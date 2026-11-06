// T-D0 증거: 앱 코드 없이 persist와 같은 writeFile+rename만 반복해 Windows EPERM 발생률을 잰다.
// 실행: node docs/d00/rename-loop.mjs <폴더>...
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const cycles = 3000;
for (const directory of process.argv.slice(2).map((path) => resolve(path))) {
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'jobs.json');
  const errors = {};
  let failures = 0;
  for (let cycle = 0; cycle < cycles; cycle++) {
    await writeFile(target + '.tmp', JSON.stringify({ cycle }), { mode: 0o600 });
    try {
      await rename(target + '.tmp', target);
    } catch (error) {
      failures++;
      errors[error.code] = (errors[error.code] ?? 0) + 1;
    }
  }
  console.log(JSON.stringify({ directory: directory.split(/[\\/]/).slice(-2).join('/'), cycles, failures, errors }));
}
