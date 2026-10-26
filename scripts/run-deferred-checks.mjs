import { spawn } from 'node:child_process';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

// Explicit invocation only. This command is never started by a build/import.
const pnpm = process.env.npm_execpath;
if (!pnpm) {
  throw new Error('pnpm run check:deferred로 실행하세요.');
}
const output = resolve('.cache/verification', new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const results = [];
const nativePnpm = extname(pnpm).toLowerCase() === '.exe';
for (const name of ['check', 'test:e2e', 'check:pilot']) {
  const log = await open(resolve(output, `${name.replaceAll(':', '-')}.log`), 'wx');
  console.log(`실행: ${name}`);
  let code;
  try {
    code = await new Promise((accept, reject) => {
      const executable = nativePnpm ? pnpm : process.execPath;
      const args = nativePnpm ? ['run', name] : [pnpm, 'run', name];
      const child = spawn(executable, args, {
        stdio: ['ignore', log.fd, log.fd],
        env: process.env,
      });
      child.once('error', reject);
      child.once('exit', (status) => accept(status ?? 1));
    });
  } finally {
    await log.close();
  }
  results.push({ command: name, exitCode: code });
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`${name}: ${code === 0 ? '통과' : '실패'} · ${output}`);
  if (code !== 0) {
    process.exitCode = 1;
    break;
  }
}
