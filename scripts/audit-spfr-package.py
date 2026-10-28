"""Independent read-only check of a converted travel package ZIP against the fixed SP-FR source copy (T-03b).

The expectations are built from the source files only (daily cards, itinerary.json, place frontmatter);
the app's normalizer is not imported. Inputs are explicit arguments, nothing is written next to them, and
the JSON report goes to --out (outside the source tree). Reports use day numbers, ids and counts only.

Usage:
  python scripts/audit-spfr-package.py --source <source-copy> --package <pilot.zip> [--package ...] \
      [--reference <full pilot.zip>] --out <report.json>
"""

import argparse
import glob
import hashlib
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict

TIME = re.compile(r'^\d{2}:\d{2}$')


def read_json(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def records(archive, name):
    data = archive.read(f'records/{name}.ndjson').decode('utf-8')
    return [json.loads(line) for line in data.splitlines()]


class Source:
    def __init__(self, root):
        self.root = root
        self.cards = {}
        for path in glob.glob(os.path.join(root, 'data', 'daily-cards', 'day-*.json')):
            card = read_json(path)
            self.cards[card['day']] = card
        itinerary = read_json(os.path.join(root, 'source', 'CURRENT', '10_Core', 'itinerary.json'))
        self.stays = itinerary['stays']
        self.facts = read_json(os.path.join(root, 'data', 'place-facts.json')).get('places', {})
        self._frontmatter = {}

    def place_region(self, slug):
        """Region named by the place file's frontmatter (None when the file or key is absent)."""
        if slug not in self._frontmatter:
            path = os.path.join(self.root, 'source', 'CURRENT', '30_Places', slug + '.md')
            region = None
            if os.path.exists(path):
                with open(path, encoding='utf-8') as handle:
                    match = re.search(r'^region:\s*["\']?([a-z][a-z0-9-]*)', handle.read(), re.M)
                region = match.group(1) if match else None
            self._frontmatter[slug] = region
        return self._frontmatter[slug]

    def covering(self, date):
        return [stay['key'] for stay in self.stays if stay['checkin'] <= date < stay['checkout']]

    def departing(self, date):
        return [stay['key'] for stay in self.stays if stay['checkout'] == date]

    def arriving(self, date):
        return [stay['key'] for stay in self.stays if stay['checkin'] == date]

    def day_kind(self, date):
        covering, departing, arriving = self.covering(date), self.departing(date), self.arriving(date)
        if departing and arriving:
            return 'move'
        if not covering:
            return 'no-stay'
        if arriving:
            return 'arrival'
        return 'regular'


def expected_time_kind(value):
    if value in (None, ''):
        return ('unspecified', None)
    if isinstance(value, str) and TIME.match(value):
        return ('local', value)
    return ('text', str(value))


def actual_time_kind(spec):
    if spec is None:
        return ('missing', None)
    precision = spec.get('precision')
    if precision == 'local':
        return ('local', spec.get('localTime'))
    if precision == 'text':
        return ('text', spec.get('rawText'))
    return (precision, None)


def check_container(archive, expected_commit, failures):
    manifest = json.loads(archive.read('manifest.json'))
    listed = {}
    for entry in manifest['files']:
        listed[entry['path']] = entry
    actual_names = {name for name in archive.namelist() if name != 'manifest.json'}
    for missing in sorted(set(listed) - actual_names):
        failures.append(f'container: 목록에 있으나 ZIP에 없음 {missing}')
    for extra in sorted(actual_names - set(listed)):
        failures.append(f'container: ZIP에 있으나 목록에 없음 {extra}')
    mismatched = 0
    asset_checked = 0
    for path, entry in listed.items():
        if path not in actual_names:
            continue
        data = archive.read(path)
        if len(data) != entry['byteLength'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            mismatched += 1
            failures.append(f'container: 길이/해시 불일치 {path}')
        if entry['role'] == 'records':
            count = len(data.decode('utf-8').splitlines()) if data else 0
            if count != entry['recordCount']:
                failures.append(f'container: recordCount 불일치 {path}')
        if entry['role'] == 'asset':
            asset_checked += 1
            if path != 'assets/sha256/' + entry['sha256']:
                failures.append(f'container: 자산 경로≠해시 {path}')
    source = manifest.get('source', {})
    if source.get('sourceCommit') != expected_commit:
        failures.append('container: sourceCommit 불일치')
    return {
        'entries': len(listed),
        'assetBlobs': asset_checked,
        'hashLengthMismatch': mismatched,
        'adapterVersion': source.get('adapterVersion'),
        'normalizationVersion': source.get('normalizationVersion'),
        'createdAt': manifest.get('createdAt'),
        'tripIds': manifest.get('tripIds'),
    }


def check_plan(archive, source, failures):
    days = {row['dayId']: row for row in records(archive, 'plan_days')}
    items = defaultdict(list)
    for row in records(archive, 'plan_items'):
        items[row['dayId']].append(row)
    legs = defaultdict(list)
    for row in records(archive, 'plan_legs'):
        legs[row['dayId']].append(row)
    day_numbers = sorted(int(day_id.split('-')[1]) for day_id in days)
    summary = Counter()
    for ordinal, number in enumerate(day_numbers, 1):
        card = source.cards.get(number)
        day_id = f'day-{number}'
        if card is None:
            failures.append(f'plan: 원천에 없는 일차 {day_id}')
            continue
        day = days[day_id]
        for key, expected in (('date', card['date']), ('cityText', card['city']), ('title', card['title'])):
            if day.get(key) != expected:
                failures.append(f'plan: {day_id}.{key} 불일치')
        if day.get('dayType') != card.get('dayType'):
            failures.append(f'plan: {day_id}.dayType 불일치')
        if expected_time_kind(card.get('startTime')) != actual_time_kind(day['time'].get('start')):
            failures.append(f'plan: {day_id}.time.start 불일치')
        expected_stops = {f"{day_id}-{stop['id']}": stop for stop in card['stops']}
        actual_items = {row['activityId']: row for row in items[day_id]}
        if set(expected_stops) != set(actual_items):
            failures.append(f'plan: {day_id} 활동 집합 불일치 (원천 {len(expected_stops)} / 패키지 {len(actual_items)})')
        for activity_id, stop in expected_stops.items():
            row = actual_items.get(activity_id)
            if row is None:
                continue
            summary['activities'] += 1
            checks = (
                ('order', stop['order'], row['order']),
                ('title', stop['name'], row['title']),
                ('category', stop['category'], row['category']),
                ('summary', stop['summary'], row['summary']),
                ('optional', stop['optional'], row['optional']),
                ('menu', stop.get('menu') or None, row.get('menuText')),
                ('reservation', stop.get('reservation') or None, row.get('reservationText')),
                ('start', expected_time_kind(stop.get('start')), actual_time_kind(row['time'].get('start'))),
                ('placeLink', stop.get('place_ref') or None, (row['placeLinks'][0]['placeId'] if row['placeLinks'] else None)),
            )
            for label, expected, actual in checks:
                if expected != actual:
                    failures.append(f'plan: {activity_id}.{label} 불일치')
        expected_legs = [(f"{day_id}-{leg['from']}", f"{day_id}-{leg['to']}", leg['mode']) for leg in card['legs']]
        actual_legs = [
            (row['fromActivityId'], row['toActivityId'], row['mode'])
            for row in sorted(legs[day_id], key=lambda leg: leg['legId'])
        ]
        if expected_legs != actual_legs:
            failures.append(f'plan: {day_id} 이동 구간 불일치 (원천 {len(expected_legs)} / 패키지 {len(actual_legs)})')
        summary['legs'] += len(expected_legs)
        summary['days'] += 1
    unexpected = [day_id for day_id in items if day_id not in days]
    if unexpected:
        failures.append(f'plan: 일차 없는 활동 행 {unexpected}')
    return days, day_numbers, dict(summary)


def flat_text(archive):
    """All stored strings, Markdown backslash escapes and table pipes removed, whitespace collapsed."""
    parts = []

    def collect(value):
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)

    for name in ('content_revisions', 'plan_days', 'plan_items', 'plan_legs', 'plan_stays', 'field_records'):
        for row in records(archive, name):
            collect(row)
    text = '\n'.join(parts)
    text = re.sub(re.escape(chr(92)) + '(.)', lambda match: match.group(1), text).replace('|', ' ')
    return re.sub(r'\s+', ' ', text)


def present(text, value):
    return re.sub(r'\s+', ' ', str(value).replace('|', ' ')).strip() in text


def check_card_fields(archive, source, day_numbers, failures):
    """Card fields that the plan rows do not carry directly must still be stored somewhere in the package."""
    text = flat_text(archive)
    totals = Counter()
    absent = Counter()

    def need(label, value, day):
        if value in (None, ''):
            return
        totals[label] += 1
        if not present(text, value):
            absent[label] += 1
            failures.append(f'card: day-{day}.{label} 값이 패키지에 없음')

    for number in day_numbers:
        card = source.cards.get(number)
        if card is None:
            continue
        hotel = card.get('hotel') or {}
        need('hotel.name', hotel.get('name'), number)
        need('hotel.address', hotel.get('address'), number)
        for ref in card.get('sourceRefs', []):
            need('sourceRefs', ref, number)
        for stop in card['stops']:
            need('stop.officialUrl', stop.get('officialUrl'), number)
            need('stop.executionNote', stop.get('executionNote'), number)
            for axis in ('lat', 'lng'):
                need('stop.' + axis, stop.get(axis), number)
    return {'checked': dict(totals), 'absent': dict(absent)}


def check_stays(archive, source, day_numbers, failures):
    dates = [source.cards[number]['date'] for number in day_numbers if number in source.cards]
    expected = {
        (stay['key'], stay['checkin'], stay['checkout'])
        for stay in source.stays
        if any(stay['checkin'] <= date < stay['checkout'] for date in dates)
    }
    actual = set()
    for row in records(archive, 'plan_stays'):
        actual.add((row['regionId'], row['time']['start'].get('date'), row['time'].get('end', {}).get('date')))
    for stay in sorted(expected - actual):
        failures.append(f'stays: 원천 숙박 누락 {stay[0]}')
    for stay in sorted(actual - expected):
        failures.append(f'stays: 원천에 없는 숙박 {stay[0]}')
    return {'expected': len(expected), 'actual': len(actual)}


def check_references(archive, source, days, failures):
    heads = records(archive, 'content_heads')
    by_kind = defaultdict(set)
    for head in heads:
        by_kind[head['targetKind']].add(head['entityId'])
    revisions = {(row['kind'], row['entityId']): row for row in records(archive, 'content_revisions')}
    blob_hashes = {name.rsplit('/', 1)[1] for name in archive.namelist() if name.startswith('assets/sha256/')}
    missing_places = set()
    for row in records(archive, 'plan_items'):
        for link in row['placeLinks']:
            if link['placeId'] not in by_kind['place']:
                missing_places.add(link['placeId'])
    for place_id in sorted(missing_places):
        failures.append(f'refs: 활동이 가리키는 장소 콘텐츠 없음 {place_id}')
    region_refs = set()
    for day in days.values():
        region_refs.update(day['regionIds'])
        if day.get('overnightRegionId'):
            region_refs.add(day['overnightRegionId'])
    for row in records(archive, 'plan_stays'):
        region_refs.add(row['regionId'])
    for (kind, entity_id), row in revisions.items():
        if kind == 'place':
            region_refs.update(row['payload'].get('regionIds', []))
    for region_id in sorted(region_refs - by_kind['region']):
        failures.append(f'refs: 지역 콘텐츠 없음 {region_id}')
    asset_issues = 0
    referenced_assets = set()
    for (kind, entity_id), row in revisions.items():
        for ref in row['payload'].get('assetRefs', []) if isinstance(row['payload'], dict) else []:
            referenced_assets.add(ref['assetId'])
    for asset_id in sorted(referenced_assets):
        asset = revisions.get(('asset', asset_id))
        if asset is None:
            failures.append(f'refs: 참조된 자산 콘텐츠 없음 {asset_id}')
            asset_issues += 1
            continue
        payload = asset['payload']
        if payload.get('hash') not in blob_hashes:
            failures.append(f'refs: 자산 blob 없음 {asset_id}')
            asset_issues += 1
        elif len(archive.read('assets/sha256/' + payload['hash'])) != payload.get('byteLength'):
            failures.append(f'refs: 자산 길이 불일치 {asset_id}')
            asset_issues += 1
    asset_contents = [row for (kind, _), row in revisions.items() if kind == 'asset']
    orphan_blobs = blob_hashes - {row['payload'].get('hash') for row in asset_contents}
    place_region_mismatch = 0
    for (kind, entity_id), row in revisions.items():
        if kind != 'place':
            continue
        region = source.place_region(entity_id)
        if region and region not in row['payload'].get('regionIds', []):
            place_region_mismatch += 1
            failures.append(f'refs: 장소 frontmatter 지역이 regionIds에 없음 {entity_id}')
    return {
        'contentByKind': {kind: len(ids) for kind, ids in sorted(by_kind.items())},
        'referencedAssets': len(referenced_assets),
        'assetIssues': asset_issues,
        'blobsWithoutAssetContent': len(orphan_blobs),
        'placeRegionMismatch': place_region_mismatch,
    }


def reg01(source, days, day_numbers):
    """Compare day.regionIds/overnightRegionId with what the source itself says for each day."""
    rows = []
    for number in day_numbers:
        card = source.cards.get(number)
        if card is None:
            continue
        date = card['date']
        day = days[f'day-{number}']
        place_regions = sorted(
            {
                region
                for stop in card['stops']
                for region in [source.place_region(stop.get('place_ref') or '')]
                if region
            }
        )
        rows.append(
            {
                'day': number,
                'kind': source.day_kind(date),
                'stayCovering': source.covering(date),
                'stayDeparting': source.departing(date),
                'stayArriving': source.arriving(date),
                'placeFrontmatterRegions': place_regions,
                'dbRegionIds': day['regionIds'],
                'dbOvernightRegionId': day.get('overnightRegionId'),
                'cityHasArrow': '→' in card['city'],
            }
        )
    return rows


def scrub(value, ids):
    """Serialized JSON with trip and plan-version ids neutralized (they differ by design between batches)."""
    text = json.dumps(value, sort_keys=True, ensure_ascii=False)
    for identifier in ids:
        text = text.replace(identifier, '<id>')
    return text


def reference_diff(archive, reference_path, day_numbers):
    """Rows of the batch compared with the reference package for the same ids, ignoring trip/plan ids."""
    with zipfile.ZipFile(reference_path) as reference:
        result = Counter()
        mine_ids = [
            row['tripId'] for row in records(archive, 'trip_headers')
        ] + [row['planVersionId'] for row in records(archive, 'plan_versions')]
        their_ids = [
            row['tripId'] for row in records(reference, 'trip_headers')
        ] + [row['planVersionId'] for row in records(reference, 'plan_versions')]
        for name in ('plan_days', 'plan_items', 'plan_legs'):
            wanted = {f'day-{number}' for number in day_numbers}
            mine = {scrub(row, mine_ids) for row in records(archive, name) if row['dayId'] in wanted}
            theirs = {scrub(row, their_ids) for row in records(reference, name) if row['dayId'] in wanted}
            result[name + '.onlyInBatch'] = len(mine - theirs)
            result[name + '.onlyInReference'] = len(theirs - mine)
        batch_heads = {(h['targetKind'], h['entityId']) for h in records(archive, 'content_heads')}
        reference_heads = {(h['targetKind'], h['entityId']) for h in records(reference, 'content_heads')}
        result['contentHeads.missingFromReference'] = len(batch_heads - reference_heads)
        reference_revisions = {
            (r['kind'], r['entityId']): scrub(r['payload'], their_ids) for r in records(reference, 'content_revisions')
        }
        changed = Counter()
        for row in records(archive, 'content_revisions'):
            other = reference_revisions.get((row['kind'], row['entityId']))
            if other is not None and other != scrub(row['payload'], mine_ids):
                changed[row['kind']] += 1
        result['contentPayloadDiffersFromReference'] = sum(changed.values())
        for kind, count in sorted(changed.items()):
            result['contentPayloadDiffers.' + kind] = count
        return dict(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', required=True)
    parser.add_argument('--package', action='append', required=True)
    parser.add_argument('--reference')
    parser.add_argument('--commit', default='35498adc6413dad45922f2dab87781afeb04d898')
    parser.add_argument('--out', required=True)
    arguments = parser.parse_args()
    source_root = os.path.abspath(arguments.source)
    out = os.path.abspath(arguments.out)
    if out.startswith(source_root + os.sep):
        sys.exit('출력 경로가 읽기 전용 원천 안에 있습니다.')
    source = Source(arguments.source)
    report = {'sourceCommit': arguments.commit, 'packages': {}}
    for package in arguments.package:
        failures = []
        with zipfile.ZipFile(package) as archive:
            package_hash = hashlib.sha256(open(package, 'rb').read()).hexdigest()
            container = check_container(archive, arguments.commit, failures)
            days, day_numbers, plan = check_plan(archive, source, failures)
            stays = check_stays(archive, source, day_numbers, failures)
            card_fields = check_card_fields(archive, source, day_numbers, failures)
            references = check_references(archive, source, days, failures)
            entry = {
                'zipBytes': os.path.getsize(package),
                'zipSha256': package_hash,
                'dayNumbers': day_numbers,
                'container': container,
                'plan': plan,
                'stays': stays,
                'cardFields': card_fields,
                'references': references,
                'reg01': reg01(source, days, day_numbers),
            }
            if arguments.reference:
                entry['versusReference'] = reference_diff(archive, arguments.reference, day_numbers)
        entry['failureCount'] = len(failures)
        entry['failures'] = failures
        report['packages'][package] = entry
        print(os.path.relpath(package), 'days', len(day_numbers), 'failures', len(failures))
    with open(arguments.out, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
