// R2: 화면에서 비운 도착·출발은 전송 본문에 키 자체가 없어야 하고, 보이는 값과 보내는 값이 같아야 한다.
import { expect, it } from 'vitest';
import { buildAiV2Payload, deriveDayTimes, displayedDayTimes } from '../src/ai-v2-context';
import { validateAiV2Output } from '../src/ai-v2-semantics';
import { aiV2Fixture } from './fixtures/ai-v2';

/** 첫째 날이 항공 이동으로 시작하는 가상 여행. 추정 도착은 14:20이다. */
async function flightDay() {
  const fixture = await aiV2Fixture();
  const plan = fixture.dataset.plans[0];
  const day = plan.days[0];
  plan.legs[0].mode = 'flight';
  plan.items[0].bookingIds = [];
  plan.items[0].taskRefs = [];
  plan.items[1].time = {
    start: { precision: 'local', date: day.date, localTime: '14:20', timeZoneStatus: 'unknown' },
  };
  return { fixture, day, plan };
}

function payload(fixture: Awaited<ReturnType<typeof aiV2Fixture>>, dayTimes?: Parameters<typeof displayedDayTimes>[2]) {
  return buildAiV2Payload(fixture.dataset, {
    prompt: '요청',
    requestKind: 'edit',
    fromDate: fixture.dataset.header.startDate,
    count: 1,
    dayTimes,
  });
}

it('입력을 비우면 추정값이 있어도 본문에 키가 없다', async () => {
  const { fixture, day, plan } = await flightDay();
  expect(deriveDayTimes(plan, day).arrival).toBe('14:20');
  const { planning } = payload(fixture, { [day.dayId]: { arrival: '' } });
  expect(Object.keys(planning.days[0])).not.toContain('arrival');
  expect(JSON.stringify(planning.days[0])).not.toContain('14:20');
});

it('얻은 값이 없는 날은 도착·출발 키가 없다(null도 보내지 않는다)', async () => {
  const { fixture } = await flightDay();
  const plan = fixture.dataset.plans[0];
  plan.legs = [];
  const { planning } = payload(fixture);
  expect(Object.keys(planning.days[0])).not.toContain('arrival');
  expect(Object.keys(planning.days[0])).not.toContain('departure');
  expect(Object.keys(planning.days[0])).not.toContain('blocked');
});

it.each([
  ['채운 경우', { arrival: '15:00' }, '15:00'],
  ['추정값 그대로', undefined, '14:20'],
  ['비운 경우', { arrival: '' }, undefined],
])('화면 표시값과 전송값이 같다: %s', async (_name, entered, expected) => {
  const { fixture, day, plan } = await flightDay();
  const dayTimes = entered ? { [day.dayId]: entered } : undefined;
  const shown = displayedDayTimes(plan, day, dayTimes);
  const { planning } = payload(fixture, dayTimes);
  expect(shown.arrival || undefined).toBe(expected);
  expect(planning.days[0].arrival).toBe(expected);
  expect(shown.arrivalEstimated).toBe(entered === undefined);
});

it('비운 쪽은 검증 제약으로 쓰지 않는다', async () => {
  const { fixture, day } = await flightDay();
  const output = structuredClone(fixture.output);
  output.operations[0] = { ...output.operations[0], startTime: '09:00', endTime: '10:00', placeId: null };
  const inferred = payload(fixture);
  expect(() => validateAiV2Output(inferred.planning, output, fixture.research.sources)).toThrow('도착 시각');
  const cleared = payload(fixture, { [day.dayId]: { arrival: '' } });
  expect(() => validateAiV2Output(cleared.planning, output, fixture.research.sources)).not.toThrow();
});

it('이동 구간 제약을 끄면 본문에서 빠진다', async () => {
  const { fixture, day, plan } = await flightDay();
  const template = plan.items[0];
  plan.items = plan.items.filter((item) => item.dayId !== day.dayId);
  const times = ['09:00', '13:00', '16:00', '18:00'];
  times.forEach((localTime, order) => {
    plan.items.push({
      ...structuredClone(template),
      activityId: `row-${order}`,
      dayId: day.dayId,
      order,
      time: { start: { precision: 'local', date: day.date, localTime, timeZoneStatus: 'unknown' } },
    });
  });
  plan.legs = [{ ...plan.legs[0], fromActivityId: 'row-1', toActivityId: 'row-2', mode: 'train' }];
  expect(payload(fixture).planning.days[0].blocked).toEqual([{ from: '13:00', to: '16:00' }]);
  const off = payload(fixture, { [day.dayId]: { ignoreTransit: true } }).planning.days[0];
  expect(Object.keys(off)).not.toContain('blocked');
  expect(displayedDayTimes(plan, day, { [day.dayId]: { ignoreTransit: true } }).blocked).toEqual([]);
});

it('CL-28: 자정을 넘는 낮 이동 구간은 버리지 않고 그날의 출발 시각이 된다', async () => {
  const { fixture, day, plan } = await flightDay();
  const template = plan.items[0];
  plan.items = plan.items.filter((item) => item.dayId !== day.dayId);
  const times = ['09:00', '22:30', '01:10', '08:00'];
  times.forEach((localTime, order) => {
    plan.items.push({
      ...structuredClone(template),
      activityId: `row-${order}`,
      dayId: day.dayId,
      order,
      time: { start: { precision: 'local', date: day.date, localTime, timeZoneStatus: 'unknown' } },
    });
  });
  plan.legs = [{ ...plan.legs[0], fromActivityId: 'row-1', toActivityId: 'row-2', mode: 'night train' }];
  const derived = deriveDayTimes(plan, day);
  expect(derived.blocked).toEqual([]);
  expect(derived.departure).toBe('22:30');
  expect(payload(fixture).planning.days[0].departure).toBe('22:30');
});
