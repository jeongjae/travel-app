import { readFileSync } from 'node:fs';
import { validateCommand } from '../src/contracts/v2';
import { checkPlanFile, parsePlanFile, toNewTrip } from '../src/plan-import';
import type { CheckedPlanFile, NewTripResult } from '../src/plan-import';

export function fixture(name: string) {
  return readFileSync(`tests/fixtures/plan-format/${name}`, 'utf8');
}

export function check(text: string): CheckedPlanFile {
  return checkPlanFile(parsePlanFile(text));
}

export function errorCodes(file: CheckedPlanFile) {
  return file.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code);
}

export function warningCodes(file: CheckedPlanFile) {
  return file.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code);
}

/** 줄 번호만 다른 결과를 같은 것으로 비교하기 위해 줄 번호 키를 뺀다. */
export function withoutLines(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, inner) => (key === 'line' || key === 'tableLine' ? undefined : inner));
}

export function createdTrip(text: string) {
  const result = toNewTrip(check(text));
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result;
}

export function validateAsCreateTrip(result: Extract<NewTripResult, { ok: true }>) {
  return validateCommand({
    format: 'travel-app-command',
    commandVersion: 2,
    normalizationVersion: 'c02',
    tripId: result.header.tripId,
    requestId: crypto.randomUUID(),
    kind: 'CreateTrip',
    payload: { header: result.header, initialPlan: result.initialPlan },
  });
}

type DayInput = { heading: string; rows: string[] };

const ACTIVITY_HEADER = '| ID | 시간 | 제목 | 종류 | 장소 | 메모 | 예약 | 링크 |\n|---|---|---|---|---|---|---|---|';

/** 활동 줄 `시간 | 제목 | 종류 | 장소 | 메모 | 예약 | 링크`만 적어 새 여행 글을 만든다. */
export function newPlan(options: {
  days: DayInput[];
  period?: string;
  zone?: string | null;
  headerLines?: string[];
  after?: string;
}) {
  const period = options.period ?? '2027-05-01 ~ 2027-05-03';
  const zone = options.zone === null ? [] : [`- 시간대: ${options.zone ?? 'Asia/Tokyo'}`];
  const head = [
    '# 여행: 시험 여행',
    '- 양식: travel-app-plan/1',
    `- 기간: ${period}`,
    ...zone,
    ...(options.headerLines ?? []),
  ];
  const days = options.days.flatMap((day) => [
    `### ${day.heading}`,
    ACTIVITY_HEADER,
    ...day.rows.map((row) => `|  | ${row} |`),
    '',
  ]);
  return [...head, '', '## 일정', ...days, options.after ?? ''].join('\n');
}

/** newPlan의 `rows` 한 줄(시간 · 제목 · 종류 · 장소 · 메모 · 예약 · 링크). */
export function act(
  time: string,
  title: string,
  category: string,
  extra: { place?: string; memo?: string; reservation?: string; link?: string } = {},
) {
  const cells = [time, title, category, extra.place ?? '', extra.memo ?? '', extra.reservation ?? '', extra.link ?? ''];
  return cells.join(' | ');
}
