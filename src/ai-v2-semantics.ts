import {
  contentRevisionSchema,
  planItemSchema,
  proposalSchema,
  type ContentRevision,
  type PlanVersion,
  type Proposal,
} from './contracts/v2/index.ts';
import type { AiV2Output, AiV2PlanningDto, AiV2Source } from './ai-v2-contract.ts';

export type AiV2Result = { proposal: Omit<Proposal, 'commitSeq'>; evidence: ContentRevision[] };
/** 저장 스키마를 바꾸지 않고 항목별 사유를 함께 보존하는 근거 행의 표식. */
export const operationReasonsRef = 'ai-operation-reasons';
const earliestRealisticHour = 5;

function overlaps(startA: string, endA: string | null, startB: string, endB: string | null) {
  const finishA = endA ?? startA;
  const finishB = endB ?? startB;
  if (startA === finishA || startB === finishB) {
    return startA <= finishB && startB <= finishA;
  }
  return startA < finishB && startB < finishA;
}

export function isUnrealisticTime(time: string | null) {
  return time !== null && Number(time.slice(0, 2)) < earliestRealisticHour;
}

/**
 * 서버와 브라우저가 같은 규칙으로 쓰는 AI 출력 검증. 어긋나면 던지고, 저장은 되지만 사용자에게
 * 보일 주의점은 돌려준다. 예약 활동 자체의 변경은 거부하지 않고 화면의 "확인 필요"로 넘긴다.
 */
export function validateAiV2Output(planning: AiV2PlanningDto, output: AiV2Output, sources: AiV2Source[]) {
  const warnings: string[] = [];
  const urls = new Set(sources.map((source) => source.url));
  output.evidence.forEach((entry) => {
    if (!urls.has(entry.url)) {
      throw new Error('조사 목록에 없는 근거 URL입니다.');
    }
    if (entry.operationIndexes.some((index) => index >= output.operations.length)) {
      throw new Error('근거가 없는 변경 항목을 가리킵니다.');
    }
  });
  const seen = new Set<string>();
  output.operations.forEach((operation) => {
    if (operation.type === 'add' && operation.activityId !== '') {
      throw new Error('새 활동 추가에는 기존 활동 ID를 사용할 수 없습니다.');
    }
    const day = planning.days.find((candidate) => candidate.dayId === operation.dayId);
    const old = planning.items.find((item) => item.activityId === operation.activityId);
    if (!day || day.date < planning.fromDate || (operation.type !== 'add' && !old)) {
      throw new Error('변경 날짜·활동이 허용 범위 밖입니다.');
    }
    if (operation.type !== 'add') {
      if (seen.has(operation.activityId)) {
        throw new Error('한 변경안에서 같은 활동을 여러 번 바꿀 수 없습니다.');
      }
      seen.add(operation.activityId);
    }
    if (operation.type === 'remove') {
      return;
    }
    if (operation.placeId && !planning.places.some((place) => place.id === operation.placeId)) {
      throw new Error('알 수 없는 장소입니다.');
    }
    const { startTime, endTime } = operation;
    if (startTime && endTime && endTime < startTime) {
      throw new Error('종료 시각이 시작 시각보다 빠릅니다.');
    }
    const earliest = startTime ?? endTime;
    const latest = endTime ?? startTime;
    if (!earliest || !latest) {
      return;
    }
    if (day.arrival && earliest < day.arrival) {
      throw new Error(`${day.date} 도착 시각 ${day.arrival} 이전의 제안입니다.`);
    }
    if (day.departure && latest > day.departure) {
      throw new Error(`${day.date} 출발 시각 ${day.departure} 이후의 제안입니다.`);
    }
    day.blocked.forEach((gap) => {
      if (earliest < gap.to && gap.from < latest) {
        throw new Error(`${day.date} 이동 구간 ${gap.from}~${gap.to}와 겹칩니다.`);
      }
      if (earliest === latest && earliest > gap.from && earliest < gap.to) {
        throw new Error(`${day.date} 이동 구간 ${gap.from}~${gap.to} 안의 제안입니다.`);
      }
    });
    planning.items
      .filter((item) => item.dayId === day.dayId && item.fixed && item.activityId !== operation.activityId)
      .forEach((item) => {
        if (item.start && overlaps(earliest, latest, item.start, item.end)) {
          throw new Error(`고정 활동 ${item.start} 시간대와 겹칩니다.`);
        }
      });
    if (isUnrealisticTime(earliest)) {
      warnings.push(`${operation.title || operation.activityId}: ${earliest}은 비현실적인 시각일 수 있습니다.`);
    }
  });
  return warnings;
}

const governmentHost = /(^|\.)(go\.kr|gov|gov\.[a-z]{2}|gouv\.fr|go\.jp|gc\.ca|europa\.eu|admin\.ch)$/i;
const pressHost =
  /(^|\.)(yna\.co\.kr|chosun\.com|joongang\.co\.kr|donga\.com|hani\.co\.kr|khan\.co\.kr|kbs\.co\.kr|mbc\.co\.kr|sbs\.co\.kr|hankookilbo\.com|nytimes\.com|bbc\.com|bbc\.co\.uk|reuters\.com|apnews\.com|lemonde\.fr|theguardian\.com)$/i;

function hostOf(url: string | undefined) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./i, '').toLowerCase() : '';
  } catch {
    return '';
  }
}

export function officialHosts(plan: PlanVersion) {
  return new Set(plan.items.map((item) => hostOf(item.officialUrl)).filter(Boolean));
}

export type SourceKind = 'official' | 'press' | 'community';

/** 출처 종류는 모델의 주장을 받지 않고 주소로만 정한다. 활동의 공식 주소와 정부 도메인만 공식이다. */
export function classifySource(url: string, official: Set<string>): SourceKind {
  const host = hostOf(url);
  const matchesOfficial = [...official].some((known) => host === known || host.endsWith(`.${known}`));
  if (matchesOfficial || governmentHost.test(host)) {
    return 'official';
  }
  return pressHost.test(host) ? 'press' : 'community';
}

const volatileFact =
  /요금|가격|입장료|운임|비용|운영\s*(시간|상태|중)|영업|개방|휴무|휴관|휴업|휴일|정기\s*휴|폐쇄|폐관|폐점|계절|동절기|하절기|시즌|price|fee|admission|opening hours|closed|closure|seasonal/i;

export function isVolatileFact(text: string) {
  return volatileFact.test(text);
}

export type AiV2LocalContext = {
  id: string;
  tripId: string;
  baseDomainRevision: number;
  /** 작업 기준의 전체 계획. 서버로 보내지 않은 필드를 그대로 보존하기 위해 브라우저에서 넣는다. */
  plan: PlanVersion;
  planning: AiV2PlanningDto;
  collectedAt: string;
};

/**
 * 저장할 변경안을 완성한다. 같은 작업이면 같은 결과가 나와야 재회수가 중복 저장되지 않으므로
 * 현재 시각 대신 작업 완료 시각(`collectedAt`)을 쓴다.
 */
export function materializeV2Proposal(
  local: AiV2LocalContext,
  output: AiV2Output,
  research: { sources: AiV2Source[] },
): AiV2Result {
  const { plan, planning, tripId } = local;
  validateAiV2Output(planning, output, research.sources);
  const proposalId = `ai-${local.id}`;
  const official = officialHosts(plan);
  const activityIdOf = (index: number) => {
    const operation = output.operations[index];
    return operation.type === 'add' ? `${proposalId}-item-${index}` : operation.activityId;
  };
  const evidenceRow = (entityId: string, payload: unknown) =>
    contentRevisionSchema.parse({
      tripId,
      entityId,
      kind: 'evidence',
      revisionId: 'ai-1',
      schemaVersion: 2,
      recordedAt: local.collectedAt,
      actor: 'ai',
      commitSeq: 1,
      sourceRefs: [],
      payload,
    });
  const evidence = output.evidence.map((source, index) =>
    evidenceRow(`${proposalId}-evidence-${index}`, {
      sourceType: 'web',
      sourceUrlOrRef: source.url,
      claim: source.claim,
      collectedAt: local.collectedAt,
      label: research.sources.find((entry) => entry.url === source.url)!.title,
      // 공식 출처의 확인 날짜만 확인 시각으로 인정한다. 모델이 다른 출처를 확인됐다고 해도 저장하지 않는다.
      ...(source.checkedAt && classifySource(source.url, official) === 'official'
        ? { sourceVerifiedAt: { precision: 'date', date: source.checkedAt } }
        : {}),
      // 참조는 기준 계획에 있는 활동만 가능하다. 새 활동은 카드에서 변경안 전체의 근거로 센다.
      relatedRefs: source.operationIndexes
        .filter((operationIndex) => output.operations[operationIndex].type !== 'add')
        .map((operationIndex) => ({
          tripId,
          targetKind: 'activity',
          entityId: activityIdOf(operationIndex),
          planVersionId: plan.planVersionId,
        })),
    }),
  );
  const reasons = Object.fromEntries(
    output.operations.map((operation, index) => [activityIdOf(index), operation.reason]),
  );
  const reasonRow = evidenceRow(`${proposalId}-reasons`, {
    sourceType: 'local',
    sourceUrlOrRef: operationReasonsRef,
    label: 'AI 항목별 사유',
    claim: JSON.stringify(reasons),
    collectedAt: local.collectedAt,
    relatedRefs: [],
  });
  const operations = output.operations.map((operation, index) => {
    const activityId = activityIdOf(index);
    const old = plan.items.find((item) => item.activityId === operation.activityId);
    const day = plan.days.find((candidate) => candidate.dayId === operation.dayId);
    if (!day || (operation.type !== 'add' && !old)) {
      throw new Error('변경 날짜·활동이 허용 범위 밖입니다.');
    }
    if (operation.type === 'remove') {
      return { type: 'remove-item' as const, activityId };
    }
    const clock = (value: string | null) =>
      value
        ? { precision: 'local' as const, date: day.date, localTime: value, timeZoneStatus: 'unknown' as const }
        : { precision: 'unspecified' as const, date: day.date };
    const time =
      operation.startTime === null && operation.endTime === null && old?.dayId === day.dayId
        ? old.time
        : { start: clock(operation.startTime), ...(operation.endTime ? { end: clock(operation.endTime) } : {}) };
    const item = planItemSchema.parse({
      ...(old ?? {
        tripId,
        planVersionId: plan.planVersionId,
        category: 'ai-proposed',
        optional: false,
        bookingIds: [],
        taskRefs: [],
        executionMarkers: [],
        sourceFlags: ['AI 제안 · 사용자 확인 전'],
      }),
      activityId,
      dayId: day.dayId,
      order:
        (old?.dayId === day.dayId ? old.order : undefined) ??
        Math.max(0, ...plan.items.filter((entry) => entry.dayId === day.dayId).map((entry) => entry.order)) + index + 1,
      title: operation.title,
      summary: operation.summary,
      time,
      placeLinks: operation.placeId ? [{ placeId: operation.placeId, relation: 'visit' }] : [],
    });
    // A moved/replaced place must not inherit coordinates belonging to the old place.
    if (old && (old.dayId !== day.dayId || old.placeLinks[0]?.placeId !== operation.placeId)) {
      delete item.mapTargetId;
    }
    return { type: 'upsert-item' as const, item };
  });
  const rows = [...evidence, reasonRow];
  const checked = proposalSchema.parse({
    tripId,
    proposalId,
    proposalRevisionId: `${proposalId}-draft-1`,
    proposalRevision: 1,
    // Atomic staging adds the evidence and advances the domain revision once.
    baseDomainRevision: local.baseDomainRevision + 1,
    basePlanVersionId: plan.planVersionId,
    origin: 'ai',
    operations,
    reason: output.reason,
    evidenceRefs: rows.map((entry) => ({
      tripId,
      targetKind: 'evidence',
      entityId: entry.entityId,
      revisionId: entry.revisionId,
    })),
    impact: {
      activityIds: output.operations.map((_, index) => activityIdOf(index)),
      reservationText: output.reservationImpact,
    },
    status: 'pending',
    commitSeq: 1,
  });
  const { commitSeq: _, ...proposal } = checked;
  return { proposal, evidence: rows };
}
