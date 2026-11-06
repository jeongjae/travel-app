// T-D0 증거용 프로브: 7일·70활동 가상 요청의 검증 CPU 시간(Node 기준 근사). Workers Free의 요청당 CPU 한도와 대조한다.
// 실행: pnpm exec vitest run --config docs/d00/vitest.probe.config.mts docs/d00/cpu.probe.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { it } from 'vitest';
import { aiV2RequestSchema } from '../../src/ai-v2-contract';
import { canonicalJson, digestBytes } from '../../src/contracts/v2';
import { aiV2Fixture } from '../../tests/fixtures/ai-v2';

it('7일 요청의 검증 시간을 잰다', async () => {
  const fixture = await aiV2Fixture();
  const request = structuredClone(fixture.input);
  const plan = request.context.plan;
  const header = request.context.header;
  header.endDate = '2026-11-20';
  const baseDay = plan.days[0];
  const baseItem = plan.items[0];
  plan.days = Array.from({ length: 7 }, (_, index) => ({
    ...baseDay,
    dayId: `day-${index + 1}`,
    ordinal: index + 1,
    date: `2026-11-0${index + 1}`,
  }));
  plan.items = plan.days.flatMap((day, dayIndex) =>
    Array.from({ length: 10 }, (_, itemIndex) => ({
      ...baseItem,
      activityId: `activity-${dayIndex}-${itemIndex}`,
      dayId: day.dayId,
      order: itemIndex,
      summary: '가상 요약 문장입니다. '.repeat(10),
    })),
  );
  plan.legs = [];
  request.context.places = Array.from({ length: 150 }, (_, index) => ({
    id: `place-${index}`,
    name: `가상 장소 ${index}`,
    summary: '가상 장소 요약 문장입니다. '.repeat(8),
  }));
  request.fromDate = '2026-11-01';
  const raw = JSON.stringify(request);
  const samples: number[] = [];
  for (let run = 0; run < 60; run++) {
    const start = performance.now();
    const parsed = aiV2RequestSchema.parse(JSON.parse(raw));
    await digestBytes(new TextEncoder().encode(canonicalJson(parsed)));
    samples.push(performance.now() - start);
  }
  const settled = samples.slice(10).sort((a, b) => a - b);
  const median = settled[Math.floor(settled.length / 2)];
  await mkdir(resolve('local-data/d00-worker-spike'), { recursive: true });
  await writeFile(resolve('local-data/d00-worker-spike/request.json'), raw);
  await writeFile(resolve('local-data/d00-worker-spike/output.json'), JSON.stringify(fixture.output));
  await writeFile(
    resolve('docs/d00/cpu.json'),
    JSON.stringify(
      {
        bytes: new TextEncoder().encode(raw).length,
        days: 7,
        items: plan.items.length,
        places: 150,
        firstRunMs: Number(samples[0].toFixed(2)),
        medianMs: Number(median.toFixed(2)),
        maxMs: Number(settled.at(-1)!.toFixed(2)),
        runtime: 'Node (workerd 아님, 근사)',
      },
      null,
      2,
    ) + '\n',
  );
});
