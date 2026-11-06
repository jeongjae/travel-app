// 스파이크 구동: 가짜 OpenAI + wrangler dev를 띄우고 무인증·CORS·중복·재시작 시 재호출 없음을 본다. 외부 호출 없음.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync, writeFileSync } from 'node:fs';

const PORT = 8798;
const base = `http://127.0.0.1:${PORT}`;
const creates = [];
let slowCreate = false;
let pollCount = 0;
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    if (req.method === 'POST') {
      creates.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      const reply = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: `resp_${creates.length}`, status: 'queued' }));
      };
      setTimeout(reply, slowCreate ? 8000 : 10);
      return;
    }
    pollCount++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: pollCount >= 3 ? 'completed' : 'in_progress' }));
  });
});
await new Promise((ok) => mock.listen(8799, '127.0.0.1', ok));

function startWorker() {
  const child = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--inspector-port', '9239', '--log-level', 'error'],
    {
      shell: true,
      stdio: 'ignore',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    },
  );
  return child;
}
function stopWorker(child) {
  execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`${base}/`, { method: 'OPTIONS' });
      return;
    } catch {
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
  throw new Error('wrangler not ready');
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const auth = { Authorization: 'Bearer spike', 'Content-Type': 'application/json' };
const post = (id, fingerprint = 'f1') =>
  fetch(`${base}/jobs/${id}`, { method: 'POST', headers: auth, body: JSON.stringify({ fingerprint }) });
const get = async (id) => (await fetch(`${base}/jobs/${id}`, { headers: auth })).json();

rmSync('.wrangler', { recursive: true, force: true });
writeFileSync('.dev.vars', 'OPENAI_API_KEY=sk-fictional-not-a-key\nSPIKE_TOKEN=spike\n');
const results = {};
let worker = startWorker();
await ready();

results.noAuth = (await fetch(`${base}/jobs/a`, { method: 'POST', body: '{}' })).status;
results.wrongOrigin = (
  await fetch(`${base}/jobs/a`, { method: 'POST', headers: { ...auth, Origin: 'https://evil.example' }, body: '{}' })
).status;
const preflight = await fetch(`${base}/jobs/a`, {
  method: 'OPTIONS',
  headers: { Origin: 'https://jeongjae.github.io' },
});
results.preflight = { status: preflight.status, allow: preflight.headers.get('access-control-allow-origin') };

const concurrent = await Promise.all(Array.from({ length: 5 }, () => post('dup')));
results.concurrentStatuses = concurrent.map((response) => response.status).sort();
results.conflict = (await post('dup', 'other')).status;
await sleep(2500);
const finished = await get('dup');
results.dup = { status: finished.status, polls: finished.polls, upstreamCreates: creates.length };
results.keyAtUpstreamOnly =
  creates[0].auth === 'Bearer sk-fictional-not-a-key' && !JSON.stringify(finished).includes('sk-fictional');
results.backgroundBody = creates[0].body;

slowCreate = true;
await post('crash');
await sleep(1500);
results.beforeKill = (await get('crash')).status;
const createsBefore = creates.length;
stopWorker(worker);
await sleep(1500);
worker = startWorker();
await ready();
await sleep(3000);
const after = await get('crash');
results.afterRestart = { status: after.status, extraCreates: creates.length - createsBefore };
results.persistedAcrossRestart = (await get('dup')).status;

stopWorker(worker);
mock.close();
console.log(JSON.stringify(results, null, 2));
process.exit(0);
