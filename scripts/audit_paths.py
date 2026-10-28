"""Path guards shared by the read-only SP-FR audit tools.

Exit codes of the audit tools: 0 = all checks passed, 1 = verification failures (report still written),
2 = input or usage error (nothing written). Observations such as unselected files or REG-01 rows are
findings in the report, never failures.

Limits: aliases are detected through os.path.realpath (symlinks, junctions, case, relative parts) and
os.path.samefile (hard links) when the target already exists. Creating links for tests needs privileges on
some Windows setups; the tests skip those cases instead of requiring elevation.
"""

import os
import sys

EXIT_FAILURES = 1
EXIT_INPUT_ERROR = 2


def fail_input(message):
    print('입력 오류: ' + message, file=sys.stderr)
    sys.exit(EXIT_INPUT_ERROR)


def resolved(path):
    return os.path.normcase(os.path.realpath(path))


def is_inside(path, root):
    target = resolved(path)
    base = resolved(root)
    try:
        return os.path.commonpath([target, base]) == base
    except ValueError:
        return False


def same_file(first, second):
    if os.path.exists(first) and os.path.exists(second):
        return os.path.samefile(first, second)
    return resolved(first) == resolved(second)


def check_output(out, protected_files, protected_dirs):
    """Refuse an output path that is, or aliases, any input file or lies inside a read-only directory."""
    if os.path.isdir(out):
        fail_input('출력 경로가 디렉터리입니다: ' + out)
    parent = os.path.dirname(os.path.abspath(out))
    if not os.path.isdir(parent):
        fail_input('출력 폴더가 없습니다: ' + parent)
    for directory in protected_dirs:
        if is_inside(out, directory) or is_inside(parent, directory):
            fail_input('출력 경로가 읽기 전용 입력 폴더 안에 있습니다')
    for path in protected_files:
        if same_file(out, path):
            fail_input('출력 경로가 읽을 입력 파일과 같습니다: ' + os.path.basename(path))


def require_inside(path, root, label):
    if not is_inside(path, root):
        fail_input(f'{label}이(가) 원천 폴더 밖을 가리킵니다: {path}')
