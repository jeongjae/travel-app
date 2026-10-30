import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { buildNewTrip } from '../src/content/trip-factory';
import { buildRetrospective, retrospectiveDates, UNKNOWN_DATE } from '../src/content/retro-rules';
import type { ActualRecord } from '../src/content/field-rules';
import type { PlanVersion, TimeSpec, TripDataset } from '../src/contracts/v2/index';

/** C-05 T-C6: 날짜별 회고 조회 모델. 가상 여행만 사용하고 조회가 아무것도 쓰지 않음을 확인한다. */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

const uuid = () => crypto.randomUUID();
const envelope = (tripId: string, kind: string, payload: unknown, expectedDomainRevision?: number, extra = {}) => ({
  format: 'travel-app-command',
  commandVersion: 2,
  normalizationVersion: 'c05',
  tripId,
  requestId: uuid(),
  kind,
  payload,
  ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
  ...extra,
});
async function setup() {
  const db = new TravelDB(`retro-${uuid()}`);
  databases.push(db);
  const repo = new ContentRepository(db);
  await repo.init();
  return { db, repo };
}
async function newTrip(repo: ContentRepository, name = '가상 회고 여행') {
  const trip = buildNewTrip({ name, start: '2032-05-01', end: '2032-05-03' });
  await repo.execute(envelope(trip.tripId, 'CreateTrip', { header: trip.header, initialPlan: trip.initialPlan }));
  return trip.tripId;
}
const local = (date: string, localTime = '10:00'): TimeSpec => ({
  precision: 'local',
  date,
  localTime,
  timeZoneStatus: 'unknown',
});
const makeItem = (plan: PlanVersion, dayIndex: number, order: number, title: string): PlanVersion['items'][number] => ({
  tripId: plan.tripId,
  planVersionId: plan.planVersionId,
  activityId: uuid(),
  dayId: plan.days[dayIndex].dayId,
  order,
  title,
  category: 'activity',
  time: { start: local(plan.days[dayIndex].date, '09:00') },
  summary: '',
  optional: false,
  placeLinks: [],
  bookingIds: [],
  taskRefs: [],
  executionMarkers: [],
  sourceFlags: [],
});
async function changePlan(
  repo: ContentRepository,
  tripId: string,
  operations: unknown[],
  reason: string,
): Promise<TripDataset> {
  const trip = await repo.get(tripId);
  await repo.execute(
    envelope(
      tripId,
      'ChangePlan',
      { currentPlanVersionId: trip.header.currentPlanVersionId, operations, reason },
      trip.header.domainRevision,
    ),
  );
  return repo.get(tripId);
}
const currentPlan = (trip: TripDataset) =>
  trip.plans.find((p) => p.planVersionId === trip.header.currentPlanVersionId)!;
const payload = (title: string, start: TimeSpec, extra: Partial<ActualRecord['payload']> = {}) => ({
  title,
  targetSummary: title,
  outcome: 'unplanned' as const,
  time: { start },
  note: `${title} 메모`,
  contextRefs: [],
  ...extra,
});
const row = (tripId: string, body: ActualRecord['payload'], extra: Record<string, unknown> = {}) => ({
  tripId,
  recordId: uuid(),
  kind: 'actual',
  sourceRefs: [] as unknown[],
  payload: body,
  ...extra,
});
async function record(repo: ContentRepository, tripId: string, body: ActualRecord['payload']) {
  const trip = await repo.get(tripId);
  const next = row(tripId, body);
  await repo.execute(envelope(tripId, 'RecordActual', { record: next }, trip.header.domainRevision));
  return next.recordId;
}
async function correct(repo: ContentRepository, tripId: string, supersedes: string, body: ActualRecord['payload']) {
  const trip = await repo.get(tripId);
  const next = row(tripId, body, { supersedes });
  await repo.execute(envelope(tripId, 'CorrectActual', { supersedes, record: next }, trip.header.domainRevision));
  return next.recordId;
}
async function proposal(
  repo: ContentRepository,
  tripId: string,
  reason: string,
  operations: unknown[],
  decision?: 'apply' | 'reject',
) {
  const trip = await repo.get(tripId);
  const body = {
    tripId,
    proposalId: uuid(),
    proposalRevisionId: uuid(),
    proposalRevision: 1,
    baseDomainRevision: trip.header.domainRevision,
    basePlanVersionId: trip.header.currentPlanVersionId,
    origin: 'user',
    operations,
    reason,
    evidenceRefs: [],
    impact: { activityIds: [], reservationText: '실제 예약 변경 없음' },
    status: 'pending',
  };
  await repo.execute(
    envelope(tripId, 'SaveProposal', { proposal: body, baseDomainRevision: trip.header.domainRevision }, undefined, {
      expectedProposalRevision: 0,
    }),
  );
  if (decision) {
    await repo.execute(
      envelope(tripId, 'DecideProposal', { proposalId: body.proposalId, decision, confirmedByUser: true }, undefined, {
        expectedProposalRevision: 1,
      }),
    );
  }
  return body;
}
async function snapshot(db: TravelDB) {
  const dump: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    dump[table.name] = await table.toArray();
  }
  return JSON.stringify(dump);
}

/** 계획 2(점심+박물관 추가) → 기록 → 계획 3(점심 제거, 박물관 이름 변경) → 변경안 적용(계획 4)·거절·대기. */
async function scenario(repo: ContentRepository) {
  const tripId = await newTrip(repo);
  const first = await repo.get(tripId);
  const lunch = makeItem(first.plans[0], 0, 0, '가상 점심');
  const museum = makeItem(first.plans[0], 0, 1, '가상 박물관');
  const planTwo = currentPlan(
    await changePlan(
      repo,
      tripId,
      [
        { type: 'upsert-item', item: lunch },
        { type: 'upsert-item', item: museum },
      ],
      '수동으로 일정 추가',
    ),
  );
  const link = (item: PlanVersion['items'][number]) => ({
    planVersionId: planTwo.planVersionId,
    activityId: item.activityId,
  });
  const lunchRecord = await record(
    repo,
    tripId,
    payload('가상 점심 방문', local('2032-05-01', '12:00'), { outcome: 'visited', ...link(lunch) }),
  );
  const lunchMoved = await correct(
    repo,
    tripId,
    lunchRecord,
    payload('가상 점심 방문', local('2032-05-02', '12:00'), { outcome: 'visited', ...link(lunch) }),
  );
  await correct(
    repo,
    tripId,
    lunchMoved,
    payload('가상 점심 방문', local('2032-05-02', '12:30'), { outcome: 'visited', note: '정정 메모', ...link(lunch) }),
  );
  await record(
    repo,
    tripId,
    payload('가상 박물관 건너뜀', { precision: 'unspecified' }, { outcome: 'skipped', ...link(museum) }),
  );
  await record(repo, tripId, payload('길가의 벤치', local('2032-05-01', '15:00')));
  await record(repo, tripId, payload('날짜 없는 메모 활동', { precision: 'unspecified' }));
  const afterTwo = await repo.get(tripId);
  const planThree = currentPlan(
    await changePlan(
      repo,
      tripId,
      [
        { type: 'remove-item', activityId: lunch.activityId },
        {
          type: 'upsert-item',
          item: { ...museum, planVersionId: afterTwo.header.currentPlanVersionId, title: '가상 박물관(이름 변경)' },
        },
      ],
      '수동으로 점심 제거',
    ),
  );
  const applied = await proposal(
    repo,
    tripId,
    '적용한 변경안 이유',
    [
      {
        type: 'upsert-item',
        item: { ...makeItem(planThree, 1, 0, '가상 산책'), planVersionId: planThree.planVersionId },
      },
    ],
    'apply',
  );
  const rejected = await proposal(
    repo,
    tripId,
    '거절한 변경안 이유',
    [{ type: 'upsert-item', item: makeItem(currentPlan(await repo.get(tripId)), 2, 0, '거절 활동') }],
    'reject',
  );
  const pending = await proposal(repo, tripId, '대기 중인 변경안 이유', [
    { type: 'upsert-item', item: makeItem(currentPlan(await repo.get(tripId)), 2, 1, '대기 활동') },
  ]);
  return { tripId, lunch, museum, planTwo, planThree, applied, rejected, pending };
}

describe('날짜별 회고 모델', () => {
  it('날짜·미상 목록을 계획 버전과 대표 기록에서 모은다', async () => {
    const { repo } = await setup();
    const { tripId } = await scenario(repo);
    const trip = await repo.get(tripId);
    const { dates, hasUnknown } = retrospectiveDates(trip);
    expect(dates).toEqual(['2032-05-01', '2032-05-02', '2032-05-03']);
    expect(hasUnknown).toBe(true);
  });

  it('같은 날짜의 현재 계획과 선택한 과거 계획을 열로 나눠 각 버전의 값을 읽는다', async () => {
    const { repo } = await setup();
    const { tripId, planTwo } = await scenario(repo);
    const trip = await repo.get(tripId);
    const view = buildRetrospective(trip, '2032-05-01', planTwo.planVersionId);
    expect(view.columns.map((c) => [c.number, c.isCurrent])).toEqual([
      [4, true],
      [2, false],
    ]);
    const past = view.columns[1].days[0].items.map((i) => i.title);
    expect(past).toEqual(['가상 점심', '가상 박물관']);
    const now = view.columns[0].days[0].items.map((i) => i.title);
    expect(now).toEqual(['가상 박물관(이름 변경)']);
    // 과거 계획의 항목은 현재 값으로 덮이지 않는다.
    expect(past).not.toContain('가상 박물관(이름 변경)');
  });

  it('최신 정정본을 대표로 두고 정정 원문·날짜가 옮겨진 원문을 이어 찾는다', async () => {
    const { repo } = await setup();
    const { tripId } = await scenario(repo);
    const trip = await repo.get(tripId);
    const day2 = buildRetrospective(trip, '2032-05-02');
    const lunch = day2.entries.find((e) => e.latest.payload.title === '가상 점심 방문')!;
    expect(lunch.chain).toHaveLength(3);
    expect(lunch.latest.payload.note).toBe('정정 메모');
    expect(lunch.earlierDates).toEqual(['2032-05-01']);
    expect(day2.summary).toMatchObject({ visited: 1, corrected: 1 });
    const day1 = buildRetrospective(trip, '2032-05-01');
    // 5/1에 쓴 원문은 대표가 아니고, 옮겨진 곳(5/2)을 알려 준다.
    expect(day1.entries.map((e) => e.latest.payload.title)).toEqual(['길가의 벤치']);
    expect(day1.movedAway).toHaveLength(1);
    expect(day1.movedAway[0].movedTo).toBe('2032-05-02');
    expect(day1.movedAway[0].entry.chain).toHaveLength(3);
    // 정정본을 중복 방문으로 집계하지 않는다.
    expect(day1.summary.visited + day2.summary.visited).toBe(1);
  });

  it('기록의 명시 계획 링크로 당시 계획을 읽고 연결이 없는 기록은 추정하지 않는다', async () => {
    const { repo } = await setup();
    const { tripId, planTwo } = await scenario(repo);
    const trip = await repo.get(tripId);
    const day2 = buildRetrospective(trip, '2032-05-02');
    const lunch = day2.entries[0];
    expect(lunch.planLink).toMatchObject({
      kind: 'linked',
      planVersionId: planTwo.planVersionId,
      planNumber: 2,
      itemTitle: '가상 점심',
      plannedDate: '2032-05-01',
      dateDiffers: true,
      inCurrentPlan: false,
    });
    const bench = buildRetrospective(trip, '2032-05-01').entries[0];
    expect(bench.planLink).toEqual({ kind: 'none' });
    // 이 날짜의 기록이 연결한 계획 버전(계획 2)의 이유도 함께 읽는다.
    expect(day2.reasons.map((r) => r.number)).toContain(2);
    expect(day2.reasons.find((r) => r.number === 2)?.roles).toContain('linked-by-record');
  });

  it('건너뜀과 날짜 미상 기록은 날짜 미상 구역에 두고 날짜를 추정하지 않는다', async () => {
    const { repo } = await setup();
    const { tripId, planTwo, museum } = await scenario(repo);
    const trip = await repo.get(tripId);
    const unknown = buildRetrospective(trip, UNKNOWN_DATE);
    expect(unknown.unknownDate).toBe(true);
    expect(unknown.entries.map((e) => e.latest.payload.title).toSorted()).toEqual([
      '가상 박물관 건너뜀',
      '날짜 없는 메모 활동',
    ]);
    expect(unknown.summary).toMatchObject({ skipped: 1, unplanned: 1 });
    expect(unknown.columns[0].days).toEqual([]);
    const skipped = unknown.entries.find((e) => e.latest.payload.outcome === 'skipped')!;
    // 계획일은 알려 주되(항목의 날짜) 실제 날짜로 대체하지 않는다.
    expect(skipped.planLink).toMatchObject({ plannedDate: '2032-05-01', dateDiffers: false });
    expect(skipped.latest.payload.time.start).toEqual({ precision: 'unspecified' });
    expect(museum.activityId).toBe(skipped.planLink.kind === 'linked' ? skipped.planLink.activityId : '');
    expect(planTwo.number).toBe(2);
    expect(buildRetrospective(trip, '2032-05-01').entries.some((e) => e.latest.payload.outcome === 'skipped')).toBe(
      false,
    );
  });

  it('변경 이유는 결과 계획이 이 버전인 적용 revision만 쓰고 대기·거절 revision을 쓰지 않는다', async () => {
    const { repo } = await setup();
    const { tripId, applied } = await scenario(repo);
    const trip = await repo.get(tripId);
    expect(trip.proposals.map((p) => p.status).toSorted()).toEqual([
      'applied',
      'pending',
      'pending',
      'pending',
      'rejected',
    ]);
    const view = buildRetrospective(trip, '2032-05-02');
    const planFour = trip.plans.find((p) => p.proposalId === applied.proposalId)!;
    const reason = buildRetrospective(trip, '2032-05-02', planFour.planVersionId).reasons.find(
      (r) => r.planVersionId === planFour.planVersionId,
    )!;
    expect(reason.source).toBe('applied-proposal');
    expect(reason.proposal?.reason).toBe('적용한 변경안 이유');
    expect(reason.proposal?.proposalRevisionId).toBe(
      trip.proposals.find((p) => p.proposalId === applied.proposalId && p.status === 'applied')?.proposalRevisionId,
    );
    expect(reason.proposal?.reservationText).toBe('실제 예약 변경 없음');
    expect(reason.dayChange).toBe('changed');
    expect(reason.changedActivityIds).toHaveLength(1);
    // 변경안 없는 수동 계획(현재 계획이 아닌 계획 3)은 저장된 이유만 보인다.
    const manual = buildRetrospective(trip, '2032-05-01', trip.plans[2].planVersionId).reasons.find(
      (r) => r.planVersionId === trip.plans[2].planVersionId,
    )!;
    expect(manual.source).toBe('stored-reason-only');
    expect(manual.proposal).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('거절한 변경안 이유');
    expect(JSON.stringify(view)).not.toContain('대기 중인 변경안 이유');
  });

  it('이유는 계획 전체의 것이며 바뀌지 않은 날짜에는 개별 원인으로 붙이지 않는다', async () => {
    const { repo } = await setup();
    const { tripId } = await scenario(repo);
    const trip = await repo.get(tripId);
    const planFour = trip.plans.find((p) => p.proposalId)!;
    // 변경안이 건드린 날짜는 5/2(날짜 2)이고 5/3은 같다.
    expect(buildRetrospective(trip, '2032-05-03', planFour.planVersionId).reasons[0].dayChange).toBe('unchanged');
    expect(buildRetrospective(trip, '2032-05-03', planFour.planVersionId).reasons[0].changedActivityIds).toEqual([]);
    const initial = buildRetrospective(trip, '2032-05-01', trip.plans[0].planVersionId).reasons.find(
      (r) => r.number === 1,
    )!;
    expect(initial.initial).toBe(true);
    expect(initial.dayChange).toBe('initial');
  });

  it('proposalId만 남고 적용 revision이 없으면 연결 없음으로 두고 근거는 고정 revision 참조를 그대로 돌려준다', async () => {
    const { repo } = await setup();
    const { tripId } = await scenario(repo);
    const trip = await repo.get(tripId);
    const planFour = trip.plans.find((p) => p.proposalId)!;
    const missing = structuredClone(trip);
    missing.proposals = missing.proposals.filter((p) => p.status !== 'applied');
    const view = buildRetrospective(missing, '2032-05-02', planFour.planVersionId);
    expect(view.reasons.find((r) => r.planVersionId === planFour.planVersionId)?.source).toBe('proposal-missing');
    expect(view.reasons.find((r) => r.planVersionId === planFour.planVersionId)?.proposal).toBeUndefined();
    const withEvidence = structuredClone(trip);
    const ref = { tripId, targetKind: 'evidence' as const, entityId: uuid(), revisionId: uuid() };
    const appliedRevision = withEvidence.proposals.find((p) => p.status === 'applied')!;
    appliedRevision.evidenceRefs = [ref];
    const evidenceView = buildRetrospective(withEvidence, '2032-05-02', planFour.planVersionId);
    expect(
      evidenceView.reasons.find((r) => r.planVersionId === planFour.planVersionId)?.proposal?.evidenceRefs,
    ).toEqual([ref]);
  });

  it('회고 조회는 DB·domainRevision·현재 계획·receipt·기록을 바꾸지 않는다', async () => {
    const { repo, db } = await setup();
    const { tripId, planTwo } = await scenario(repo);
    const before = await snapshot(db);
    const trip = await repo.get(tripId);
    retrospectiveDates(trip);
    for (const date of ['2032-05-01', '2032-05-02', '2032-05-03', UNKNOWN_DATE]) {
      buildRetrospective(trip, date);
      buildRetrospective(trip, date, planTwo.planVersionId);
    }
    await repo.timeline(tripId);
    await repo.proposals(tripId);
    await repo.history(tripId);
    expect(await snapshot(db)).toBe(before);
    const after = await repo.get(tripId);
    expect(after.header).toEqual(trip.header);
    expect(after.records).toEqual(trip.records);
  });

  it('다른 여행의 계획·기록을 섞지 않는다', async () => {
    const { repo } = await setup();
    const { tripId } = await scenario(repo);
    const otherId = await newTrip(repo, '다른 가상 여행');
    await record(repo, otherId, payload('다른 여행 기록', local('2032-05-01', '11:00')));
    const trip = await repo.get(tripId);
    const other = await repo.get(otherId);
    expect(JSON.stringify(buildRetrospective(trip, '2032-05-01'))).not.toContain('다른 여행 기록');
    const otherView = buildRetrospective(other, '2032-05-01');
    expect(otherView.entries.map((e) => e.latest.payload.title)).toEqual(['다른 여행 기록']);
    expect(JSON.stringify(otherView)).not.toContain('가상 점심');
    expect(otherView.reasons.map((r) => r.number)).toEqual([1]);
  });
});
