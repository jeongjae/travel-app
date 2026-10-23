"""Fetch only pinned pilot attachments and verify bytes before publishing local files."""

import argparse
import hashlib
import json
import mimetypes
import runpy
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen


PREFLIGHT = runpy.run_path(str(Path(__file__).with_name('source-preflight.py')))
MAX_FILE_BYTES = 32 * 1024 * 1024


def media_type(path, data):
    # Windows may not register WebP in mimetypes. Use verified bytes, not a filename-only guess.
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    return mimetypes.guess_type(path)[0] or 'application/octet-stream'


def fetch_media(audit, tree, commit, output, reuse_roots=()):
    if audit.get('sourceCommit') != commit:
        raise ValueError('audit source commit mismatch')
    output = Path(output).resolve()
    reuse_roots = [Path(root).resolve(strict=True) for root in reuse_roots]
    private_root = Path('local-data').resolve(strict=True)
    if not output.is_relative_to(private_root) or output == private_root:
        raise ValueError('media output must be inside local-data')
    selected = sorted({item['sourcePath'] for item in audit['media']})
    PREFLIGHT['inventory'](tree, commit, selected)
    blobs = {item['path']: item for item in tree['tree'] if item['type'] == 'blob'}
    by_path = {path: [item for item in audit['media'] if item['sourcePath'] == path] for path in selected}
    for path in selected:
        if not 0 < blobs[path]['size'] <= MAX_FILE_BYTES:
            raise ValueError('media size exceeds per-file limit: ' + path)
    output.mkdir(parents=True, exist_ok=True)
    # Resolve existing parents before parallel writes (Windows can canonicalize
    # a partly-created directory differently while another worker creates it).
    for parent in sorted({(output / path).parent for path in selected}):
        parent.mkdir(parents=True, exist_ok=True)
        if not parent.resolve(strict=True).is_relative_to(output):
            raise ValueError('media directory escapes output')

    def verify(path, data):
        blob = blobs[path]
        git_hash = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        digest = hashlib.sha256(data).hexdigest()
        if len(data) != blob['size'] or git_hash != blob['sha']:
            raise ValueError('Git blob/size mismatch: ' + path)
        for item in by_path[path]:
            if item.get('sha256') and item['sha256'] != digest:
                raise ValueError('image manifest SHA-256 mismatch: ' + path)
            if item.get('byteLength') is not None and item['byteLength'] != len(data):
                raise ValueError('image manifest size mismatch: ' + path)
        return digest

    def download(path):
        target = output / path
        if not target.resolve().is_relative_to(output):
            raise ValueError('media path escapes output: ' + path)
        reused = target.is_file()
        if reused:
            data = target.read_bytes()
        else:
            data = None
            for root in reuse_roots:
                candidate = root / path
                if candidate.is_file() and candidate.resolve().is_relative_to(root):
                    candidate_data = candidate.read_bytes()
                    verify(path, candidate_data)
                    data = candidate_data
                    break
            if data is None:
                url = 'https://raw.githubusercontent.com/jeongjae/SP-FR-guidebook/' + commit + '/' + quote(path)
                with urlopen(url, timeout=45) as response:
                    data = response.read(MAX_FILE_BYTES + 1)
        digest = verify(path, data)
        if not reused:
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.parent.resolve().is_relative_to(output):
                raise ValueError('media directory escapes output')
            with target.open('xb') as destination:
                destination.write(data)
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError('media changed after local write: ' + path)
        return {
            'sourcePath': path,
            'sha256': digest,
            'gitBlobSha1': blobs[path]['sha'],
            'byteLength': len(data),
            'mimeType': media_type(path, data),
            'reused': reused,
        }

    with ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(download, selected))
    return {'sourceCommit': commit, 'files': records, 'allBytesVerified': True}


def main():
    parser = argparse.ArgumentParser()
    for flag in ['audit', 'tree', 'commit', 'output-dir']:
        parser.add_argument('--' + flag, required=True)
    parser.add_argument('--reuse-root', action='append', default=[])
    args = parser.parse_args()
    result = fetch_media(
        PREFLIGHT['load_json'](args.audit),
        PREFLIGHT['load_json'](args.tree),
        args.commit,
        args.output_dir,
        args.reuse_root,
    )
    report = Path(args.output_dir) / 'media-files.json'
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(result['files']), 'bytes': sum(item['byteLength'] for item in result['files']),
                      'allBytesVerified': True}))


if __name__ == '__main__':
    main()
