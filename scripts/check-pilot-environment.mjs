import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const python = fileURLToPath(new URL(process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python', import.meta.url));
const result = spawnSync(python, [fileURLToPath(new URL('./check-pilot-environment.py', import.meta.url))], { stdio: 'inherit' });
if (result.error) { console.error('프로젝트 .venv를 먼저 생성하고 requirements-extract.txt를 설치하세요.', result.error.message); }
process.exit(result.status ?? 1);
