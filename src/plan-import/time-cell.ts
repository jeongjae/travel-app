import { Temporal } from '@js-temporal/polyfill';
import { timeSpecSchema, type TimeSpec } from '../contracts/v2';
import { nextDay } from '../content/quick-time';
import type { TimeSpan } from './types';

export const MAX_SPAN_MINUTES = 12 * 60;
const MINUTES_PER_DAY = 24 * 60;

const SINGLE_TIME = /^(\d{2}):(\d{2})$/;
const RANGE_TIME = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})(\(\+1\))?$/;

export type TimeCellResult = { ok: true; span?: TimeSpan } | { ok: false; code: string; message: string };

function toMinute(hour: string, minute: string) {
  const hours = Number(hour);
  const minutes = Number(minute);
  if (hours > 23 || minutes > 59) {
    return undefined;
  }
  return hours * 60 + minutes;
}

function invalid(code: string, message: string): TimeCellResult {
  return { ok: false, code, message };
}

/** 시간 칸의 4가지 표현(빈 칸·`HH:MM`·`HH:MM-HH:MM`·`HH:MM-HH:MM(+1)`)만 읽는다. */
export function parseTimeCell(cell: string): TimeCellResult {
  if (cell === '') {
    return { ok: true };
  }
  const single = SINGLE_TIME.exec(cell);
  if (single) {
    const start = toMinute(single[1], single[2]);
    if (start === undefined) {
      return invalid('time-invalid', `시간 "${cell}"은 24시간제 HH:MM이어야 합니다.`);
    }
    return { ok: true, span: { startMinute: start, overnight: false } };
  }
  const range = RANGE_TIME.exec(cell);
  if (!range) {
    return invalid(
      'time-invalid',
      `시간 "${cell}"을 읽을 수 없습니다. 빈 칸, HH:MM, HH:MM-HH:MM, HH:MM-HH:MM(+1)만 쓸 수 있습니다.`,
    );
  }
  const start = toMinute(range[1], range[2]);
  const rawEnd = toMinute(range[3], range[4]);
  if (start === undefined || rawEnd === undefined) {
    return invalid('time-invalid', `시간 "${cell}"은 24시간제 HH:MM이어야 합니다.`);
  }
  const overnight = range[5] !== undefined;
  if (!overnight && rawEnd === start) {
    return invalid('time-zero', `시간 "${cell}"의 길이가 0입니다. 시작과 끝이 같을 수 없습니다.`);
  }
  if (!overnight && rawEnd < start) {
    return invalid('time-reversed', `시간 "${cell}"의 끝이 시작보다 이릅니다. 자정을 넘으면 (+1)을 붙입니다.`);
  }
  const end = overnight ? rawEnd + MINUTES_PER_DAY : rawEnd;
  if (end - start > MAX_SPAN_MINUTES) {
    return invalid('time-too-long', `시간 "${cell}"이 12시간을 넘습니다.`);
  }
  return { ok: true, span: { startMinute: start, endMinute: end, overnight } };
}

function clockText(minute: number) {
  const inDay = minute % MINUTES_PER_DAY;
  const hours = String(Math.floor(inDay / 60)).padStart(2, '0');
  const minutes = String(inDay % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

type SpecContext = { date: string; timeZone?: string };

function localSpec(date: string, minute: number, timeZone?: string): TimeSpec {
  const base = { precision: 'local' as const, date, localTime: clockText(minute) };
  if (timeZone) {
    return { ...base, timeZone, timeZoneStatus: 'confirmed' };
  }
  return { ...base, timeZoneStatus: 'unknown' };
}

/** 시간 칸이 비면 날짜만, 있으면 현지 시각(시간대 확인 여부 포함)으로 만든다. */
export function buildActivityTime(span: TimeSpan | undefined, context: SpecContext) {
  if (!span) {
    return { start: { precision: 'date' as const, date: context.date } };
  }
  const start = localSpec(context.date, span.startMinute, context.timeZone);
  if (span.endMinute === undefined) {
    return { start };
  }
  const endDate = span.endMinute >= MINUTES_PER_DAY ? nextDay(context.date) : context.date;
  return { start, end: localSpec(endDate, span.endMinute, context.timeZone) };
}

/** 저장 스키마가 받아들이는 시각인지 확인한다(예: 건너뛰는 서머타임 시각). */
export function timeSpecProblem(span: TimeSpan | undefined, context: SpecContext): string | undefined {
  if (!span) {
    return undefined;
  }
  const time = buildActivityTime(span, context);
  for (const spec of [time.start, 'end' in time ? time.end : undefined]) {
    if (spec && !timeSpecSchema.safeParse(spec).success) {
      return '확인된 시간대에 존재하지 않는 현지 시각입니다.';
    }
  }
  return undefined;
}

/** 같은 날 안에서 두 시간 구간이 겹치는지. 길이 없는 단독 시각은 겹침으로 보지 않는다. */
export function spansOverlap(a: TimeSpan, b: TimeSpan) {
  if (a.endMinute === undefined || b.endMinute === undefined) {
    return false;
  }
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  try {
    Temporal.PlainDate.from(value, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}
