// R1: 장거리 이동으로 얻는 도착·출발·이동 구간. 거부할 제안은 거부하고 허용할 제안은 허용하는지 함께 단언한다.
import { expect, it } from 'vitest';
import { buildAiV2Payload } from '../src/ai-v2-context';
import { validateAiV2Output } from '../src/ai-v2-semantics';
import { aiV2Fixture } from './fixtures/ai-v2';

type Row = [id: string, start: string];
type Link = [from: string, to: string, mode: string];

/** 첫째 날을 주어진 활동·이동으로 바꾼 뒤 실제 빌더로 전송 내용을 만든다. */
async function dayOf(rows: Row[], links: Link[]) {
  const fixture = await aiV2Fixture();
  const plan = fixture.dataset.plans[0];
  const day = plan.days[0];
  const template = plan.items[0];
  plan.items = [
    ...plan.items.filter((item) => item.dayId !== day.dayId),
    ...rows.map(([activityId, localTime], order) => ({
      ...structuredClone(template),
      activityId,
      dayId: day.dayId,
      order,
      bookingIds: [],
      taskRefs: [],
      time: { start: { precision: 'local' as const, date: day.date, localTime, timeZoneStatus: 'unknown' as const } },
    })),
  ];
  plan.legs = links.map(([fromActivityId, toActivityId, mode], index) => ({
    ...plan.legs[0],
    legId: `leg-${index}`,
    dayId: day.dayId,
    fromActivityId,
    toActivityId,
    mode,
  }));
  const { planning } = buildAiV2Payload(fixture.dataset, {
    prompt: '요청',
    requestKind: 'add',
    fromDate: day.date,
    count: 1,
  });
  const verdict = (startTime: string, endTime: string | null = null) => {
    const output = structuredClone(fixture.output);
    output.operations[0] = {
      ...output.operations[0],
      type: 'add',
      activityId: '',
      dayId: day.dayId,
      placeId: null,
      startTime,
      endTime,
    };
    try {
      validateAiV2Output(planning, output, fixture.research.sources);
      return 'allowed';
    } catch {
      return 'rejected';
    }
  };
  return { day: planning.days[0], verdict };
}

function expectOrdered(day: { arrival?: string | null; departure?: string | null }) {
  if (day.arrival && day.departure) {
    expect(day.arrival <= day.departure).toBe(true);
  }
}

it('이동 1회·오전 도착: 도착 전은 거부하고 그 뒤는 허용한다', async () => {
  const { day, verdict } = await dayOf(
    [
      ['airport', '07:00'],
      ['hotel', '09:00'],
      ['lunch', '12:00'],
    ],
    [['airport', 'hotel', 'flight']],
  );
  expect(day.arrival).toBe('09:00');
  expect(day.departure ?? null).toBeNull();
  expectOrdered(day);
  expect(verdict('08:00')).toBe('rejected');
  expect(verdict('10:00')).toBe('allowed');
  expect(verdict('20:00')).toBe('allowed');
});

it('이동 1회·오후 출발: 출발 뒤는 거부하고 그 전은 허용한다', async () => {
  const { day, verdict } = await dayOf(
    [
      ['museum', '09:00'],
      ['station', '15:00'],
      ['destination', '18:00'],
    ],
    [['station', 'destination', 'train']],
  );
  expect(day.departure).toBe('15:00');
  expect(day.arrival ?? null).toBeNull();
  expectOrdered(day);
  expect(verdict('10:00', '11:00')).toBe('allowed');
  expect(verdict('14:00', '15:00')).toBe('allowed');
  expect(verdict('16:00')).toBe('rejected');
});

it('이동 1회가 낮에 끼면 이동 구간만 거부하고 앞뒤는 허용한다', async () => {
  const { day, verdict } = await dayOf(
    [
      ['museum', '09:00'],
      ['station', '13:00'],
      ['destination', '16:00'],
      ['dinner', '18:00'],
    ],
    [['station', 'destination', 'train']],
  );
  expectOrdered(day);
  expect(verdict('10:00', '11:00')).toBe('allowed');
  expect(verdict('14:00', '15:00')).toBe('rejected');
  expect(verdict('12:00', '14:00')).toBe('rejected');
  expect(verdict('17:00', '18:00')).toBe('allowed');
});

it('이동 2회: 이동 사이가 별도 창이고 하나로 합치지 않는다', async () => {
  const { day, verdict } = await dayOf(
    [
      ['a', '08:00'],
      ['b', '11:00'],
      ['c', '14:00'],
      ['d', '16:00'],
      ['e', '20:00'],
    ],
    [
      ['a', 'b', 'flight'],
      ['c', 'd', 'train'],
    ],
  );
  expect(day.arrival).toBe('11:00');
  expectOrdered(day);
  expect(verdict('07:00')).toBe('rejected');
  expect(verdict('12:00', '13:00')).toBe('allowed');
  expect(verdict('15:00')).toBe('rejected');
  expect(verdict('13:00', '15:00')).toBe('rejected');
  expect(verdict('17:00', '19:00')).toBe('allowed');
});

it('이동 뒤 활동 없음: 도착만 있고 그 뒤는 제약이 없다', async () => {
  const { day, verdict } = await dayOf(
    [
      ['station', '13:00'],
      ['hotel', '16:00'],
    ],
    [['station', 'hotel', 'train']],
  );
  expect(day.arrival).toBe('16:00');
  expect(day.departure ?? null).toBeNull();
  expect(verdict('14:00')).toBe('rejected');
  expect(verdict('17:00')).toBe('allowed');
  expect(verdict('23:00')).toBe('allowed');
});

it('이동 없음: 창이 없어 모든 시각을 허용한다', async () => {
  const { day, verdict } = await dayOf(
    [
      ['a', '09:00'],
      ['b', '12:00'],
    ],
    [['a', 'b', 'walk']],
  );
  expect(day.arrival ?? null).toBeNull();
  expect(day.departure ?? null).toBeNull();
  expect(verdict('06:00')).toBe('allowed');
  expect(verdict('22:00')).toBe('allowed');
});
