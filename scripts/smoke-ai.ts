// Uses fictional data only. Never print credentials or raw provider error bodies.
import { writeFile, mkdir } from 'node:fs/promises';
import { demoTrips } from '../src/demo.ts';
import { uid } from '../src/domain.ts';

const trip = demoTrips()[0];
const request = {
  id: uid(),
  trip,
  fromDate: trip.startDate,
  prompt:
    '작은 미술관 일정을 파리 오르세 미술관 방문으로 바꾸어 주세요. 2026년 11월 7일 공식 관람 안내를 조사하고 방문 전 확인할 사항을 근거와 예약 영향에 남기세요. 다른 두 일정은 유지해 주세요.',
};
const base = 'http://127.0.0.1:8787/api/ai/jobs';
const started = await fetch(base, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Travel-App': '1' },
  body: JSON.stringify(request),
});
if (!started.ok) {
  console.log(JSON.stringify({ started: false, status: started.status }));
  process.exit(1);
}
let previous = '';
for (let count = 0; count < 180; count++) {
  const res = await fetch(`${base}/${request.id}`);
  const job = await res.json();
  if (job.status !== previous) {
    console.log(JSON.stringify({ status: job.status, attempt: job.attempt }));
    previous = job.status;
  }
  if (['failed', 'cancelled', 'interrupted', 'awaiting-decision'].includes(job.status)) {
    await mkdir('.cache', { recursive: true });
    await writeFile('.cache/ai-smoke-result.json', JSON.stringify({ request, job }, null, 2));
    console.log(
      JSON.stringify({
        successful: job.status === 'awaiting-decision',
        sourceCount: job.sources.length,
        operationCount: job.proposal?.operations.length ?? 0,
        error: job.error,
      }),
    );
    process.exit(job.status === 'awaiting-decision' ? 0 : 1);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
console.log(JSON.stringify({ successful: false, reason: 'poll timeout' }));
process.exit(1);
