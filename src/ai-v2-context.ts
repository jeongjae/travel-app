import {
  aiV2Limits,
  aiV2PlanningDtoSchema,
  aiV2RequestSchema,
  aiV2ResearchDtoSchema,
  consentFingerprint,
  type AiV2Payload,
  type AiV2PlanningDto,
  type AiV2Policy,
  type AiV2RequestKind,
} from './ai-v2-contract.ts';
import type { PlanVersion, TimeSpec, TripDataset } from './contracts/v2/index.ts';
import { nextDate } from './ai-v2-semantics.ts';

export type AiV2DayTimes = Record<string, { arrival?: string; departure?: string; ignoreTransit?: boolean }>;
export type AiV2Selection = {
  prompt: string;
  requestKind: AiV2RequestKind;
  fromDate: string;
  count: number;
  /** 사용자가 고른 기록만 전송한다. 기본은 빈 목록이다. */
  recordIds?: string[];
  /** 요청에만 쓰는 도착·출발 시각. 저장 데이터는 바꾸지 않는다. */
  dayTimes?: AiV2DayTimes;
};
type Day = PlanVersion['days'][number];
type Item = PlanVersion['items'][number];
type Leg = PlanVersion['legs'][number];
type FieldRecord = TripDataset['records'][number];

export type SelectableRecord = { id: string; kind: 'actual' | 'note' | 'legacy-state'; date: string; summary: string };

const requestKindLabel: Record<AiV2RequestKind, string> = { add: '추가', edit: '수정', remove: '제거' };
const longDistanceLeg =
  /flight|plane|air|항공|비행|train|rail|ktx|tgv|기차|열차|철도|ferry|페리|선박|배편|coach|고속버스/i;

export function currentPlan(dataset: TripDataset) {
  return dataset.plans.find((plan) => plan.planVersionId === dataset.header.currentPlanVersionId)!;
}

export function selectedDays(dataset: TripDataset, fromDate: string, count: number): Day[] {
  return currentPlan(dataset)
    .days.filter((day) => day.date >= fromDate)
    .sort((a, b) => a.ordinal - b.ordinal)
    .slice(0, Math.min(aiV2Limits.maxDays, Math.max(1, count)));
}

function clockOf(time: TimeSpec | undefined) {
  if (time && (time.precision === 'local' || time.precision === 'instant')) {
    return time.localTime.slice(0, 5);
  }
  return null;
}

/**
 * 그날 장거리 이동으로 정해지는 시간 제약. 이동(leg)에는 시각 필드가 없어 양 끝 활동의 시작 시각으로 얻는다.
 * - 그날 첫 활동에서 떠나는 이동: 도착 시각. 그 전에는 제안할 수 없다.
 * - 그날 마지막 활동으로 끝나고 앞에 다른 활동이 있는 이동: 출발 시각. 그 뒤에는 제안할 수 없다.
 * - 그 밖의 이동: 앞뒤 일정이 모두 있으므로 이동 구간만 막는다. 창을 하나로 합치지 않는다.
 */
export function deriveDayTimes(plan: PlanVersion, day: Day) {
  const items = plan.items.filter((item) => item.dayId === day.dayId).sort((a, b) => a.order - b.order);
  const position = (activityId: string) => items.findIndex((item) => item.activityId === activityId);
  const startOf = (activityId: string) => clockOf(items.find((item) => item.activityId === activityId)?.time.start);
  const legs = plan.legs
    .filter((leg) => leg.dayId === day.dayId && longDistanceLeg.test(leg.mode))
    .sort((a, b) => position(a.fromActivityId) - position(b.fromActivityId));
  let arrival: string | null = null;
  let departure: string | null = null;
  const blocked: { from: string; to: string }[] = [];
  // 출발 후보가 여럿이면 가장 이른 시각이 그날의 끝이다.
  const setDeparture = (from: string | null) => {
    if (from && (departure === null || from < departure)) {
      departure = from;
    }
  };
  legs.forEach((leg) => {
    const from = startOf(leg.fromActivityId);
    const to = startOf(leg.toActivityId);
    const startsDay = position(leg.fromActivityId) === 0;
    const endsDay = position(leg.toActivityId) === items.length - 1;
    if (startsDay) {
      arrival = to;
    } else if (endsDay) {
      setDeparture(from);
    } else if (from && to && from < to) {
      blocked.push({ from, to });
    } else if (from && to && from > to) {
      // 자정을 넘는 낮 구간은 버리지 않고 그날의 끝(출발 시각)으로 승격한다.
      setDeparture(from);
    }
  });
  if (arrival && departure && arrival > departure) {
    return { arrival: null, departure: null, blocked };
  }
  return { arrival, departure, blocked };
}

/**
 * 화면에 보일 값이자 전송할 값. 사용자가 비우면(빈 문자열) 추정값으로 되돌아가지 않는다.
 * 전송 내용도 이 함수로 만들어 화면과 본문이 갈라지지 않게 한다.
 */
export function displayedDayTimes(plan: PlanVersion, day: Day, dayTimes?: AiV2DayTimes) {
  const derived = deriveDayTimes(plan, day);
  const entered = dayTimes?.[day.dayId];
  return {
    arrival: entered?.arrival ?? derived.arrival ?? '',
    departure: entered?.departure ?? derived.departure ?? '',
    arrivalEstimated: entered?.arrival === undefined,
    departureEstimated: entered?.departure === undefined,
    blocked: entered?.ignoreTransit ? [] : derived.blocked,
    transit: derived.blocked,
    ignoreTransit: Boolean(entered?.ignoreTransit),
  };
}

/** `supersedes`로 대체된 기록을 빼서 정정 전 값이 전송되지 않게 한다. */
function latestRecords(records: FieldRecord[]) {
  const superseded = new Set(records.flatMap((record) => (record.supersedes ? [record.supersedes] : [])));
  return records.filter((record) => !superseded.has(record.recordId));
}

function recordDate(record: FieldRecord, days: Day[], items: Item[]) {
  if (record.kind === 'actual') {
    return record.payload.time.start.date ?? record.recordedAt.slice(0, 10);
  }
  if (record.kind !== 'note' && record.kind !== 'legacy-state') {
    return null;
  }
  const target = record.payload.targetRef;
  if (target.targetKind === 'day') {
    return days.find((day) => day.dayId === target.entityId)?.date ?? null;
  }
  if (target.targetKind === 'activity') {
    const item = items.find((candidate) => candidate.activityId === target.entityId);
    return days.find((day) => day.dayId === item?.dayId)?.date ?? null;
  }
  return null;
}

function recordSummary(record: FieldRecord) {
  switch (record.kind) {
    case 'actual':
      return `${record.payload.title} · ${record.payload.outcome} · ${record.payload.note}`;
    case 'note':
      return record.payload.body;
    case 'legacy-state':
      return `${record.payload.state} · ${record.payload.note} · 실제 방문 시각 미상`;
    default:
      return '';
  }
}

/** 선택 날짜에 속한 최신 유효 기록. 날짜를 알 수 없는 기록과 작업 체크는 고를 수 없다. */
export function selectableRecords(dataset: TripDataset, fromDate: string, count: number): SelectableRecord[] {
  const plan = currentPlan(dataset);
  const days = selectedDays(dataset, fromDate, count);
  const dates = new Set(days.map((day) => day.date));
  return latestRecords(dataset.records).flatMap((record): SelectableRecord[] => {
    const when = recordDate(record, plan.days, plan.items);
    if (!when || !dates.has(when) || record.kind === 'task-state') {
      return [];
    }
    return [{ id: record.recordId, kind: record.kind, date: when, summary: recordSummary(record) }];
  });
}

export function defaultResearchQuestion(kind: AiV2RequestKind, dates: string[], placeNames: string[]) {
  const where = placeNames.length ? placeNames.join(', ') : '선택 날짜의 방문지';
  const when = dates.length > 1 ? `${dates[0]}~${dates.at(-1)}` : dates[0];
  return `${when} ${where} 일정 ${requestKindLabel[kind]}에 필요한 운영시간, 휴무일, 요금, 예약 필요 여부를 공식 출처에서 확인`;
}

/** 선택 범위 다음 날의 시각만 알린다. 그날의 제목·활동 내용은 보내지 않는다. */
function followingDayOf(plan: PlanVersion, days: Day[]) {
  const last = days.at(-1);
  const date = last ? nextDate(last.date) : undefined;
  const day = plan.days.find((candidate) => candidate.date === date);
  if (!day || !date) {
    return {};
  }
  const starts = plan.items
    .filter((item) => item.dayId === day.dayId)
    .flatMap((item) => {
      const start = clockOf(item.time.start);
      return start ? [start] : [];
    })
    .sort();
  const { arrival } = deriveDayTimes(plan, day);
  return {
    followingDay: {
      date,
      ...(starts[0] ? { firstStart: starts[0] } : {}),
      ...(arrival ? { arrival } : {}),
    },
  };
}

/** 전송 내용 생성. 저장 모델을 복사하지 않고 허용한 필드만 옮기며, 동의는 여기서 정하지 않는다. */
export function buildAiV2Payload(dataset: TripDataset, selection: AiV2Selection): AiV2Payload {
  const plan = currentPlan(dataset);
  const days = selectedDays(dataset, selection.fromDate, selection.count);
  const dayIds = new Set(days.map((day) => day.dayId));
  const items = plan.items.filter((item) => dayIds.has(item.dayId));
  const itemIds = new Set(items.map((item) => item.activityId));
  const referenced = new Set(items.flatMap((item) => item.placeLinks.map((link) => link.placeId)));
  const places = dataset.contents.flatMap((content) => {
    const active = dataset.heads.some(
      (head) =>
        head.targetKind === content.kind &&
        head.entityId === content.entityId &&
        head.revisionId === content.revisionId &&
        head.status === 'active',
    );
    if (content.kind !== 'place' || !active || !referenced.has(content.entityId)) {
      return [];
    }
    return [{ id: content.entityId, name: content.payload.name, summary: content.payload.summary }];
  });
  const chosen = new Set(selection.recordIds ?? []);
  const records = selectableRecords(dataset, selection.fromDate, selection.count)
    .filter((record) => chosen.has(record.id))
    .map((record) => ({ id: record.id, kind: record.kind, date: record.date, summary: record.summary }));
  const planning: AiV2PlanningDto = {
    request: selection.prompt,
    requestKind: selection.requestKind,
    fromDate: selection.fromDate,
    trip: { startDate: dataset.header.startDate, endDate: dataset.header.endDate },
    days: days.map((day) => {
      const shown = displayedDayTimes(plan, day, selection.dayTimes);
      return {
        dayId: day.dayId,
        date: day.date,
        cityText: day.cityText,
        title: day.title,
        ...(shown.arrival ? { arrival: shown.arrival } : {}),
        ...(shown.departure ? { departure: shown.departure } : {}),
        ...(shown.blocked.length ? { blocked: shown.blocked } : {}),
      };
    }),
    items: items.map((item) => ({
      activityId: item.activityId,
      dayId: item.dayId,
      order: item.order,
      title: item.title,
      category: item.category,
      summary: item.summary,
      start: clockOf(item.time.start),
      end: clockOf(item.time.end),
      // 예약 원값 대신 "옮기면 안 되는 시간대"라는 사실만 보낸다.
      fixed: item.bookingIds.length > 0,
      placeId: item.placeLinks[0]?.placeId ?? null,
    })),
    legs: plan.legs
      .filter((leg) => dayIds.has(leg.dayId) && itemIds.has(leg.fromActivityId) && itemIds.has(leg.toActivityId))
      .map((leg) => ({
        dayId: leg.dayId,
        fromActivityId: leg.fromActivityId,
        toActivityId: leg.toActivityId,
        mode: leg.mode,
        durationText: leg.durationText ?? null,
      })),
    places,
    ...followingDayOf(plan, days),
    records,
  };
  const dates = days.map((day) => day.date);
  const placeNames = places.map((place) => place.name);
  return {
    id: crypto.randomUUID(),
    scope: {
      tripId: dataset.header.tripId,
      baseDomainRevision: dataset.header.domainRevision,
      basePlanVersionId: plan.planVersionId,
    },
    research: aiV2ResearchDtoSchema.parse({
      question: defaultResearchQuestion(selection.requestKind, dates, placeNames),
      requestKind: selection.requestKind,
      dates,
      places: placeNames.map((name) => ({ name })),
    }),
    planning: aiV2PlanningDtoSchema.parse(planning),
  };
}

/** 사용자가 동의한 순간에만 호출한다. 지문이 서버의 재계산 값과 다르면 서버가 거부한다. */
export async function consentedRequest(payload: AiV2Payload, policy: AiV2Policy) {
  const fingerprint = await consentFingerprint(payload, policy);
  return aiV2RequestSchema.parse({ ...payload, consent: { ...policy, fingerprint } });
}
