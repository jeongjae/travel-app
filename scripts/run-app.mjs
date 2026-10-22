import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const args = process.argv[2] === 'preview' ? ['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'] : ['--host', '127.0.0.1', '--port', '5173', '--strictPort'];
const server = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server/index.ts'], { stdio: 'inherit' });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), ...args], { stdio: 'inherit' });
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; server.kill(); frontend.kill(); process.exitCode = code; }
server.on('exit', code => stop(code ?? 1)); frontend.on('exit', code => stop(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
