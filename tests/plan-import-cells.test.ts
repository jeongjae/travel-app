import { describe, expect, it } from 'vitest';
import { toNewTrip } from '../src/plan-import';
import {
  act,
  check,
  createdTrip,
  errorCodes,
  newPlan,
  validateAsCreateTrip,
  warningCodes,
} from './plan-import-helpers';

const DAY1 = '2027-05-01 첫날';

function oneDay(...rows: string[]) {
  return newPlan({ days: [{ heading: DAY1, rows }] });
}

function timeResult(time: string) {
  const file = check(oneDay(act(time, '산책', '관광')));
  return { codes: errorCodes(file), file };
}

function spanOf(time: string) {
  return timeResult(time).file.days[0].rows[0].span;
}

const STAY_TABLE_HEAD = ['## 숙소', '| ID | 체크인 | 체크아웃 | 이름 | 지역 | 예약 |', '|---|---|---|---|---|---|'];

function withStays(base: string, rows: string[]) {
  return [base, ...STAY_TABLE_HEAD, ...rows].join('\n');
}

describe('시간 칸', () => {
  it('빈 칸·HH:MM·범위·(+1)을 읽는다', () => {
    expect(spanOf('')).toBeUndefined();
    expect(spanOf('09:05')).toEqual({ startMinute: 545, overnight: false });
    expect(spanOf('09:00-10:30')).toEqual({ startMinute: 540, endMinute: 630, overnight: false });
    expect(spanOf('23:30-00:20(+1)')).toEqual({ startMinute: 1410, endMinute: 1460, overnight: true });
    expect(timeResult('23:30-00:20(+1)').codes).toEqual([]);
  });

  it('길이 0은 거부하고 그날 표를 뺀다 (AC-06)', () => {
    const { codes, file } = timeResult('10:00-10:00');
    expect(codes).toEqual(['time-zero']);
    expect(file.days[0].rows).toEqual([]);
    expect(file.dropped).toMatchObject([{ section: '일정', label: '2027-05-01', rowCount: 1 }]);
  });

  it('(+1) 없이 끝이 시작보다 이르면 거부', () => {
    expect(timeResult('23:30-00:20').codes).toEqual(['time-reversed']);
  });

  it('12시간 초과는 거부, 정확히 12시간은 허용', () => {
    expect(timeResult('08:00-20:01').codes).toEqual(['time-too-long']);
    expect(timeResult('20:00-08:00(+1)').codes).toEqual([]);
    expect(timeResult('20:00-08:01(+1)').codes).toEqual(['time-too-long']);
    expect(timeResult('10:00-12:00(+1)').codes).toEqual(['time-too-long']);
  });

  it.each(['9:00', '24:00', '09:60', '09:00~10:00', '09:00 - 10:00', '오전 9시', '09:00-', '09:00-10:00(+2)', '0900'])(
    '허용하지 않는 표현 %s',
    (time) => {
      expect(timeResult(time).codes).toEqual(['time-invalid']);
    },
  );

  it('같은 날 겹침은 경고이고 일정은 남는다', () => {
    const file = check(
      oneDay(act('09:00-10:00', '가', '관광'), act('09:30-11:00', '나', '관광'), act('11:00-12:00', '다', '식사')),
    );
    expect(errorCodes(file)).toEqual([]);
    expect(warningCodes(file)).toEqual(['time-overlap']);
    expect(file.days[0].rows).toHaveLength(3);
  });

  it('맞닿는 시간과 단독 시각은 겹침이 아니다', () => {
    const file = check(
      oneDay(act('09:00-10:00', '가', '관광'), act('10:00-11:00', '나', '관광'), act('10:30', '다', '기타')),
    );
    expect(file.issues).toEqual([]);
  });

  it('확인된 시간대에 없는 현지 시각(서머타임)은 거부', () => {
    const text = newPlan({
      period: '2027-03-13 ~ 2027-03-15',
      zone: 'America/New_York',
      days: [{ heading: '2027-03-14 전환일', rows: [act('02:30-03:30', '새벽', '기타')] }],
    });
    expect(errorCodes(check(text))).toEqual(['time-nonexistent']);
  });
});

describe('칸·표 규칙', () => {
  it('칸 안의 \\|는 글자 |로 읽는다', () => {
    const file = check(oneDay(act('', '가\\|나', '관광', { memo: '메모 \\| 계속' })));
    expect(file.days[0].rows[0]).toMatchObject({ title: '가|나', memo: '메모 | 계속' });
    expect(errorCodes(file)).toEqual([]);
  });

  it('칸이 모자라면 그 날짜 표 전체를 뺀다(다른 날짜는 남는다)', () => {
    const text = newPlan({
      days: [
        { heading: DAY1, rows: [act('', '정상', '관광'), '09:00 | 칸 모자람 | 관광'] },
        { heading: '2027-05-02 둘째 날', rows: [act('', '정상', '관광')] },
      ],
    });
    const file = check(text);
    expect(errorCodes(file)).toEqual(['column-count']);
    expect(file.days.map((day) => day.rows.length)).toEqual([0, 1]);
    expect(file.dropped.map((item) => item.label)).toEqual(['2027-05-01']);
  });

  it('칸이 넘쳐도 그 표 전체를 뺀다', () => {
    const text = oneDay(act('', '가', '관광'), act('', '나', '관광') + ' | 남는 칸');
    const file = check(text);
    expect(errorCodes(file)).toEqual(['column-count']);
    expect(file.days[0].rows).toEqual([]);
  });

  it('첫 오류에서 멈추지 않고 모든 오류를 모은다', () => {
    const file = check(
      oneDay(
        act('10:00-10:00', '가', '관광'),
        act('9:00', '나', '관광'),
        act('', '', '관광'),
        act('', '다', '관광', { link: 'http://x.example' }),
      ),
    );
    expect(errorCodes(file)).toEqual(['time-zero', 'time-invalid', 'blank-required', 'link-invalid']);
  });

  it('필수 열이 없으면 표 오류', () => {
    const text = oneDay(act('', '가', '관광')).replace('| 종류 |', '| 분류 |');
    const file = check(text);
    expect(errorCodes(file)).toContain('column-missing');
    expect(file.days[0].rows).toEqual([]);
  });

  it('모르는 열은 읽지 않고 notImported에 남기며 나머지는 읽는다', () => {
    const text = [
      '# 여행: 열',
      '- 양식: travel-app-plan/1',
      '- 기간: 2027-05-01 ~ 2027-05-01',
      '',
      '## 일정',
      '### 2027-05-01',
      '| ID | 시간 | 제목 | 종류 | 예산 |',
      '|---|---|---|---|---|',
      '|  |  | 가 | 관광 | 3만원 |',
    ].join('\n');
    const file = check(text);
    expect(errorCodes(file)).toEqual([]);
    expect(file.notImported).toEqual([{ kind: 'column', name: '예산', where: '일정', lineCount: 1 }]);
    expect(file.days[0].rows[0].title).toBe('가');
  });

  it('열 순서가 달라도 이름으로 읽는다', () => {
    const text = [
      '# 여행: 순서',
      '- 양식: travel-app-plan/1',
      '- 기간: 2027-05-01 ~ 2027-05-01',
      '',
      '## 일정',
      '### 2027-05-01',
      '| 종류 | 제목 | 시간 | ID | 링크 | 메모 |',
      '|---|---|---|---|---|---|',
      '| 관광 | 산책 | 10:00 |  | https://example.com/a | 좋음 |',
    ].join('\n');
    const file = check(text);
    expect(file.days[0].rows[0]).toMatchObject({
      title: '산책',
      category: '관광',
      time: '10:00',
      link: 'https://example.com/a',
      memo: '좋음',
    });
  });

  it('http:// 링크와 공백 있는 링크는 거부, https://는 허용', () => {
    const linkCodes = (link: string) => errorCodes(check(oneDay(act('', '가', '관광', { link }))));
    expect(linkCodes('http://example.com')).toEqual(['link-invalid']);
    expect(linkCodes('https://a.com b')).toEqual(['link-invalid']);
    expect(linkCodes('https://a.com/x?y=1')).toEqual([]);
  });

  it('새 여행 파일의 ID 값은 오류', () => {
    const text = oneDay(act('', '가', '관광')).replace('|  | ', '| abc-1 | ');
    expect(errorCodes(check(text))).toEqual(['id-in-new-file']);
  });

  it('새 줄의 (비움)은 오류, 글자 그대로 \\(비움)은 값', () => {
    expect(errorCodes(check(oneDay(act('', '가', '관광', { memo: '(비움)' }))))).toEqual(['clear-without-id']);
    const literal = check(oneDay(act('', '가', '관광', { memo: '\\(비움)' })));
    expect(errorCodes(literal)).toEqual([]);
    expect(literal.days[0].rows[0].memo).toBe('(비움)');
  });

  it('빈 제목·종류는 새 줄에서 오류', () => {
    expect(errorCodes(check(oneDay(act('', '', '관광'))))).toEqual(['blank-required']);
    expect(errorCodes(check(oneDay(act('', '가', ''))))).toEqual(['blank-required']);
  });
});

describe('날짜·머리 줄·숙소·삭제', () => {
  it('기간 밖 날짜와 실제 없는 날짜는 오류로 그 날을 뺀다', () => {
    const text = newPlan({
      days: [
        { heading: '2027-05-04 기간 밖', rows: [act('', '가', '관광')] },
        { heading: '2027-02-30 없는 날', rows: [act('', '나', '관광')] },
        { heading: '2027-05-02 정상', rows: [act('', '다', '관광')] },
      ],
    });
    const file = check(text);
    expect(errorCodes(file)).toEqual(['date-out-of-range', 'date-invalid']);
    expect(file.days.map((day) => day.rows.length)).toEqual([0, 0, 1]);
  });

  it('같은 날짜 제목이 두 번이면 뒤의 것을 오류로 뺀다', () => {
    const text = newPlan({
      days: [
        { heading: DAY1, rows: [act('', '가', '관광')] },
        { heading: DAY1, rows: [act('', '나', '관광')] },
      ],
    });
    const file = check(text);
    expect(errorCodes(file)).toEqual(['duplicate-day']);
    expect(file.days.map((day) => day.rows.length)).toEqual([1, 0]);
  });

  it('날짜 제목 끝의 (시간대: …)는 그날만의 시간대', () => {
    const text = newPlan({ days: [{ heading: `${DAY1} (시간대: Europe/Paris)`, rows: [act('10:00', '가', '관광')] }] });
    const trip = createdTrip(text);
    expect(trip.initialPlan.items[0].time.start).toMatchObject({
      timeZone: 'Europe/Paris',
      timeZoneStatus: 'confirmed',
    });
    expect(trip.initialPlan.days[0].title).toBe('첫날');
    const bad = newPlan({ days: [{ heading: `${DAY1} (시간대: Mars/Base)`, rows: [act('', '가', '관광')] }] });
    expect(errorCodes(check(bad))).toEqual(['timezone-invalid']);
  });

  it.each([
    ['기간이 없음', 'period-missing'],
    ['기간 뒤집힘', 'period-reversed'],
    ['기간 형식 오류', 'period-invalid'],
    ['시간대 이름 오류', 'timezone-invalid'],
    ['이름 없음', 'name-missing'],
  ])('머리 줄 오류(%s)는 저장을 막는다', (label, code) => {
    const base = oneDay(act('', '가', '관광'));
    const variants: Record<string, string> = {
      'period-missing': base.replace(/- 기간: .*\n/, ''),
      'period-reversed': base.replace('2027-05-01 ~ 2027-05-03', '2027-05-03 ~ 2027-05-01'),
      'period-invalid': base.replace('2027-05-01 ~ 2027-05-03', '5월 1일 ~ 5월 3일'),
      'timezone-invalid': base.replace('Asia/Tokyo', 'Mars/Base'),
      'name-missing': base.replace('# 여행: 시험 여행\n', ''),
    };
    const file = check(variants[code]);
    expect(
      file.issues.map((issue) => issue.code),
      label,
    ).toContain(code);
    expect(file.saveable).toBe(false);
  });

  it('시간대 줄이 없으면 시간대 미확인으로 저장', () => {
    const trip = createdTrip(newPlan({ zone: null, days: [{ heading: DAY1, rows: [act('10:00', '가', '관광')] }] }));
    expect(trip.header.timeZoneStatus).toBe('unknown');
    expect(trip.initialPlan.items[0].time.start).toMatchObject({ precision: 'local', timeZoneStatus: 'unknown' });
  });

  it('숙소: 체크아웃이 체크인보다 늦어야 하고 기간 안이어야 한다', () => {
    const base = oneDay(act('', '가', '관광'));
    expect(errorCodes(check(withStays(base, ['|  | 2027-05-02 | 2027-05-02 | A |  |  |'])))).toEqual(['stay-order']);
    expect(errorCodes(check(withStays(base, ['|  | 2027-05-02 | 2027-05-04 | A |  |  |'])))).toEqual([
      'date-out-of-range',
    ]);
    expect(errorCodes(check(withStays(base, ['|  | 2027-05-01 | 2027-05-03 | A |  |  |'])))).toEqual([]);
  });

  it('숙소 표에 오류가 있으면 그 표를 빼지만 일정은 남는다', () => {
    const rows = ['|  | 2027-05-01 | 2027-05-03 | A |  |  |', '|  | 2027-05-02 | 2027-05-02 | B |  |  |'];
    const file = check(withStays(oneDay(act('', '가', '관광')), rows));
    expect(file.stays).toEqual([]);
    expect(file.days[0].rows).toHaveLength(1);
    expect(file.dropped).toMatchObject([{ section: '숙소', rowCount: 2 }]);
  });

  it('삭제 표: 종류는 활동·숙소만 허용, 새 여행 파일에서는 ID 자체가 오류', () => {
    const rows = ['## 삭제', '| 종류 | ID | 제목 |', '|---|---|---|', '| 장소 | x-1 | 제목 |'];
    const file = check([oneDay(act('', '가', '관광')), ...rows].join('\n'));
    expect(errorCodes(file)).toEqual(['delete-kind', 'id-in-new-file']);
  });

  it('모르는 구역과 머리 줄은 notImported', () => {
    const text = newPlan({
      days: [{ heading: DAY1, rows: [act('', '가', '관광')] }],
      headerLines: ['- 메모장: 비공개'],
      after: '## 교통편\n| 가 | 나 |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n',
    });
    expect(check(text).notImported).toEqual([
      { kind: 'header', name: '메모장', lineCount: 1 },
      { kind: 'section', name: '교통편', lineCount: 2 },
    ]);
  });
});

describe('새 여행 변환', () => {
  it('날짜 행은 buildNewTrip과 같게 만들고 활동 순서는 표의 줄 순서다', () => {
    const trip = createdTrip(
      newPlan({
        days: [
          {
            heading: '2027-05-01 도착',
            rows: [act('', '시간 없음', '기타'), act('08:00', '일찍', '관광'), act('', '또 없음', '기타')],
          },
          { heading: '2027-05-03 마지막', rows: [act('09:00-10:00', '끝', '관광')] },
        ],
      }),
    );
    expect(trip.initialPlan.days.map((day) => [day.date, day.title])).toEqual([
      ['2027-05-01', '도착'],
      ['2027-05-02', '2027-05-02'],
      ['2027-05-03', '마지막'],
    ]);
    const first = trip.initialPlan.items.filter((item) => item.dayId === trip.initialPlan.days[0].dayId);
    expect(first.map((item) => [item.order, item.title])).toEqual([
      [0, '시간 없음'],
      [1, '일찍'],
      [2, '또 없음'],
    ]);
    expect(first[0].time).toEqual({ start: { precision: 'date', date: '2027-05-01' } });
    expect(validateAsCreateTrip(trip).kind).toBe('CreateTrip');
  });

  it('장소 칸은 메모 앞에 [장소: 값]으로 남고 placeLinks는 비어 있다', () => {
    const trip = createdTrip(
      oneDay(act('', '가', '관광', { place: '구시다 신사', memo: '아침에' }), act('', '나', '관광', { place: '시장' })),
    );
    expect(trip.initialPlan.items.map((item) => item.summary)).toEqual(['[장소: 구시다 신사] 아침에', '[장소: 시장]']);
    expect(trip.initialPlan.items.every((item) => item.placeLinks.length === 0)).toBe(true);
  });

  it('예약 칸과 링크 칸은 각각 reservationText·officialUrl로 저장된다', () => {
    const trip = createdTrip(
      oneDay(act('', '가', '관광', { reservation: '예약 필요', link: 'https://example.com/x' })),
    );
    expect(trip.initialPlan.items[0]).toMatchObject({
      reservationText: '예약 필요',
      officialUrl: 'https://example.com/x',
    });
  });

  it('(+1) 일정은 끝이 다음 날 날짜로 저장된다', () => {
    const trip = createdTrip(oneDay(act('23:30-00:20(+1)', '야경', '관광')));
    expect(trip.initialPlan.items[0].time.end).toMatchObject({ date: '2027-05-02', localTime: '00:20' });
    validateAsCreateTrip(trip);
  });

  it('숙소 지역·예약은 체크인 날 숙박 활동 메모에 덧붙인다', () => {
    const row = '|  | 2027-05-01 | 2027-05-03 | 호텔 A | 하카타 | 예약 필요 |';
    const trip = createdTrip(withStays(oneDay(act('15:00', '체크인', '숙박', { memo: '로비' })), [row]));
    expect(trip.initialPlan.items[0].summary).toBe('로비 [숙소 지역: 하카타] [숙소 예약: 예약 필요]');
    expect(trip.preview.memoAdditions).toEqual([
      { date: '2027-05-01', activityTitle: '체크인', text: '[숙소 지역: 하카타] [숙소 예약: 예약 필요]' },
    ]);
    expect(trip.preview.addedActivities).toEqual([]);
    expect(trip.initialPlan.stays).toHaveLength(1);
    expect(trip.initialPlan.stays[0]).toMatchObject({ baseText: '호텔 A', plannedNights: 2 });
    validateAsCreateTrip(trip);
  });

  it('체크인 날에 숙박 줄이 없으면 맨 끝에 활동을 만든다', () => {
    const row = '|  | 2027-05-01 | 2027-05-02 | 호텔 B | 후쿠오카 |  |';
    const trip = createdTrip(withStays(oneDay(act('', '가', '관광')), [row]));
    expect(trip.initialPlan.items.map((item) => [item.order, item.title, item.category, item.summary])).toEqual([
      [0, '가', '관광', ''],
      [1, '숙소: 호텔 B', '숙박', '[숙소 지역: 후쿠오카]'],
    ]);
    expect(trip.preview.addedActivities).toEqual([{ date: '2027-05-01', title: '숙소: 호텔 B' }]);
    validateAsCreateTrip(trip);
  });

  it('지역·예약 두 칸이 비면 아무것도 덧붙이지 않는다', () => {
    const row = '|  | 2027-05-01 | 2027-05-02 | 호텔 C |  |  |';
    const trip = createdTrip(withStays(oneDay(act('', '가', '관광')), [row]));
    expect(trip.initialPlan.items).toHaveLength(1);
    expect(trip.initialPlan.stays).toHaveLength(1);
    expect(trip.preview).toEqual({ addedActivities: [], memoAdditions: [] });
  });

  it('숙소만 있는 새 여행 파일도 만들어진다 (AC-12 일부)', () => {
    const text = [
      '# 여행: 숙소만',
      '- 양식: travel-app-plan/1',
      '- 기간: 2027-05-01 ~ 2027-05-03',
      '',
      '## 숙소',
      '| ID | 체크인 | 체크아웃 | 이름 |',
      '|---|---|---|---|',
      '|  | 2027-05-01 | 2027-05-03 | 호텔 |',
    ].join('\n');
    const trip = createdTrip(text);
    expect(trip.initialPlan.items).toEqual([]);
    expect(trip.initialPlan.stays).toHaveLength(1);
    validateAsCreateTrip(trip);
  });

  it('머리 줄이 온전하지 않거나 rejected이면 만들지 않는다', () => {
    const noPeriod = oneDay(act('', '가', '관광')).replace('- 기간: 2027-05-01 ~ 2027-05-03\n', '');
    expect(toNewTrip(check(noPeriod)).ok).toBe(false);
    expect(toNewTrip(check('아무 글')).ok).toBe(false);
  });

  it('표 오류로 빠진 날짜가 있어도 나머지로 새 여행을 만들 수 있다', () => {
    const text = newPlan({
      days: [
        { heading: DAY1, rows: [act('10:00-10:00', '나쁜 줄', '관광')] },
        { heading: '2027-05-02 정상', rows: [act('', '좋은 줄', '관광')] },
      ],
    });
    const trip = createdTrip(text);
    expect(trip.initialPlan.items.map((item) => item.title)).toEqual(['좋은 줄']);
    validateAsCreateTrip(trip);
  });
});
