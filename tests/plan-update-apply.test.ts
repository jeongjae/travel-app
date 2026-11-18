import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { buildSelection, computeUpdate, exportPlan } from '../src/plan-update';
import { check, createdTrip, fixture } from './plan-import-helpers';
import { partialUpdate, ready, rewriteRow } from './plan-update-helpers';

/** A4: 변경 계산 결과를 실제 저장소의 `ChangePlan` 1회로 적용한다. 가상 여행만 사용한다. */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

const envelope = (tripId: string, kind: string, payload: unknown, expectedDomainRevision: number) => ({
  format: 'travel-app-command',
  commandVersion: 2,
  normalizationVersion: 'neutral-v1',
  tripId,
  requestId: crypto.randomUUID(),
  kind,
  payload,
  expectedDomainRevision,
});

async function savedTrip() {
  const db = new TravelDB(`update-${crypto.randomUUID()}`);
  databases.push(db);
  const repo = new ContentRepository(db);
  await repo.init();
  const created = createdTrip(fixture('claude-t1-run2.md'));
  const { tripId } = created.header;
  await repo.execute({
    format: 'travel-app-command',
    commandVersion: 2,
    normalizationVersion: 'neutral-v1',
    tripId,
    requestId: crypto.randomUUID(),
    kind: 'CreateTrip',
    payload: { header: created.header, initialPlan: created.initialPlan },
  });
  return { repo, tripId };
}

async function latest(repo: ContentRepository, tripId: string) {
  const trip = await repo.get(tripId);
  const plan = trip.plans.find((candidate) => candidate.planVersionId === trip.header.currentPlanVersionId)!;
  return { header: trip.header, plan, trip };
}

function addNote(tripId: string, revision: number) {
  return envelope(
    tripId,
    'AddNote',
    {
      record: {
        tripId,
        recordId: crypto.randomUUID(),
        kind: 'note',
        sourceRefs: [],
        payload: { targetRef: { tripId, targetKind: 'trip', entityId: tripId }, body: '메모', contextRefs: [] },
      },
    },
    revision,
  );
}

describe('내보내기 → 수정 → 적용 (실제 저장소)', () => {
  it('저장된 여행을 내보내 고쳐 가져오면 새 계획 버전 1개로 적용되고 이전 버전은 남는다 (AC-05)', async () => {
    const { repo, tripId } = await savedTrip();
    const before = await latest(repo, tripId);
    const exported = exportPlan({ header: before.header, plan: before.plan });
    const target = before.plan.items.find((item) => item.title !== '')!;
    const edited = rewriteRow(exported.text, target.activityId, { 메모: '고친 메모' });
    const current = { header: before.header, plan: before.plan };
    const result = ready(computeUpdate(check(edited), current));
    expect(result.changes).toHaveLength(1);
    const picked = buildSelection(result, new Set(result.changes.map((change) => change.key)), current);
    if (!picked.ok) {
      throw new Error(picked.problems.join(' '));
    }
    await repo.execute(
      envelope(
        tripId,
        'ChangePlan',
        { currentPlanVersionId: before.plan.planVersionId, operations: picked.operations, reason: picked.reason },
        before.header.domainRevision,
      ),
    );
    const after = await latest(repo, tripId);
    expect(after.trip.plans).toHaveLength(before.trip.plans.length + 1);
    expect(after.header.domainRevision).toBe(before.header.domainRevision + 1);
    expect(after.plan.reason).toBe('AI 결과 붙여넣기: 수정 1·추가 0·삭제 0');
    expect(after.plan.items.find((item) => item.activityId === target.activityId)!.summary).toContain('고친 메모');
    const kept = await repo.plan(tripId, before.plan.planVersionId);
    expect(kept?.items.find((item) => item.activityId === target.activityId)!.summary).toBe(target.summary);
    const rest = (items: typeof after.plan.items) =>
      items
        .filter((item) => item.activityId !== target.activityId)
        .map(({ planVersionId: _version, ...item }) => item)
        .sort((a, b) => a.activityId.localeCompare(b.activityId));
    expect(rest(after.plan.items)).toEqual(rest(before.plan.items));
  });

  it('저장 뒤 같은 글을 다시 붙이면 기준이 달라 적용할 수 없다', async () => {
    const { repo, tripId } = await savedTrip();
    const before = await latest(repo, tripId);
    const exported = exportPlan({ header: before.header, plan: before.plan });
    await repo.execute(addNote(tripId, before.header.domainRevision));
    const after = await latest(repo, tripId);
    const result = computeUpdate(check(exported.text), { header: after.header, plan: after.plan });
    expect(result).toMatchObject({ status: 'blocked', reason: 'stale-revision' });
  });

  it('미리보기 뒤 다른 저장이 끼면 저장소가 적용을 거부하고 아무것도 바뀌지 않는다 (AC-14)', async () => {
    const { repo, tripId } = await savedTrip();
    const before = await latest(repo, tripId);
    const exported = exportPlan({ header: before.header, plan: before.plan });
    const target = before.plan.items[0];
    const current = { header: before.header, plan: before.plan };
    const result = ready(
      computeUpdate(check(rewriteRow(exported.text, target.activityId, { 제목: '바꾼 제목' })), current),
    );
    const picked = buildSelection(result, new Set(result.changes.map((change) => change.key)), current);
    if (!picked.ok) {
      throw new Error(picked.problems.join(' '));
    }
    await repo.execute(addNote(tripId, before.header.domainRevision));
    const mid = await latest(repo, tripId);
    await expect(
      repo.execute(
        envelope(
          tripId,
          'ChangePlan',
          { currentPlanVersionId: before.plan.planVersionId, operations: picked.operations, reason: picked.reason },
          before.header.domainRevision,
        ),
      ),
    ).rejects.toThrow('CONFLICT');
    const after = await latest(repo, tripId);
    expect(after.trip.plans).toEqual(mid.trip.plans);
    expect(after.header.domainRevision).toBe(mid.header.domainRevision);
  });

  it('추가·수정·삭제를 한 번에 적용한다. 일부만 고르면 고른 것만 반영된다 (AC-11)', async () => {
    const { repo, tripId } = await savedTrip();
    const before = await latest(repo, tripId);
    const exported = exportPlan({ header: before.header, plan: before.plan });
    const [first, second] = before.plan.items;
    const firstDay = before.plan.days.find((day) => day.dayId === first.dayId)!;
    const text = partialUpdate(exported.text, {
      days: [
        {
          heading: firstDay.date,
          rows: [`| ${first.activityId} |  | 이름 바뀜 |  |  |  |  |  |`, '|  | 22:00 | 새 활동 | 기타 |  |  |  |  |'],
        },
      ],
      deletions: [['활동', second.activityId, second.title]],
    });
    const current = { header: before.header, plan: before.plan };
    const result = ready(computeUpdate(check(text), current));
    expect(result.changes.map((change) => change.kind).sort()).toEqual(['add', 'delete', 'edit']);
    const keep = result.changes.filter((change) => change.kind !== 'delete').map((change) => change.key);
    const picked = buildSelection(result, new Set(keep), current);
    if (!picked.ok) {
      throw new Error(picked.problems.join(' '));
    }
    await repo.execute(
      envelope(
        tripId,
        'ChangePlan',
        { currentPlanVersionId: before.plan.planVersionId, operations: picked.operations, reason: picked.reason },
        before.header.domainRevision,
      ),
    );
    const after = await latest(repo, tripId);
    expect(after.plan.items).toHaveLength(before.plan.items.length + 1);
    expect(after.plan.items.some((item) => item.activityId === second.activityId)).toBe(true);
    expect(after.plan.items.find((item) => item.activityId === first.activityId)!.title).toBe('이름 바뀜');
    expect(after.plan.reason).toBe('AI 결과 붙여넣기: 수정 1·추가 1·삭제 0');
  });
});

describe('어떤 저장이 domainRevision을 올리는가 (E2 보완 5 조사)', () => {
  it('계획 수정·메모·여행 정보 수정은 올리고, 읽기와 다른 여행의 저장은 올리지 않는다', async () => {
    const { repo, tripId } = await savedTrip();
    const start = await latest(repo, tripId);
    let revision = start.header.domainRevision;
    await repo.execute(addNote(tripId, revision));
    revision += 1;
    expect((await latest(repo, tripId)).header.domainRevision).toBe(revision);
    await repo.execute(
      envelope(
        tripId,
        'UpdateTripMetadata',
        { name: '이름 변경', startDate: start.header.startDate, endDate: start.header.endDate },
        revision,
      ),
    );
    revision += 1;
    expect((await latest(repo, tripId)).header.domainRevision).toBe(revision);
    const read = await latest(repo, tripId);
    expect(read.header.domainRevision).toBe(revision);
    const other = createdTrip(fixture('chatgpt-t1-run2.md'));
    await repo.execute({
      format: 'travel-app-command',
      commandVersion: 2,
      normalizationVersion: 'neutral-v1',
      tripId: other.header.tripId,
      requestId: crypto.randomUUID(),
      kind: 'CreateTrip',
      payload: { header: other.header, initialPlan: other.initialPlan },
    });
    expect((await latest(repo, tripId)).header.domainRevision).toBe(revision);
  });
});
