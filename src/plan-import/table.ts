import type { SourceLine } from './types';

export const CLEAR_MARK = '(비움)';
const ESCAPED_CLEAR_MARK = '\\(비움)';

/** 칸 안의 `\|`는 글자 `|`로 읽고, 앞뒤 `|` 하나씩과 칸 앞뒤 공백은 버린다. */
export function splitTableRow(text: string): string[] {
  let body = text.trim();
  if (body.startsWith('|')) {
    body = body.slice(1);
  }
  if (body.endsWith('|') && !body.endsWith('\\|')) {
    body = body.slice(0, -1);
  }
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (character === '\\' && body[index + 1] === '|') {
      current += '|';
      index++;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(text: string) {
  const cells = splitTableRow(text);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

export type RawTableRow = { line: number; cells: string[] };

export type RawTable = {
  /** 제목 줄의 줄 번호. 표를 구분하는 값으로도 쓴다. */
  line: number;
  headers: string[];
  hasSeparator: boolean;
  rows: RawTableRow[];
  /** 표 다음 줄의 위치(lines 배열 기준). */
  next: number;
};

/** `|`로 시작하는 연속된 줄을 하나의 표로 읽는다. */
export function readRawTable(lines: SourceLine[], start: number): RawTable {
  let next = start;
  while (next < lines.length && lines[next].text.startsWith('|')) {
    next++;
  }
  const block = lines.slice(start, next);
  const hasSeparator = block.length > 1 && isSeparatorRow(block[1].text);
  const rows = block
    .slice(hasSeparator ? 2 : 1)
    .map((entry) => ({ line: entry.line, cells: splitTableRow(entry.text) }));
  return { line: block[0].line, headers: splitTableRow(block[0].text), hasSeparator, rows, next };
}

export type ColumnMap = {
  indexByName: Map<string, number>;
  missing: string[];
  duplicated: string[];
  unknown: string[];
};

/** 열은 이름으로 읽는다. 순서에 의존하지 않는다. */
export function mapColumns(headers: string[], required: string[], optional: string[]): ColumnMap {
  const known = new Set([...required, ...optional]);
  const indexByName = new Map<string, number>();
  const duplicated: string[] = [];
  const unknown: string[] = [];
  headers.forEach((name, index) => {
    if (!known.has(name)) {
      unknown.push(name);
    } else if (indexByName.has(name)) {
      duplicated.push(name);
    } else {
      indexByName.set(name, index);
    }
  });
  const missing = required.filter((name) => !indexByName.has(name));
  return { indexByName, missing, duplicated, unknown };
}

export type CellReader = { value: (name: string) => string; cleared: string[] };

/**
 * 한 줄의 칸 읽기. `(비움)`은 지우기 표시로 따로 모으고 값은 빈 문자열로 둔다.
 * 글자 그대로의 `(비움)`은 `\(비움)`으로 적는다.
 */
export function readCells(cells: string[], columns: ColumnMap): CellReader {
  const cleared: string[] = [];
  const values = new Map<string, string>();
  columns.indexByName.forEach((index, name) => {
    const cell = cells[index] ?? '';
    if (cell === CLEAR_MARK) {
      cleared.push(name);
      values.set(name, '');
    } else if (cell === ESCAPED_CLEAR_MARK) {
      values.set(name, CLEAR_MARK);
    } else {
      values.set(name, cell);
    }
  });
  return { value: (name) => values.get(name) ?? '', cleared };
}
