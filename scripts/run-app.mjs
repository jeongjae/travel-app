// pnpm dev / preview: Vite + AI 서버를 함께 띄운다.
// 기본 AI 서버는 로컬 Worker(`wrangler dev`, 8787)다. `node` 인자를 주면 이전 Node 서버(server/index.ts)를 쓴다.
// Worker 비밀값은 worker/.dev.vars(커밋 안 함)에서 읽는다. 패스키는 http://localhost:5173 으로 열어야 동작한다.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const mode = process.argv[2] === 'preview' ? 'preview' : 'dev';
const backend = process.argv[3] === 'node' ? 'node' : 'worker';
const args =
  mode === 'preview'
    ? ['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort']
    : ['--host', '127.0.0.1', '--port', '5173', '--strictPort'];
const serverArgs =
  backend === 'node'
    ? ['--env-file-if-exists=.env.local', 'server/index.ts']
    : [
        resolve('node_modules/wrangler/bin/wrangler.js'),
        'dev',
        '--config',
        'worker/wrangler.toml',
        '--ip',
        '127.0.0.1',
        '--port',
        '8787',
        '--persist-to',
        '.cache/wrangler-dev',
        '--show-interactive-dev-session=false',
      ];
const server = spawn(process.execPath, serverArgs, {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), ...args], { stdio: 'inherit' });
let stopping = false;
function stop(code = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  server.kill();
  frontend.kill();
  process.exitCode = code;
}
server.on('exit', (code) => stop(code ?? 1));
frontend.on('exit', (code) => stop(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop());
}
