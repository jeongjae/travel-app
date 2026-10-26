import {
  digestBytes,
  fieldRecordSchema,
  type ContentRevision,
  type FieldRecord,
  type PlanVersion,
  type TargetRef,
} from '../contracts/v2/index.ts';
import { sourceObject as obj, sourceText as text, sourceRefFor, type SourceExtract } from './spfr-source.ts';

/** Import source notes/checks as legacy state, never infer an actual occurrence time. */
export async function mapSpfrFieldState(extract: SourceExtract, plan: PlanVersion, contents: ContentRevision[]) {
  const records: FieldRecord[] = [];
  const imported = new Set<string>();
  const errors: string[] = [];
  const targetFor = (key: string): TargetRef | undefined => {
    const match = /^(day-\d+)(?:\/(.+))?$/.exec(key);
    if (!match || !plan.days.some((day) => day.dayId === match[1])) {
      return undefined;
    }
    const activityId = match[2] ? `${match[1]}-${match[2]}` : undefined;
    if (activityId && !plan.items.some((item) => item.activityId === activityId)) {
      errors.push(`FIELD_TARGET_MISSING:${key}`);
      return undefined;
    }
    return {
      tripId: plan.tripId,
      targetKind: activityId ? 'activity' : 'day',
      entityId: activityId ?? match[1],
      planVersionId: plan.planVersionId,
    };
  };
  const add = async (path: string, locator: string, raw: unknown, payload: unknown, kind: FieldRecord['kind']) => {
    const value = obj(raw);
    const recordId = `source-state-${(await digestBytes(new TextEncoder().encode(locator))).slice(0, 24)}`;
    records.push(
      fieldRecordSchema.parse({
        tripId: plan.tripId,
        recordId,
        recordedAt: value.ts,
        sourceRefs: [sourceRefFor(path, locator)],
        commitSeq: 1,
        kind,
        payload,
      }),
    );
  };
  for (const basename of ['field-notes', 'booking-overrides']) {
    const path = `data/${basename}.json`;
    const data = obj(extract.entries.find((entry) => entry.sourceKey === path)!.rawValue);
    for (const [group, collection] of Object.entries(data)) {
      if (group === 'version' || group === 'note' || !collection || typeof collection !== 'object') {
        continue;
      }
      for (const [key, raw] of Object.entries(collection)) {
        const value = obj(raw);
        const locator = `${path}#/${group}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
        if (basename === 'booking-overrides') {
          const booking = contents.find((content) => content.kind === 'booking' && content.entityId === `xlsx-${key}`);
          if (booking?.kind !== 'booking') {
            continue;
          }
          await add(
            path,
            locator,
            value,
            {
              targetRef: { tripId: plan.tripId, targetKind: 'booking', entityId: booking.entityId },
              body: `원천 예약 상태 변경: ${text(value.status)}. 신규 예약 실행/확인 시각이 아닙니다.`,
              contextRefs: [
                {
                  tripId: plan.tripId,
                  targetKind: 'booking',
                  entityId: booking.entityId,
                  revisionId: booking.revisionId,
                },
              ],
            },
            'note',
          );
          booking.payload.status = text(value.status);
          imported.add(locator);
          continue;
        }
        const entity = value.entity ? obj(value.entity) : undefined;
        const sourceEntity = entity ? text(entity.key) : key;
        const target =
          entity?.kind === 'booking' && group === 'notes'
            ? { tripId: plan.tripId, targetKind: 'trip' as const, entityId: plan.tripId }
            : targetFor(sourceEntity);
        if (!target) {
          continue;
        }
        if (group === 'notes') {
          const body =
            entity?.kind === 'booking'
              ? `원천 대상 ${sourceEntity} · 앱 예약 연결 미확정\n\n${text(value.text)}`
              : text(value.text);
          await add(path, locator, value, { targetRef: target, body, contextRefs: [] }, 'note');
        } else if (group === 'visited') {
          if (typeof value.value !== 'boolean') {
            errors.push(`FIELD_VISITED_VALUE_INVALID:${locator}`);
            continue;
          }
          await add(
            path,
            locator,
            value,
            {
              targetRef: target,
              state: value.value ? 'visited' : 'not-visited',
              sourceKey: key,
              originalTime: {
                precision: 'text',
                rawText: text(value.ts),
                interpretation: '원천 체크 저장 시각; 방문 시각 미상',
              },
              note: '원천 방문 체크 상태입니다. 실제 방문 시각을 추정하지 않았습니다.',
            },
            'legacy-state',
          );
        } else if (group === 'checkedActions') {
          for (const [action, rawAction] of Object.entries(value)) {
            const actionValue = obj(rawAction);
            if (typeof actionValue.checked !== 'boolean') {
              errors.push(`FIELD_CHECK_VALUE_INVALID:${locator}`);
              continue;
            }
            await add(
              path,
              `${locator}/${action.replaceAll('~', '~0').replaceAll('/', '~1')}`,
              actionValue,
              {
                targetRef: target,
                state: actionValue.checked ? 'checked' : 'unchecked',
                sourceKey: action,
                originalTime: {
                  precision: 'text',
                  rawText: text(actionValue.ts),
                  interpretation: '원천 체크 저장 시각',
                },
                note: '기존 실행 항목 체크입니다. 새 작업 완료나 여행 변경안 승인으로 해석하지 않습니다.',
              },
              'legacy-state',
            );
          }
        } else {
          errors.push(`FIELD_GROUP_UNSUPPORTED:${group}`);
          continue;
        }
        imported.add(locator);
      }
    }
  }
  return { records, imported, errors };
}
