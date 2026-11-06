// T-D0 증거용 프로브: `tests/ai-v2.test.ts` 간헐 실패 원인 추정. 제품 코드를 바꾸지 않고 외부 호출이 없다.
// 실행: pnpm exec vitest run --config docs/d00/vitest.probe.config.mts docs/d00/flake.probe.ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { AiV2Provider } from '../../server/ai-v2';
import { AiV2Jobs } from '../../server/ai-v2-jobs';
import { aiV2Fixture } from '../../tests/fixtures/ai-v2';

async function workspace() {
  await mkdir('.cache/d00', { recursive: true });
  return mkdtemp(resolve('.cache/d00/flake-'));
}

it('부하 중 반복 실행의 작업 오류 문구를 집계한다', async () => {
  const fixture = await aiV2Fixture();
  const directory = await workspace();
  const outcomes = new Map<string, number>();
  const runs = 300;
  for (let run = 0; run < runs; run++) {
    const invalid = structuredClone(fixture.output);
    invalid.evidence[0].url = 'https://example.org/invented';
    const provider: AiV2Provider = {
      model: 'fictional',
      research: async () => fixture.research,
      plan: async () => invalid,
    };
    const jobs = new AiV2Jobs(provider, await mkdtemp(join(directory, 'run-')));
    await jobs.init();
    const input = { ...fixture.input, id: crypto.randomUUID() };
    await jobs.create(input);
    await vi.waitFor(() => expect(jobs.get(input.id)?.status).toBe('failed'), { timeout: 5000, interval: 2 });
    const job = jobs.get(input.id)!;
    const dir = (jobs as unknown as { directory: string }).directory;
    await (jobs as unknown as { writes: Promise<void> }).writes;
    const stored = JSON.parse(await readFile(join(dir, 'jobs.json'), 'utf8'))[0].job.status;
    const key = `${(job.error ?? '').replace(/'[^']*'/g, "'…'").slice(0, 70)} | file=${stored}`;
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  }
  await writeFile(
    resolve('docs/d00/flake-stress.json'),
    JSON.stringify({ platform: process.platform, runs, outcomes: Object.fromEntries(outcomes) }, null, 2) + '\n',
  );
}, 300_000);
