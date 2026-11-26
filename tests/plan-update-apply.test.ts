import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import {
  applyPlaceEdit,
  buildLinkPlan,
  buildPlaceContent,
  buildSelection,
  chunkPlaces,
  collectMarkCandidates,
  collectPlaceCandidates,
  computeUpdate,
  exportPlan,
  extendSpan,
  joinSpans,
  type CatalogPlace,
  type SaveSpan,
} from '../src/plan-update';
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

describe('시간순 자리 (R1, 실제 저장소)', () => {
  it('끼워 넣은 활동이 시간순 자리에 저장되고 기존 활동의 순서·내용은 그대로다', async () => {
    const { repo, tripId } = await savedTrip();
    const before = await latest(repo, tripId);
    const dayId = before.plan.days[0].dayId;
    const day = before.plan.days[0];
    const sorted = before.plan.items.filter((item) => item.dayId === dayId).sort((a, b) => a.order - b.order);
    const start = sorted[0].time.start;
    const clock = start?.precision === 'local' ? start.localTime.slice(0, 5) : '09:00';
    const text = partialUpdate(exportPlan({ header: before.header, plan: before.plan }).text, {
      days: [{ heading: day.date, rows: [`|  | ${clock} | 끼운 활동 | 기타 |  |  |  |  |`] }],
    });
    const current = { header: before.header, plan: before.plan };
    const result = ready(computeUpdate(check(text), current));
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
    const titles = after.plan.items
      .filter((item) => item.dayId === dayId)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.title);
    expect(titles).toEqual([sorted[0].title, '끼운 활동', ...sorted.slice(1).map((item) => item.title)]);
    expect(after.trip.plans).toHaveLength(before.trip.plans.length + 1);
    expect(after.plan.reason).toBe('AI 결과 붙여넣기: 수정 0·추가 1·삭제 0');
    const unchanged = (items: typeof after.plan.items) =>
      items
        .filter((item) => item.title !== '끼운 활동')
        .map(({ planVersionId: _version, order: _order, ...item }) => item)
        .sort((a, b) => a.activityId.localeCompare(b.activityId));
    expect(unchanged(after.plan.items)).toEqual(unchanged(before.plan.items));
  });
});

describe('시각이 바뀐 기존 활동의 자리 (R2, 실제 저장소)', () => {
  it('시각을 그날 마지막보다 늦추면 저장 뒤 마지막에 온다', async () => {
    const { repo, tripId } = await savedTrip();
    const before = await latest(repo, tripId);
    const day = before.plan.days[0];
    const sorted = before.plan.items.filter((item) => item.dayId === day.dayId).sort((a, b) => a.order - b.order);
    const text = rewriteRow(exportPlan({ header: before.header, plan: before.plan }).text, sorted[0].activityId, {
      시간: '23:50',
    });
    const current = { header: before.header, plan: before.plan };
    const result = ready(computeUpdate(check(text), current));
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
    const titles = after.plan.items
      .filter((item) => item.dayId === day.dayId)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.title);
    expect(titles).toEqual([...sorted.slice(1).map((item) => item.title), sorted[0].title]);
    expect(after.plan.reason).toBe('AI 결과 붙여넣기: 수정 1·추가 0·삭제 0');
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

describe('기존 장소 수정 (실제 저장소)', () => {
  it('UpdateContent로 장소를 고치면 revision이 오르고, 기준 연결로 같은 글의 일정 변경이 이어진다', async () => {
    const { repo, tripId } = await savedTrip();
    const { header, plan } = await latest(repo, tripId);
    const candidates = collectMarkCandidates(plan, { places: [] });
    const contents = candidates.map((candidate) => buildPlaceContent(tripId, candidate, []));
    const made = await repo.execute(
      envelope(tripId, 'CreateContentBatch', { create: contents, updateOwners: [] }, header.domainRevision),
    );
    const content = (await repo.catalog(tripId, 'place')).find((row) => row.kind === 'place')!;
    if (content.kind !== 'place') {
      throw new Error('place expected');
    }
    const { commitSeq: _seq, recordedAt: _at, actor: _actor, ...stable } = content;
    const next = {
      ...applyPlaceEdit(stable, { summary: '고친 설명', regionIds: [], wikiRef: 'https://example.com/a' }),
      revisionId: crypto.randomUUID(),
      previousRevisionId: content.revisionId,
    };
    const edited = await repo.execute(
      envelope(tripId, 'UpdateContent', { expectedRevisionId: content.revisionId, content: next }, made.domainRevision),
    );
    expect(edited.domainRevision).toBe(made.domainRevision + 1);
    const after = (await repo.catalog(tripId, 'place')).find((row) => row.entityId === content.entityId)!;
    expect(after.kind === 'place' && after.payload.summary).toBe('고친 설명');
    expect(after.kind === 'place' && after.payload.wikiRef).toBe('https://example.com/a');
    expect(after.kind === 'place' && after.payload.name).toBe(content.payload.name);
    const fresh = await latest(repo, tripId);
    const text = exportPlan({ header, plan }).text;
    const bridged = {
      header: fresh.header,
      plan: fresh.plan,
      revisionBridge: { from: header.domainRevision, to: edited.domainRevision },
    };
    expect(computeUpdate(check(text), bridged).status).toBe('ready');
    expect(computeUpdate(check(text), { ...bridged, revisionBridge: undefined }).status).toBe('blocked');
  });
});

describe('저장 구간 잇기 (실제 저장소)', () => {
  async function editTwice(interleave: boolean) {
    const { repo, tripId } = await savedTrip();
    const { header, plan } = await latest(repo, tripId);
    const candidates = collectMarkCandidates(plan, { places: [] });
    const contents = candidates.map((candidate) => buildPlaceContent(tripId, candidate, []));
    const made = await repo.execute(
      envelope(tripId, 'CreateContentBatch', { create: contents, updateOwners: [] }, header.domainRevision),
    );
    const created = extendSpan(undefined, header.domainRevision, made.domainRevision);
    const places = (await repo.catalog(tripId, 'place')).filter((row) => row.kind === 'place');
    let revision = made.domainRevision;
    const save = async (index: number, summary: string) => {
      const row = places[index];
      if (row.kind !== 'place') {
        throw new Error('place expected');
      }
      const current = (await repo.catalog(tripId, 'place')).find((item) => item.entityId === row.entityId)!;
      const { commitSeq: _seq, recordedAt: _at, actor: _actor, ...stable } = current as typeof row;
      const next = {
        ...applyPlaceEdit(stable, { summary, regionIds: [], wikiRef: undefined }),
        revisionId: crypto.randomUUID(),
        previousRevisionId: current.revisionId,
      };
      const before = revision;
      const result = await repo.execute(
        envelope(tripId, 'UpdateContent', { expectedRevisionId: current.revisionId, content: next }, before),
      );
      revision = result.domainRevision;
      return { before, after: result.domainRevision };
    };
    let edited: SaveSpan | undefined;
    const first = await save(0, '첫째');
    edited = extendSpan(edited, first.before, first.after);
    if (interleave) {
      await save(places.length > 1 ? 1 : 0, '끼어든 저장');
    }
    const second = await save(0, '둘째');
    edited = extendSpan(edited, second.before, second.after);
    return { created, edited, revision };
  }

  it('끼어든 저장이 없으면 만들기와 수정 구간이 이어진다', async () => {
    const { created, edited, revision } = await editTwice(false);
    expect(joinSpans(created, edited)).toEqual({ from: created.from, to: revision });
  });

  it('장소 수정 사이에 다른 저장이 끼면 연결하지 않는다', async () => {
    const { created, edited } = await editTwice(true);
    expect(joinSpans(created, edited)).toBeUndefined();
  });
});

describe('장소 단계 (실제 저장소)', () => {
  async function stage(repo: ContentRepository, tripId: string, count = 0) {
    const { header, plan } = await latest(repo, tripId);
    const candidates = collectMarkCandidates(plan, { places: [] });
    const contents = candidates
      .slice(0, count === 0 ? candidates.length : count)
      .map((candidate) => buildPlaceContent(tripId, candidate, []));
    return { header, plan, contents };
  }

  it('장소를 만들고 ChangePlan 1회로 연결하면 왕복이 변경 0건이다 (AC-16·B1)', async () => {
    const { repo, tripId } = await savedTrip();
    const { header, plan, contents } = await stage(repo, tripId);
    expect(contents.length).toBeGreaterThan(0);
    const made = await repo.execute(
      envelope(tripId, 'CreateContentBatch', { create: contents, updateOwners: [] }, header.domainRevision),
    );
    const placeIds = new Map(contents.map((content) => [content.payload.name, content.entityId]));
    const link = buildLinkPlan(plan, placeIds);
    expect(link.operations.length).toBeGreaterThan(0);
    await repo.execute(
      envelope(
        tripId,
        'ChangePlan',
        { currentPlanVersionId: plan.planVersionId, operations: link.operations, reason: '장소 연결' },
        made.domainRevision,
      ),
    );
    const after = await latest(repo, tripId);
    const catalog = await repo.catalog(tripId, 'place');
    const places: CatalogPlace[] = catalog.flatMap((content) =>
      content.kind === 'place'
        ? [
            {
              entityId: content.entityId,
              name: content.payload.name,
              summary: content.payload.summary,
              regionIds: content.payload.regionIds,
            },
          ]
        : [],
    );
    expect(places).toHaveLength(contents.length);
    expect(after.plan.items.filter((item) => item.placeLinks.length > 0)).toHaveLength(link.linked.length);
    expect(after.plan.items.some((item) => item.summary.startsWith('[장소:'))).toBe(false);
    const placeNames = new Map(places.map((place) => [place.entityId, place.name]));
    const exported = exportPlan({ header: after.header, plan: after.plan, placeNames, places, regions: [] });
    expect(exported.counts.places).toBeGreaterThan(0);
    const again = check(exported.text);
    const result = ready(computeUpdate(again, { header: after.header, plan: after.plan, placeNames }));
    expect(result.changes).toEqual([]);
    expect(result.errors).toEqual([]);
    const collection = collectPlaceCandidates(again, { plan: after.plan, places, regions: [] });
    expect(collection.candidates).toEqual([]);
    expect(collection.existingLines).toEqual({ nameIgnored: 0, unknown: 0 });
  });

  it('만들기 묶음이 거부되면 아무 장소도 남지 않는다 (AC-16)', async () => {
    const { repo, tripId } = await savedTrip();
    const { header, contents } = await stage(repo, tripId);
    const broken = [...contents, { ...contents[0], revisionId: crypto.randomUUID() }];
    await expect(
      repo.execute(envelope(tripId, 'CreateContentBatch', { create: broken, updateOwners: [] }, header.domainRevision)),
    ).rejects.toThrow();
    expect(await repo.catalog(tripId, 'place')).toEqual([]);
    expect((await latest(repo, tripId)).header.domainRevision).toBe(header.domainRevision);
  });

  it('20개씩 나눈 묶음을 차례로 만들 수 있다', async () => {
    const { repo, tripId } = await savedTrip();
    const { plan } = await stage(repo, tripId);
    const [template] = collectMarkCandidates(plan, { places: [] });
    const many = Array.from({ length: 45 }, (_, index) =>
      buildPlaceContent(tripId, { ...template, name: `장소 ${index}` }, []),
    );
    let revision = (await latest(repo, tripId)).header.domainRevision;
    for (const chunk of chunkPlaces(many)) {
      const result = await repo.execute(
        envelope(tripId, 'CreateContentBatch', { create: chunk, updateOwners: [] }, revision),
      );
      revision = result.domainRevision;
    }
    expect(await repo.catalog(tripId, 'place')).toHaveLength(45);
  });
});
