"""Build regional and full packages; defer browser/tests to the user's later pass."""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    for name in ['root', 'tree', 'commit', 'plan', 'media-dir', 'output-dir']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--only', help='Comma-separated region IDs, unassigned, or full')
    args = parser.parse_args()
    private = Path('local-data').resolve(strict=True)
    output = Path(args.output_dir).resolve()
    if not output.is_relative_to(private) or output == private:
        raise ValueError('batch output must be below local-data')
    output.mkdir(parents=True, exist_ok=False)
    plan = json.loads(Path(args.plan).read_text(encoding='utf-8'))
    if plan['sourceCommit'] != args.commit:
        raise ValueError('batch plan/source commit mismatch')
    assigned = set()
    batches = []
    for item in plan['regionBatches']:
        days = item['sourceDayOrdinals']
        if assigned.intersection(days):
            raise ValueError('overlapping regional days')
        assigned.update(days)
        batches.append((item['regionId'], days))
    all_days = list(range(1, plan['sourceDays'] + 1))
    missing = sorted(set(all_days) - assigned)
    if assigned - set(all_days):
        raise ValueError('day outside plan range')
    if missing:
        batches.append(('unassigned', missing))
    batches.append(('full', all_days))
    selected = set(args.only.split(',')) if args.only else None
    if selected and selected - {name for name, _ in batches}:
        raise ValueError('unknown batch ID')
    results = []
    for name, days in batches:
        if not re.fullmatch(r'[a-z][a-z0-9-]*', name):
            raise ValueError('unsafe batch name')
        if selected and name not in selected:
            continue
        batch = output / name
        batch.mkdir()
        prepare = [sys.executable, 'scripts/prepare-spfr-pilot.py', '--root', args.root,
                   '--tree', args.tree, '--commit', args.commit, '--days', *map(str, days),
                   '--include-region-catalog', '--output-dir', str(batch / 'input')]
        if name == 'full':
            prepare.append('--include-common-content')
        normalize = ['node', 'scripts/normalize-spfr-pilot.mjs', '--extract', str(batch / 'input/extract.json'),
                     '--audit', str(batch / 'input/audit.json'), '--media-dir', args.media_dir,
                     '--days', ','.join(map(str, days)), '--trip-id', 'spfr-' + name,
                     '--lineage-id', 'spfr-' + name, '--output-dir', str(batch / 'package')]
        if name == 'full':
            normalize += ['--trip-name', f'SP-FR 전체 {len(days)}일']
        codes = []
        for stage, command in [('prepare', prepare), ('normalize', normalize)]:
            with (batch / (stage + '.log')).open('w', encoding='utf-8') as stream:
                completed = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, check=False)
            codes.append(completed.returncode)
            if completed.returncode:
                break
        result = {'batch': name, 'days': days, 'commandExitCodes': codes,
                  'packageCreated': len(codes) == 2 and not any(codes),
                  'tests': 'deferred-by-user', 'browser': 'not-run', 'userReview': 'not-confirmed'}
        results.append(result)
        (output / 'batch-results.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result), flush=True)
    if any(not result['packageCreated'] for result in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
