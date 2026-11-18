import { describe, expect, it } from 'vitest';
import {
  buildSelection,
  computeUpdate,
  exportPlan,
  STALE_PLAN_MESSAGE,
  STALE_REVISION_MESSAGE,
} from '../src/plan-update';
import { act, check, createdTrip, fixture, newPlan } from './plan-import-helpers';
import {
  currentOf,
  exampleSapporoText,
  expectZeroChanges,
  partialUpdate,
  ready,
  rewriteRow,
  type Created,
} from './plan-update-helpers';

const TRIP_ID = '5b0e6f3a-2c41-4d8e-9a17-0f6c2d7e1b90';
const PLAN_ID = '9d2a71c4-6e05-4b3f-8c22-41a7e0d5f318';
const STAY_ID = 'b2e1d3c5-0002-4b20-8c02-000000000001';
const activityId = (index: number) => `a1f0c2d4-0001-4a10-9b01-00000000000${index}`;

/** 예시 내보내기 글(삿포로)의 내용으로 만든 가상 여행. 고정 자료 T2·T3가 가리키는 ID·기준을 그대로 쓴다. */
function sapporoTrip(): Created {
  const idCell = /^\| [0-9a-f]{8}-[0-9a-f-]{27} \|/;
  const text = exampleSapporoText()
    .split('\n')
    .filter((line) => !/^- (여행ID|기준계획|기준revision):/.test(line) && !line.startsWith('>'))
    .map((line) => (idCell.test(line) ? line.replace(idCell, '|  |') : line))
    .join('\n');
  const created = createdTrip(text);
  const { initialPlan } = created;
  const rebase = <T extends { tripId: string; planVersionId: string }>(row: T): T => ({
    ...row,
    tripId: TRIP_ID,
    planVersionId: PLAN_ID,
  });
  created.header.tripId = TRIP_ID;
  created.header.currentPlanVersionId = PLAN_ID;
  created.header.domainRevision = 12;
  initialPlan.tripId = TRIP_ID;
  initialPlan.planVersionId = PLAN_ID;
  initialPlan.days = initialPlan.days.map(rebase);
  initialPlan.items = initialPlan.items.map((item, index) => ({ ...rebase(item), activityId: activityId(index) }));
  initialPlan.stays = initialPlan.stays.map((stay) => ({ ...rebase(stay), stayId: STAY_ID }));
  return created;
}

function applyFixture(name: string, created = sapporoTrip()) {
  const current = currentOf(created);
  return { created, current, result: ready(computeUpdate(check(fixture(name)), current)) };
}

describe('내보내기 → 그대로 가져오기 = 변경 0건 (AC-04)', () => {
  it.each(['chatgpt-t1-run2.md', 'claude-t1-run2.md'])('고정 자료 %s', (name) => {
    const created = createdTrip(fixture(name));
    expectZeroChanges(created, check(exportPlan({ header: created.header, plan: created.initialPlan }).text));
  });

  it('예시 삿포로 여행(예약 칸 포함·미포함)', () => {
    const created = sapporoTrip();
    for (const includeReservation of [false, true]) {
      const exported = exportPlan({ header: created.header, plan: created.initialPlan }, { includeReservation });
      expectZeroChanges(created, check(exported.text), includeReservation);
    }
  });

  it('자정 넘김·시간 미정·파이프·장소 표시·숙소 2곳·예약', () => {
    const created = createdTrip(
      newPlan({
        days: [
          {
            heading: '2027-05-01 도착',
            rows: [
              act('23:30-00:30(+1)', '카운트다운', '관광', { place: '오도리 공원', memo: '인파' }),
              act('', '시간 미정 카페', '기타'),
              act('10:00', '파이프', '관광', { memo: '가격 \\| 환율' }),
              act('12:00-13:00', '점심', '식사', { reservation: '예약 전', link: 'https://example.com/s' }),
            ],
          },
        ],
        after: [
          '## 숙소',
          '| ID | 체크인 | 체크아웃 | 이름 | 지역 | 예약 |',
          '|---|---|---|---|---|---|',
          '|  | 2027-05-01 | 2027-05-02 | 호텔 가 | 삿포로 | 예약 완료 |',
          '|  | 2027-05-02 | 2027-05-03 | 호텔 나 |  |  |',
        ].join('\n'),
      }),
    );
    for (const includeReservation of [false, true]) {
      const exported = exportPlan({ header: created.header, plan: created.initialPlan }, { includeReservation });
      expectZeroChanges(created, check(exported.text), includeReservation);
    }
  });

  it('표현할 수 없는 시간·줄바꿈이 든 줄도 변경 0건이다(경고만 남는다)', () => {
    const created = createdTrip(
      newPlan({ days: [{ heading: '2027-05-01 첫날', rows: [act('09:00', 'A', '관광'), act('10:00', 'B', '관광')] }] }),
    );
    created.initialPlan.items[0].time = { start: { precision: 'text', date: '2027-05-01', rawText: '저녁쯤' } };
    created.initialPlan.items[1].summary = '첫 줄\n둘째 줄';
    const exported = exportPlan({ header: created.header, plan: created.initialPlan });
    expect(exported.warnings.map((warning) => warning.code).sort()).toEqual([
      'newline-flattened',
      'time-unrepresentable',
    ]);
    expectZeroChanges(created, check(exported.text));
  });

  it('날짜 범위로 내보낸 글도 변경 0건이고 범위 내보내기로 알린다', () => {
    const created = sapporoTrip();
    const exported = exportPlan(
      { header: created.header, plan: created.initialPlan },
      { range: { start: '2027-01-01', end: '2027-01-01' } },
    );
    const result = ready(computeUpdate(check(exported.text), currentOf(created)));
    expect(result.rangeExport).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe('E0 2회차 수정 글을 예시 내보내기 여행에 적용 (AC-15)', () => {
  it('T2: 메모만 바뀌고 새 줄 1개가 생긴다. 다른 칸은 그대로다', () => {
    const { current, result } = applyFixture('claude-t2-run2.md');
    expect(result.errors).toEqual([]);
    expect(result.changes.map((change) => [change.kind, change.title])).toEqual([
      ['edit', '점심: 스프카레'],
      ['add', '저녁 식사'],
    ]);
    const edit = result.changes[0];
    expect(edit.fields.map((field) => field.name)).toEqual(['메모']);
    const original = current.plan.items.find((item) => item.activityId === activityId(5))!;
    expect(edit.operation.type).toBe('upsert-item');
    if (edit.operation.type === 'upsert-item') {
      const { summary, ...rest } = edit.operation.item;
      const { summary: before, ...originalRest } = original;
      expect(rest).toEqual(originalRest);
      expect(before).toBe('[장소: 스아게 플러스]');
      expect(summary).toBe('[장소: 스아게 플러스] 13시 이후가 덜 붐빔');
    }
    const added = result.changes[1].operation;
    expect(added.type === 'upsert-item' && added.item.activityId).toBeTruthy();
    expect(result.unchanged).toEqual([]);
  });

  it.each(['claude-t3-run2.md', 'chatgpt-t3-run2.md'])('T3 %s: 링크 지움 1건과 삭제 1건', (name) => {
    const { current, result } = applyFixture(name);
    expect(result.errors).toEqual([]);
    expect(result.changes.map((change) => [change.kind, change.title])).toEqual([
      ['edit', '저녁: 징기스칸'],
      ['delete', '카페 휴식'],
    ]);
    const edit = result.changes[0];
    expect(edit.fields).toEqual([{ name: '링크', before: 'https://example.com/daruma', after: '', cleared: true }]);
    if (edit.operation.type === 'upsert-item') {
      const original = current.plan.items.find((item) => item.activityId === activityId(2))!;
      const { officialUrl, ...rest } = original;
      expect(officialUrl).toBe('https://example.com/daruma');
      expect(edit.operation.item).toEqual(rest);
    }
    expect(result.changes[1].operation).toEqual({ type: 'remove-item', activityId: activityId(6) });
  });

  it('일부만 든 날짜 표는 나머지 날짜·활동을 바꾸지 않는다 (AC-21)', () => {
    const { result } = applyFixture('claude-t3-run2.md');
    const touched = result.changes.map((change) => change.title);
    expect(touched).not.toContain('새해 카운트다운');
    expect(touched).toHaveLength(2);
  });
});

describe('대상 확인 (AC-08·17)', () => {
  const created = sapporoTrip();
  const current = currentOf(created);
  const fileText = fixture('claude-t3-run2.md');

  it('여행ID가 다르면 거부하고 어느 여행인지 알려 준다', () => {
    const result = computeUpdate(check(fileText.replace(TRIP_ID, 'other-trip-id')), current);
    expect(result).toMatchObject({ status: 'blocked', reason: 'other-trip', otherTripId: 'other-trip-id' });
  });

  it('기준계획이 다르면 적용 불가다', () => {
    const result = computeUpdate(check(fileText.replace(PLAN_ID, 'old-plan-id')), current);
    expect(result).toMatchObject({ status: 'blocked', reason: 'stale-plan', message: STALE_PLAN_MESSAGE });
  });

  it('기준revision이 다르면 적용 불가다', () => {
    const result = computeUpdate(check(fileText.replace('기준revision: 12', '기준revision: 11')), current);
    expect(result).toMatchObject({ status: 'blocked', reason: 'stale-revision', message: STALE_REVISION_MESSAGE });
  });

  it('여행 쪽 revision이 올라간 뒤의 글은 같은 이유로 막힌다', () => {
    const moved = currentOf(created);
    moved.header.domainRevision = 13;
    expect(computeUpdate(check(fileText), moved)).toMatchObject({ status: 'blocked', reason: 'stale-revision' });
  });

  it('새 여행 글은 수정으로 적용할 수 없다', () => {
    const text = newPlan({ days: [{ heading: '2027-05-01 첫날', rows: [act('09:00', 'A', '관광')] }] });
    expect(computeUpdate(check(text), current)).toMatchObject({ status: 'blocked', reason: 'bad-header' });
  });
});

describe('줄 맞추기', () => {
  const created = sapporoTrip();
  const current = currentOf(created);
  const exported = exportPlan({ header: created.header, plan: created.initialPlan }).text;
  const run = (text: string) => ready(computeUpdate(check(text), current));

  it('빈 칸은 변경 없음, (비움)은 지움이고 바뀐 칸만 모은다', () => {
    const text = rewriteRow(exported, activityId(2), { 제목: '저녁: 양고기', 메모: '(비움)', 예약: '' });
    const result = run(text);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].fields.map((field) => [field.name, field.cleared])).toEqual([
      ['제목', false],
      ['메모', true],
    ]);
    expect(result.unchanged).toHaveLength(created.initialPlan.items.length + 1 - 1);
  });

  it('시간 칸 변경은 새 시간으로, (비움)은 시간 미정으로 바꾼다', () => {
    const changed = run(rewriteRow(exported, activityId(2), { 시간: '19:00-20:30' }));
    const operation = changed.changes[0].operation;
    expect(operation.type === 'upsert-item' && operation.item.time.end?.precision).toBe('local');
    const cleared = run(rewriteRow(exported, activityId(2), { 시간: '(비움)' }));
    const clearedOperation = cleared.changes[0].operation;
    expect(clearedOperation.type === 'upsert-item' && clearedOperation.item.time).toEqual({
      start: { precision: 'date', date: '2026-12-31' },
    });
  });

  it('ID가 없는 줄은 새 항목, 없는 ID·종류가 다른 ID는 오류다', () => {
    const text = partialUpdate(exported, {
      days: [
        {
          heading: '2026-12-31 삿포로 도착',
          rows: [
            '|  | 21:00 | 야식 라멘 | 식사 |  |  |  |  |',
            '| no-such-id |  | 이름 |  |  |  |  |  |',
            `| ${STAY_ID} |  | 이름 |  |  |  |  |  |`,
          ],
        },
      ],
    });
    const result = run(text);
    expect(result.changes.map((change) => [change.kind, change.title])).toEqual([['add', '야식 라멘']]);
    expect(result.errors.map((error) => error.message)).toEqual([
      'ID no-such-id인 활동이 이 여행에 없습니다.',
      `ID ${STAY_ID}는 숙소의 ID인데 일정 표에 있습니다.`,
    ]);
    const added = result.changes[0].operation;
    expect(added.type === 'upsert-item' && added.item.order).toBe(4);
  });

  it('같은 날짜·같은 제목의 새 줄은 기본으로 넣지 않는 건너뜀 후보다 (AC-09)', () => {
    const text = partialUpdate(exported, {
      days: [{ heading: '2027-01-01 시내', rows: ['|  |  | 카페 휴식 | 기타 |  |  |  |  |'] }],
    });
    const result = run(text);
    expect(result.changes).toEqual([]);
    expect(result.skipped.map((entry) => entry.title)).toEqual(['카페 휴식']);
    expect(result.skipped[0].notes[0]).toContain('이미 같은 항목');
  });

  it('같은 글 안의 같은 새 줄 두 개는 앞의 것만 넣고 뒤의 것은 건너뜀 후보다', () => {
    const row = '|  | 21:00 | 야식 | 식사 |  |  |  |  |';
    const result = run(partialUpdate(exported, { days: [{ heading: '2026-12-31 삿포로 도착', rows: [row, row] }] }));
    expect(result.changes).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it('다른 날짜 표로 옮긴 줄은 그 날짜로 옮기고 시간도 새 날짜로 옮긴다', () => {
    const text = partialUpdate(exported, {
      days: [
        {
          heading: '2027-01-01 시내',
          rows: [`| ${activityId(2)} | | | | | | | |`],
        },
      ],
    });
    const result = run(text);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    const [change] = result.changes;
    expect(change.kind).toBe('move');
    expect(change.fields).toEqual([{ name: '날짜', before: '2026-12-31', after: '2027-01-01', cleared: false }]);
    const operation = change.operation;
    if (operation.type === 'upsert-item') {
      const day = current.plan.days.find((candidate) => candidate.date === '2027-01-01')!;
      expect(operation.item.dayId).toBe(day.dayId);
      expect(operation.item.order).toBe(3);
      expect(operation.item.time.start).toMatchObject({ date: '2027-01-01', localTime: '18:30' });
    }
  });

  it('연결된 이동이 있는 활동은 날짜 이동·삭제를 오류로 막는다 (AC-11)', () => {
    const withLeg = currentOf(created);
    const [from, to] = withLeg.plan.items;
    withLeg.plan.legs.push({
      tripId: TRIP_ID,
      planVersionId: PLAN_ID,
      legId: 'leg-1',
      dayId: from.dayId,
      fromActivityId: from.activityId,
      toActivityId: to.activityId,
      mode: '도보',
    });
    const text = partialUpdate(exported, {
      days: [{ heading: '2027-01-01 시내', rows: [`| ${from.activityId} | | | | | | | |`] }],
      deletions: [['활동', to.activityId, to.title]],
    });
    const result = ready(computeUpdate(check(text), withLeg));
    expect(result.changes).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((error) => error.message.includes('이동'))).toBe(true);
  });

  it('삭제: 없는 ID·종류가 다른 ID·같은 글에서 수정한 ID는 오류이고 파일에 없는 항목은 그대로다 (AC-10·18)', () => {
    const text = partialUpdate(exported, {
      days: [{ heading: '2026-12-31 삿포로 도착', rows: [`| ${activityId(0)} |  | 이름 바꿈 |  |  |  |  |  |`] }],
      deletions: [
        ['활동', 'no-such-id', '없음'],
        ['활동', STAY_ID, '호텔'],
        ['숙소', activityId(1), '호텔 체크인'],
        ['활동', activityId(0), '이름 바꿈'],
        ['활동', activityId(6), '카페 휴식'],
      ],
    });
    const result = run(text);
    expect(result.errors).toHaveLength(4);
    expect(result.changes.map((change) => [change.kind, change.title])).toEqual([
      ['edit', '신치토세 공항 → 삿포로역'],
      ['delete', '카페 휴식'],
    ]);
  });

  it('(비움)을 필수 칸에 쓰면 검사 단계에서 그 날짜 표가 빠진다', () => {
    const text = rewriteRow(exported, activityId(2), { 제목: '(비움)' });
    const file = check(text);
    expect(file.issues.map((issue) => issue.code)).toContain('clear-required');
    const result = ready(computeUpdate(file, current));
    expect(result.changes).toEqual([]);
    expect(file.dropped.map((table) => table.label)).toContain('2026-12-31');
  });

  it('같은 ID가 두 줄이면 그 날짜 표를 쓰지 않는다', () => {
    const row = `| ${activityId(2)} |  | 이름 |  |  |  |  |  |`;
    const file = check(partialUpdate(exported, { days: [{ heading: '2026-12-31 삿포로 도착', rows: [row, row] }] }));
    expect(file.issues.map((issue) => issue.code)).toContain('duplicate-id');
    expect(ready(computeUpdate(file, current)).changes).toEqual([]);
  });

  it('숙소: 체크아웃 변경은 새 날짜로, 새 줄은 추가, 같은 숙소는 건너뜀, 삭제는 삭제', () => {
    const text = partialUpdate(exported, {
      stays: [
        `| ${STAY_ID} | | 2027-01-02 | | | |`,
        '|  | 2027-01-02 | 2027-01-03 | 새 숙소 | 삿포로 |  |',
        '|  | 2026-12-31 | 2027-01-03 | 스스키노 호텔 |  |  |',
      ],
    });
    const result = run(text);
    expect(result.changes.map((change) => [change.kind, change.title])).toEqual([
      ['edit', '스스키노 호텔'],
      ['add', '새 숙소'],
    ]);
    const edit = result.changes[0].operation;
    expect(edit.type === 'upsert-stay' && edit.stay.plannedNights).toBe(2);
    expect(result.skipped.map((entry) => entry.title)).toEqual(['스스키노 호텔']);
    expect(result.ignored).toEqual(['숙소 "새 숙소": 지역·예약 칸은 이 단계에서 반영하지 않습니다.']);
    const removal = run(partialUpdate(exported, { deletions: [['숙소', STAY_ID, '스스키노 호텔']] }));
    expect(removal.changes[0].operation).toEqual({ type: 'remove-stay', stayId: STAY_ID });
  });
});

describe('장소 칸과 메모 칸의 합치기 (보완 3)', () => {
  const created = sapporoTrip();
  const current = currentOf(created);
  const exported = exportPlan({ header: created.header, plan: created.initialPlan }).text;
  const summaryAfter = (patch: Parameters<typeof rewriteRow>[2], target = current) => {
    const result = ready(computeUpdate(check(rewriteRow(exported, activityId(2), patch)), target));
    expect(result.errors).toEqual([]);
    const operation = result.changes[0]?.operation;
    return {
      result,
      summary: operation?.type === 'upsert-item' ? operation.item.summary : undefined,
    };
  };

  it('메모만 바꾸면 장소 표시가 보존된다', () => {
    expect(summaryAfter({ 메모: '새 메모' }).summary).toBe('[장소: 다루마 본점] 새 메모');
  });

  it('장소만 바꾸면 메모가 보존된다', () => {
    expect(summaryAfter({ 장소: '신규 식당' }).summary).toBe('[장소: 신규 식당] 대기 줄 길 수 있음');
  });

  it('장소 칸 (비움)은 메모 앞 [장소: …] 표시를 뺀다', () => {
    expect(summaryAfter({ 장소: '(비움)' }).summary).toBe('대기 줄 길 수 있음');
  });

  it('연결된 장소가 있으면 같은 이름은 변경 없음, 다른 이름은 연결을 두고 메모 앞에 적고 안내한다', () => {
    const linked = currentOf(created, new Map([['place-1', '다루마 본점']]));
    const item = linked.plan.items.find((candidate) => candidate.activityId === activityId(2))!;
    item.placeLinks = [{ placeId: 'place-1', relation: 'visit' }];
    item.summary = '대기 줄 길 수 있음';
    const linkedText = exportPlan({ header: linked.header, plan: linked.plan, placeNames: linked.placeNames }, {}).text;
    expect(linkedText).toContain('| 다루마 본점 | 대기 줄 길 수 있음 |');
    const same = ready(computeUpdate(check(linkedText), linked));
    expect(same.changes).toEqual([]);
    const renamed = ready(computeUpdate(check(rewriteRow(linkedText, activityId(2), { 장소: '다른 가게' })), linked));
    const [change] = renamed.changes;
    expect(change.notes).toEqual(['연결된 장소는 바뀌지 않습니다. 새 장소 이름은 메모 앞에 적힙니다.']);
    expect(change.operation.type === 'upsert-item' && change.operation.item.placeLinks).toHaveLength(1);
    expect(change.operation.type === 'upsert-item' && change.operation.item.summary).toBe(
      '[장소: 다른 가게] 대기 줄 길 수 있음',
    );
    const cleared = ready(computeUpdate(check(rewriteRow(linkedText, activityId(2), { 장소: '(비움)' })), linked));
    expect(cleared.changes).toEqual([]);
    expect(cleared.ignored).toHaveLength(1);
  });

  it('표현할 수 없는 시간의 메모 표시는 저장하는 메모에 남지 않는다', () => {
    const odd = currentOf(created);
    const target = odd.plan.items.find((candidate) => candidate.activityId === activityId(2))!;
    target.time = { start: { precision: 'text', date: '2026-12-31', rawText: '저녁쯤' } };
    const oddText = exportPlan({ header: odd.header, plan: odd.plan }).text;
    expect(oddText).toContain('[원래 시간: 저녁쯤]');
    expect(ready(computeUpdate(check(oddText), odd)).changes).toEqual([]);
    const edited = oddText.replace('대기 줄 길 수 있음 [원래 시간: 저녁쯤]', '바뀐 메모');
    const result = ready(computeUpdate(check(edited), odd));
    const operation = result.changes[0].operation;
    expect(operation.type === 'upsert-item' && operation.item.summary).toBe('[장소: 다루마 본점] 바뀐 메모');
  });
});

describe('고른 변경만 적용 (AC-11)', () => {
  const created = sapporoTrip();
  const current = currentOf(created);
  const result = ready(computeUpdate(check(fixture('claude-t2-run2.md')), current));

  it('고른 것만 연산이 되고 사유에 개수가 들어간다', () => {
    const picked = buildSelection(result, new Set([result.changes[0].key]), current);
    expect(picked).toMatchObject({ ok: true, counts: { edit: 1, add: 0, remove: 0 } });
    if (picked.ok) {
      expect(picked.operations).toHaveLength(1);
      expect(picked.reason).toBe('AI 결과 붙여넣기: 수정 1·추가 0·삭제 0');
    }
  });

  it('아무것도 고르지 않으면 적용할 수 없다', () => {
    expect(buildSelection(result, new Set(), current)).toMatchObject({ ok: false });
  });

  it('고른 결과가 현재 계획과 맞지 않으면(계획이 바뀐 뒤) 막는다', () => {
    const other = currentOf(created);
    other.plan.planVersionId = 'newer-plan';
    const picked = buildSelection(result, new Set(result.changes.map((change) => change.key)), other);
    expect(picked.ok).toBe(false);
  });

  it('건너뜀 후보도 고르면 들어간다', () => {
    const dup = ready(
      computeUpdate(
        check(
          partialUpdate(exportPlan({ header: created.header, plan: created.initialPlan }).text, {
            days: [{ heading: '2027-01-01 시내', rows: ['|  |  | 카페 휴식 | 기타 |  |  |  |  |'] }],
          }),
        ),
        current,
      ),
    );
    const picked = buildSelection(dup, new Set([dup.skipped[0].key]), current);
    expect(picked).toMatchObject({ ok: true, counts: { add: 1 } });
  });
});
