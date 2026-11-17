import {
  MAX_INPUT_CHARS,
  MAX_INPUT_LINES,
  PLAN_FORMAT,
  selectFormattedBody,
  splitSourceLines,
} from '../plan-import/input-text';
import { mapColumns, readRawTable, type RawTable } from '../plan-import/table';
import { isRealDate } from '../plan-import/time-cell';
import type { Rejection, SourceLine } from '../plan-import/types';
import {
  GUIDE_KINDS,
  type GuideIssue,
  type GuideItem,
  type GuideKind,
  type GuideNotImported,
  type GuideRejection,
  type GuideResult,
} from './types';

export const GUIDE_FORMAT = 'travel-app-guide/1';
export const MAX_GUIDE_ITEMS = 200;

const ITEM_SECTION = '항목';
const REQUIRED_COLUMNS = ['종류', '이름'];
const OPTIONAL_COLUMNS = ['지역', '한 줄 설명', '예상 소요', '확인 필요'];
const HEADER_LINE = /^-\s*([^:]+?)\s*:\s*(.*)$/;
const TITLE_LINE = /^#\s*가이드\s*:\s*(.*)$/;

/** 같은 글이면 같은 값이 나오는 32비트 지문(FNV-1a). 보안 용도가 아니라 key를 만드는 용도다. */
function fingerprint(lines: SourceLine[]) {
  let hash = 0x811c9dc5;
  for (const entry of lines) {
    for (const character of `${entry.text}\n`) {
      hash ^= character.codePointAt(0)!;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

function isKind(value: string): value is GuideKind {
  return (GUIDE_KINDS as readonly string[]).includes(value);
}

function reject(code: GuideRejection['code'], message: string): GuideResult {
  return { accepted: false, rejection: { code, message }, issues: [], notImported: [] };
}

class GuideReader {
  private readonly issues: GuideIssue[] = [];
  private readonly notImported: GuideNotImported[] = [];
  private readonly items: GuideItem[] = [];
  private destination = '';
  private referenceDate: string | undefined;
  private titleCount = 0;
  private sawItemSection = false;
  private sawTable = false;

  constructor(
    private readonly body: SourceLine[],
    private readonly prefix: string,
  ) {}

  read(): GuideResult {
    this.readBody();
    this.finish();
    const hasError = this.issues.some((issue) => issue.severity === 'error');
    if (hasError) {
      return { accepted: false, issues: this.issues, notImported: this.notImported };
    }
    return {
      accepted: true,
      destination: this.destination,
      referenceDate: this.referenceDate,
      items: this.items,
      issues: this.issues,
      notImported: this.notImported,
    };
  }

  private error(line: number, message: string) {
    this.issues.push({ severity: 'error', line, message });
  }

  private warn(line: number, message: string) {
    this.issues.push({ severity: 'warning', line, message });
  }

  private readBody() {
    let section = '';
    for (let index = 0; index < this.body.length; index++) {
      const entry = this.body[index];
      const title = TITLE_LINE.exec(entry.text);
      if (title) {
        this.readTitle(title[1].trim(), entry.line);
      } else if (entry.text.startsWith('## ')) {
        section = entry.text.slice(3).trim();
        this.enterSection(section, entry.line);
      } else if (entry.text.startsWith('|') && section === ITEM_SECTION) {
        index = this.readItemTable(index) - 1;
      } else if (section === '') {
        this.readHeaderLine(entry);
      }
    }
  }

  private readTitle(value: string, line: number) {
    this.titleCount++;
    if (this.titleCount > 1) {
      this.error(line, '`# 가이드:` 줄이 둘 이상입니다.');
    } else if (value === '') {
      this.error(line, '`# 가이드:` 줄에 목적지 이름이 없습니다.');
    } else {
      this.destination = value;
    }
  }

  private enterSection(name: string, line: number) {
    if (name !== ITEM_SECTION) {
      this.notImported.push({ line, what: `\`## ${name}\` 구역` });
      return;
    }
    if (this.sawItemSection) {
      this.error(line, '`## 항목` 구역이 둘 이상입니다.');
    }
    this.sawItemSection = true;
  }

  private readHeaderLine(entry: SourceLine) {
    const match = HEADER_LINE.exec(entry.text);
    if (!match) {
      return;
    }
    const key = match[1];
    const value = match[2].trim();
    if (key === '양식') {
      return;
    }
    if (key !== '기준일') {
      this.notImported.push({ line: entry.line, what: `머리 줄 \`${key}\`` });
      return;
    }
    if (isRealDate(value)) {
      this.referenceDate = value;
    } else {
      this.warn(entry.line, `기준일 "${value}"을 읽을 수 없어 쓰지 않습니다. YYYY-MM-DD로 적어야 합니다.`);
    }
  }

  /** 표를 읽고 표 다음 줄의 위치를 돌려준다. */
  private readItemTable(start: number) {
    const table = readRawTable(this.body, start);
    if (this.sawTable) {
      this.error(table.line, '항목 표가 둘 이상입니다. 표 하나만 남겨 주세요.');
    } else {
      this.sawTable = true;
      this.readRows(table);
    }
    return table.next;
  }

  private readRows(table: RawTable) {
    const columns = mapColumns(table.headers, REQUIRED_COLUMNS, OPTIONAL_COLUMNS);
    let usable = true;
    if (!table.hasSeparator) {
      this.error(table.line, '표 제목 줄 아래에 구분 줄(|---|---|)이 없습니다.');
      usable = false;
    }
    for (const name of columns.missing) {
      this.error(table.line, `필수 열 "${name}"이 없습니다.`);
      usable = false;
    }
    for (const name of columns.duplicated) {
      this.error(table.line, `열 "${name}"이 두 번 있습니다.`);
      usable = false;
    }
    for (const name of columns.unknown) {
      this.notImported.push({ line: table.line, what: `열 "${name}"` });
    }
    if (!usable) {
      return;
    }
    if (table.rows.length > MAX_GUIDE_ITEMS) {
      this.error(table.line, `항목이 ${table.rows.length}줄로 상한 ${MAX_GUIDE_ITEMS}줄을 넘습니다.`);
      return;
    }
    const cell = (cells: string[], name: string) => cells[columns.indexByName.get(name) ?? -1] ?? '';
    for (const row of table.rows) {
      if (row.cells.length !== table.headers.length) {
        this.error(row.line, `칸이 ${row.cells.length}개입니다. 제목 줄은 ${table.headers.length}개입니다.`);
        continue;
      }
      const kind = cell(row.cells, '종류');
      const name = cell(row.cells, '이름');
      if (!isKind(kind)) {
        this.error(row.line, `종류 "${kind}"를 알 수 없습니다. ${GUIDE_KINDS.join('·')} 중 하나여야 합니다.`);
      }
      if (name === '') {
        this.error(row.line, '이름이 비어 있습니다.');
      }
      if (!isKind(kind) || name === '') {
        continue;
      }
      this.items.push({
        key: `${this.prefix}-${this.items.length + 1}`,
        kind,
        name,
        area: cell(row.cells, '지역'),
        description: cell(row.cells, '한 줄 설명'),
        durationText: cell(row.cells, '예상 소요'),
        needsCheck: cell(row.cells, '확인 필요'),
        line: row.line,
      });
    }
  }

  private finish() {
    if (this.titleCount === 0) {
      this.error(1, '`# 가이드: 목적지` 줄이 없습니다.');
    }
    if (!this.sawItemSection) {
      this.error(1, '`## 항목` 구역이 없습니다.');
    } else if (!this.sawTable) {
      this.error(1, '`## 항목` 아래에 표가 없습니다.');
    } else if (this.items.length === 0 && !this.issues.some((issue) => issue.severity === 'error')) {
      this.error(1, '항목이 하나도 없습니다.');
    }
    this.warnDuplicates();
  }

  private warnDuplicates() {
    const firstLineByIdentity = new Map<string, number>();
    for (const item of this.items) {
      const identity = [item.kind, item.name, item.area].join('\u0000');
      const first = firstLineByIdentity.get(identity);
      if (first === undefined) {
        firstLineByIdentity.set(identity, item.line);
      } else {
        this.warn(item.line, `${first}줄과 종류·이름·지역이 같은 항목입니다. 합치지 않고 둘 다 보여 줍니다.`);
      }
    }
  }
}

function planRejection(value: string): Rejection | undefined {
  if (value !== PLAN_FORMAT) {
    return undefined;
  }
  return { code: 'is-plan', message: '이것은 계획입니다. "AI 결과 붙여넣기"에 넣으세요.' };
}

/** 가이드 글 → 항목 목록. 오류가 하나라도 있으면 전체를 받지 않고 오류를 모두 모아 돌려준다. */
export function parseGuide(text: string): GuideResult {
  if (text.length > MAX_INPUT_CHARS) {
    return reject('too-large', `글이 너무 깁니다(상한 ${MAX_INPUT_CHARS.toLocaleString('ko-KR')}자).`);
  }
  const lines = splitSourceLines(text);
  if (lines.length > MAX_INPUT_LINES) {
    return reject('too-large', `줄이 너무 많습니다(상한 ${MAX_INPUT_LINES.toLocaleString('ko-KR')}줄).`);
  }
  const selection = selectFormattedBody(lines, {
    format: GUIDE_FORMAT,
    example: `- 양식: ${GUIDE_FORMAT}`,
    mismatch: planRejection,
  });
  if ('rejection' in selection) {
    const { code, message } = selection.rejection;
    return reject(code === 'not-plan' ? 'not-guide' : (code as GuideRejection['code']), message);
  }
  return new GuideReader(selection.body, fingerprint(selection.body)).read();
}
