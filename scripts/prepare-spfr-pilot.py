"""Prepare a pinned, loss-visible SP-FR pilot input. Never execute the source repository.

This emits an extraction/audit, not an importable travel-app package. Unsupported
fields and missing media remain blocking instead of masquerading as migrated data.
"""
import argparse
import hashlib
import json
import re
import runpy
from collections import Counter
from datetime import date
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
PREFLIGHT = runpy.run_path(str(SCRIPTS / 'source-preflight.py'))
EXTRACTOR = runpy.run_path(str(SCRIPTS / 'extract-source.py'))
BOOK = 'source/OPERATIONS/TP_Europe_Travel_Master_Tracker_v1.2.xlsx'
JSON_SOURCES = [
    'source/CURRENT/10_Core/itinerary.json', 'source/CURRENT/10_Core/regions.json',
    'data/place-facts.json', 'data/map-queries.json', 'data/region-essentials.json',
    'data/transit-facts.json', 'data/transit-resources.json', 'data/tourist-maps.json',
    'data/travel-french-phrases.json', 'data/travel-french-guide.json',
    'data/images/image-manifest.json', 'data/field-notes.json', 'data/booking-overrides.json',
]


def leaves(value, pointer=''):
    """Count null/empty collections too; an unknown empty field cannot disappear."""
    if isinstance(value, dict) and value:
        for key, item in value.items():
            escaped = key.replace('~', '~0').replace('/', '~1')
            yield from leaves(item, pointer + '/' + escaped)
    elif isinstance(value, list) and value:
        for i, item in enumerate(value):
            yield from leaves(item, pointer + '/' + str(i))
    else:
        yield pointer, value


def prepare(root, tree, commit, days):
    root = Path(root).resolve(strict=True)
    if not days or len(days) != len(set(days)) or any(type(n) is not int or n < 1 for n in days):
        raise ValueError('unique positive pilot days required')
    days = sorted(days)
    read = lambda path: PREFLIGHT['load_json'](root / path)
    cards = [read(f'data/daily-cards/day-{n:02d}.json') for n in days]
    for n, card in zip(days, cards):
        if card.get('day') != n or not isinstance(card.get('stops'), list) or not isinstance(card.get('legs'), list):
            raise ValueError('daily card identity/shape mismatch')
        date.fromisoformat(card['date'])
        stop_ids = [s['id'] for s in card['stops']]
        if len(stop_ids) != len(set(stop_ids)) or any(l['from'] not in stop_ids or l['to'] not in stop_ids for l in card['legs']):
            raise ValueError('duplicate stop or broken leg reference')
    itinerary = read(JSON_SOURCES[0])
    dates = {c['date'] for c in cards}
    selected_stays = [s for s in itinerary['stays'] if any(s['checkin'] <= d < s['checkout'] for d in dates)]
    regions = sorted({s['key'] for s in selected_stays})
    if any(not any(s['checkin'] <= d < s['checkout'] for s in selected_stays) for d in dates):
        raise ValueError('selected day has no explicit itinerary region')
    places = sorted({s['place_ref'] for c in cards for s in c['stops'] if s.get('place_ref')})
    paths = JSON_SOURCES + [f'data/daily-cards/day-{n:02d}.json' for n in days]
    paths += [f'source/CURRENT/20_Regions/{r}.md' for r in regions]
    paths += [f'source/CURRENT/30_Places/{p}.md' for p in places]
    paths += [BOOK, 'build/model.py', 'build/render.py', 'source/ASSETS/91_Place_Registry_v1.0.md']
    # Validate every selected path against the untruncated tree before extraction.
    checked = PREFLIGHT['inventory'](tree, commit, paths, root)
    before = {r['sourceKey']: r['sha256'] for r in checked['records'] if r['selected']}
    spec = [{'path': p, 'kind': 'json' if p.endswith('.json') else 'xlsx' if p == BOOK else 'python' if p.endswith('.py') else 'markdown',
             **({'constants': ['PARIS_MUSEUM_BOOKINGS']} if p == 'build/render.py' else {})} for p in paths]
    extraction = EXTRACTOR['extract'](root, spec, 'jeongjae/SP-FR-guidebook', commit)
    if any(before[f['path']] != f['sha256'] for f in extraction['manifest']):
        raise ValueError('source changed between pinned audit and extraction')
    by_key = {e['sourceKey']: e for e in extraction['entries']}
    code = by_key['build/render.py:PARIS_MUSEUM_BOOKINGS']
    code_records = [{'index': i, 'locator': code['locator'], 'rawValue': item}
                    for i, item in enumerate(code['rawValue']) if item.get('day') in days] if code['status'] == 'extracted' else []
    scoped = [{'sourcePath': f'data/daily-cards/day-{c["day"]:02d}.json', 'pointer': '', 'value': c} for c in cards]
    facts = read('data/place-facts.json')
    for slug in places:
        if slug in facts.get('places', {}):
            scoped.append({'sourcePath': 'data/place-facts.json', 'pointer': '/places/' + slug, 'value': facts['places'][slug]})
    for record in code_records:
        scoped.append({'sourcePath': 'build/render.py', 'pointer': f'/PARIS_MUSEUM_BOOKINGS/{record["index"]}', 'value': record['rawValue']})
    fields = []
    for scope in scoped:
        for pointer, value in leaves(scope['value'], scope['pointer']):
            fields.append({'sourcePath': scope['sourcePath'], 'pointer': pointer, 'rawValue': value,
                           'disposition': 'pending-normalization', 'target': None})
    sheets = {}
    for e in extraction['entries']:
        if e['sourceKind'] != 'xlsx':
            continue
        sheet, coordinate = e['sourceKey'][len(BOOK) + 1:].rsplit('!', 1)
        sheet_info = sheets.setdefault(sheet, {'nonEmptyCells': 0, 'formulaCells': 0, 'missingFormulaCaches': 0, 'rows': set()})
        sheet_info['nonEmptyCells'] += 1
        sheet_info['rows'].add(int(re.search(r'\d+$', coordinate)[0]))
        sheet_info['formulaCells'] += e['rawValue']['cellType'] == 'f'
        sheet_info['missingFormulaCaches'] += e['status'] == 'unresolved'
    for info in sheets.values():
        info['nonEmptyRows'] = len(info.pop('rows'))
    media = []
    images = read('data/images/image-manifest.json')
    for image in images['images']:
        uses = {f'daily/day-{n:02d}.html' for n in days}
        if image.get('placeId') not in places and not uses.intersection(image.get('usage', [])) and not (image.get('region') in regions and image.get('regionHero')):
            continue
        for role, variants in image.get('variants', {}).items():
            for variant in variants:
                media.append({'sourcePath': variant['path'], 'sha256': variant['sha256'], 'byteLength': variant['bytes'],
                              'imageId': image['imageId'], 'role': role, 'license': image.get('license'),
                              'rightsSource': image.get('sourcePage'), 'rightsReview': 'pending'})
    for region in regions:
        for item in read('data/tourist-maps.json').get('regions', {}).get(region, []):
            media.append({'sourcePath': 'source/ASSETS/' + item['localPath'].removeprefix('assets/'),
                          'license': item.get('license'), 'redistributionBasis': item.get('redistributionBasis'),
                          'rightsSource': item.get('sourceUrl'), 'rightsReview': 'pending'})
    tree_files = {e['path']: e for e in tree['tree'] if e['type'] == 'blob'}
    for item in media:
        PREFLIGHT['safe_path'](item['sourcePath'])
        item['gitBlobSha1'] = tree_files.get(item['sourcePath'], {}).get('sha')
        item['availableLocally'] = (root / item['sourcePath']).is_file()
    sections = []
    for p in paths:
        if not p.endswith('.md'):
            continue
        body = by_key[p]['rawValue']
        sections.append({'sourcePath': p, 'headings': [{'line': i + 1, 'title': line[3:]} for i, line in enumerate(body.splitlines()) if line.startswith('## ')],
                         'factTokens': re.findall(r'\{\{([^}]+)\}\}', body),
                         'disposition': 'pending-normalization'})
    # Preserve the whole raw extract; no unmapped source is relabelled as completed.
    blocking = [{'code': 'NORMALIZATION_PENDING', 'message': 'source fields/sections/XLSX cells have not been mapped to the v2 dataset'}]
    blocking += [{'code': 'UNRESOLVED_SOURCE', **u} for u in extraction['unresolved']]
    blocking += [{'code': 'MISSING_MEDIA', 'sourcePath': m['sourcePath']} for m in media if not m['availableLocally']]
    if media:
        blocking.append({'code': 'MEDIA_RIGHTS_REVIEW_PENDING', 'message': 'source license/basis is preserved; no fresh rights approval is inferred'})
    report = {'format': 'travel-app-spfr-pilot-audit', 'version': 1, 'sourceCommit': commit,
              'scope': {'days': days, 'dates': sorted(dates), 'regions': regions, 'places': places},
              'counts': {'filesVerified': len(paths), 'sourceEntries': len(extraction['entries']), 'sourceUnresolved': len(extraction['unresolved']),
                         'days': len(cards), 'stops': sum(len(c['stops']) for c in cards), 'legs': sum(len(c['legs']) for c in cards),
                         'places': len(places), 'codeBookingsInWindow': len(code_records), 'scopedLeafFields': len(fields),
                         'mediaVariants': len(media), 'missingMedia': sum(not m['availableLocally'] for m in media)},
              'sheets': sheets, 'sections': sections, 'codeBookings': code_records, 'fields': fields, 'media': media,
              'blocking': blocking, 'packageReady': False, 'deviceVerification': 'not-run',
              'warnings': ['full raw source extraction is preserved; retained source is not functional migration',
                           'code booking date/schedule remain raw; do not feed M/D strings into ISO date fields',
                           'source status/visit checks do not supply a historical occurrence time or a new user approval']}
    return extraction, report, spec


def main():
    p = argparse.ArgumentParser()
    for flag in ['root', 'tree', 'commit', 'output-dir']:
        p.add_argument('--' + flag, required=True)
    p.add_argument('--days', required=True, nargs='+', type=int)
    args = p.parse_args()
    out = Path(args.output_dir).resolve()
    if out.is_relative_to(Path(args.root).resolve()):
        raise ValueError('output must be outside source root')
    extraction, report, spec = prepare(args.root, PREFLIGHT['load_json'](args.tree), args.commit, args.days)
    out.mkdir(parents=True, exist_ok=True)
    for filename, value in [('extract.json', extraction), ('audit.json', report), ('selection-spec.json', spec)]:
        (out / filename).write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'counts': report['counts'], 'blockingCounts': dict(Counter(b['code'] for b in report['blocking'])), 'packageReady': False}))


if __name__ == '__main__':
    main()
