"""Virtual-data checks for scripts/audit-spfr-*.py (exit codes and read-only protection).

Only temporary synthetic files are used; no real source, package or profile is read.
Run: python -m unittest discover -s tests/audit -v
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACKAGE_TOOL = os.path.join(ROOT, 'scripts', 'audit-spfr-package.py')
SOURCE_TOOL = os.path.join(ROOT, 'scripts', 'audit-spfr-source.py')
COMMIT = '0' * 40


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False)


def sha256_file(path):
    with open(path, 'rb') as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def make_source(root):
    stop = {
        'id': 'visit',
        'order': 0,
        'start': '09:00',
        'end': None,
        'name': 'Virtual stop',
        'category': 'sight',
        'summary': 'Virtual summary',
        'menu': None,
        'reservation': None,
        'optional': False,
        'place_ref': 'p1',
        'lat': 1.5,
        'lng': 2.5,
    }
    card = {
        'day': 1,
        'date': '2033-01-01',
        'city': 'Virtual city',
        'title': 'Virtual day',
        'dayType': 'city',
        'startTime': '09:00',
        'hotel': {},
        'stops': [stop],
        'legs': [],
        'sourceRefs': [],
    }
    write_json(os.path.join(root, 'data', 'daily-cards', 'day-01.json'), card)
    stays = [{'key': 'r1', 'checkin': '2033-01-01', 'checkout': '2033-01-02', 'nights': 1}]
    write_json(os.path.join(root, 'source', 'CURRENT', '10_Core', 'itinerary.json'), {'stays': stays})
    write_json(os.path.join(root, 'data', 'place-facts.json'), {'places': {}})
    write_json(os.path.join(root, 'selection.json'), [{'path': 'data/place-facts.json', 'kind': 'json'}])
    with open(os.path.join(root, 'build_stub.py'), 'w', encoding='utf-8') as handle:
        handle.write('def f():\n    return "가상 문구 입니다 테스트"\n')


def revision(kind, entity, payload):
    return {'kind': kind, 'entityId': entity, 'payload': payload}


def make_package(path, break_title=False, adapter='v', overnight=None):
    blob = b'virtual-asset-bytes'
    blob_hash = hashlib.sha256(blob).hexdigest()
    local_start = {'start': {'precision': 'local', 'localTime': '09:00'}}
    records = {
        'trip_headers': [{'tripId': 'virtual'}],
        'plan_versions': [{'planVersionId': 'plan-1'}],
        'plan_days': [
            {
                'dayId': 'day-1',
                'date': '2033-01-01',
                'cityText': 'Virtual city',
                'title': 'Virtual day',
                'dayType': 'city',
                'regionIds': ['r1'],
                **({'overnightRegionId': overnight} if overnight else {}),
                'time': local_start,
            }
        ],
        'plan_items': [
            {
                'dayId': 'day-1',
                'activityId': 'day-1-visit',
                'order': 0,
                'title': 'Changed' if break_title else 'Virtual stop',
                'category': 'sight',
                'summary': 'Virtual summary',
                'optional': False,
                'time': local_start,
                'placeLinks': [{'placeId': 'p1', 'relation': 'visit'}],
            }
        ],
        'plan_legs': [],
        'plan_stays': [{'regionId': 'r1', 'time': {'start': {'date': '2033-01-01'}, 'end': {'date': '2033-01-02'}}}],
        'content_heads': [
            {'targetKind': 'place', 'entityId': 'p1'},
            {'targetKind': 'region', 'entityId': 'r1'},
            {'targetKind': 'asset', 'entityId': 'a1'},
            {'targetKind': 'map-target', 'entityId': 'm1'},
        ],
        'content_revisions': [
            revision('place', 'p1', {'regionIds': ['r1'], 'assetRefs': [{'assetId': 'a1'}]}),
            revision('region', 'r1', {'name': 'Virtual region'}),
            revision('map-target', 'm1', {'url': 'https://example.invalid/?q=1.5,2.5'}),
            revision('asset', 'a1', {'hash': blob_hash, 'byteLength': len(blob)}),
        ],
        'field_records': [],
    }
    files = []
    with zipfile.ZipFile(path, 'w') as archive:
        for name, rows in records.items():
            data = ''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows).encode('utf-8')
            archive.writestr(f'records/{name}.ndjson', data)
            files.append(
                {
                    'path': f'records/{name}.ndjson',
                    'role': 'records',
                    'byteLength': len(data),
                    'sha256': hashlib.sha256(data).hexdigest(),
                    'recordCount': len(rows),
                }
            )
        archive.writestr(f'assets/sha256/{blob_hash}', blob)
        files.append(
            {'path': f'assets/sha256/{blob_hash}', 'role': 'asset', 'byteLength': len(blob), 'sha256': blob_hash}
        )
        source = {'sourceCommit': COMMIT, 'adapterVersion': adapter, 'normalizationVersion': '1'}
        archive.writestr('manifest.json', json.dumps({'files': files, 'source': source}))


def run(tool, *arguments):
    command = [sys.executable, '-I', '-X', 'utf8', tool, *arguments]
    environment = {**os.environ, 'PYTHONIOENCODING': 'utf-8'}
    return subprocess.run(command, capture_output=True, text=True, encoding='utf-8', env=environment)


class AuditToolTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix='t03-audit-')
        self.addCleanup(shutil.rmtree, self.directory, True)
        self.source = os.path.join(self.directory, 'source')
        self.good = os.path.join(self.directory, 'good.zip')
        self.bad = os.path.join(self.directory, 'bad.zip')
        self.out = os.path.join(self.directory, 'out', 'report.json')
        os.makedirs(os.path.dirname(self.out))
        make_source(self.source)
        make_package(self.good)
        make_package(self.bad, break_title=True)

    def package(self, *packages, out=None, extra=()):
        arguments = ['--source', self.source, '--commit', COMMIT, '--out', out or self.out]
        for package in packages:
            arguments += ['--package', package]
        return run(PACKAGE_TOOL, *arguments, *extra)

    def report(self):
        with open(self.out, encoding='utf-8') as handle:
            return json.load(handle)

    def assert_refused(self, result, protected=()):
        self.assertEqual(result.returncode, 2, result.stderr)
        for path, digest in protected:
            self.assertEqual(sha256_file(path), digest, 'input changed: ' + path)

    def test_valid_package_exits_zero_and_report_has_no_failures(self):
        result = self.package(self.good)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        counts = [entry['failureCount'] for entry in self.report()['packages'].values()]
        self.assertEqual(counts, [0])

    def test_tampered_package_exits_one_and_still_writes_report(self):
        result = self.package(self.bad)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertGreater(list(self.report()['packages'].values())[0]['failureCount'], 0)

    def test_one_bad_package_among_good_ones_fails_the_run(self):
        self.assertEqual(self.package(self.good, self.bad).returncode, 1)

    def test_reg01_observation_rows_are_not_failures(self):
        self.assertEqual(self.package(self.good).returncode, 0)
        entry = list(self.report()['packages'].values())[0]
        self.assertEqual(len(entry['reg01']), 1)
        self.assertEqual(entry['failureCount'], 0)

    def test_reg01_is_strict_only_for_packages_that_claim_the_source_day_model(self):
        modern_ok = os.path.join(self.directory, 'modern-ok.zip')
        modern_bad = os.path.join(self.directory, 'modern-bad.zip')
        make_package(modern_ok, adapter='spfr-pilot-v3', overnight='r1')
        make_package(modern_bad, adapter='spfr-pilot-v3')
        self.assertEqual(self.package(modern_ok).returncode, 0)
        self.assertEqual(self.package(modern_bad).returncode, 1)
        failures = list(self.report()['packages'].values())[0]['failures']
        self.assertTrue(any('overnightRegionId' in failure for failure in failures))
        # a legacy package is reported as legacy and never silently re-read with the new meaning
        self.assertEqual(self.package(self.good).returncode, 0)
        check = list(self.report()['packages'].values())[0]['reg01Check']
        self.assertEqual(check['semantics'], 'legacy-arrival-only')

    def test_missing_input_is_an_input_error(self):
        self.assertEqual(self.package(os.path.join(self.directory, 'missing.zip')).returncode, 2)

    def test_output_equal_to_input_package_is_refused(self):
        digest = sha256_file(self.good)
        self.assert_refused(self.package(self.good, out=self.good), [(self.good, digest)])

    def test_output_equal_to_reference_is_refused(self):
        digest = sha256_file(self.bad)
        result = self.package(self.good, out=self.bad, extra=('--reference', self.bad))
        self.assert_refused(result, [(self.bad, digest)])

    def test_output_inside_source_is_refused(self):
        inside = os.path.join(self.source, 'data', 'report.json')
        self.assert_refused(self.package(self.good, out=inside))
        self.assertFalse(os.path.exists(inside))

    def test_relative_parts_and_case_alias_of_input_are_refused(self):
        digest = sha256_file(self.good)
        roundabout = os.path.join(self.directory, 'out', '..', 'good.zip')
        self.assert_refused(self.package(self.good, out=roundabout), [(self.good, digest)])
        if os.name == 'nt':
            upper = os.path.join(self.directory, 'GOOD.ZIP')
            self.assert_refused(self.package(self.good, out=upper), [(self.good, digest)])

    def test_hard_link_and_symlink_aliases_are_refused(self):
        digest = sha256_file(self.good)
        hard = os.path.join(self.directory, 'out', 'hard.json')
        try:
            os.link(self.good, hard)
        except OSError:
            self.skipTest('hard links unavailable here')
        self.assert_refused(self.package(self.good, out=hard), [(self.good, digest)])
        soft = os.path.join(self.directory, 'out', 'soft.json')
        try:
            os.symlink(self.good, soft)
        except (OSError, NotImplementedError):
            self.skipTest('symlinks need privileges here (documented limit)')
        self.assert_refused(self.package(self.good, out=soft), [(self.good, digest)])

    def test_failure_run_preserves_inputs(self):
        before = [(self.bad, sha256_file(self.bad)), (self.good, sha256_file(self.good))]
        self.assertEqual(self.package(self.bad).returncode, 1)
        for path, digest in before:
            self.assertEqual(sha256_file(path), digest)

    def test_source_scope_refuses_overwriting_selection(self):
        selection = os.path.join(self.source, 'selection.json')
        digest = sha256_file(selection)
        outside = os.path.join(self.directory, 'selection-copy.json')
        shutil.copy(selection, outside)
        outside_digest = sha256_file(outside)
        result = run(SOURCE_TOOL, 'scope', '--source', self.source, '--selection', outside, '--out', outside)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(sha256_file(outside), outside_digest)
        inside = run(SOURCE_TOOL, 'scope', '--source', self.source, '--selection', selection, '--out', selection)
        self.assertEqual(inside.returncode, 2)
        self.assertEqual(sha256_file(selection), digest)

    def test_source_scope_ok_and_missing_selected_file_fails(self):
        selection = os.path.join(self.source, 'selection.json')
        ok = run(SOURCE_TOOL, 'scope', '--source', self.source, '--selection', selection, '--out', self.out)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        missing = os.path.join(self.directory, 'missing-selection.json')
        write_json(missing, [{'path': 'data/not-there.json'}])
        failed = run(SOURCE_TOOL, 'scope', '--source', self.source, '--selection', missing, '--out', self.out)
        self.assertEqual(failed.returncode, 1)

    def test_renderer_refuses_escape_and_overwrites_then_succeeds(self):
        outside = os.path.join(self.directory, 'outside.py')
        with open(outside, 'w', encoding='utf-8') as handle:
            handle.write('x = 1\n')
        base = ['renderer', '--source', self.source, '--package', self.good]
        escape = run(SOURCE_TOOL, *base, '--out', self.out, os.path.join('..', 'outside.py'))
        self.assertEqual(escape.returncode, 2)
        digest = sha256_file(self.good)
        overwrite = run(SOURCE_TOOL, *base, '--out', self.good, 'build_stub.py')
        self.assertEqual(overwrite.returncode, 2)
        self.assertEqual(sha256_file(self.good), digest)
        stub = os.path.join(self.source, 'build_stub.py')
        stub_digest = sha256_file(stub)
        clobber = run(SOURCE_TOOL, *base, '--out', stub, 'build_stub.py')
        self.assertEqual(clobber.returncode, 2)
        self.assertEqual(sha256_file(stub), stub_digest)
        fine = run(SOURCE_TOOL, *base, '--out', self.out, 'build_stub.py')
        self.assertEqual(fine.returncode, 0, fine.stderr)


if __name__ == '__main__':
    unittest.main()
