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

HANGUL = re.compile(r'[가-힣]')
TAG = re.compile(r'<[^>]+>')
PLACEHOLDER = re.compile(r'\{[^{}]*\}|%\([^)]*\)[sd]|%[sd]')
SPACE = re.compile(r'\s+')


def normalize(text):
    return SPACE.sub(' ', text).strip()


def refuse_inside(path, root):
    absolute = os.path.abspath(path)
    root_absolute = os.path.abspath(root)
    if absolute == root_absolute or absolute.startswith(root_absolute + os.sep):
        sys.exit('출력 경로가 읽기 전용 입력 안에 있습니다: ' + path)


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
    refuse_inside(arguments.out, root)
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


def renderer(arguments):
    refuse_inside(arguments.out, arguments.source)
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
    {'scope': scope, 'renderer': renderer}[arguments.command](arguments)


if __name__ == '__main__':
    main()
