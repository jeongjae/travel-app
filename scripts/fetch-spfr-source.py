"""Collect pinned migration inputs without executing the reference repository.

The Git tree is supplied by the caller. Existing byte-identical local copies are
reused; fresh downloads use the same immutable commit and are checked before write.
"""

import argparse
import hashlib
import json
import runpy
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

PREFLIGHT = runpy.run_path(str(Path(__file__).with_name('source-preflight.py')))
PREPARE = runpy.run_path(str(Path(__file__).with_name('prepare-spfr-pilot.py')))
MAX_BYTES = 16 * 1024 * 1024


def collect(tree, commit, output, reuse_roots):
    PREFLIGHT['inventory'](tree, commit)
    private = Path('local-data').resolve(strict=True)
    output = Path(output).resolve()
    if not output.is_relative_to(private) or output == private:
        raise ValueError('source output must be below local-data')
    blobs = {item['path']: item for item in tree['tree'] if item['type'] == 'blob'}
    required = set(PREPARE['JSON_SOURCES']) | {
        PREPARE['BOOK'], 'source/ASSETS/91_Place_Registry_v1.0.md',
    }
    required.update(path for path in blobs if (
        path.startswith('data/daily-cards/') and path.endswith('.json')
        or path.startswith('source/CURRENT/') and path.endswith('.md')
        or path.startswith('build/') and path.endswith('.py')
    ))
    PREFLIGHT['inventory'](tree, commit, required)
    roots = [Path(root).resolve(strict=True) for root in reuse_roots]
    output.mkdir(parents=True, exist_ok=True)

    def verify(path, data):
        blob = blobs[path]
        identity = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if len(data) != blob['size'] or identity != blob['sha']:
            raise ValueError('pinned source mismatch: ' + path)
        return hashlib.sha256(data).hexdigest()

    def fetch(path):
        PREFLIGHT['safe_path'](path)
        target = output / path
        if not target.resolve().is_relative_to(output) or not 0 <= blobs[path]['size'] <= MAX_BYTES:
            raise ValueError('source path/size limit')
        data = None
        reused = False
        for root in [output, *roots]:
            candidate = root / path
            if candidate.is_file() and candidate.resolve().is_relative_to(root):
                candidate_bytes = candidate.read_bytes()
                try:
                    verify(path, candidate_bytes)
                except ValueError:
                    if root == output:
                        raise
                    continue
                data = candidate_bytes
                reused = True
                break
        if data is None:
            url = 'https://raw.githubusercontent.com/jeongjae/SP-FR-guidebook/' + commit + '/' + quote(path)
            with urlopen(url, timeout=45) as response:
                data = response.read(MAX_BYTES + 1)
        digest = verify(path, data)
        if not target.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.parent.resolve().is_relative_to(output):
                raise ValueError('source directory escapes output')
            with target.open('xb') as stream:
                stream.write(data)
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError('source changed after write')
        return {'path': path, 'sha256': digest, 'gitBlobSha1': blobs[path]['sha'],
                'byteLength': len(data), 'reused': reused}

    with ThreadPoolExecutor(max_workers=4) as pool:
        files = list(pool.map(fetch, sorted(required)))
    return {'sourceCommit': commit, 'files': files, 'allBytesVerified': True}


def main():
    parser = argparse.ArgumentParser()
    for name in ['tree', 'commit', 'output-dir']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--reuse-root', action='append', default=[])
    args = parser.parse_args()
    result = collect(PREFLIGHT['load_json'](args.tree), args.commit, args.output_dir, args.reuse_root)
    report = Path(args.output_dir).parent / 'source-files.json'
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(result['files']), 'bytes': sum(item['byteLength'] for item in result['files']),
                      'allBytesVerified': True}))


if __name__ == '__main__':
    main()
