"""Read-only audit of a fixed SP-FR source copy against a converted travel package (T-03a).

Nothing here executes source code, writes next to the inputs, or reads a browser profile.
Every input is an explicit argument; the report goes to the explicit --out path, which must be
outside the source tree (use a Git-ignored location such as local-data/ or .cache/).

Subcommands:
  scope     file inventory of the source copy split into selected/unselected, with per-group counts
  renderer  Hangul text chunks inside renderer/build Python functions (AST only) and whether each
            chunk already exists in the package text
"""

import argparse
import ast
import hashlib
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_paths  # noqa: E402

HANGUL = re.compile(r'[가-힣]')
TAG = re.compile(r'<[^>]+>')
PLACEHOLDER = re.compile(r'\{[^{}]*\}|%\([^)]*\)[sd]|%[sd]')
SPACE = re.compile(r'\s+')


def normalize(text):
    return SPACE.sub(' ', text).strip()


def relative_files(root):
    found = []
    for directory, _, names in os.walk(root):
        for name in names:
            full = os.path.join(directory, name)
            found.append(os.path.relpath(full, root).replace(os.sep, '/'))
    return sorted(found)


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def package_corpus(zip_path):
    """Every string value of every content revision, normalized, joined for substring search."""
    strings = []

    def collect(value):
        if isinstance(value, str):
            strings.append(normalize(value))
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)

    with zipfile.ZipFile(zip_path) as archive:
        for name in ('content_revisions', 'plan_days', 'plan_items', 'plan_legs', 'plan_stays', 'field_records'):
            for line in archive.read(f'records/{name}.ndjson').decode('utf-8').splitlines():
                collect(json.loads(line))
    return '\n'.join(strings)


def hangul_chunks(literal):
    """Visible Korean text pieces of a string literal (tags and format placeholders removed)."""
    without_tags = TAG.sub('\n', literal)
    without_placeholders = PLACEHOLDER.sub('\n', without_tags)
    chunks = []
    for piece in without_placeholders.split('\n'):
        piece = normalize(piece)
        if len(HANGUL.findall(piece)) >= 4:
            chunks.append(piece)
    return chunks


def docstring_ids(tree):
    """ids of docstring constants: developer documentation, never rendered travel content."""
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
                ids.add(id(first.value))
    return ids


def function_literals(path):
    with open(path, encoding='utf-8') as handle:
        tree = ast.parse(handle.read(), filename=path)
    skip = docstring_ids(tree)
    result = {}
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        literals = [
            part.value
            for part in ast.walk(node)
            if isinstance(part, ast.Constant)
            and isinstance(part.value, str)
            and HANGUL.search(part.value)
            and id(part) not in skip
        ]
        result[node.name] = {'line': node.lineno, 'literals': literals}
    return result


def module_literals(path):
    """Hangul literals outside any function (module constants)."""
    with open(path, encoding='utf-8') as handle:
        tree = ast.parse(handle.read(), filename=path)
    inside = set(docstring_ids(tree))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            inside.update(id(part) for part in ast.walk(node))
    return [
        part.value
        for part in ast.walk(tree)
        if isinstance(part, ast.Constant) and isinstance(part.value, str) and HANGUL.search(part.value)
        and id(part) not in inside
    ]


def scope(arguments):
    root = arguments.source
    if not os.path.isdir(root) or not os.path.isfile(arguments.selection):
        audit_paths.fail_input('원천 폴더 또는 selection 파일이 없습니다')
    audit_paths.check_output(arguments.out, [arguments.selection], [root])
    with open(arguments.selection, encoding='utf-8') as handle:
        selected = {entry['path'] for entry in json.load(handle)}
    files = relative_files(root)
    groups = defaultdict(lambda: {'selected': 0, 'unselected': 0, 'bytes': 0})
    unselected = []
    combined = hashlib.sha256()
    for name in files:
        full = os.path.join(root, name)
        size = os.path.getsize(full)
        digest = sha256_of(full)
        combined.update(f'{name}\0{digest}\0'.encode('utf-8'))
        group = name.split('/')[0] + ('/' + name.split('/')[1] if name.startswith(('data/', 'source/')) else '')
        state = 'selected' if name in selected else 'unselected'
        groups[group][state] += 1
        groups[group]['bytes'] += size
        if state == 'unselected':
            unselected.append({'path': name, 'bytes': size, 'sha256': digest})
    report = {
        'fileCount': len(files),
        'totalBytes': sum(os.path.getsize(os.path.join(root, name)) for name in files),
        'combinedSha256': combined.hexdigest(),
        'selectionEntries': len(selected),
        'selectedMissingFromTree': sorted(selected - set(files)),
        'groups': dict(sorted(groups.items())),
        'unselected': unselected,
    }
    with open(arguments.out, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps({key: report[key] for key in ('fileCount', 'totalBytes', 'combinedSha256', 'selectionEntries')}))
    for group, counts in report['groups'].items():
        print(group, counts)
    if report['selectedMissingFromTree']:
        print('검증 실패: 선택 목록의 파일이 원천에 없음', len(report['selectedMissingFromTree']), file=sys.stderr)
        sys.exit(audit_paths.EXIT_FAILURES)


def renderer(arguments):
    if not os.path.isdir(arguments.source) or not os.path.isfile(arguments.package):
        audit_paths.fail_input('원천 폴더 또는 패키지 파일이 없습니다')
    paths = [os.path.join(arguments.source, relative) for relative in arguments.files]
    for relative, path in zip(arguments.files, paths):
        audit_paths.require_inside(path, arguments.source, '파일 인자 ' + relative)
        if not os.path.isfile(path):
            audit_paths.fail_input('원천에 없는 파일: ' + relative)
    audit_paths.check_output(arguments.out, [arguments.package, *paths], [arguments.source])
    corpus = package_corpus(arguments.package)
    report = {'package': os.path.basename(os.path.dirname(os.path.dirname(arguments.package))), 'files': {}}
    for relative in arguments.files:
        path = os.path.join(arguments.source, relative)
        functions = function_literals(path)
        entries = {}
        for name, info in functions.items():
            chunks = [chunk for literal in info['literals'] for chunk in hangul_chunks(literal)]
            if not chunks:
                continue
            present = [chunk for chunk in chunks if chunk in corpus]
            absent = [chunk for chunk in chunks if chunk not in corpus]
            entries[name] = {'line': info['line'], 'chunks': len(chunks), 'present': len(present), 'absent': absent}
        module_chunks = [chunk for literal in module_literals(path) for chunk in hangul_chunks(literal)]
        entries['<module>'] = {
            'line': 0,
            'chunks': len(module_chunks),
            'present': sum(1 for chunk in module_chunks if chunk in corpus),
            'absent': [chunk for chunk in module_chunks if chunk not in corpus],
        }
        report['files'][relative] = entries
    with open(arguments.out, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    totals = Counter()
    for relative, entries in report['files'].items():
        chunks = sum(entry['chunks'] for entry in entries.values())
        absent = sum(len(entry['absent']) for entry in entries.values())
        totals['chunks'] += chunks
        totals['absent'] += absent
        print(relative, 'chunks', chunks, 'absent', absent)
    print(dict(totals))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    scope_parser = commands.add_parser('scope')
    scope_parser.add_argument('--source', required=True)
    scope_parser.add_argument('--selection', required=True)
    scope_parser.add_argument('--out', required=True)
    renderer_parser = commands.add_parser('renderer')
    renderer_parser.add_argument('--source', required=True)
    renderer_parser.add_argument('--package', required=True)
    renderer_parser.add_argument('--out', required=True)
    renderer_parser.add_argument('files', nargs='+', help='source-relative Python files')
    arguments = parser.parse_args()
    try:
        {'scope': scope, 'renderer': renderer}[arguments.command](arguments)
    except (zipfile.BadZipFile, KeyError, FileNotFoundError, json.JSONDecodeError, SyntaxError) as error:
        audit_paths.fail_input(f'{type(error).__name__}: {error}')


if __name__ == '__main__':
    main()
