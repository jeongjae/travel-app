import { afterEach, expect, it, vi } from 'vitest';
import { OpenAiV2Provider, rateLimitMessage } from '../server/ai-v2';
import { consentFingerprint, type AiV2Output } from '../src/ai-v2-contract';
import { buildAiV2Payload, deriveDayTimes, selectableRecords } from '../src/ai-v2-context';
import { materializeV2Proposal, validateAiV2Output } from '../src/ai-v2-semantics';
import { operationsToApply, reviewProposal } from '../src/content/proposal-review';
import { ContentRepository, TravelDB } from '../src/repository';
import { digestBytes, type ContentRevision, type Proposal } from '../src/contracts/v2';
import { command } from '../src/content/ui';
import { currentMappings } from '../src/transfer/normalize';
import { fixtureAssets } from './fixtures/pilot';
import { aiV2Fixture, fictionalPolicy } from './fixtures/ai-v2';

afterEach(() => {
  vi.unstubAllGlobals();
});

function editing(fixture: Awaited<ReturnType<typeof aiV2Fixture>>, patch: Partial<AiV2Output['operations'][number]>) {
  const draft = structuredClone(fixture.output);
  draft.operations[0] = { ...draft.operations[0], ...patch };
  return draft;
}

it('동의 지문은 내용·서버·모델·한도가 바뀌면 달라진다', async () => {
  const { payload, policy } = await aiV2Fixture();
  const base = await consentFingerprint(payload, policy);
  expect(await consentFingerprint({ ...payload, id: crypto.randomUUID() } as typeof payload, policy)).toBe(base);
  const edited = { ...payload, research: { ...payload.research, question: '바뀐 질문' } };
  expect(await consentFingerprint(edited, policy)).not.toBe(base);
  expect(await consentFingerprint(payload, fictionalPolicy('other-model'))).not.toBe(base);
  expect(await consentFingerprint(payload, { ...policy, server: 'other-server' })).not.toBe(base);
  expect(await consentFingerprint(payload, { ...policy, limits: { ...policy.limits, maxDays: 1 } })).not.toBe(base);
});

it('빌더는 동의 값을 만들지 않는다', async () => {
  const { payload } = await aiV2Fixture();
  expect(payload).not.toHaveProperty('consent');
});

it('기록은 기본 제외이고 정정된 기록은 고를 수 없다', async () => {
  const { dataset } = await aiV2Fixture();
  const date = dataset.header.startDate;
  dataset.records.push({
    tripId: dataset.header.tripId,
    recordId: 'correction',
    kind: 'actual',
    recordedAt: '2026-01-02T00:00:00Z',
    supersedes: 'actual-1',
    sourceRefs: [],
    commitSeq: 2,
    payload: {
      title: '정정 후',
      targetSummary: '',
      outcome: 'visited',
      time: { start: { precision: 'date', date } },
      note: '',
      contextRefs: [],
    },
  });
  const ids = selectableRecords(dataset, date, 3).map((record) => record.id);
  expect(ids).toContain('correction');
  expect(ids).not.toContain('actual-1');
  const payload = buildAiV2Payload(dataset, { prompt: '요청', requestKind: 'edit', fromDate: date, count: 3 });
  expect(payload.planning.records).toEqual([]);
});

it('예약은 원값 없이 고정 표시로만 간다', async () => {
  const { input } = await aiV2Fixture();
  const booked = input.planning.items.find((item) => item.activityId === 'activity-1')!;
  expect(booked.fixed).toBe(true);
  expect(input.planning.items.find((item) => item.activityId === 'activity-2')!.fixed).toBe(false);
  expect(JSON.stringify(input.planning)).not.toContain('booking-code');
});

it('장거리 이동의 양 끝 활동 시각에서 도착·출발을 얻고 도보 이동에서는 얻지 않는다', async () => {
  const { dataset } = await aiV2Fixture();
  const plan = dataset.plans[0];
  const day = plan.days[0];
  expect(deriveDayTimes(plan, day)).toEqual({ arrival: null, departure: null, blocked: [] });
  const flight = structuredClone(plan);
  flight.legs[0].mode = 'flight';
  flight.items[1].time = {
    start: { precision: 'local', date: day.date, localTime: '14:20', timeZoneStatus: 'unknown' },
  };
  expect(deriveDayTimes(flight, day).arrival).toBe('14:20');
});

it('요청에서 넣은 도착·출발이 제약이 되고 저장 데이터는 그대로다', async () => {
  const { dataset } = await aiV2Fixture();
  const before = structuredClone(dataset);
  const day = dataset.plans[0].days[0];
  const payload = buildAiV2Payload(dataset, {
    prompt: '요청',
    requestKind: 'edit',
    fromDate: day.date,
    count: 1,
    dayTimes: { [day.dayId]: { arrival: '13:00', departure: '20:00' } },
  });
  expect(payload.planning.days[0]).toMatchObject({ arrival: '13:00', departure: '20:00' });
  expect(dataset).toEqual(before);
});

it.each([
  ['도착 이전', { arrival: '13:00' }, { startTime: '09:00', endTime: '10:00' }, '도착 시각'],
  ['출발 이후', { departure: '18:00' }, { startTime: '17:00', endTime: '19:00' }, '출발 시각'],
])('%s 제안을 거부한다', async (_name, times, operation, message) => {
  const fixture = await aiV2Fixture();
  const planning = structuredClone(fixture.input.planning);
  Object.assign(planning.days[0], times);
  expect(() => validateAiV2Output(planning, editing(fixture, operation), fixture.research.sources)).toThrow(message);
});

it('다른 고정 활동과 겹치는 시간대를 거부하고 겹치지 않으면 통과한다', async () => {
  const fixture = await aiV2Fixture();
  const planning = structuredClone(fixture.input.planning);
  const fixed = planning.items[0];
  fixed.start = '10:00';
  fixed.end = '11:00';
  const other = planning.items.find((item) => item.activityId === 'activity-2')!;
  const operation = { activityId: other.activityId, dayId: other.dayId };
  const overlapping = editing(fixture, { ...operation, startTime: '10:30', endTime: '12:00' });
  expect(() => validateAiV2Output(planning, overlapping, fixture.research.sources)).toThrow('고정 활동');
  const clear = editing(fixture, { ...operation, startTime: '12:00', endTime: '13:00' });
  expect(validateAiV2Output(planning, clear, fixture.research.sources)).toEqual([]);
});

it('종료가 시작보다 빠르면 거부하고 03시는 경고만 한다', async () => {
  const fixture = await aiV2Fixture();
  const { planning } = fixture.input;
  expect(() =>
    validateAiV2Output(planning, editing(fixture, { startTime: '18:00', endTime: '09:00' }), fixture.research.sources),
  ).toThrow('종료 시각');
  const warnings = validateAiV2Output(
    planning,
    editing(fixture, { startTime: '03:00', endTime: '03:30' }),
    fixture.research.sources,
  );
  expect(warnings[0]).toContain('비현실적');
});

function reviewed(fixture: Awaited<ReturnType<typeof aiV2Fixture>>, output: AiV2Output) {
  const result = materializeV2Proposal(fixture.local, output, fixture.research);
  const proposal = { ...result.proposal, commitSeq: 1 } as Proposal;
  return { result, reviews: reviewProposal(proposal, fixture.local.plan, result.evidence as ContentRevision[]) };
}

it('예약 활동의 시각 변경과 제거는 확인 필요이고 일괄 적용에서 빠진다', async () => {
  const fixture = await aiV2Fixture();
  const moved = reviewed(fixture, editing(fixture, { startTime: '10:00' })).reviews;
  expect(moved[0].needsConfirmation).toBe(true);
  expect(operationsToApply(moved, new Set())).toEqual([]);
  expect(operationsToApply(moved, new Set([0]))).toHaveLength(1);
  const removed = reviewed(
    fixture,
    editing(fixture, { type: 'remove', title: '', summary: '', startTime: null, endTime: null, placeId: null }),
  ).reviews;
  expect(removed[0].needsConfirmation).toBe(true);
  const titleOnly = reviewed(fixture, fixture.output).reviews;
  expect(titleOnly[0].needsConfirmation).toBe(false);
});

it('제거·날짜 이동으로 사라질 이동과 앞뒤 시간 충돌을 표시한다', async () => {
  const fixture = await aiV2Fixture();
  const removed = reviewed(
    fixture,
    editing(fixture, { type: 'remove', title: '', summary: '', startTime: null, endTime: null, placeId: null }),
  ).reviews;
  expect(removed[0].droppedLegs[0]).toContain('가상 활동 2');
  const movedDay = reviewed(fixture, editing(fixture, { dayId: 'day-2', startTime: '12:00' })).reviews;
  expect(movedDay[0].droppedLegs).toHaveLength(1);
  const plan = structuredClone(fixture.local.plan);
  const date = plan.days[0].date;
  plan.items[1].time = { start: { precision: 'local', date, localTime: '09:05', timeZoneStatus: 'unknown' } };
  const conflicted = reviewed(
    { ...fixture, local: { ...fixture.local, plan } },
    editing(fixture, { startTime: '09:00', endTime: null }),
  ).reviews;
  expect(conflicted[0].conflicts.join()).toContain('이동');
});

it('변하는 사실은 공식 출처와 확인 시각이 없으면 모델 주장과 무관하게 미확인이다', async () => {
  const fixture = await aiV2Fixture();
  const blog = structuredClone(fixture.output);
  blog.evidence[0] = { ...blog.evidence[0], claim: '확인됨: 입장료 1만원', checkedAt: '2026-01-02' };
  const unverified = reviewed(fixture, blog);
  expect(unverified.reviews[0].factStatus).toBe('unverified');
  expect(unverified.result.evidence[0].payload).not.toHaveProperty('sourceVerifiedAt');

  const official = { url: 'https://www.museum.go.kr/fee', title: '공식' };
  const withOfficial = { ...fixture, research: { ...fixture.research, sources: [official] } };
  const confirmed = structuredClone(blog);
  confirmed.evidence[0].url = official.url;
  const verified = reviewed(withOfficial, confirmed);
  expect(verified.reviews[0].factStatus).toBe('verified');
  expect(verified.reviews[0].sources.official).toBe(1);
  expect(verified.reviews[0].checkedAt).toBe('2026-01-02');

  confirmed.evidence[0].checkedAt = null;
  expect(reviewed(withOfficial, confirmed).reviews[0].factStatus).toBe('unverified');
});

it('출처 종류는 주소로 나누고 항목별 사유를 보존한다', async () => {
  const fixture = await aiV2Fixture();
  const sources = [
    { url: 'https://www.yna.co.kr/a', title: '언론' },
    { url: 'https://blog.example.org/a', title: '블로그' },
  ];
  const output = structuredClone(fixture.output);
  output.evidence = sources.map((source) => ({
    url: source.url,
    claim: '가상 주장',
    checkedAt: null,
    operationIndexes: [0],
  }));
  const { reviews, result } = reviewed({ ...fixture, research: { text: '', sources } }, output);
  expect(reviews[0].sources).toEqual({ official: 0, press: 1, community: 1 });
  expect(reviews[0].reason).toBe('가상 항목 사유');
  expect(result.evidence.length).toBe(sources.length + 1);
});

it('같은 작업을 다시 완성해도 결과가 같아 재회수가 중복 저장되지 않는다', async () => {
  const { local, output, research } = await aiV2Fixture();
  expect(materializeV2Proposal(local, output, research)).toEqual(materializeV2Proposal(local, output, research));
});

it('확인 필요 항목을 뺀 revision을 저장한 뒤 적용하면 남은 항목만 반영되고 전체 항목은 이력에 남는다', async () => {
  const fixture = await aiV2Fixture();
  const database = new TravelDB(`d01-narrow-${crypto.randomUUID()}`);
  const repository = new ContentRepository(database);
  await repository.init();
  try {
    const assets = new Map<string, Uint8Array>();
    for (const bytes of Object.values(fixtureAssets)) {
      assets.set(await digestBytes(bytes), bytes);
    }
    const provenance = {
      packageId: 'fictional-d01',
      packageDigest: 'a'.repeat(64),
      lineageId: 'fictional-d01',
      adapterVersion: '1',
      manifest: {},
      report: {},
      mappings: currentMappings(fixture.dataset),
    };
    await repository.prepareImport(fixture.dataset, assets, provenance);
    const tripId = fixture.dataset.header.tripId;
    await repository.execute(
      command(tripId, 'ImportNewTrip', { packageId: provenance.packageId, packageDigest: provenance.packageDigest }),
    );
    const other = fixture.input.planning.items.find((item) => item.activityId === 'activity-2')!;
    const output = structuredClone(fixture.output);
    output.operations[0].startTime = '10:00';
    output.operations.push({
      ...output.operations[0],
      activityId: other.activityId,
      dayId: other.dayId,
      title: '남는 항목',
      startTime: null,
      placeId: other.placeId,
    });
    const result = materializeV2Proposal(fixture.local, output, fixture.research);
    const evidence = result.evidence.map(({ actor: _a, recordedAt: _r, commitSeq: _c, ...content }) => content);
    await repository.execute({
      ...command(tripId, 'StageAiProposal', { proposal: result.proposal, evidence }, 0),
      requestId: fixture.input.id,
    });
    const keep = result.proposal.operations.slice(1);
    const narrowed = {
      ...result.proposal,
      proposalRevision: 2,
      proposalRevisionId: crypto.randomUUID(),
      previousProposalRevisionId: result.proposal.proposalRevisionId,
      operations: keep,
      impact: { ...result.proposal.impact, activityIds: [other.activityId] },
    };
    await repository.execute(
      command(
        tripId,
        'SaveProposal',
        { proposal: narrowed, baseDomainRevision: narrowed.baseDomainRevision },
        undefined,
        {
          expectedProposalRevision: 1,
        },
      ),
    );
    await repository.execute(
      command(
        tripId,
        'DecideProposal',
        { proposalId: result.proposal.proposalId, decision: 'apply', confirmedByUser: true },
        undefined,
        { expectedProposalRevision: 2 },
      ),
    );
    const saved = await repository.get(tripId);
    const current = saved.plans.find((plan) => plan.planVersionId === saved.header.currentPlanVersionId)!;
    expect(current.items.find((item) => item.activityId === 'activity-1')!.title).toBe('가상 활동 1');
    expect(current.items.find((item) => item.activityId === 'activity-2')!.title).toBe('남는 항목');
    const first = saved.proposals.find(
      (proposal) => proposal.proposalId === result.proposal.proposalId && proposal.proposalRevision === 1,
    )!;
    expect(first.operations).toHaveLength(2);
  } finally {
    await database.delete();
  }
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

it('429를 예산 차단과 일반 속도 제한으로 구분한다', async () => {
  const code = (value: string) => jsonResponse(429, { error: { code: value } });
  expect(await rateLimitMessage(code('project_spend_limit_exceeded'))).toContain('예산 한도');
  expect(await rateLimitMessage(code('organization_spend_limit_exceeded'))).toContain('예산 한도');
  expect(await rateLimitMessage(code('rate_limit_exceeded'))).toContain('잠시 후');
  expect(await rateLimitMessage(new Response('not json', { status: 429 }))).toContain('잠시 후');
});

async function runProvider(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(status, body)),
  );
  const fixture = await aiV2Fixture();
  const usage = vi.fn();
  const provider = new OpenAiV2Provider('sk-fictional-not-a-key', 'fictional');
  const run = provider.plan(fixture.input.planning, fixture.research, '', new AbortController().signal, usage);
  return { run, usage, fixture };
}

it('거절·길이 초과·미완성 응답을 구분하고 사용량을 읽는다', async () => {
  const refused = await runProvider({
    status: 'completed',
    usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
    output: [{ type: 'message', content: [{ type: 'refusal', refusal: '거절' }] }],
  });
  await expect(refused.run).rejects.toThrow('거절');
  expect(refused.usage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 5, totalTokens: 6, calls: 1 }));
  const cut = await runProvider({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
  await expect(cut.run).rejects.toThrow('길이 한도');
  const other = await runProvider({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } });
  await expect(other.run).rejects.toThrow('완성되지');
  const limited = await runProvider({ error: { code: 'project_spend_limit_exceeded' } }, 429);
  await expect(limited.run).rejects.toThrow('예산 한도');
});
