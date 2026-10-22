import { z } from 'zod';
import {
  sourceExtractSchema,
  validateTripDataset,
  type TripDataset,
  type ContentRevision,
  timeSpecSchema,
} from '../contracts/v2/index.ts';
import type { ImportMapping } from '../storage/content-repository.ts';
import { comparablePlan, comparableTrip } from './comparable.ts';
export type NormalizationRule =
  | { sourceKey: string; targetBookingId: string; mode: 'python-booking'; index: number }
  | { sourceKey: string; targetBookingId: string; mode: 'xlsx-booking' };
export type ImportReport = {
  adapterVersion: string;
  sourceCommit: string;
  decisions: {
    sourceKey: string;
    locator: string;
    disposition: 'direct' | 'transformed' | 'retained-source' | 'unresolved';
    target: string;
    reason: string;
    rawValue: unknown;
  }[];
  blocking: string[];
};
export function normalizeExtract(
  raw: unknown,
  datasetSourceKey: string,
  rules: NormalizationRule[] = [],
  retainedUnresolved: string[] = [],
) {
  const extract = sourceExtractSchema.parse(raw),
    seed = extract.entries.find((e) => e.sourceKey === datasetSourceKey && e.sourceKind === 'json');
  if (!seed) {
    throw new Error('정규화된 공통 여행 JSON 원천을 지정하세요.');
  }
  const dataset = validateTripDataset(seed.rawValue),
    report: ImportReport = {
      adapterVersion: 'neutral-v1',
      sourceCommit: extract.sourceCommit,
      decisions: [],
      blocking: [],
    };
  const mapped = new Set([datasetSourceKey]);
  for (const rule of rules) {
    if (rule.mode === 'xlsx-booking') {
      const match = /^(.*!)([A-Z]+)(\d+)$/.exec(rule.sourceKey);
      if (!match) {
        throw new Error('XLSX 예약 행의 A열 locator가 필요합니다.');
      }
      const cell = (col: string) => {
        const e = extract.entries.find((e) => e.sourceKey === `${match[1]}${col}${match[3]}`);
        return e ? z.record(z.string(), z.json()).parse(e.rawValue).value : undefined;
      };
      const template = dataset.contents.find((c) => c.kind === 'booking');
      if (template?.kind !== 'booking') {
        throw new Error('예약 형식의 기준 행이 필요합니다.');
      }
      if (cell('A') !== rule.targetBookingId || typeof cell('E') !== 'string') {
        throw new Error('XLSX 행 ID/상태를 확인하세요.');
      }
      const dateCell = cell('C'),
        sourceDate =
          typeof dateCell === 'object' && dateCell !== null && 'isoValue' in dateCell
            ? String(dateCell.isoValue).slice(0, 10)
            : undefined;
      const payload: Extract<ContentRevision, { kind: 'booking' }>['payload'] = {
        type: 'unspecified',
        title: String(cell('A')),
        activityIds: [],
        time: { start: { precision: 'unspecified' } },
        sourceStatusRaw: String(cell('E')),
        status: 'needs-review',
        note: String(cell('F') ?? ''),
        actionTiming: { precision: 'unspecified' },
      };
      payload.time = {
        start: timeSpecSchema.parse(
          typeof cell('D') === 'string'
            ? { precision: 'text', rawText: cell('D'), ...(sourceDate ? { date: sourceDate } : {}) }
            : sourceDate
              ? { precision: 'date', date: sourceDate }
              : { precision: 'unspecified' },
        ),
      };
      if (typeof cell('B') === 'string') {
        payload.placeId = String(cell('B'));
      }
      const sourceRefs = [
        { sourceKind: 'xlsx', sourceKey: rule.sourceKey, sourcePath: match[1].split(':')[0], locator: rule.sourceKey },
      ];
      dataset.contents.push({ ...template, entityId: rule.targetBookingId, sourceRefs, payload });
      dataset.heads.push({
        tripId: dataset.header.tripId,
        targetKind: 'booking',
        entityId: rule.targetBookingId,
        revisionId: template.revisionId,
        status: 'active',
      });
      for (const p of dataset.plans) {
        p.contextRefs.push({
          tripId: dataset.header.tripId,
          targetKind: 'booking',
          entityId: rule.targetBookingId,
          revisionId: template.revisionId,
        });
      }
      for (const e of extract.entries.filter((e) =>
        new RegExp(`^${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[A-Z]+${match[3]}$`).test(e.sourceKey),
      )) {
        mapped.add(e.sourceKey);
        report.decisions.push({
          sourceKey: e.sourceKey,
          locator: e.locator,
          disposition: e.sourceKey.includes(`!G${match[3]}`) ? 'retained-source' : 'transformed',
          target: `booking/${rule.targetBookingId}`,
          reason: '명시적 neutral 예약 열 A~F 대응. 금액 열은 예약 원문 보고서에 보존.',
          rawValue: e.rawValue,
        });
      }
      continue;
    }
    const entry = extract.entries.find((e) => e.sourceKey === rule.sourceKey);
    if (!entry || !Array.isArray(entry.rawValue)) {
      throw new Error('예약 리터럴 원천이 없습니다.');
    }
    const record = z.record(z.string(), z.json()).parse(entry.rawValue[rule.index]);
    const booking = dataset.contents.find((c) => c.kind === 'booking' && c.entityId === rule.targetBookingId);
    if (booking?.kind !== 'booking') {
      throw new Error('예약 대상 대응이 없습니다.');
    }
    const string = (key: string, fallback: string) =>
      typeof record[key] === 'string' ? (record[key] as string) : fallback;
    booking.payload.title = string('name', booking.payload.title);
    booking.payload.sourceStatusRaw = string('canonical_status', booking.payload.sourceStatusRaw);
    booking.payload.stageText = string('stage', '');
    booking.payload.actionTiming = { precision: 'text', rawText: string('when', '시점 미상') };
    booking.payload.time = {
      start: timeSpecSchema.parse({
        precision: 'text',
        ...(typeof record.date === 'string' ? { date: record.date } : {}),
        rawText: string('schedule', '시각 미상'),
      }),
    };
    booking.payload.passNote = string('pass_note', '');
    booking.payload.planB = string('plan_b', '');
    booking.payload.note = string('note', '');
    booking.sourceRefs = [
      {
        sourceKind: entry.sourceKind,
        sourceKey: entry.sourceKey,
        locator: entry.locator,
        sourcePath: extract.manifest.find((f) => entry.sourceKey.startsWith(f.path))?.path ?? entry.sourceKey,
      },
    ];
    mapped.add(entry.sourceKey);
    report.decisions.push({
      sourceKey: entry.sourceKey,
      locator: entry.locator,
      disposition: 'transformed',
      target: `booking/${booking.entityId}`,
      reason: '명시적 예약 대응 규칙. 원문 전체는 보고서에 보존.',
      rawValue: record,
    });
  }
  for (const entry of extract.entries) {
    if (!report.decisions.some((d) => d.sourceKey === entry.sourceKey)) {
      const blocking = entry.status === 'unresolved' && !retainedUnresolved.includes(entry.sourceKey);
      if (blocking) {
        report.blocking.push(entry.sourceKey);
      }
      report.decisions.push({
        sourceKey: entry.sourceKey,
        locator: entry.locator,
        disposition: blocking ? 'unresolved' : mapped.has(entry.sourceKey) ? 'direct' : 'retained-source',
        target: mapped.has(entry.sourceKey) ? 'dataset' : 'report',
        reason: blocking
          ? (entry.issue ?? '미해결')
          : '공통 JSON 계약 또는 명시적으로 보존한 원천. retained-source는 화면 이행 완료가 아님.',
        rawValue: entry.rawValue,
      });
    }
  }
  validateTripDataset(dataset);
  const mappings = currentMappings(dataset);
  return { dataset, report, mappings, extract };
}
export function currentMappings(dataset: TripDataset): ImportMapping[] {
  const result: ImportMapping[] = dataset.heads
    .filter((h) => h.status === 'active')
    .map((h) => {
      const c = dataset.contents.find(
        (c) => c.kind === h.targetKind && c.entityId === h.entityId && c.revisionId === h.revisionId,
      )!;
      return {
        sourceKind: c.kind,
        sourceKey: c.entityId,
        targetKind: c.kind,
        entityId: c.entityId,
        baselineValue: c.payload,
        sourceRefs: c.sourceRefs,
      };
    });
  result.push(
    {
      sourceKind: 'plan',
      sourceKey: 'current-plan',
      targetKind: 'plan',
      entityId: 'current-plan',
      baselineValue: comparablePlan(
        dataset.plans.find((p) => p.planVersionId === dataset.header.currentPlanVersionId)!,
      ),
      sourceRefs: [],
    },
    {
      sourceKind: 'trip',
      sourceKey: dataset.header.tripId,
      targetKind: 'trip',
      entityId: dataset.header.tripId,
      baselineValue: comparableTrip(dataset.header),
      sourceRefs: [],
    },
  );
  return result;
}
