import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('고정 미디어 다운로드는 Git blob·manifest·경로를 검증하고 기존 파일을 덮어쓰지 않는다', () => {
  const python = resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const script = String.raw`
import hashlib, io, json, runpy, tempfile
from pathlib import Path

module = runpy.run_path('scripts/fetch-spfr-media.py')
fetch = module['fetch_media']
commit = 'a' * 40
source = 'source/ASSETS/fiction.webp'
data = b'synthetic image bytes'
digest = hashlib.sha256(data).hexdigest()
blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
audit = {'sourceCommit': commit, 'media': [{'sourcePath': source, 'sha256': digest, 'byteLength': len(data)}]}
tree = {'sha': commit, 'truncated': False, 'tree': [{'path': source, 'mode': '100644', 'type': 'blob', 'sha': blob, 'size': len(data)}]}
calls = []
def request(url, timeout):
    assert commit in url and timeout == 45
    calls.append(url)
    return io.BytesIO(data)
fetch.__globals__['urlopen'] = request
private = Path('local-data').resolve()
private.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=private, prefix='media-test-') as directory:
    output = Path(directory).resolve() / 'files'
    assert output.is_relative_to(private)
    first = fetch(audit, tree, commit, output)
    assert first['files'][0]['sha256'] == digest
    assert first['files'][0]['reused'] is False
    second = fetch(audit, tree, commit, output)
    assert second['files'][0]['reused'] is True and len(calls) == 1
    target = output / source
    target.write_bytes(b'changed existing file')
    try:
        fetch(audit, tree, commit, output)
        raise AssertionError('tampered existing file accepted')
    except ValueError:
        assert target.read_bytes() == b'changed existing file'
    try:
        fetch(audit, tree, 'b' * 40, output)
        raise AssertionError('commit mismatch accepted')
    except ValueError:
        pass
    try:
        fetch(audit, tree, commit, Path(directory).resolve().parents[1])
        raise AssertionError('outside private output accepted')
    except ValueError:
        pass
    hostile = {'sourceCommit': commit, 'media': [{'sourcePath': '../escape.webp'}]}
    hostile_tree = {'sha': commit, 'truncated': False, 'tree': [{'path': '../escape.webp', 'mode': '100644', 'type': 'blob', 'sha': blob, 'size': len(data)}]}
    try:
        fetch(hostile, hostile_tree, commit, output)
        raise AssertionError('traversal accepted')
    except ValueError:
        pass
print(json.dumps({'passed': True, 'networkCalls': len(calls)}))
`;
  const result = execFileSync(python, ['-c', script], { encoding: 'utf8' });
  expect(JSON.parse(result)).toEqual({ passed: true, networkCalls: 1 });
});
