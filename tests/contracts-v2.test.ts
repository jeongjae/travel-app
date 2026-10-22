import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  commandFingerprint,
  commandSchema,
  contentRevisionSchema,
  fieldRecordSchema,
  manifestSchema,
  parseCommandJson,
  parseManifestJson,
  parseStrictJson,
  sourceExtractSchema,
  timeRangeSchema,
  timeSpecSchema,
  validateCommand,
  validateImmutableTransition,
  validateManifestPaths,
  validateTripDataset,
  type TripDataset,
} from '../src/contracts/v2';
import { fixtureAssets, invalidFixtures, pilotTrip } from './fixtures/pilot';

const foldedTime = {
  precision: 'instant',
  date: '2026-11-01',
  localTime: '01:30',
  timeZone: 'America/New_York',
  offset: '-05:00',
  instant: '2026-11-01T06:30:00Z',
};
describe('P-01 TimeSpec', () => {
  it.each([
    { precision: 'unspecified' },
    { precision: 'unspecified', date: '2026-11-01' },
    { precision: 'date', date: '2028-02-29' },
    { precision: 'text', rawText: '점심 후' },
    { precision: 'local', date: '2026-11-01', localTime: '01:30', timeZoneStatus: 'unknown' },
    {
      precision: 'local',
      date: '2026-11-01',
      localTime: '01:30',
      timeZone: 'America/New_York',
      timeZoneStatus: 'confirmed',
    },
    foldedTime,
    { ...foldedTime, offset: '-04:00', instant: '2026-11-01T05:30:00Z' },
  ])('정밀도·원문을 보존한다: %j', (value) => {
    expect(timeSpecSchema.parse(value)).toEqual(value);
  });
  it.each([
    { precision: 'date', date: '2026-02-29' },
    { precision: 'date', date: '2026-01-01', localTime: '10:00' },
    { precision: 'unspecified', instant: '2026-01-01T00:00:00Z' },
    { precision: 'text', rawText: '  ' },
    { precision: 'local', date: '2026-01-01', localTime: '24:00', timeZoneStatus: 'unknown' },
    { precision: 'local', date: '2026-01-01', localTime: '10:00', timeZoneStatus: 'confirmed' },
    { precision: 'local', date: '2026-01-01', localTime: '10:00', timeZoneStatus: 'unknown', timeZone: 'Asia/Seoul' },
    {
      precision: 'local',
      date: '2026-03-08',
      localTime: '02:30',
      timeZoneStatus: 'confirmed',
      timeZone: 'America/New_York',
    },
    { ...foldedTime, timeZone: '+09:00' },
    { ...foldedTime, timeZone: 'Not/AZone' },
    { ...foldedTime, offset: '-03:00' },
    { ...foldedTime, instant: '2026-11-01T05:30:00Z' },
    { ...foldedTime, date: '2026-03-08', localTime: '02:30', offset: '-05:00', instant: '2026-03-08T07:30:00Z' },
  ])('잘못된 시간·정밀도를 거부한다: %j', (value) => {
    expect(timeSpecSchema.safeParse(value).success).toBe(false);
  });
  it('날짜 변경선 이동을 실제 instant로 비교하며 미정 종료를 허용한다', () => {
    expect(timeRangeSchema.safeParse({ start: foldedTime }).success).toBe(true);
    const start = {
      precision: 'instant',
      date: '2026-01-02',
      localTime: '10:00',
      timeZone: 'Asia/Tokyo',
      offset: '+09:00',
      instant: '2026-01-02T01:00:00Z',
    };
    const end = {
      precision: 'instant',
      date: '2026-01-01',
      localTime: '20:00',
      timeZone: 'America/Los_Angeles',
      offset: '-08:00',
      instant: '2026-01-02T04:00:00Z',
    };
    expect(timeRangeSchema.safeParse({ start, end }).success).toBe(true);
    expect(timeRangeSchema.safeParse({ start: end, end: start }).success).toBe(false);
  });
});

describe('P-01 F-01/02/04 계약·의미', () => {
  it('3일/1일 두 여행·같은 slug·다른 언어를 검증하고 입력을 바꾸지 않는다', async () => {
    const a = await pilotTrip(),
      b = await pilotTrip(true),
      before = structuredClone(a);
    expect(validateTripDataset(a)).toEqual(before);
    expect(validateTripDataset(b)).toEqual(b);
    expect(a.plans[0].days).toHaveLength(3);
    expect(b.plans[0].days).toHaveLength(1);
    expect(a.contents.filter((c) => c.kind === 'region')).toHaveLength(2);
    expect(a.contents.filter((c) => c.kind === 'place')).toHaveLength(4);
    expect(a.plans[0].items.filter((i) => i.placeLinks.some((l) => l.placeId === 'shared-source-slug'))).toHaveLength(
      2,
    );
    expect(a.contents.find((c) => c.kind === 'phrase-book')?.payload).not.toEqual(
      b.contents.find((c) => c.kind === 'phrase-book')?.payload,
    );
    expect(a).toEqual(before);
  });
  it.each(Object.keys(invalidFixtures))('F-04 %s를 거부한다', async (name) => {
    const t = await pilotTrip();
    invalidFixtures[name](t);
    expect(() => validateTripDataset(t)).toThrow();
  });
  it('없는 head/revision, 잘못된 해시·작업 의미·kind payload를 거부한다', async () => {
    const t = await pilotTrip();
    t.heads[0].revisionId = 'missing';
    expect(() => validateTripDataset(t)).toThrow('현재 revision');
    const c = (await pilotTrip()).contents.find((c) => c.kind === 'asset')!;
    expect(contentRevisionSchema.safeParse({ ...c, payload: { title: '다른 kind' } }).success).toBe(false);
    const badHash = await pilotTrip();
    badHash.plans[0].contextRefs.find((r) => r.targetKind === 'asset')!.hash = '0'.repeat(64);
    expect(() => validateTripDataset(badHash)).toThrow('해시');
    const task = await pilotTrip();
    task.records.push({
      tripId: task.header.tripId,
      recordId: 'task-state',
      kind: 'task-state',
      recordedAt: '2026-01-02T00:00:00Z',
      sourceRefs: [],
      commitSeq: 3,
      payload: {
        taskRef: { tripId: task.header.tripId, targetKind: 'task', entityId: 'task-1', revisionId: 'r1' },
        meaningFingerprint: '2'.repeat(64),
        completed: true,
        contextRefs: task.plans[0].contextRefs,
      },
    });
    expect(() => validateTripDataset(task)).toThrow('의미');
  });
  it('본문·Fact 새 revision과 A 편집이 과거 맥락·실제·미승인 초안·B 사본을 바꾸지 않는다', async () => {
    const before = await pilotTrip(),
      after = structuredClone(before),
      b = await pilotTrip(true),
      bBefore = structuredClone(b);
    const fact = after.contents.find((c) => c.kind === 'fact')!;
    if (fact.kind !== 'fact') throw new Error();
    after.contents.push({
      ...fact,
      revisionId: 'r2',
      previousRevisionId: fact.revisionId,
      commitSeq: 3,
      payload: { ...fact.payload, valueText: '새 가상 값' },
    });
    after.heads.find((h) => h.targetKind === 'fact')!.revisionId = 'r2';
    after.header.domainRevision++;
    const guide = after.contents.find((c) => c.kind === 'guide')!;
    if (guide.kind !== 'guide') throw new Error();
    after.contents.push({
      ...guide,
      revisionId: 'r2',
      previousRevisionId: guide.revisionId,
      commitSeq: 3,
      payload: {
        ...guide.payload,
        sections: guide.payload.sections.map((s) =>
          s.key === 'practical' ? { ...s, bodyMd: 'A의 새 실용 설명: {{fact:opening}}' } : s,
        ),
        factBindings: [
          {
            token: 'opening',
            ref: { tripId: after.header.tripId, targetKind: 'fact', entityId: fact.entityId, revisionId: 'r2' },
          },
        ],
      },
    });
    after.heads.find((h) => h.targetKind === 'guide')!.revisionId = 'r2';
    validateImmutableTransition(before, after);
    expect(after.plans[0].contextRefs.find((r) => r.targetKind === 'fact')?.revisionId).toBe('r1');
    expect(after.plans).toEqual(before.plans);
    expect(after.records).toEqual(before.records);
    expect(after.proposals).toEqual(before.proposals);
    expect(b).toEqual(bBefore);
    after.contents.find((c) => c.kind === 'fact')!.recordedAt = '2026-01-02T00:00:00Z';
    expect(() => validateImmutableTransition(before, after)).toThrow('불변');
  });
  it('기존 기록·계획·초안 삭제/덮어쓰기를 순수 후보 검사에서 거부한다', async () => {
    const before = await pilotTrip();
    for (const change of [
      (t: TripDataset) => {
        t.records = [];
      },
      (t: TripDataset) => {
        t.plans[0].items[0].title = '몰래 덮어씀';
      },
      (t: TripDataset) => {
        t.proposals[0].reason = '몰래 덮어씀';
      },
    ]) {
      const after = structuredClone(before);
      change(after);
      expect(() => validateImmutableTransition(before, after)).toThrow('불변');
    }
  });
  it('정정 분기/순환과 legacy-state의 실제 발생 시각을 거부한다', async () => {
    const t = await pilotTrip(),
      original = t.records.find((r) => r.kind === 'actual')!;
    t.records.push({ ...original, recordId: 'correction', supersedes: original.recordId, commitSeq: 3 });
    validateTripDataset(t);
    t.records.push({ ...original, recordId: 'branch', supersedes: original.recordId, commitSeq: 4 });
    expect(() => validateTripDataset(t)).toThrow('중복');
    t.records.pop();
    t.records[1].supersedes = 'correction';
    expect(() => validateTripDataset(t)).toThrow('이전 기록');
    const legacy = (await pilotTrip()).records[0];
    expect(fieldRecordSchema.safeParse({ ...legacy, occurredTime: foldedTime }).success).toBe(false);
  });
  it('가상 PNG/PDF 바이트와 asset revision의 해시/크기가 일치한다', async () => {
    for (const c of (await pilotTrip()).contents)
      if (c.kind === 'asset') {
        const bytes = fixtureAssets[c.entityId as keyof typeof fixtureAssets];
        expect(c.payload.byteLength).toBe(bytes.length);
        expect(c.payload.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
      }
    expect(new TextDecoder().decode(fixtureAssets['asset-pdf']).startsWith('%PDF-1.4')).toBe(true);
    expect([...fixtureAssets['asset-image'].slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

const baseCommand = () => ({
  format: 'travel-app-command',
  commandVersion: 2,
  tripId: 'fixture-a',
  requestId: 'request-1',
  normalizationVersion: 'pilot-v1',
  kind: 'ChangePlan',
  expectedDomainRevision: 0,
  payload: {
    currentPlanVersionId: 'plan-1',
    operations: [{ type: 'remove-item', activityId: 'activity-1' }],
    reason: '가상 변경',
  },
});
const manifest = () => ({
  format: 'travel-app-package',
  version: 2,
  domainSchemaVersion: 2,
  createdAt: '2026-01-01T00:00:00Z',
  packageId: 'package-1',
  purpose: 'migration',
  source: {
    sourceRepository: 'synthetic/pilot',
    sourceCommit: 'synthetic-v1',
    lineageId: 'synthetic',
    adapterVersion: '1',
    normalizationVersion: 'pilot-v1',
  },
  tripIds: ['fixture-a'],
  files: [
    {
      path: 'records/trip_headers.ndjson',
      role: 'records',
      byteLength: 100,
      sha256: '0'.repeat(64),
      collection: 'trip_headers',
      recordCount: 1,
    },
  ],
});
describe('P-01 명령/교환 입력 경계', () => {
  it('기준 revision 없는 쓰기, v1, 임의 명령·초안 연산을 거부한다', async () => {
    const c = baseCommand();
    expect(validateCommand(c)).toEqual(c);
    const { expectedDomainRevision: _, ...missing } = c;
    expect(commandSchema.safeParse(missing).success).toBe(false);
    expect(commandSchema.safeParse({ ...c, commandVersion: 1 }).success).toBe(false);
    expect(commandSchema.safeParse({ ...c, kind: 'RunSql' }).success).toBe(false);
    expect(commandSchema.safeParse({ ...c, payload: { ...c.payload, operations: [] } }).success).toBe(false);
    const proposal = (await pilotTrip()).proposals[0];
    expect(() =>
      validateCommand({
        ...c,
        kind: 'SaveProposal',
        expectedProposalRevision: 0,
        payload: { proposal: { ...proposal, operations: [{ type: 'correct-actual' }] }, baseDomainRevision: 0 },
      }),
    ).toThrow();
    const decision = {
      format: c.format,
      commandVersion: 2,
      tripId: c.tripId,
      requestId: 'decision',
      normalizationVersion: c.normalizationVersion,
      kind: 'DecideProposal',
      expectedProposalRevision: 1,
      payload: { proposalId: 'proposal-1', decision: 'apply', confirmedByUser: false },
    };
    expect(commandSchema.safeParse(decision).success).toBe(false);
  });
  it('C-01~09의 모든 명령 분기를 내부 저장 필드 없는 입력으로 읽는다', async () => {
    const t = await pilotTrip();
    const { commitSeq: _c, recordedAt: _r, actor: _a, ...content } = t.contents[0];
    const bookingRow = t.contents.find((r) => r.kind === 'booking')!;
    const { commitSeq: _bc, recordedAt: _br, actor: _ba, ...booking } = bookingRow;
    const recordRow = t.records.find((r) => r.kind === 'actual')!;
    const { commitSeq: _rc, recordedAt: _rr, ...record } = recordRow;
    const { commitSeq: _pc, ...proposal } = t.proposals[0];
    const { commitSeq: _vc, createdAt: _vca, ...initialPlan } = t.plans[0];
    const c = baseCommand();
    const { kind: _k, payload: _p, expectedDomainRevision: _e, ...env } = c;
    const write = { expectedDomainRevision: 0 },
      pkg = { packageId: 'package', packageDigest: '0'.repeat(64) };
    const cases = [
      { kind: 'CreateTrip', payload: { header: t.header, initialPlan } },
      { kind: 'ImportNewTrip', payload: pkg },
      {
        kind: 'EditContentSection',
        ...write,
        payload: {
          target: { targetKind: 'guide', entityId: 'guide-place', revisionId: 'r1' },
          section: {
            key: 'practical',
            title: '실용',
            order: 2,
            bodyMd: '가상',
            factRefs: [],
            assetRefs: [],
            linkRefs: [],
          },
        },
      },
      { kind: 'UpdateContent', ...write, payload: { expectedRevisionId: 'r1', content } },
      { kind: 'ChangePlan', ...write, payload: c.payload },
      { kind: 'RecordActual', ...write, payload: { record } },
      {
        kind: 'CorrectActual',
        ...write,
        payload: { supersedes: 'actual-1', record: { ...record, recordId: 'actual-2', supersedes: 'actual-1' } },
      },
      {
        kind: 'AddNote',
        ...write,
        payload: {
          record: {
            ...record,
            kind: 'note',
            payload: {
              targetRef: { tripId: t.header.tripId, targetKind: 'trip', entityId: t.header.tripId },
              body: '가상 메모',
              contextRefs: [],
            },
          },
        },
      },
      { kind: 'SetBookingState', ...write, payload: { expectedRevisionId: 'r1', booking } },
      {
        kind: 'SetTaskState',
        ...write,
        payload: {
          record: {
            ...record,
            kind: 'task-state',
            payload: {
              taskRef: { tripId: t.header.tripId, targetKind: 'task', entityId: 'task-1', revisionId: 'r1' },
              meaningFingerprint: '1'.repeat(64),
              completed: true,
              contextRefs: t.plans[0].contextRefs,
            },
          },
        },
      },
      { kind: 'SaveProposal', expectedProposalRevision: 0, payload: { proposal, baseDomainRevision: 0 } },
      {
        kind: 'DecideProposal',
        expectedProposalRevision: 1,
        payload: { proposalId: 'proposal-1', decision: 'apply', confirmedByUser: true },
      },
      { kind: 'ApplyReimport', ...write, payload: { ...pkg, lineageId: 'fixture', reviewDigest: '0'.repeat(64) } },
      {
        kind: 'UpdateTripMetadata',
        ...write,
        payload: { name: t.header.name, startDate: t.header.startDate, endDate: t.header.endDate },
      },
      {
        kind: 'DeactivateContent',
        ...write,
        payload: { target: { targetKind: 'place', entityId: 'shared-source-slug', revisionId: 'r1' } },
      },
    ];
    for (const input of cases) expect(validateCommand({ ...env, ...input }).kind).toBe(input.kind);
    expect(cases).toHaveLength(commandSchema.options.length);
    const updateInput = { ...env, ...cases[3] };
    expect(() =>
      validateCommand({
        ...updateInput,
        payload: { expectedRevisionId: 'r1', content: { ...content, commitSeq: 123 } },
      }),
    ).toThrow();
    expect(() =>
      validateCommand({
        ...updateInput,
        payload: { expectedRevisionId: 'r1', content: { ...content, tripId: 'fixture-b' } },
      }),
    ).toThrow('다른 여행');
  });
  it('명령 fingerprint는 키 순서/물리 영역에 독립이고 본문·배열·기준값을 보존한다', async () => {
    const c = baseCommand(),
      reversed = Object.fromEntries(Object.entries(c).reverse());
    expect(await commandFingerprint(c)).toBe(await commandFingerprint(reversed));
    expect(await commandFingerprint(c)).not.toBe(await commandFingerprint({ ...c, expectedDomainRevision: 1 }));
    expect(await commandFingerprint(c)).toBe(createHash('sha256').update(canonicalJson(c)).digest('hex'));
    expect(() => validateCommand({ ...c, spaceId: 'physical' })).toThrow();
    expect(canonicalJson([' 나 ', '가'])).not.toBe(canonicalJson(['가', ' 나 ']));
  });
  it.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"a":1,"a":2}}'])(
    '중복 JSON 키를 거부한다: %s',
    (input) => {
      expect(() => parseStrictJson(input)).toThrow('DUPLICATE_ID');
    },
  );
  it.each(['NaN', '1e999', '9007199254740992', '[1,]', '{"x":1,}', '01', 'true false', '\ufeff{}'])(
    '잘못된 JSON/숫자를 거부한다: %s',
    (input) => {
      expect(() => parseStrictJson(input)).toThrow();
    },
  );
  it('undefined/비JSON/깊이·UTF-8 바이트 한도를 거부하고 위험 키를 데이터로 읽는다', () => {
    for (const v of [{ a: undefined }, NaN, Infinity, new Date(), [undefined]])
      expect(() => canonicalJson(v)).toThrow();
    expect(() => parseStrictJson('"가"', 4)).toThrow('LIMIT');
    expect(() => parseStrictJson('['.repeat(110) + '0' + ']'.repeat(110))).toThrow('LIMIT');
    expect(Object.getPrototypeOf(parseStrictJson('{"__proto__":{"polluted":true}}'))).toBe(null);
    expect(parseCommandJson(JSON.stringify(baseCommand()))).toEqual(baseCommand());
  });
  it('파일 format/version과 collection·경로·중복 entry를 검사하며 v1을 재해석하지 않는다', () => {
    const m = manifest();
    expect(parseManifestJson(JSON.stringify(m))).toEqual(m);
    expect(manifestSchema.safeParse({ ...m, version: 1 }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...m, files: [{ ...m.files[0], collection: 'workspace_meta' }] }).success).toBe(
      false,
    );
    for (const path of ['../escape', 'C:/secret', '/absolute', 'records\\trip_headers.ndjson', 'manifest.json'])
      expect(manifestSchema.safeParse({ ...m, files: [{ ...m.files[0], path }] }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...m, files: [...m.files, ...m.files] }).success).toBe(false);
    const parsed = manifestSchema.parse(m);
    validateManifestPaths(['manifest.json', m.files[0].path], parsed);
    expect(() => validateManifestPaths(['manifest.json', m.files[0].path, m.files[0].path], parsed)).toThrow('중복');
    expect(() => validateManifestPaths(['manifest.json', 'extra'], parsed)).toThrow();
    expect(
      sourceExtractSchema.safeParse({
        format: 'travel-app-source-extract',
        version: 1,
        sourceRepository: 'synthetic',
        sourceCommit: 'synthetic',
        adapter: 'pilot',
        extractorVersion: '1',
        manifest: [],
        entries: [],
        unresolved: [],
      }).success,
    ).toBe(true);
  });
});
