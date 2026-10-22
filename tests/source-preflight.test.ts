import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const python = resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
it('고정 Git tree와 선택 원천 바이트를 대조하고 미검토·미확인 범위를 분리한다', async () => {
  await mkdir('.cache/preflight-tests', { recursive: true });
  const dir = await mkdtemp(resolve('.cache/preflight-tests/source-')),
    root = join(dir, 'source');
  await mkdir(root);
  const data = Buffer.from('실행하지 않는 원천\n'),
    sha = createHash('sha1')
      .update(Buffer.from(`blob ${data.length}\0`))
      .update(data)
      .digest('hex'),
    commit = 'a'.repeat(40);
  await writeFile(join(root, 'example.md'), data);
  const tree = {
    sha: commit,
    truncated: false,
    tree: [{ path: 'example.md', mode: '100644', type: 'blob', sha, size: data.length }],
  };
  await writeFile(join(dir, 'tree.json'), JSON.stringify(tree));
  await writeFile(join(dir, 'selection.json'), '["example.md"]');
  const args = [
    'scripts/source-preflight.py',
    '--tree',
    join(dir, 'tree.json'),
    '--expected-commit',
    commit,
    '--selection',
    join(dir, 'selection.json'),
    '--source-root',
    root,
    '--output',
    join(dir, 'report.json'),
  ];
  execFileSync(python, args, { stdio: 'pipe' });
  const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
  expect(report.summary.localBytesVerified).toBe(1);
  expect(report.records[0].migrationDisposition).toBe('unreviewed');
  expect(report.records[0].sha256).toBe(createHash('sha256').update(data).digest('hex'));
  expect(await readFile(join(root, 'example.md'))).toEqual(data);
  await writeFile(join(root, 'example.md'), 'changed');
  expect(spawnSync(python, args, { stdio: 'pipe' }).status).not.toBe(0);
});
it('잘린 tree·다른 commit·경로 탈출·중복·소스 내부 출력을 거부한다', async () => {
  await mkdir('.cache/preflight-tests', { recursive: true });
  const dir = await mkdtemp(resolve('.cache/preflight-tests/bad-')),
    commit = 'a'.repeat(40),
    entry = { path: 'a.md', mode: '100644', type: 'blob', sha: 'b'.repeat(40), size: 1 };
  for (const tree of [
    { sha: commit, truncated: true, tree: [entry] },
    { sha: 'b'.repeat(40), truncated: false, tree: [entry] },
    { sha: commit, truncated: false, tree: [{ ...entry, path: '../escape' }] },
    { sha: commit, truncated: false, tree: [entry, entry] },
  ]) {
    await writeFile(join(dir, 'tree.json'), JSON.stringify(tree));
    expect(
      spawnSync(
        python,
        [
          'scripts/source-preflight.py',
          '--tree',
          join(dir, 'tree.json'),
          '--expected-commit',
          commit,
          '--output',
          join(dir, 'output.json'),
        ],
        { stdio: 'pipe' },
      ).status,
    ).not.toBe(0);
  }
  await writeFile(join(dir, 'tree.json'), JSON.stringify({ sha: commit, truncated: false, tree: [entry] }));
  expect(
    spawnSync(
      python,
      [
        'scripts/source-preflight.py',
        '--tree',
        join(dir, 'tree.json'),
        '--expected-commit',
        commit,
        '--source-root',
        dir,
        '--output',
        join(dir, 'inside.json'),
      ],
      { stdio: 'pipe' },
    ).status,
  ).not.toBe(0);
});
