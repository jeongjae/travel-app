// T-D0 프로브를 승격한 시험. 필드마다 표식을 심고 실제 provider body에서 찾아 허용 목록 밖 값이 0인지 단언한다.
import { expect, it, vi } from 'vitest';
import { OpenAiV2Provider } from '../server/ai-v2';
import { buildAiV2Payload } from '../src/ai-v2-context';
import type { TripDataset } from '../src/contracts/v2';
import { aiV2Fixture } from './fixtures/ai-v2';

function plantCanaries(dataset: TripDataset) {
  const plan = dataset.plans[0];
  const [day1, , day3] = plan.days;
  const item = plan.items[0];
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
  day1.durationText = 'CANARY-day-durationText';
  day1.distanceText = 'CANARY-day-distanceText';
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
  plan.items.find((candidate) => candidate.dayId === day3.dayId)!.title = 'CANARY-other-day-item-title';
  for (const content of dataset.contents) {
    if (content.kind === 'place' && content.entityId === 'shared-source-slug') {
      content.payload.name = 'CANARY-referenced-place-name';
      content.payload.summary = 'CANARY-referenced-place-summary';
    }
    if (content.kind === 'place' && content.entityId === 'place-4') {
      // place-4는 3일째에만 쓰인다. 1~2일째 요청에 실리면 안 된다.
      content.payload.name = 'CANARY-unreferenced-place-name';
      content.payload.summary = 'CANARY-unreferenced-place-summary';
    }
    if (content.kind === 'guide') {
      content.payload.title = 'CANARY-guide-title';
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
      time: { start: { precision: 'date' as const, date: day1.date } },
      note,
      contextRefs: [],
    },
  });
  dataset.records.push(actual('r-old', 'CANARY-superseded-record-note'));
  dataset.records.push(actual('r-new', 'CANARY-latest-record-note', 'r-old'));
  dataset.records.push(actual('r-other', 'CANARY-unchosen-record-note'));
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
  return day1;
}

function canariesIn(text: string) {
  return [...new Set(text.match(/CANARY-[A-Za-z0-9-]+/g) ?? [])].sort();
}

async function capture(recordIds: string[]) {
  const fixture = await aiV2Fixture();
  const day1 = plantCanaries(fixture.dataset);
  const payload = buildAiV2Payload(fixture.dataset, {
    prompt: 'CANARY-prompt-free-text 내 예약번호 ABC123 근처 일정을 조정해 줘',
    requestKind: 'edit',
    fromDate: day1.date,
    count: 2,
    recordIds,
  });
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const text = bodies.length > 1 ? JSON.stringify(fixture.output) : '가상 조사';
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'web_search_call', action: { sources: [{ url: fixture.research.sources[0].url, title: '가상' }] } },
            { type: 'message', content: [{ type: 'output_text', text, annotations: [] }] },
          ],
        }),
      );
    }),
  );
  try {
    const provider = new OpenAiV2Provider('sk-fictional-not-a-key', 'fictional-model');
    const signal = new AbortController().signal;
    const research = await provider.research(payload.research, signal);
    await provider.plan(payload.planning, research, '', signal);
  } finally {
    vi.unstubAllGlobals();
  }
  return { research: String(bodies[0].input), planning: String(bodies[1].input) };
}

const allowedForPlanning = [
  'CANARY-day-cityText',
  'CANARY-day-title',
  'CANARY-item-summary',
  'CANARY-item-title',
  'CANARY-leg-durationText',
  'CANARY-prompt-free-text',
  'CANARY-referenced-place-name',
  'CANARY-referenced-place-summary',
];

it('조사 호출에는 선택 활동의 장소 이름만 가고 요청 원문은 가지 않는다', async () => {
  const { research } = await capture([]);
  expect(canariesIn(research)).toEqual(['CANARY-referenced-place-name']);
  expect(research).not.toContain('ABC123');
});

it('작성 호출의 표식은 허용 목록과 정확히 같다', async () => {
  const { planning } = await capture([]);
  expect(canariesIn(planning)).toEqual(allowedForPlanning);
});

it('고른 기록의 최신 유효값만 추가되고 정정 전·다른 날짜·고르지 않은 기록은 가지 않는다', async () => {
  const { planning, research } = await capture(['r-new', 'r-old', 'r-memo']);
  expect(canariesIn(planning)).toEqual(
    [...allowedForPlanning, 'CANARY-latest-record-note', 'CANARY-r-new-title'].sort(),
  );
  expect(canariesIn(research)).toEqual(['CANARY-referenced-place-name']);
});
