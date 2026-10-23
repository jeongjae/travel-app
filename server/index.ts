import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { JobManager } from './jobs.ts';
import { OpenAiProvider } from './ai.ts';
import { AiV2Jobs } from './ai-v2-jobs.ts';
import { OpenAiV2Provider } from './ai-v2.ts';

export async function makeApiServer(manager: JobManager, configured: boolean, v2?: AiV2Jobs) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    const host = req.headers.host ?? '';
    const origin = req.headers.origin;
    if (
      !/^127\.0\.0\.1:\d+$/.test(host) ||
      (origin && !/^http:\/\/(127\.0\.0\.1|localhost):(4173|5173)$/.test(origin))
    ) {
      send(403, { error: '허용하지 않는 로컬 요청입니다.' });
      return;
    }
    const path = req.url ?? '';
    if (req.method === 'GET' && path === '/api/ai/status') {
      send(200, { configured, model: manager.provider.model });
      return;
    }
    if (req.method === 'GET' && path === '/api/ai/v2/status') {
      send(200, {
        configured: configured && Boolean(v2),
        model: v2?.provider.model,
        maxDays: 7,
        dailyJobLimit: 20,
        maxSearchCalls: 2,
        maxPlanningAttempts: 2,
      });
      return;
    }
    if (!configured) {
      send(503, { error: '서버의 OpenAI API 키를 설정해야 합니다.' });
      return;
    }
    try {
      if (req.method === 'POST' && req.headers['x-travel-app'] !== '1') {
        send(403, { error: '앱에서 실행해 주세요.' });
        return;
      }
      if (path.startsWith('/api/ai/v2/')) {
        if (!v2) {
          send(503, { error: 'v2 AI 실행은 서버 설정 OPENAI_V2_ENABLED=1로 명시적으로 켜야 합니다.' });
          return;
        }
        if (req.method === 'GET' && path.startsWith('/api/ai/v2/jobs?')) {
          const tripId = new URL(path, 'http://127.0.0.1').searchParams.get('tripId');
          send(200, tripId ? v2.list(tripId) : []);
          return;
        }
        if (req.method === 'POST' && path === '/api/ai/v2/jobs') {
          if (!req.headers['content-type']?.startsWith('application/json')) {
            send(415, { error: 'JSON 요청만 허용합니다.' });
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of req) {
            bytes += Buffer.byteLength(chunk);
            if (bytes > 1024 ** 2) {
              send(413, { error: 'AI 컨텍스트는 1 MiB 이하로 줄여 주세요.' });
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          send(202, await v2.create(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
          return;
        }
        const match = /^\/api\/ai\/v2\/jobs\/([a-f0-9-]{36})(\/cancel)?$/.exec(path);
        if (match && req.method === 'GET' && !match[2]) {
          const job = v2.get(match[1]);
          send(job ? 200 : 404, job ?? { error: 'AI 작업이 없습니다.' });
          return;
        }
        if (match && req.method === 'POST' && match[2]) {
          send(200, await v2.cancel(match[1]));
          return;
        }
        send(404, { error: '없는 v2 API 경로입니다.' });
        return;
      }
      if (req.method === 'POST' && path === '/api/ai/jobs') {
        if (!req.headers['content-type']?.startsWith('application/json')) {
          send(415, { error: 'JSON 요청만 허용합니다.' });
          return;
        }
        let body = '';
        let bytes = 0;
        for await (const chunk of req) {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 1024 * 1024) {
            send(413, { error: 'AI 요청 크기는 1 MiB 이하로 줄여 주세요.' });
            return;
          }
          body += chunk;
        }
        const job = await manager.create(JSON.parse(body));
        send(202, job);
        return;
      }
      const match = /^\/api\/ai\/jobs\/([a-f0-9-]{36})(\/cancel)?$/.exec(path);
      if (match && req.method === 'GET' && !match[2]) {
        const job = manager.get(match[1]);
        send(job ? 200 : 404, job ?? { error: 'AI 작업이 없습니다.' });
        return;
      }
      if (match && req.method === 'POST' && match[2]) {
        send(200, await manager.cancel(match[1]));
        return;
      }
      send(404, { error: '없는 API 경로입니다.' });
    } catch (e) {
      // Schema parse errors may embed inputs, so expose only known operational errors.
      const message =
        e instanceof Error && e.name !== 'ZodError' && e.name !== 'SyntaxError'
          ? e.message
          : 'AI 요청 형식이 올바르지 않습니다.';
      send(400, { error: message });
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const key = process.env.OPENAI_API_KEY ?? '';
  const manager = new JobManager(
    new OpenAiProvider(key, process.env.OPENAI_MODEL || 'gpt-5.4-mini'),
    resolve('local-data/ai-jobs'),
  );
  await manager.init();
  const v2 =
    process.env.OPENAI_V2_ENABLED === '1'
      ? new AiV2Jobs(
          new OpenAiV2Provider(key, process.env.OPENAI_MODEL || 'gpt-5.4-mini'),
          resolve('local-data/ai-v2-jobs'),
        )
      : undefined;
  await v2?.init();
  const server = await makeApiServer(manager, key.startsWith('sk-'), v2);
  server.on('error', () => {
    console.error('AI 서버를 시작할 수 없습니다. 로컬 포트 8787을 확인하세요.');
    process.exitCode = 1;
  });
  server.listen(8787, '127.0.0.1', () => console.log('travel-app AI server: http://127.0.0.1:8787'));
}
