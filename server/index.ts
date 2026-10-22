import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { JobManager } from './jobs.ts';
import { OpenAiProvider } from './ai.ts';

export async function makeApiServer(manager: JobManager, configured: boolean) {
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
    if (!configured) {
      send(503, { error: '서버의 OpenAI API 키를 설정해야 합니다.' });
      return;
    }
    try {
      if (req.method === 'POST' && req.headers['x-travel-app'] !== '1') {
        send(403, { error: '앱에서 실행해 주세요.' });
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
  const server = await makeApiServer(manager, key.startsWith('sk-'));
  server.on('error', () => {
    console.error('AI 서버를 시작할 수 없습니다. 로컬 포트 8787을 확인하세요.');
    process.exitCode = 1;
  });
  server.listen(8787, '127.0.0.1', () => console.log('travel-app AI server: http://127.0.0.1:8787'));
}
