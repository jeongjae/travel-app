import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';

const text = z.string().trim().min(1).max(2000);
const id = z.string().min(1).max(120);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    try {
      return Temporal.PlainDate.from(v).toString() === v;
    } catch {
      return false;
    }
  }, '올바른 날짜가 필요합니다.');
const zone = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return !/^[+-]/.test(v);
  } catch {
    return false;
  }
}, 'IANA 시간대를 입력하세요.');
const instant = z.string().refine((v) => {
  try {
    Temporal.Instant.from(v);
    return /(?:Z|[+-]\d{2}:\d{2})$/.test(v);
  } catch {
    return false;
  }
}, '오프셋이 포함된 ISO 시각이 필요합니다.');
export const activitySchema = z
  .object({
    id,
    title: text,
    placeId: id.optional(),
    start: instant,
    end: instant,
    timeZone: zone,
    note: z.string().max(5000).default(''),
    sourceRef: z.string().max(2000).optional(),
  })
  .strict();
export const evidenceSchema = z
  .object({
    id,
    source: z
      .string()
      .min(1)
      .max(2000)
      .refine((v) => {
        if (!/^\w+:/.test(v)) return !v.startsWith('//');
        try {
          const url = new URL(v);
          return /^https?:$/.test(url.protocol) && !!url.hostname && !url.username && !url.password;
        } catch {
          return false;
        }
      }, '출처는 자격증명이 없는 웹 URL 또는 상대 로컬 경로로 지정하세요.'),
    claim: text,
    checkedAt: instant,
    appliesFrom: dateSchema,
    appliesTo: dateSchema,
    relatedActivityIds: z.array(id).max(1000),
    status: z.enum(['verified', 'unverified']),
  })
  .strict();
const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('upsert'), activity: activitySchema }).strict(),
  z.object({ type: z.literal('remove'), activityId: id }).strict(),
]);
export const proposalInputSchema = z
  .object({
    id,
    tripId: id,
    baseRevision: z.number().int().nonnegative(),
    reason: text,
    reservationImpact: text,
    evidence: z.array(evidenceSchema).max(1000),
    operations: z.array(operationSchema).min(1).max(1000),
  })
  .strict();
const proposalSchema = proposalInputSchema
  .extend({
    status: z.enum(['pending', 'applied', 'rejected']),
    createdAt: instant,
    basePlanNumber: z.number().int().positive(),
    decidedAt: instant.optional(),
    decidedBy: z.string().optional(),
  })
  .strict();
export const actualSchema = z
  .object({
    id,
    activityId: id.optional(),
    placeId: id.optional(),
    title: text,
    outcome: z.enum(['visited', 'skipped']),
    start: instant,
    end: instant,
    timeZone: zone,
    note: z.string().max(5000).default(''),
    createdAt: instant,
    supersedes: id.optional(),
  })
  .strict();
const versionSchema = z
  .object({
    number: z.number().int().positive(),
    createdAt: instant,
    reason: text,
    activities: z.array(activitySchema).max(2000),
    evidence: z.array(evidenceSchema).max(1000),
    proposalId: id.optional(),
  })
  .strict();
export const tripSchema = z
  .object({
    id,
    name: text,
    startDate: dateSchema,
    endDate: dateSchema,
    timeZone: zone,
    revision: z.number().int().nonnegative(),
    places: z.array(z.object({ id, name: text }).strict()).max(3000),
    versions: z.array(versionSchema).min(1).max(1000),
    actuals: z.array(actualSchema).max(10000),
    proposals: z.array(proposalSchema).max(1000),
    receipts: z.array(z.object({ id, fingerprint: z.string() }).strict()).max(20000),
  })
  .strict();
export const backupSchema = z
  .object({
    format: z.literal('travel-app-backup'),
    schemaVersion: z.literal(1),
    exportedAt: instant,
    trips: z.array(tripSchema).max(500),
  })
  .strict();
export const tripFileSchema = z
  .object({
    format: z.literal('travel-app-trip'),
    schemaVersion: z.literal(1),
    trip: tripSchema,
  })
  .strict();
export type Activity = z.infer<typeof activitySchema>;
export type ActualRecord = z.infer<typeof actualSchema>;
export type ProposalInput = z.infer<typeof proposalInputSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type Backup = z.infer<typeof backupSchema>;
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const currentPlan = (trip: Trip) => trip.versions.at(-1)!;
export const localDate = (value: string, timeZone: string) =>
  Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toPlainDate().toString();
export const localInput = (value: string, timeZone: string) =>
  Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toPlainDateTime().toString({ smallestUnit: 'minute' });
export function fromLocal(value: string, timeZone: string): string {
  try {
    const p = Temporal.PlainDateTime.from(value);
    return p.toZonedDateTime(timeZone, { disambiguation: 'reject' }).toString({ timeZoneName: 'never' });
  } catch {
    throw new Error('현지 날짜·시각 또는 시간대를 확인하세요. DST의 중복·없는 시각은 허용하지 않습니다.');
  }
}
export const addDate = (value: string, days: number) => Temporal.PlainDate.from(value).add({ days }).toString();
export function dateRange(start: string, end: string) {
  const dates: string[] = [];
  for (let d = start; d <= end && dates.length < 367; d = addDate(d, 1)) dates.push(d);
  return dates;
}
export const sortByStart = <T extends { start: string }>(rows: T[]) =>
  [...rows].sort((a, b) => Temporal.Instant.compare(a.start, b.start));
export function effectiveActuals(trip: Trip) {
  const superseded = new Set(trip.actuals.flatMap((a) => (a.supersedes ? [a.supersedes] : [])));
  return sortByStart(trip.actuals.filter((a) => !superseded.has(a.id)));
}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function unique(ids: string[], label: string) {
  assert(new Set(ids).size === ids.length, `${label} ID가 중복됩니다.`);
}
function validateTime(row: { start: string; end: string; timeZone: string }) {
  assert(Temporal.Instant.compare(row.start, row.end) <= 0, '종료 시각은 시작 이후여야 합니다.');
  for (const value of [row.start, row.end]) {
    // An offset must describe the stated destination zone; Z is an explicit instant.
    if (!value.endsWith('Z')) {
      try {
        Temporal.ZonedDateTime.from(`${value}[${row.timeZone}]`, { offset: 'reject' });
      } catch {
        throw new Error('시각의 오프셋과 시간대가 일치하지 않습니다.');
      }
    }
  }
}
export function applyOperations(trip: Trip, operations: Operation[]): Activity[] {
  const activities = structuredClone(currentPlan(trip).activities);
  unique(
    operations.map((o) => (o.type === 'upsert' ? o.activity.id : o.activityId)),
    '변경 대상',
  );
  for (const op of operations) {
    const activityId = op.type === 'upsert' ? op.activity.id : op.activityId;
    const index = activities.findIndex((a) => a.id === activityId);
    if (op.type === 'remove') {
      assert(index >= 0, '제거할 일정이 현재 계획에 없습니다.');
      activities.splice(index, 1);
    } else if (index >= 0) activities[index] = op.activity;
    else activities.push(op.activity);
  }
  return sortByStart(activities);
}
export function validateTrip(input: unknown): Trip {
  const t = tripSchema.parse(input);
  assert(t.revision >= t.versions.length - 1 + t.actuals.length, '여행 revision과 변경 이력이 일치하지 않습니다.');
  assert(t.startDate <= t.endDate, '여행 종료일을 확인하세요.');
  assert(Temporal.PlainDate.from(t.startDate).until(t.endDate).days <= 366, '첫 버전은 367일 이내 여행을 지원합니다.');
  unique(
    t.places.map((p) => p.id),
    '장소',
  );
  unique(
    t.actuals.map((a) => a.id),
    '실제 기록',
  );
  unique(
    t.proposals.map((p) => p.id),
    '변경안',
  );
  unique(
    t.receipts.map((r) => r.id),
    '요청',
  );
  const places = new Set(t.places.map((p) => p.id));
  const historical = new Set(t.versions.flatMap((v) => v.activities.map((a) => a.id)));
  const actualIds = new Set<string>();
  const corrected = new Set<string>();
  const checkRow = (a: Activity | ActualRecord) => {
    validateTime(a);
    const date = localDate(a.start, a.timeZone);
    assert(date >= t.startDate && date <= t.endDate, '활동 시작 날짜가 여행 기간을 벗어났습니다.');
    assert(!a.placeId || places.has(a.placeId), '같은 여행의 장소를 참조해야 합니다.');
  };
  const checkEvidence = (e: Evidence, allowed: Set<string>) => {
    assert(e.appliesFrom <= e.appliesTo, '근거 적용 기간을 확인하세요.');
    unique(e.relatedActivityIds, '근거 대상');
    assert(
      e.relatedActivityIds.every((x) => allowed.has(x)),
      '근거에 알 수 없는 일정 참조가 있습니다.',
    );
  };
  t.versions.forEach((v, i) => {
    assert(v.number === i + 1, '계획 버전 번호가 연속되지 않습니다.');
    unique(
      v.activities.map((a) => a.id),
      '일정',
    );
    unique(
      v.evidence.map((e) => e.id),
      '근거',
    );
    v.activities.forEach(checkRow);
    v.evidence.forEach((e) => checkEvidence(e, historical));
    if (v.proposalId)
      assert(
        t.proposals.some((p) => p.id === v.proposalId && p.status === 'applied'),
        '버전의 적용 변경안이 없습니다.',
      );
  });
  for (const a of t.actuals) {
    checkRow(a);
    assert(!a.activityId || historical.has(a.activityId), '실제 기록의 원본 일정이 없습니다.');
    if (a.supersedes) {
      assert(
        actualIds.has(a.supersedes) && !corrected.has(a.supersedes),
        '정정은 같은 여행의 최신 기존 기록을 참조해야 합니다.',
      );
      corrected.add(a.supersedes);
    }
    actualIds.add(a.id);
  }
  for (const p of t.proposals) {
    assert(p.tripId === t.id, '변경안의 여행이 일치하지 않습니다.');
    assert(p.baseRevision <= t.revision, '변경안 기준 revision이 미래입니다.');
    assert(
      t.versions.some((v) => v.number === p.basePlanNumber),
      '변경안의 기준 계획 버전이 없습니다.',
    );
    unique(
      p.operations.map((o) => (o.type === 'upsert' ? o.activity.id : o.activityId)),
      '변경 대상',
    );
    const proposed = new Set([
      ...historical,
      ...p.operations.flatMap((o) => (o.type === 'upsert' ? [o.activity.id] : [])),
    ]);
    p.operations.forEach((o) => {
      if (o.type === 'upsert') checkRow(o.activity);
      else assert(historical.has(o.activityId), '삭제 대상 일정이 없습니다.');
    });
    unique(
      p.evidence.map((e) => e.id),
      '근거',
    );
    p.evidence.forEach((e) => checkEvidence(e, proposed));
    assert(
      p.status === 'pending' ? !p.decidedAt && !p.decidedBy : !!p.decidedAt && !!p.decidedBy,
      '변경안 결정 기록이 올바르지 않습니다.',
    );
    if (p.status === 'applied')
      assert(
        t.versions.some((v) => v.proposalId === p.id),
        '적용 변경안의 계획 버전이 없습니다.',
      );
  }
  return t;
}
export function newTrip(input: {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
}): Trip {
  return validateTrip({
    ...input,
    id: input.id ?? uid(),
    revision: 0,
    places: [],
    actuals: [],
    proposals: [],
    receipts: [],
    versions: [{ number: 1, createdAt: now(), reason: '여행 생성', activities: [], evidence: [] }],
  });
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
