import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeSpfrCandidate } from '../src/transfer/spfr-candidate';
import { canonicalJson, sourceExtractSchema } from '../src/contracts/v2';
import { buildPackage, readPackage } from '../src/transfer/package';
const python = resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
it('기기 MIME 등록과 파일 확장자에 의존하지 않고 검증 이미지 바이트의 형식을 식별한다', () => {
  const result = execFileSync(
    python,
    [
      '-c',
      [
        'import runpy',
        "mime = runpy.run_path('scripts/fetch-spfr-media.py')['media_type']",
        "assert mime('a.bin', b'RIFF0000WEBP0000') == 'image/webp'",
        "assert mime('a.bin', b'\\x89PNG\\r\\n\\x1a\\n000') == 'image/png'",
        "assert mime('a.bin', b'\\xff\\xd8\\xff000') == 'image/jpeg'",
        "assert mime('a.bin', b'unknown') == 'application/octet-stream'",
        "print('verified')",
      ].join('\n'),
    ],
    { encoding: 'utf8' },
  );
  expect(result.trim()).toBe('verified');
});
async function fixture() {
  await mkdir('.cache/spfr-tests', { recursive: true });
  const dir = await mkdtemp(resolve('.cache/spfr-tests/source-')),
    root = join(dir, 'reference'),
    commit = 'a'.repeat(40);
  const put = async (path: string, value: unknown, raw = false) => {
    const file = join(root, path);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, raw ? String(value) : JSON.stringify(value));
  };
  const stop = (id: string, start: string) => ({
    id,
    order: id === 'one' ? 0 : 1,
    start,
    end: null,
    name: '가상 장소',
    category: 'walk',
    summary: '가상 설명',
    menu: '',
    reservation: '',
    optional: false,
    executionStatuses: [],
    place_ref: 'pilot-place',
    lat: 1,
    lng: 2,
  });
  await put('data/daily-cards/day-28.json', {
    schemaVersion: '1.0',
    day: 28,
    date: '2033-05-01',
    city: '가상 지역',
    title: '가상 하루',
    startTime: null,
    endTime: null,
    dayType: 'walk',
    sourceStatus: 'synthetic',
    fatigue: '미상',
    totalDuration: '미상',
    totalDistance: '미상',
    stops: [stop('one', '오후'), stop('two', '10:00')],
    legs: [
      { from: 'one', to: 'two', mode: 'walk', duration: '미상', distance: '미상', line: '', geometryStatus: 'unknown' },
    ],
    transport: [],
    food: [],
    highlights: [],
    backup: '가상 대안',
    needsReview: [],
    hotel: {},
    map: {},
    sourceRefs: [],
  });
  await put('source/CURRENT/10_Core/itinerary.json', {
    stays: [{ key: 'pilot-region', checkin: '2033-04-30', checkout: '2033-05-03' }],
  });
  await put('source/CURRENT/10_Core/regions.json', { regions: [{ slug: 'pilot-region', name: '가상 지역' }] });
  await put('data/place-facts.json', {
    places: {
      'pilot-place': {
        facts: {
          hours: {
            value: '오후 개방',
            source: 'https://example.com/pilot',
            confidence: 'editorial',
            verified_at: '2033-01-01',
          },
        },
      },
    },
  });
  await put('data/map-queries.json', {
    places: { 'pilot-place': { query: 'Fictional pilot', verdict: 'source-only' } },
  });
  for (const name of ['region-essentials', 'transit-facts', 'transit-resources', 'tourist-maps']) {
    await put(`data/${name}.json`, { regions: { 'pilot-region': [] } });
  }
  await put('data/travel-french-phrases.json', { phrases: [] });
  await put('data/travel-french-guide.json', {});
  await put('data/field-notes.json', {});
  await put('data/booking-overrides.json', {});
  await put('data/images/image-manifest.json', {
    images: [
      {
        imageId: 'synthetic-photo',
        placeId: 'pilot-place',
        license: 'synthetic-only',
        variants: { content: [{ path: 'source/ASSETS/not-downloaded.webp', sha256: 'f'.repeat(64), bytes: 10 }] },
      },
    ],
  });
  await put(
    'source/CURRENT/30_Places/pilot-place.md',
    '---\nslug: pilot-place\nname: "가상 장소"\nregion: pilot-region\nkind: spot\nsummary: "가상 요약"\n---\n\n## 왜 가는가\n가상 본문\n\n## 더 깊이\n|표|값|\n|---|---|\n|가상|표본|\n\n## 실용\n원문을 보존합니다.\n',
    true,
  );
  await put('source/CURRENT/20_Regions/pilot-region.md', '## 가상 지역\n원문\n', true);
  await put('source/ASSETS/91_Place_Registry_v1.0.md', '가상 registry\n', true);
  await put('build/model.py', 'raise RuntimeError("source must never execute")\n', true);
  await put(
    'build/render.py',
    "PARIS_MUSEUM_BOOKINGS = [{'id':'synthetic|2033-05-01|afternoon','slug':'pilot-place','name':'가상 코드 예약','day':28,'date':'5/1 (일)','schedule':'오후','canonical_status':'source-booked','stage':'원본 단계','when':'판매 시작 시','action_date':'가상 티켓 저장','pmp':'가상 패스 조건','plan_b':'가상 대안','note':'실제 예약 아님','official_url':'https://example.com/pilot'}]\nraise RuntimeError('source must never execute')\n",
    true,
  );
  const book = join(root, 'source/OPERATIONS/TP_Europe_Travel_Master_Tracker_v1.2.xlsx');
  await mkdir(join(book, '..'), { recursive: true });
  execFileSync(python, [
    '-c',
    "from openpyxl import Workbook;import sys;w=Workbook();s=w.active;s.title='Reservations';s.append(['id','date','status']);s.append(['synthetic','2033-05-01','=1+1']);w.save(sys.argv[1]);w.close()",
    book,
  ]);
  const files: string[] = [];
  async function walk(path: string) {
    for (const e of await readdir(path, { withFileTypes: true })) {
      const p = join(path, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else {
        files.push(p);
      }
    }
  }
  await walk(root);
  const tree = [];
  for (const path of files) {
    const bytes = await readFile(path);
    tree.push({
      path: relative(root, path).replaceAll('\\', '/'),
      type: 'blob',
      mode: '100644',
      size: bytes.length,
      sha: createHash('sha1')
        .update(Buffer.from(`blob ${bytes.length}\0`))
        .update(bytes)
        .digest('hex'),
    });
  }
  const treeFile = join(dir, 'tree.json');
  await writeFile(treeFile, JSON.stringify({ sha: commit, truncated: false, tree }));
  const out = join(dir, 'audit');
  const args = [
    'scripts/prepare-spfr-pilot.py',
    '--root',
    root,
    '--tree',
    treeFile,
    '--commit',
    commit,
    '--days',
    '28',
    '--output-dir',
    out,
  ];
  return { root, out, args };
}
it('고정 원천 실행 없이 AST/XLSX/본문을 추출하고 v2 후보/원문/차단 사유를 분리한다', async () => {
  const f = await fixture();
  const original = await readFile(join(f.root, 'build/render.py'));
  execFileSync(python, f.args, { stdio: 'pipe' });
  const extract = sourceExtractSchema.parse(JSON.parse(await readFile(join(f.out, 'extract.json'), 'utf8'))),
    audit = JSON.parse(await readFile(join(f.out, 'audit.json'), 'utf8'));
  expect(audit.counts.codeBookingsInWindow).toBe(1);
  expect(audit.sheets.Reservations.formulaCells).toBe(1);
  expect(audit.sheets.Reservations.missingFormulaCaches).toBe(1);
  expect(audit.counts.missingMedia).toBe(1);
  expect(audit.packageReady).toBe(false);
  expect(await readFile(join(f.root, 'build/render.py'))).toEqual(original);
  const n = await normalizeSpfrCandidate(extract, {
    days: [28],
    tripId: 'synthetic-spfr',
    createdAt: '2026-10-22T00:00:00Z',
  });
  expect(() => canonicalJson(n.dataset)).not.toThrow();
  expect(n.dataset.plans[0].items).toHaveLength(2);
  expect(n.dataset.plans[0].legs).toHaveLength(1);
  const booking = n.dataset.contents.find((c) => c.kind === 'booking');
  if (booking?.kind !== 'booking') {
    throw Error();
  }
  expect(booking.payload.time.start).toEqual({ precision: 'text', date: '2033-05-01', rawText: '오후' });
  expect(booking.payload.passNote).toBe('가상 패스 조건');
  expect(booking.payload.actionTiming).toEqual({ precision: 'text', rawText: '판매 시작 시' });
  expect(booking.payload.activityIds).toEqual(['day-28-one', 'day-28-two']);
  expect(n.dataset.records).toEqual([]);
  expect(
    n.dataset.contents
      .filter((c) => c.kind === 'fact')
      .every((c) => c.kind === 'fact' && c.payload.appReviewStatus === 'unverified'),
  ).toBe(true);
  expect(n.report.blocking).toContain('UNRESOLVED_SOURCE');
  expect(n.report.packageReady).toBe(false);
  const p = await buildPackage(
    n.dataset,
    new Map(),
    {
      sourceRepository: 'synthetic/pilot',
      sourceCommit: 'synthetic',
      lineageId: 'synthetic',
      adapterVersion: 'spfr-candidate-v1',
      normalizationVersion: '1',
    },
    n.report,
    n.mappings,
  );
  await expect(readPackage(p.blob)).rejects.toThrow('미해결');
}, 15000);
it('고정 원천 변조·깨진 이동 참조를 거부하고 없는 Fact 근거/미상 필드를 발명하지 않는다', async () => {
  const f = await fixture();
  execFileSync(python, f.args, { stdio: 'pipe' });
  const raw = JSON.parse(await readFile(join(f.out, 'extract.json'), 'utf8')),
    fact = raw.entries.find((e: { sourceKey: string }) => e.sourceKey === 'data/place-facts.json');
  delete fact.rawValue.places['pilot-place'].facts.hours.source;
  const n = await normalizeSpfrCandidate(raw, {
    days: [28],
    tripId: 'synthetic-spfr',
    createdAt: '2026-10-22T00:00:00Z',
  });
  expect(n.dataset.contents.filter((c) => c.kind === 'evidence')).toEqual([]);
  expect(n.report.blocking).toContain('FACT_SOURCE_MISSING:pilot-place:hours');
  const cardPath = join(f.root, 'data/daily-cards/day-28.json');
  await writeFile(cardPath, '{}');
  expect(spawnSync(python, f.args, { stdio: 'pipe' }).status).not.toBe(0);
  const broken = structuredClone(raw);
  broken.entries.find(
    (e: { sourceKey: string }) => e.sourceKey === 'data/daily-cards/day-28.json',
  ).rawValue.legs[0].from = 'missing';
  await expect(
    normalizeSpfrCandidate(broken, { days: [28], tripId: 'synthetic-spfr', createdAt: '2026-10-22T00:00:00Z' }),
  ).rejects.toThrow();
}, 15000);
