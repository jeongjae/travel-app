import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CheckedPlanFile } from '../src/plan-import';
import { EXPORT_RULE_LINES, exportPlan, tableCell, timeCellOf } from '../src/plan-update';
import { act, check, createdTrip, fixture, newPlan } from './plan-import-helpers';
import { expectZeroChanges } from './plan-update-helpers';

/** 새 여행 글 → 앱 안의 여행(가져오기 결과) → 내보내기 → 다시 읽기. */
function roundTrip(text: string, options: Parameters<typeof exportPlan>[1] = {}) {
  const created = createdTrip(text);
  const exported = exportPlan({ header: created.header, plan: created.initialPlan }, options);
  return { created, exported, again: check(exported.text) };
}

/**
 * 변경 0건의 기준(AC-04): 다시 읽은 글을 A3의 변경 계산에 넣으면 변경·건너뜀·오류가 0건이고
 * 모든 활동·숙소가 "변경 없음"이다. 머리 줄의 여행ID·기준계획·기준revision도 내부 값과 같아야 한다.
 */
function expectNoCellChanges(
  created: ReturnType<typeof createdTrip>,
  again: CheckedPlanFile,
  includeReservation = false,
) {
  expect(again.header.tripId?.value).toBe(created.header.tripId);
  expect(again.header.basePlanId?.value).toBe(created.initialPlan.planVersionId);
  expect(again.header.baseRevision?.value).toBe(String(created.header.domainRevision));
  expectZeroChanges(created, again, includeReservation);
}

describe('내보내기 규칙 글', () => {
  it('예시 문서의 인용 규칙과 글자가 같다(한 곳에서 관리)', () => {
    const example = readFileSync('docs/examples/plan-export-sapporo.md', 'utf8').replace(/\r\n/g, '\n');
    const quoted = example.split('\n').filter((line) => line.startsWith('>'));
    expect(EXPORT_RULE_LINES).toEqual(quoted);
  });
});

describe.each(['chatgpt-t1-run2.md', 'claude-t1-run2.md'])('고정 자료 %s: 내보내기 → 그대로 가져오기', (name) => {
  const { created, exported, again } = roundTrip(fixture(name));

  it('머리 줄 7개와 규칙 글·삭제 표가 있고 칸 단위 변경이 0건이다 (AC-04)', () => {
    const head = exported.text.split('\n').slice(0, 7);
    expect(head[1]).toBe('- 양식: travel-app-plan/1');
    expect(head[4]).toBe(`- 여행ID: ${created.header.tripId}`);
    expect(exported.text).toContain('## 삭제\n| 종류 | ID | 제목 |\n|---|---|---|\n');
    expectNoCellChanges(created, again);
  });

  it('활동·숙소 수가 내부 계획과 같고, 같은 글을 두 번 내보내면 같다', () => {
    expect(exported.counts.activities).toBe(created.initialPlan.items.length);
    expect(exported.counts.stays).toBe(created.initialPlan.stays.length);
    const second = exportPlan({ header: created.header, plan: created.initialPlan });
    expect(second.text).toBe(exported.text);
  });

  it('이동·장소 구역은 내보내지 않는다', () => {
    expect(exported.text).not.toContain('## 이동');
    expect(exported.text).not.toContain('## 장소');
  });
});

describe('가상 여행: 어려운 칸의 왕복', () => {
  const text = newPlan({
    days: [
      {
        heading: '2027-05-01 도착',
        rows: [
          act('23:30-00:30(+1)', '새해 카운트다운', '관광', { place: '오도리 공원', memo: '인파 많음' }),
          act('', '시간 미정 카페', '기타'),
          act('10:00', '메모에 파이프', '관광', { memo: '가격 \\| 환율 확인' }),
          act('12:00-13:00', '점심', '식사', {
            place: '스아게',
            reservation: '예약 전',
            link: 'https://example.com/s',
          }),
        ],
      },
      { heading: '2027-05-02 이동', rows: [act('09:00-10:30', '공항', '이동')] },
    ],
    after: [
      '## 숙소',
      '| ID | 체크인 | 체크아웃 | 이름 | 지역 | 예약 |',
      '|---|---|---|---|---|---|',
      '|  | 2027-05-01 | 2027-05-02 | 호텔 가 | 삿포로 | 예약 완료 |',
      '|  | 2027-05-02 | 2027-05-03 | 호텔 나 |  |  |',
    ].join('\n'),
  });
  const { created, exported, again } = roundTrip(text);

  it('자정 넘김·시간 미정·파이프·장소 표시·숙소 2곳에서 변경 0건이다', () => {
    expect(exported.warnings).toEqual([]);
    expectNoCellChanges(created, again);
  });

  it('시간은 4표현으로 나가고 장소 표시는 장소 칸으로 올라가며 메모에서는 빠진다 (G-b)', () => {
    const rows = exported.text.split('\n');
    const midnight = rows.find((line) => line.includes('새해 카운트다운'))!;
    expect(midnight).toContain('| 23:30-00:30(+1) |');
    expect(midnight).toContain('| 오도리 공원 | 인파 많음 |');
    expect(midnight).not.toContain('[장소:');
    expect(rows.find((line) => line.includes('시간 미정 카페'))).toMatch(
      /\| 시간 미정 카페 \| 기타 \| {2}\| {2}\| {2}\| {2}\|$/,
    );
    expect(rows.find((line) => line.includes('메모에 파이프'))).toContain('가격 \\| 환율 확인');
  });

  it('숙소 표의 지역·예약 칸은 비우고, 메모의 [숙소 지역]은 메모에 그대로 둔다 (G-c)', () => {
    const stayRows = exported.text.split('\n').filter((line) => line.includes('호텔'));
    const stayTableRows = stayRows.filter((line) => /\| 2027-05-0[12] \|/.test(line));
    expect(stayTableRows).toHaveLength(2);
    for (const row of stayTableRows) {
      expect(row).toMatch(/\| {2}\| {2}\|$/);
    }
    expect(exported.text).toContain('[숙소 지역: 삿포로]');
  });

  it('예약 칸은 기본으로 비우고 "예약 메모도 넣기"를 고르면 채운다 (G-d)', () => {
    expect(exported.text).not.toContain('예약 전');
    const withReservation = roundTrip(text, { includeReservation: true });
    expect(withReservation.exported.text).toContain('예약 전');
    expectNoCellChanges(withReservation.created, withReservation.again, true);
  });
});

describe('내보내기 변환의 경계', () => {
  it('날짜 범위: 그 날짜의 표만, 머리에 범위 줄, 숙소는 겹치는 것만', () => {
    const text = newPlan({
      days: [
        { heading: '2027-05-01 첫날', rows: [act('09:00', 'A', '관광')] },
        { heading: '2027-05-02 둘째', rows: [act('09:00', 'B', '관광')] },
        { heading: '2027-05-03 셋째', rows: [act('09:00', 'C', '관광')] },
      ],
      after: [
        '## 숙소',
        '| ID | 체크인 | 체크아웃 | 이름 | 지역 | 예약 |',
        '|---|---|---|---|---|---|',
        '|  | 2027-05-01 | 2027-05-02 | 앞 호텔 |  |  |',
        '|  | 2027-05-02 | 2027-05-03 | 가운데 호텔 |  |  |',
      ].join('\n'),
    });
    const { exported, again } = roundTrip(text, { range: { start: '2027-05-03', end: '2027-05-03' } });
    expect(exported.text).toContain('- 범위: 2027-05-03 ~ 2027-05-03');
    expect(exported.text).toContain('### 2027-05-03');
    expect(exported.text).not.toContain('### 2027-05-01');
    expect(exported.text).not.toContain('앞 호텔');
    expect(exported.text).toContain('가운데 호텔');
    expect(exported.counts.days).toBe(1);
    expect(again.kind).toBe('update');
    expect(again.issues).toEqual([]);
    expect(again.notImported.map((entry) => `${entry.kind}:${entry.name}`)).toEqual(['header:범위']);
  });

  it('표현할 수 없는 시간은 막지 않고 메모 끝에 원래 시간을 적고 경고로 모은다', () => {
    const created = createdTrip(newPlan({ days: [{ heading: '2027-05-01 첫날', rows: [act('09:00', 'A', '관광')] }] }));
    const plan = structuredClone(created.initialPlan);
    plan.items[0].time = { start: { precision: 'text', date: '2027-05-01', rawText: '저녁쯤' } };
    plan.items.push({
      ...plan.items[0],
      activityId: 'x2',
      order: 1,
      title: '다른 날짜 시작',
      time: { start: { precision: 'local', date: '2027-05-02', localTime: '08:00', timeZoneStatus: 'unknown' } },
    });
    const result = exportPlan({ header: created.header, plan });
    expect(result.warnings.map((warning) => warning.code)).toEqual(['time-unrepresentable', 'time-unrepresentable']);
    expect(result.text).toContain('[원래 시간: 저녁쯤]');
    expect(result.text).toContain('[원래 시간: 2027-05-02 08:00]');
    expect(check(result.text).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('칸 안 줄바꿈은 공백으로 바꾸고 경고하며, 파이프·(비움)은 글자로 돌아온다', () => {
    const created = createdTrip(newPlan({ days: [{ heading: '2027-05-01 첫날', rows: [act('', 'A', '관광')] }] }));
    const plan = structuredClone(created.initialPlan);
    plan.items[0].summary = '첫 줄\n둘째 | 줄';
    plan.items[0].title = '(비움)';
    const result = exportPlan({ header: created.header, plan });
    expect(result.warnings.map((warning) => warning.code)).toEqual(['newline-flattened']);
    const again = check(result.text);
    const row = again.days[0].rows[0];
    expect(row.memo).toBe('첫 줄 둘째 | 줄');
    expect(row.title).toBe('(비움)');
    expect(row.cleared).toEqual([]);
  });

  it('연결된 장소가 있으면 그 이름이 장소 칸이고 메모는 그대로다', () => {
    const created = createdTrip(
      newPlan({ days: [{ heading: '2027-05-01 첫날', rows: [act('', 'A', '관광', { memo: '메모' })] }] }),
    );
    const plan = structuredClone(created.initialPlan);
    plan.items[0].placeLinks = [{ placeId: 'p1', relation: 'visit' }];
    const result = exportPlan({ header: created.header, plan, placeNames: new Map([['p1', '연결된 곳']]) });
    expect(result.text).toContain('| 연결된 곳 | 메모 |');
  });

  it('시간 칸 변환과 칸 규칙 단위 확인', () => {
    const local = (date: string, localTime: string) =>
      ({ precision: 'local', date, localTime, timeZoneStatus: 'unknown' }) as const;
    expect(timeCellOf({ start: local('2027-05-01', '09:05:00') }, '2027-05-01')).toEqual({ text: '09:05' });
    expect(timeCellOf({ start: local('2027-05-01', '09:05:30') }, '2027-05-01')).toHaveProperty('problem');
    expect(
      timeCellOf({ start: local('2027-05-01', '09:00'), end: local('2027-05-01', '09:00') }, '2027-05-01'),
    ).toHaveProperty('problem');
    expect(
      timeCellOf({ start: local('2027-05-01', '08:00'), end: local('2027-05-01', '21:00') }, '2027-05-01'),
    ).toHaveProperty('problem');
    expect(
      timeCellOf({ start: local('2027-05-01', '23:00'), end: local('2027-05-02', '01:00') }, '2027-05-01'),
    ).toEqual({
      text: '23:00-01:00(+1)',
    });
    expect(tableCell(' a|b ')).toEqual({ text: 'a\\|b', changed: false });
    expect(tableCell('(비움)').text).toBe('\\(비움)');
  });
});
