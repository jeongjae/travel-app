// T-D0 증거용 프로브. 제품 코드가 아니며 `pnpm run test`에 포함되지 않는다. 가상 데이터만 쓰고 외부 호출이 없다(fetch 대체).
// 실행: pnpm exec vitest run --config docs/d00/vitest.probe.config.mts
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { materializeV2Proposal, OpenAiV2Provider, type AiV2Provider } from '../../server/ai-v2';
import { AiV2Jobs } from '../../server/ai-v2-jobs';
import { JobManager } from '../../server/jobs';
import { makeApiServer } from '../../server/index';
import { buildAiV2Request } from '../../src/ai-v2-context';
import { ContentRepository, TravelDB } from '../../src/repository';
import { digestBytes, type TripDataset } from '../../src/contracts/v2';
import { command } from '../../src/content/ui';
import { currentMappings } from '../../src/transfer/normalize';
import { aiV2Fixture } from '../../tests/fixtures/ai-v2';
import { fixtureAssets } from '../../tests/fixtures/pilot';

const output = resolve('docs/d00/send-surface.json');

/** 필드마다 고유 표식을 심어, 어느 호출의 body에 실제로 들어갔는지 문자열로 판정한다. */
function plantCanaries(dataset: TripDataset) {
  const plan = dataset.plans[0];
  const [day1, day2, day3] = plan.days;
  const [item] = plan.items;
  dataset.header.name = 'CANARY-header-name';
  plan.reason = 'CANARY-plan-reason';
  day1.title = 'CANARY-day-title';
  day1.cityText = 'CANARY-day-cityText';
  day1.backupText = 'CANARY-day-backupText';
  day1.fatigueText = 'CANARY-day-fatigueText';
  day1.needsReview = ['CANARY-day-needsReview'];
  day1.food = ['CANARY-day-food'];
  day1.transport = ['CANARY-day-transport'];
  day1.highlights = ['CANARY-day-highlights'];
  day1.assetRefs = [{ assetId: 'asset-image', role: 'daily-card', caption: 'CANARY-day-photo-caption' }];
  day1.sourceStatus = 'CANARY-day-sourceStatus';
  item.title = 'CANARY-item-title';
  item.summary = 'CANARY-item-summary';
  item.reservationText = 'CANARY-item-reservationText';
  item.executionNote = 'CANARY-item-executionNote';
  item.menuText = 'CANARY-item-menuText';
  item.executionMarkers = [
    { type: 'CANARY-marker-type', detail: 'CANARY-marker-detail', label: 'CANARY-marker-label' },
  ];
  item.sourceFlags = ['CANARY-item-sourceFlags'];
  item.bookingIds = ['CANARY-item-bookingId'];
  item.officialUrl = 'https://example.org/CANARY-item-officialUrl';
  item.mapTargetId = 'CANARY-item-mapTargetId';
  plan.legs[0].lineText = 'CANARY-leg-lineText';
  plan.legs[0].durationText = 'CANARY-leg-durationText';
  plan.stays[0].baseText = 'CANARY-stay-baseText';
  day3.title = 'CANARY-other-day-title';
  day3.backupText = 'CANARY-other-day-backupText';
  const day3Item = plan.items.find((candidate) => candidate.dayId === day3.dayId)!;
  day3Item.title = 'CANARY-other-day-item-title';
  for (const content of dataset.contents) {
    if (content.kind === 'place' && content.entityId === 'place-4') {
      // place-4는 3일째에만 쓰인다. 1~2일째 요청에 실리면 "참조와 무관한 전체 장소 전송"이다.
      content.payload.name = 'CANARY-unreferenced-place-name';
      content.payload.summary = 'CANARY-unreferenced-place-summary';
    }
    if (content.kind === 'guide') {
      content.payload.title = 'CANARY-guide-title';
    }
    if (content.kind === 'booking') {
      (content.payload as { title?: string }).title = 'CANARY-booking-title';
    }
    if (content.kind === 'fact') {
      content.payload.valueText = 'CANARY-fact-valueText';
    }
    if (content.kind === 'asset') {
      content.payload.originalPath = 'CANARY-asset-originalPath';
    }
    content.sourceRefs = content.sourceRefs.map((ref) => ({ ...ref, sourcePath: 'CANARY-sourceRef-path' }));
  }
  const common = { tripId: dataset.header.tripId, sourceRefs: [], commitSeq: 1 };
  const actual = (recordId: string, note: string, supersedes?: string) => ({
    ...common,
    recordId,
    kind: 'actual' as const,
    recordedAt: '2026-01-02T00:00:00Z',
    ...(supersedes ? { supersedes } : {}),
    payload: {
      title: `CANARY-${recordId}-title`,
      targetSummary: 'CANARY-record-targetSummary',
      outcome: 'visited' as const,
      time: { start: { precision: 'unspecified' as const } },
      note,
      contextRefs: [],
    },
  });
  dataset.records.push(actual('r-old', 'CANARY-superseded-record-note'));
  dataset.records.push(actual('r-new', 'CANARY-latest-record-note', 'r-old'));
  dataset.records.push({
    ...common,
    recordId: 'r-memo',
    kind: 'note',
    recordedAt: '2026-01-03T00:00:00Z',
    payload: {
      targetRef: { tripId: dataset.header.tripId, targetKind: 'day', entityId: day3.dayId, planVersionId: 'plan-1' },
      body: 'CANARY-other-day-memo-body',
      contextRefs: [],
    },
  } as TripDataset['records'][number]);
  return { day1, day2 };
}

function canariesIn(text: string) {
  return [...new Set(text.match(/CANARY-[A-Za-z0-9-]+/g) ?? [])].sort();
}

async function capture(records: boolean) {
  const fixture = await aiV2Fixture();
  const { day1 } = plantCanaries(fixture.dataset);
  const prompt = 'CANARY-prompt-free-text 내 예약번호 ABC123 근처 일정을 조정해 줘';
  const input = buildAiV2Request(fixture.dataset, prompt, day1.date, 2, records);
  const bodies: Record<string, unknown>[] = [];
  const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const isPlan = bodies.length > 1;
    const text = isPlan ? JSON.stringify(fixture.output) : '가상 조사';
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'web_search_call',
            action: { sources: [{ url: fixture.research.sources[0].url, title: '가상' }] },
          },
          { type: 'message', content: [{ type: 'output_text', text, annotations: [] }] },
        ],
      }),
    );
  });
  vi.stubGlobal('fetch', fakeFetch);
  try {
    const provider = new OpenAiV2Provider('sk-fictional-not-a-key', 'fictional-model');
    const signal = new AbortController().signal;
    const research = await provider.research(input, signal);
    await provider.plan(input, research, '', signal);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(fakeFetch).toHaveBeenCalledTimes(2);
  const [researchBody, planBody] = bodies;
  const { tools: _tools, ...researchRest } = researchBody;
  return {
    researchKeys: Object.keys(researchRest).sort(),
    researchInput: canariesIn(String(researchBody.input)),
    researchHasPromptVerbatim: String(researchBody.input).includes('예약번호 ABC123'),
    planInput: canariesIn(String(planBody.input)),
    researchBytes: new TextEncoder().encode(String(researchBody.input)).length,
    planBytes: new TextEncoder().encode(String(planBody.input)).length,
  };
}

it('전송 표면 캡처와 의미 검증 공백을 기록한다', async () => {
  const withoutRecords = await capture(false);
  const withRecords = await capture(true);

  // 의미 검증 공백: 로컬 검증이 통과시키는 AI 출력.
  const { input, output: base, research } = await aiV2Fixture();
  const booked = input.context.plan.items.find((item) => item.bookingIds.length > 0)!;
  const accepted = (mutate: (draft: typeof base) => void) => {
    const draft = structuredClone(base);
    mutate(draft);
    try {
      materializeV2Proposal(input, draft, research);
      return true;
    } catch {
      return false;
    }
  };
  const editOp = base.operations[0];
  const semantic = {
    bookedItemTimeChanged: accepted((draft) => {
      draft.operations[0] = { ...editOp, activityId: booked.activityId, dayId: booked.dayId, startTime: '03:00' };
    }),
    bookedItemRemoved: accepted((draft) => {
      draft.operations[0] = {
        ...editOp,
        type: 'remove',
        activityId: booked.activityId,
        dayId: booked.dayId,
        title: '',
        summary: '',
        startTime: null,
        endTime: null,
        placeId: null,
      };
    }),
    endBeforeStart: accepted((draft) => {
      draft.operations[0] = { ...editOp, startTime: '18:00', endTime: '09:00' };
    }),
    addAtThreeAm: accepted((draft) => {
      draft.operations[0] = { ...editOp, type: 'add', activityId: '', startTime: '03:00', endTime: '03:30' };
    }),
  };

  // leg가 걸린 활동을 제거한 변경안의 끝까지: Stage·Decide.
  const leg = await legRemoval();

  // HTTP 경계: 무인증·v1 우회.
  const http = await httpSurface();

  await mkdir(resolve('docs/d00'), { recursive: true });
  await writeFile(output, JSON.stringify({ withoutRecords, withRecords, semantic, leg, http }, null, 2) + '\n');
});

async function legRemoval() {
  const fixture = await aiV2Fixture();
  const database = new TravelDB(`d00-${crypto.randomUUID()}`);
  const repository = new ContentRepository(database);
  await repository.init();
  try {
    const assets = new Map<string, Uint8Array>();
    for (const bytes of Object.values(fixtureAssets)) {
      assets.set(await digestBytes(bytes), bytes);
    }
    const provenance = {
      packageId: 'fictional-d00',
      packageDigest: 'a'.repeat(64),
      lineageId: 'fictional-d00',
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
    const legged = fixture.input.context.plan.legs[0].fromActivityId;
    const legDay = fixture.input.context.plan.items.find((item) => item.activityId === legged)!.dayId;
    const draft = structuredClone(fixture.output);
    draft.operations[0] = {
      type: 'remove',
      activityId: legged,
      dayId: legDay,
      title: '',
      summary: '',
      startTime: null,
      endTime: null,
      placeId: null,
    };
    const result = materializeV2Proposal(fixture.input, draft, fixture.research);
    const evidence = result.evidence.map(({ actor: _a, recordedAt: _r, commitSeq: _c, ...content }) => content);
    const payload = { proposal: result.proposal, evidence };
    await repository.execute({
      ...command(tripId, 'StageAiProposal', payload, fixture.dataset.header.domainRevision, {
        requestId: fixture.input.id,
      }),
      payload,
    });
    const saved = await repository.get(tripId);
    const proposal = saved.proposals.at(-1)!;
    let decide = 'applied';
    try {
      await repository.execute(
        command(
          tripId,
          'DecideProposal',
          { proposalId: proposal.proposalId, decision: 'apply', confirmedByUser: true },
          undefined,
          { expectedProposalRevision: 1 },
        ),
      );
    } catch (error) {
      decide = `rejected: ${(error as Error).name} ${(error as Error).message}`.slice(0, 160);
    }
    const after = await repository.get(tripId);
    const current = after.plans.find((plan) => plan.planVersionId === after.header.currentPlanVersionId)!;
    return {
      decide,
      legsAfter: current.legs.length,
      itemStillThere: current.items.some((i) => i.activityId === legged),
    };
  } finally {
    await database.delete();
  }
}

async function httpSurface() {
  const fixture = await aiV2Fixture();
  await mkdir('.cache/d00', { recursive: true });
  const directory = await mkdtemp(resolve('.cache/d00/jobs-'));
  const provider: AiV2Provider = {
    model: 'fictional',
    research: async () => fixture.research,
    plan: async () => structuredClone(fixture.output),
  };
  const jobs = new AiV2Jobs(provider, directory);
  await jobs.init();
  await jobs.create(fixture.input);
  await vi.waitFor(() => {
    const job = jobs.get(fixture.input.id);
    expect(`${job?.status} ${job?.error ?? ''}`.trim()).toBe('awaiting-decision');
  });
  const legacy = new JobManager({ model: 'unused', research: vi.fn(), plan: vi.fn() }, resolve(directory, 'legacy'));
  const server = await makeApiServer(legacy, true, jobs);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('주소 없음');
  }
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const tripId = fixture.input.context.header.tripId;
    const list = await fetch(`${base}/api/ai/v2/jobs?tripId=${tripId}`);
    const listed = (await list.json()) as { result?: unknown }[];
    const one = await fetch(`${base}/api/ai/v2/jobs/${fixture.input.id}`);
    const cancel = await fetch(`${base}/api/ai/v2/jobs/${fixture.input.id}/cancel`, {
      method: 'POST',
      headers: { 'X-Travel-App': '1' },
    });
    const otherOrigin = await fetch(`${base}/api/ai/v2/jobs/${fixture.input.id}`, {
      headers: { Origin: 'https://jeongjae.github.io' },
    });
    const v1Reachable = await fetch(`${base}/api/ai/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Travel-App': '1' },
      body: '{}',
    });
    return {
      listWithoutAuth: { status: list.status, returnsResult: Boolean(listed[0]?.result) },
      getWithoutAuth: one.status,
      cancelWithoutAuth: cancel.status,
      pagesOriginToday: otherOrigin.status,
      v1PostShapeCheck: v1Reachable.status,
      corsHeader: otherOrigin.headers.get('access-control-allow-origin'),
    };
  } finally {
    await new Promise<void>((accept) => server.close(() => accept()));
  }
}
