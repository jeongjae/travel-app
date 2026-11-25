import {
  formatLineValue,
  isPrepFileText,
  MAX_INPUT_CHARS,
  MAX_INPUT_LINES,
  PREP_FORMAT,
  splitSourceLines,
} from '../plan-import/input-text';
import {
  COMPANION_OPTIONS,
  INTEREST_OPTIONS,
  PACE_OPTIONS,
  STAY_PRIORITY_OPTIONS,
  STAY_TYPE_OPTIONS,
  TRANSPORT_OPTIONS,
} from '../plan-import/travel-brief';
import { pickLastAnswers, type LastAnswers } from '../plan-import/prep-helpers';
import { readRawTable } from '../plan-import/table';
import type { SourceLine } from '../plan-import/types';
import type { PrepState } from './draft';
import { parseGuide } from './parse';
import { CHOICE_LABEL, countByChoice, CHOICES, type Choice, type Selections } from './selection';
import type { GuideItem } from './types';

export { PREP_FORMAT } from '../plan-import/input-text';

const ANSWERS_HEADING = '취향 답';
const CHOSEN_HEADING = '고른 것';
const GUIDE_HEADING = '가이드 원문';
const ANSWER_HEADERS = ['항목', '값'];
const CHOSEN_HEADERS = ['선택', '종류', '이름', '지역'];
const LIST_SEPARATOR = /\s*[,，、]\s*/;

/** 취향 답 8칸의 표 글자. 읽을 때도 같은 이름으로 찾는다. */
const ANSWER_LABELS: Record<keyof LastAnswers, string> = {
  interests: '관심사',
  pace: '속도',
  budget: '예산',
  companion: '동행',
  headcount: '인원',
  transport: '이동수단',
  stayTypes: '숙소 유형',
  stayPriorities: '숙소 우선순위',
};
const ANSWER_ORDER = Object.keys(ANSWER_LABELS) as (keyof LastAnswers)[];

const CHOICE_BY_LABEL = new Map<string, Choice>(CHOICES.map((choice) => [CHOICE_LABEL[choice], choice]));

export type PrepFileResult =
  | { accepted: false; message: string }
  | {
      accepted: true;
      destination: string;
      guideText: string;
      items: GuideItem[];
      /** 파일 안 가이드의 항목 key 기준으로 맞춘 고른 상태. */
      selections: Selections;
      counts: Record<Choice, number>;
      /** 파일에 적힌 고른 것 중 가이드 항목과 맞지 않아 버린 줄 수. */
      dropped: number;
      /** 표에서 읽은 취향 답(선택지 밖의 값은 이미 버렸다). */
      answers: LastAnswers;
    };

function rejected(message: string): PrepFileResult {
  return { accepted: false, message };
}

function cellText(value: string) {
  return value.replace(/\r?\n|\r/g, ' ').replace(/\|/g, '\\|');
}

function answerCell(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

function answerRows(answers: LastAnswers) {
  const rows: string[] = [];
  for (const key of ANSWER_ORDER) {
    const value = answers[key];
    if (value !== undefined) {
      rows.push(`| ${ANSWER_LABELS[key]} | ${cellText(answerCell(value))} |`);
    }
  }
  return rows;
}

function chosenRows(prep: PrepState) {
  const rows: string[] = [];
  for (const item of prep.guide?.items ?? []) {
    const choice = prep.selections[item.key];
    if (choice) {
      const cells = [CHOICE_LABEL[choice], item.kind, item.name, item.area].map(cellText);
      rows.push(`| ${cells.join(' | ')} |`);
    }
  }
  return rows;
}

/** 준비 자료 파일 글. 가이드가 없으면 만들지 않는다(`undefined`). `today`는 YYYY-MM-DD. */
export function buildPrepFile(prep: PrepState, today: string): string | undefined {
  if (!prep.guide || prep.guideText.trim() === '') {
    return undefined;
  }
  const lines = [
    `# 준비 자료: ${prep.guide.destination}`,
    `- 양식: ${PREP_FORMAT}`,
    `- 만든 날: ${today}`,
    '',
    `## ${ANSWERS_HEADING}`,
    '| 항목 | 값 |',
    '|---|---|',
    ...answerRows(pickLastAnswers(prep.answers as Record<string, unknown>)),
    '',
    `## ${CHOSEN_HEADING}`,
    '| 선택 | 종류 | 이름 | 지역 |',
    '|---|---|---|---|',
    ...chosenRows(prep),
    '',
    `## ${GUIDE_HEADING}`,
    prep.guideText.trim(),
    '',
  ];
  return lines.join('\n');
}

export function prepFileName(destination: string) {
  return `준비자료-${destination}.md`;
}

function normalized(text: string) {
  return splitSourceLines(text)
    .map((entry) => entry.text)
    .join('\n');
}

/** 글 전체가 코드 블록 하나에 싸여 있으면 안쪽만 남긴다. 가이드 원문 안의 코드 블록은 건드리지 않는다. */
function unwrapped(text: string) {
  const lines = text.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  let last = lines.length - 1;
  while (last > first && lines[last].trim() === '') {
    last--;
  }
  const opener = /^(`{3,}|~{3,})/.exec(lines[first]?.trim() ?? '');
  const closer = lines[last]?.trim() ?? '';
  const closes = opener && last > first && closer.startsWith(opener[1][0]) && /^(`+|~+)$/.test(closer);
  if (closes && closer.length >= opener[1].length) {
    return lines.slice(first + 1, last).join('\n');
  }
  return text;
}

function sectionRange(lines: SourceLine[], heading: string) {
  const start = lines.findIndex((entry) => entry.text === `## ${heading}`);
  if (start < 0) {
    return undefined;
  }
  let end = lines.findIndex((entry, index) => index > start && entry.text.startsWith('## '));
  if (end < 0) {
    end = lines.length;
  }
  return lines.slice(start + 1, end);
}

type TableRows = { rows: { line: number; cells: string[] }[] } | { message: string };

function readTable(section: SourceLine[] | undefined, headers: string[], name: string): TableRows {
  if (!section) {
    return { rows: [] };
  }
  const start = section.findIndex((entry) => entry.text.startsWith('|'));
  if (start < 0) {
    return { rows: [] };
  }
  const table = readRawTable(section, start);
  const sameHeaders = table.headers.length === headers.length && table.headers.every((cell, i) => cell === headers[i]);
  if (!sameHeaders || !table.hasSeparator) {
    return {
      message: `준비 자료의 "${name}" 표가 깨졌습니다. 제목 줄(${headers.join(' | ')})과 구분 줄을 확인하세요.`,
    };
  }
  const broken = table.rows.find((row) => row.cells.length !== headers.length);
  if (broken) {
    return { message: `준비 자료의 "${name}" 표가 깨졌습니다(${broken.line}줄: 칸이 ${broken.cells.length}개).` };
  }
  return { rows: table.rows };
}

function listOf(text: string, options: readonly string[]) {
  const picked = text.split(LIST_SEPARATOR).filter((part) => options.includes(part));
  return picked.length > 0 ? picked : undefined;
}

function answersFromRows(rows: { cells: string[] }[]): LastAnswers {
  const byLabel = new Map(rows.map((row) => [row.cells[0], row.cells[1]]));
  const text = (key: keyof LastAnswers) => byLabel.get(ANSWER_LABELS[key]) ?? '';
  return pickLastAnswers({
    interests: listOf(text('interests'), INTEREST_OPTIONS),
    pace: PACE_OPTIONS.find((option) => option === text('pace')),
    budget: text('budget'),
    companion: COMPANION_OPTIONS.find((option) => option === text('companion')),
    headcount: Number(text('headcount')),
    transport: TRANSPORT_OPTIONS.find((option) => option === text('transport')),
    stayTypes: listOf(text('stayTypes'), STAY_TYPE_OPTIONS),
    stayPriorities: listOf(text('stayPriorities'), STAY_PRIORITY_OPTIONS),
  });
}

function matchSelections(rows: { cells: string[] }[], items: GuideItem[]) {
  const selections: Selections = {};
  let dropped = 0;
  for (const row of rows) {
    const [label, kind, name, area] = row.cells;
    const choice = CHOICE_BY_LABEL.get(label);
    const matched = items.filter((item) => item.kind === kind && item.name === name && item.area === area);
    if (!choice || matched.length === 0) {
      dropped++;
      continue;
    }
    for (const item of matched) {
      selections[item.key] = choice;
    }
  }
  return { selections, dropped };
}

function headProblem(head: SourceLine[]) {
  const values = head.map((entry) => formatLineValue(entry.text)).filter((value) => value !== undefined);
  if (values.length !== 1) {
    return `준비 자료의 양식 줄(- 양식: ${PREP_FORMAT})이 ${values.length === 0 ? '없습니다' : '둘 이상입니다'}.`;
  }
  if (values[0] !== PREP_FORMAT) {
    return `지원하지 않는 준비 자료 양식입니다(${values[0] || '비어 있음'}). ${PREP_FORMAT}만 읽을 수 있습니다.`;
  }
  return undefined;
}

/**
 * 글이 준비 자료면 읽은 결과를, 아니면 `undefined`를 돌려준다(순수 가이드 글은 여기서 건드리지 않는다).
 * 거절하면 한글 이유를 돌려주며 호출한 쪽의 초안은 바뀌지 않는다.
 */
export function parsePrepFile(text: string): PrepFileResult | undefined {
  if (!isPrepFileText(text)) {
    return undefined;
  }
  if (text.length > MAX_INPUT_CHARS) {
    return rejected(`글이 너무 깁니다(상한 ${MAX_INPUT_CHARS.toLocaleString('ko-KR')}자).`);
  }
  const lines = splitSourceLines(unwrapped(normalized(text)));
  if (lines.length > MAX_INPUT_LINES) {
    return rejected(`줄이 너무 많습니다(상한 ${MAX_INPUT_LINES.toLocaleString('ko-KR')}줄).`);
  }
  const guideStart = lines.findIndex((entry) => entry.text === `## ${GUIDE_HEADING}`);
  if (guideStart < 0) {
    return rejected(`준비 자료에 "## ${GUIDE_HEADING}" 구역이 없습니다.`);
  }
  const head = lines.slice(0, guideStart);
  const problem = headProblem(head);
  if (problem) {
    return rejected(problem);
  }
  const answerTable = readTable(sectionRange(head, ANSWERS_HEADING), ANSWER_HEADERS, ANSWERS_HEADING);
  const chosenTable = readTable(sectionRange(head, CHOSEN_HEADING), CHOSEN_HEADERS, CHOSEN_HEADING);
  if ('message' in answerTable) {
    return rejected(answerTable.message);
  }
  if ('message' in chosenTable) {
    return rejected(chosenTable.message);
  }
  const guideText = lines
    .slice(guideStart + 1)
    .map((entry) => entry.text)
    .join('\n')
    .trim();
  const guide = parseGuide(guideText);
  if (!guide.accepted) {
    const reason = guide.rejection?.message ?? guide.issues.find((issue) => issue.severity === 'error')?.message ?? '';
    return rejected(`준비 자료 안의 가이드 원문을 읽을 수 없습니다. ${reason}`.trim());
  }
  const { selections, dropped } = matchSelections(chosenTable.rows, guide.items);
  return {
    accepted: true,
    destination: guide.destination,
    guideText,
    items: guide.items,
    selections,
    counts: countByChoice(selections, guide.items),
    dropped,
    answers: answersFromRows(answerTable.rows),
  };
}
