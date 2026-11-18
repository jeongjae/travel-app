import type { PlanVersion, TimeSpec } from '../contracts/v2';
import { nextDay } from '../content/quick-time';
import { MAX_SPAN_MINUTES } from '../plan-import/time-cell';
import { CLEAR_MARK } from '../plan-import/table';

type PlanItem = PlanVersion['items'][number];
type TimeRange = PlanItem['time'];

const MINUTES_PER_DAY = 24 * 60;
const PLACE_MARK = /^\[장소: ([^\]]+)\](?: (.*))?$/s;

/** 양식 표에 적히는 활동 한 줄의 칸 값(칸 안 글 규칙 적용 전). */
export type ActivityCells = {
  time: string;
  title: string;
  category: string;
  place: string;
  memo: string;
  reservation: string;
  link: string;
};

export type CellNote = { code: 'time-unrepresentable'; message: string };

export type ActivityCellsResult = { cells: ActivityCells; notes: CellNote[] };

export type CellContext = {
  /** 그 활동이 든 날의 날짜. 시간 칸은 이 날짜 기준이다. */
  date: string;
  /** 연결된 장소 id → 이름. 없는 id는 연결 없음으로 본다. */
  placeNames: ReadonlyMap<string, string>;
  includeReservation: boolean;
};

type LocalPoint = { date: string; minute: number };

function minuteOf(localTime: string) {
  const [hours, minutes] = localTime.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function clock(minute: number) {
  const inDay = minute % MINUTES_PER_DAY;
  return `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`;
}

/** 시각을 분 단위 현지 시각으로 읽는다. 초가 0이 아니거나 시각이 없으면 undefined. */
function pointOf(spec: TimeSpec): LocalPoint | undefined {
  if (spec.precision !== 'local' && spec.precision !== 'instant') {
    return undefined;
  }
  const seconds = spec.localTime.split(':')[2];
  if (seconds !== undefined && Number(seconds) !== 0) {
    return undefined;
  }
  return { date: spec.date, minute: minuteOf(spec.localTime) };
}

function describeSpec(spec: TimeSpec) {
  if (spec.precision === 'text') {
    return spec.rawText;
  }
  if (spec.precision === 'local' || spec.precision === 'instant') {
    return `${spec.date} ${spec.localTime}`;
  }
  return spec.date ?? '미정';
}

function describeRange(time: TimeRange) {
  const start = describeSpec(time.start);
  return time.end ? `${start} ~ ${describeSpec(time.end)}` : start;
}

type TimeCell = { text: string } | { problem: string };

/** 내부 시간 → 규격의 4표현. 표현할 수 없으면 `problem`에 원래 시간을 글로 돌려준다. */
export function timeCellOf(time: TimeRange, date: string): TimeCell {
  const { start, end } = time;
  if (start.precision === 'date' || start.precision === 'unspecified') {
    return end ? { problem: describeRange(time) } : { text: '' };
  }
  const from = pointOf(start);
  if (!from || from.date !== date) {
    return { problem: describeRange(time) };
  }
  if (!end) {
    return { text: clock(from.minute) };
  }
  const to = pointOf(end);
  if (!to) {
    return { problem: describeRange(time) };
  }
  const endMinute = to.date === date ? to.minute : to.date === nextDay(date) ? to.minute + MINUTES_PER_DAY : undefined;
  if (endMinute === undefined || endMinute <= from.minute || endMinute - from.minute > MAX_SPAN_MINUTES) {
    return { problem: describeRange(time) };
  }
  const overnight = endMinute >= MINUTES_PER_DAY ? '(+1)' : '';
  return { text: `${clock(from.minute)}-${clock(endMinute)}${overnight}` };
}

function joinText(parts: string[]) {
  return parts.filter((part) => part !== '').join(' ');
}

function linkedPlaceName(item: PlanItem, placeNames: ReadonlyMap<string, string>) {
  const links = [...item.placeLinks].sort((a, b) => Number(b.relation === 'visit') - Number(a.relation === 'visit'));
  for (const link of links) {
    const name = placeNames.get(link.placeId);
    if (name) {
      return name;
    }
  }
  return undefined;
}

/**
 * 장소 칸: 연결된 장소의 이름. 없고 메모가 `[장소: X]`로 시작하면 X를 장소 칸으로 올리고 메모에서는 뺀다.
 * 다시 가져올 때 같은 규칙으로 메모 앞에 돌아가므로 변경이 없다(결정 G-b).
 */
function splitPlaceAndMemo(item: PlanItem, placeNames: ReadonlyMap<string, string>) {
  const linked = linkedPlaceName(item, placeNames);
  if (linked !== undefined) {
    return { place: linked, memo: item.summary };
  }
  const marked = PLACE_MARK.exec(item.summary.trim());
  if (marked) {
    return { place: marked[1].trim(), memo: (marked[2] ?? '').trim() };
  }
  return { place: '', memo: item.summary };
}

export function activityCellsOf(item: PlanItem, context: CellContext): ActivityCellsResult {
  const { place, memo } = splitPlaceAndMemo(item, context.placeNames);
  const time = timeCellOf(item.time, context.date);
  const notes: CellNote[] = [];
  let memoText = memo.trim();
  if ('problem' in time) {
    memoText = joinText([memoText, `[원래 시간: ${time.problem}]`]);
    notes.push({
      code: 'time-unrepresentable',
      message: `시간을 양식으로 적을 수 없어 시간 칸을 비우고 메모 끝에 원래 시간을 적었습니다(${time.problem}).`,
    });
  }
  return {
    cells: {
      time: 'text' in time ? time.text : '',
      title: item.title.trim(),
      category: item.category.trim(),
      place,
      memo: memoText,
      reservation: context.includeReservation ? (item.reservationText ?? '').trim() : '',
      link: (item.officialUrl ?? '').trim(),
    },
    notes,
  };
}

/** 칸 안 글을 표에 쓸 수 있게 한다. 줄바꿈은 공백으로(바뀌면 changed), `|`는 `\|`, 글자 그대로의 `(비움)`은 `\(비움)`. */
export function tableCell(value: string): { text: string; changed: boolean } {
  const flat = value.replace(/\r\n|\r|\n/g, ' ');
  const changed = flat !== value;
  const trimmed = flat.trim();
  const marked = trimmed === CLEAR_MARK ? `\\${CLEAR_MARK}` : trimmed;
  return { text: marked.replace(/\|/g, '\\|'), changed };
}
