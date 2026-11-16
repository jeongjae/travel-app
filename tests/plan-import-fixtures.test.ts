import { describe, expect, it } from 'vitest';
import { check, createdTrip, errorCodes, fixture, validateAsCreateTrip, warningCodes } from './plan-import-helpers';

/** 파일 글에서 구역별 표의 데이터 줄 수를 독립적으로 센다(변환기와 별개의 계산). */
function countTableRows(text: string) {
  const counts: Record<string, number> = {};
  let section = '';
  let inTable = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      inTable = 0;
    } else if (line.startsWith('|')) {
      inTable++;
      if (inTable > 2) {
        counts[section] = (counts[section] ?? 0) + 1;
      }
    } else {
      inTable = 0;
    }
  }
  return counts;
}

const NEW_FILES = ['chatgpt-t1-run2.md', 'claude-t1-run2.md'];
const UPDATE_FILES = ['chatgpt-t2-run2.md', 'claude-t2-run2.md', 'chatgpt-t3-run2.md', 'claude-t3-run2.md'];

describe.each(NEW_FILES)('새 여행 고정 자료 %s', (name) => {
  const text = fixture(name);
  const file = check(text);
  const counts = countTableRows(text);

  it('오류·경고 0건으로 새 여행으로 분류된다 (AC-01)', () => {
    expect(file.kind).toBe('new');
    expect(file.issues).toEqual([]);
    expect(file.saveable).toBe(true);
    expect(file.dropped).toEqual([]);
  });

  it('활동·숙소·장소 줄 수가 파일의 표와 같다', () => {
    expect(file.days.reduce((sum, day) => sum + day.rows.length, 0)).toBe(counts['일정']);
    expect(file.stays).toHaveLength(counts['숙소']);
    expect(file.places).toHaveLength(counts['장소']);
  });

  it('## 이동은 읽지 않고 notImported에 줄 수와 함께 남는다', () => {
    expect(file.notImported).toEqual([{ kind: 'section', name: '이동', lineCount: counts['이동'] }]);
  });

  it('새 여행으로 변환되고 CreateTrip 명령 검증을 통과한다', () => {
    const trip = createdTrip(text);
    expect(validateAsCreateTrip(trip).kind).toBe('CreateTrip');
    const planned = trip.initialPlan.items.length;
    expect(planned).toBe(counts['일정'] + trip.preview.addedActivities.length);
    expect(trip.initialPlan.stays).toHaveLength(counts['숙소']);
  });
});

describe('T1 숙소의 지역·예약 원문 (규격 §5-1)', () => {
  it.each(NEW_FILES)('%s: 원문이 체크인 날 숙박 활동 메모에 남고 숙박은 이름·기간으로 저장된다', (name) => {
    const text = fixture(name);
    const file = check(text);
    const stay = file.stays[0];
    const trip = createdTrip(text);
    const saved = trip.initialPlan.stays[0];
    expect(saved.baseText).toBe(stay.name);
    expect(saved.time.start).toEqual({ precision: 'date', date: stay.checkIn });
    expect(saved.time.end).toEqual({ precision: 'date', date: stay.checkOut });
    expect(saved.regionId).toBeUndefined();
    expect(saved.bookingId).toBeUndefined();
    const memoTexts = trip.preview.memoAdditions.map((addition) => addition.text);
    const added = trip.preview.addedActivities;
    const expectedRegion = stay.region === '' ? undefined : `[숙소 지역: ${stay.region}]`;
    const expectedBooking = stay.booking === '' ? undefined : `[숙소 예약: ${stay.booking}]`;
    const target = trip.initialPlan.items.filter((item) => item.summary.includes('[숙소 '));
    expect(target).toHaveLength(1);
    expect(target[0].category).toBe('숙박');
    if (expectedRegion) {
      expect(target[0].summary).toContain(expectedRegion);
    }
    if (expectedBooking) {
      expect(target[0].summary).toContain(expectedBooking);
    }
    expect(memoTexts.length + added.length).toBe(1);
  });
});

describe.each(UPDATE_FILES)('수정 고정 자료 %s', (name) => {
  const file = check(fixture(name));

  it('update로 분류되고 오류 0건이며 새 여행으로는 만들 수 없다', () => {
    expect(file.kind).toBe('update');
    expect(errorCodes(file)).toEqual([]);
    expect(file.saveable).toBe(false);
    expect(file.resolved.baseRevision).toBe(12);
  });
});

describe('수정 고정 자료의 줄 내용', () => {
  it('claude-t2-run2: 메모만 바뀐 줄 + 시간 없는 새 줄', () => {
    const rows = check(fixture('claude-t2-run2.md')).days[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'a1f0c2d4-0001-4a10-9b01-000000000005',
      memo: '13시 이후가 덜 붐빔',
      title: '',
    });
    expect(rows[1]).toMatchObject({ id: '', title: '저녁 식사', category: '식사', memo: '' });
  });

  it('chatgpt-t2-run2: 메모 수정 줄과 시간 있는 새 줄', () => {
    const rows = check(fixture('chatgpt-t2-run2.md')).days[0].rows;
    expect(rows[0]).toMatchObject({ id: 'a1f0c2d4-0001-4a10-9b01-000000000005', memo: '13시 이후가 덜 붐빔' });
    expect(rows[1]).toMatchObject({ id: '', time: '19:00-20:00', memo: '식당 미정' });
    expect(rows[1].span).toEqual({ startMinute: 19 * 60, endMinute: 20 * 60, overnight: false });
  });

  it.each(['chatgpt-t3-run2.md', 'claude-t3-run2.md'])('%s: 링크 (비움)과 삭제 줄', (name) => {
    const file = check(fixture(name));
    expect(file.days[0].rows[0]).toMatchObject({
      id: 'a1f0c2d4-0001-4a10-9b01-000000000002',
      link: '',
      cleared: ['링크'],
    });
    expect(file.deletions).toHaveLength(1);
    expect(file.deletions[0]).toMatchObject({ kind: '활동', id: 'a1f0c2d4-0001-4a10-9b01-000000000006' });
  });
});

describe('1회차 고정 자료는 거부 또는 오류', () => {
  it('chatgpt-t2-run1: 양식 줄이 없어 양식 아님으로 거부', () => {
    const file = check(fixture('chatgpt-t2-run1.md'));
    expect(file.kind).toBe('rejected');
    expect(file.rejection?.code).toBe('not-plan');
    expect(file.saveable).toBe(false);
    expect(file.days).toEqual([]);
  });

  it('claude-t3-run1: 삭제 표의 필수 열(종류)이 없어 그 표만 오류, 나머지는 읽힌다', () => {
    const file = check(fixture('claude-t3-run1.md'));
    expect(file.kind).toBe('update');
    expect(errorCodes(file)).toEqual(['column-missing']);
    expect(file.issues[0]).toMatchObject({ section: '삭제', line: 19 });
    expect(file.deletions).toEqual([]);
    expect(file.dropped).toEqual([{ section: '삭제', label: '삭제', line: 19, rowCount: 1 }]);
    expect(file.days[0].rows).toHaveLength(1);
    const names = file.notImported.map((item) => `${item.kind}:${item.name}`);
    expect(names).toEqual(['header:범위', 'column:구분', 'column:날짜']);
    expect(warningCodes(file)).toEqual([]);
  });
});

it('같은 글을 두 번 해석하면 결과가 같다', () => {
  for (const name of [...NEW_FILES, ...UPDATE_FILES, 'claude-t3-run1.md', 'chatgpt-t2-run1.md']) {
    expect(check(fixture(name))).toEqual(check(fixture(name)));
  }
});
