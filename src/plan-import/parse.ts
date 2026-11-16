import { MAX_INPUT_CHARS, MAX_INPUT_LINES, selectBody, splitSourceLines } from './input-text';
import { mapColumns, readCells, readRawTable, type ColumnMap, type RawTable } from './table';
import type {
  ActivityRow,
  DeletionRow,
  DroppedTable,
  HeaderKey,
  PlaceRow,
  PlanDay,
  PlanFile,
  PlanIssue,
  PlanKind,
  Rejection,
  SourceLine,
  StayRow,
} from './types';

type SectionSpec = { required: string[]; optional: string[] };

const SECTION_SPECS: Record<string, SectionSpec> = {
  일정: { required: ['ID', '시간', '제목', '종류'], optional: ['장소', '메모', '예약', '링크'] },
  숙소: { required: ['ID', '체크인', '체크아웃', '이름'], optional: ['지역', '예약'] },
  장소: { required: ['ID', '이름'], optional: ['지역', '설명', '영업시간', '링크'] },
  삭제: { required: ['종류', 'ID'], optional: ['제목'] },
};

const HEADER_KEYS: Record<string, HeaderKey> = {
  양식: 'format',
  기간: 'period',
  시간대: 'timeZone',
  여행ID: 'tripId',
  기준계획: 'basePlanId',
  기준revision: 'baseRevision',
};

const TRIP_TITLE_LINE = /^#\s+여행\s*:\s*(.*)$/;
const HEADER_BULLET = /^-\s*([^:]+?)\s*:\s*(.*)$/;
const DAY_ZONE_SUFFIX = /\(\s*시간대\s*:\s*([^)]*?)\s*\)\s*$/;

function emptyPlan(): PlanFile {
  return {
    kind: 'rejected',
    header: {},
    days: [],
    stays: [],
    places: [],
    deletions: [],
    issues: [],
    notImported: [],
    dropped: [],
  };
}

function rejected(rejection: Rejection): PlanFile {
  return { ...emptyPlan(), rejection };
}

type IgnoredSection = { name: string; lineCount: number };

/** 한 번의 읽기 동안 쌓이는 상태. 함수들이 같은 결과 객체를 채운다. */
class PlanReader {
  readonly plan = emptyPlan();
  private section = '';
  private currentDay: PlanDay | undefined;
  private ignored: IgnoredSection | undefined;
  private titleSeen = false;
  private readonly idHeaderCounts = new Map<HeaderKey, number>();
  private duplicatedIdHeader = false;

  constructor(private readonly body: SourceLine[]) {}

  read(): PlanFile {
    let index = 0;
    while (index < this.body.length) {
      index = this.readAt(index);
    }
    this.closeIgnoredSection();
    this.plan.kind = this.decideKind();
    return this.plan;
  }

  private readAt(index: number): number {
    const entry = this.body[index];
    if (entry.text.startsWith('## ')) {
      this.startSection(entry.text.slice(3).trim());
      return index + 1;
    }
    if (this.section === '' && !entry.text.startsWith('|')) {
      this.readHeaderLine(entry);
      return index + 1;
    }
    if (this.section === '일정' && entry.text.startsWith('### ')) {
      this.startDay(entry);
      return index + 1;
    }
    if (entry.text.startsWith('|')) {
      return this.readTable(index);
    }
    this.countIgnoredText(entry);
    return index + 1;
  }

  private issue(severity: PlanIssue['severity'], line: number, section: string, code: string, message: string) {
    this.plan.issues.push({ severity, line, section, code, message });
  }

  private startSection(name: string) {
    this.closeIgnoredSection();
    this.section = name;
    this.currentDay = undefined;
    if (!(name in SECTION_SPECS)) {
      this.ignored = { name, lineCount: 0 };
    }
  }

  private closeIgnoredSection() {
    if (this.ignored) {
      const { name, lineCount } = this.ignored;
      this.plan.notImported.push({ kind: 'section', name, lineCount });
      this.ignored = undefined;
    }
  }

  private countIgnoredText(entry: SourceLine) {
    if (this.ignored && entry.text !== '') {
      this.ignored.lineCount++;
    }
  }

  private readHeaderLine(entry: SourceLine) {
    const title = TRIP_TITLE_LINE.exec(entry.text);
    if (title && !this.titleSeen) {
      this.titleSeen = true;
      this.plan.header.name = { value: title[1].trim(), line: entry.line };
      return;
    }
    const bullet = HEADER_BULLET.exec(entry.text);
    if (!bullet) {
      return;
    }
    const key = HEADER_KEYS[bullet[1]];
    if (!key) {
      this.plan.notImported.push({ kind: 'header', name: bullet[1], lineCount: 1 });
      return;
    }
    this.storeHeader(key, bullet[2].trim(), entry.line, bullet[1]);
  }

  private storeHeader(key: HeaderKey, value: string, line: number, label: string) {
    const isIdKey = key === 'tripId' || key === 'basePlanId' || key === 'baseRevision';
    if (isIdKey) {
      this.idHeaderCounts.set(key, (this.idHeaderCounts.get(key) ?? 0) + 1);
    }
    if (this.plan.header[key]) {
      this.duplicatedIdHeader ||= isIdKey;
      this.issue('error', line, '머리 줄', 'header-duplicate', `머리 줄 "${label}"이 두 번 이상 있습니다.`);
      return;
    }
    this.plan.header[key] = { value, line };
  }

  private decideKind(): PlanKind {
    const present = this.idHeaderCounts.size;
    if (this.duplicatedIdHeader) {
      this.issue('error', 0, '머리 줄', 'id-header-duplicate', '여행ID·기준계획·기준revision 줄이 중복되었습니다.');
      return 'invalid';
    }
    if (present === 0) {
      return 'new';
    }
    if (present === 3) {
      return 'update';
    }
    this.issue(
      'error',
      0,
      '머리 줄',
      'id-header-partial',
      '여행ID·기준계획·기준revision은 셋 다 있거나 셋 다 없어야 합니다. 새 여행인지 수정인지 알 수 없어 저장할 수 없습니다.',
    );
    return 'invalid';
  }

  private startDay(entry: SourceLine) {
    const rest = entry.text.slice(4).trim();
    const space = rest.search(/\s/);
    const date = space === -1 ? rest : rest.slice(0, space);
    let title = space === -1 ? '' : rest.slice(space).trim();
    const zone = DAY_ZONE_SUFFIX.exec(title);
    if (zone) {
      title = title.slice(0, zone.index).trim();
    }
    this.currentDay = {
      line: entry.line,
      date,
      title,
      ...(zone ? { timeZone: zone[1] } : {}),
      rows: [],
      broken: false,
    };
    this.plan.days.push(this.currentDay);
  }

  private readTable(index: number): number {
    const table = readRawTable(this.body, index);
    if (this.ignored) {
      this.ignored.lineCount += table.rows.length;
      return table.next;
    }
    const spec = SECTION_SPECS[this.section];
    if (this.section === '' || !spec) {
      return table.next;
    }
    const label = this.tableLabel();
    if (this.section === '일정' && !this.currentDay) {
      this.dropTable(table, '일정', label, 'table-without-day', '날짜 제목(### YYYY-MM-DD) 없이 일정 표가 있습니다.');
      return table.next;
    }
    this.readKnownTable(table, spec, label);
    return table.next;
  }

  private tableLabel() {
    return this.section === '일정' && this.currentDay ? `${this.section} ${this.currentDay.date}` : this.section;
  }

  private dropTable(table: RawTable, section: string, label: string, code: string, message: string) {
    this.issue('error', table.line, label, code, message);
    this.recordDropped(section, label, table);
  }

  private recordDropped(section: string, label: string, table: RawTable) {
    const dropped: DroppedTable = { section, label, line: table.line, rowCount: table.rows.length };
    this.plan.dropped.push(dropped);
  }

  /** 일정 표는 날짜 단위로 빼므로 날짜에 표시만 하고, 다른 구역은 표 단위로 기록한다. */
  private markBroken(table: RawTable, label: string) {
    if (this.section === '일정' && this.currentDay) {
      this.currentDay.broken = true;
      return;
    }
    this.recordDropped(this.section, label, table);
  }

  private readKnownTable(table: RawTable, spec: SectionSpec, label: string) {
    const columns = mapColumns(table.headers, spec.required, spec.optional);
    const problems = this.tableProblems(table, columns, label);
    columns.unknown.forEach((name) => {
      this.plan.notImported.push({ kind: 'column', name, where: this.section, lineCount: table.rows.length });
    });
    if (problems > 0) {
      this.markBroken(table, label);
      return;
    }
    table.rows.forEach((row) => this.storeRow(table.line, row.line, readCells(row.cells, columns)));
  }

  /** 표 구조 오류를 모두 모은다. 첫 오류에서 멈추지 않는다. */
  private tableProblems(table: RawTable, columns: ColumnMap, label: string): number {
    let problems = 0;
    const report = (line: number, code: string, message: string) => {
      problems++;
      this.issue('error', line, label, code, message);
    };
    if (!table.hasSeparator) {
      report(table.line, 'table-no-separator', '표의 제목 줄 아래에 구분 줄(|---|---|)이 없습니다.');
    }
    if (columns.missing.length > 0) {
      report(table.line, 'column-missing', `필수 열이 없습니다: ${columns.missing.join(', ')}.`);
    }
    if (columns.duplicated.length > 0) {
      report(table.line, 'column-duplicate', `같은 이름의 열이 두 번 있습니다: ${columns.duplicated.join(', ')}.`);
    }
    table.rows.forEach((row) => {
      if (row.cells.length !== table.headers.length) {
        report(
          row.line,
          'column-count',
          `칸이 ${row.cells.length}개입니다. 제목 줄은 ${table.headers.length}개입니다. 칸 안의 |는 \\|로 적어야 합니다.`,
        );
      }
    });
    return problems;
  }

  private storeRow(tableLine: number, line: number, cells: ReturnType<typeof readCells>) {
    const base = { line, tableLine, cleared: cells.cleared };
    const value = cells.value;
    if (this.section === '일정' && this.currentDay) {
      const row: ActivityRow = {
        ...base,
        id: value('ID'),
        time: value('시간'),
        title: value('제목'),
        category: value('종류'),
        place: value('장소'),
        memo: value('메모'),
        reservation: value('예약'),
        link: value('링크'),
      };
      this.currentDay.rows.push(row);
    } else if (this.section === '숙소') {
      const row: StayRow = {
        ...base,
        id: value('ID'),
        checkIn: value('체크인'),
        checkOut: value('체크아웃'),
        name: value('이름'),
        region: value('지역'),
        booking: value('예약'),
      };
      this.plan.stays.push(row);
    } else if (this.section === '장소') {
      const row: PlaceRow = {
        ...base,
        id: value('ID'),
        name: value('이름'),
        region: value('지역'),
        description: value('설명'),
        hours: value('영업시간'),
        link: value('링크'),
      };
      this.plan.places.push(row);
    } else if (this.section === '삭제') {
      const row: DeletionRow = { ...base, kind: value('종류'), id: value('ID'), title: value('제목') };
      this.plan.deletions.push(row);
    }
  }
}

/**
 * 붙여 넣은 글 또는 파일 글을 중간 구조로 읽는다. 표만 읽고 표 밖의 글은 읽지 않는다.
 * 구조 오류(열·칸 수·구분 줄)는 여기서, 값 검사(날짜·시간·링크·숙소)는 `checkPlanFile`에서 한다.
 */
export function parsePlanFile(text: string): PlanFile {
  if (text.length > MAX_INPUT_CHARS) {
    return rejected({ code: 'too-large', message: `글이 ${MAX_INPUT_CHARS.toLocaleString('ko-KR')}자를 넘습니다.` });
  }
  const lines = splitSourceLines(text);
  if (lines.length > MAX_INPUT_LINES) {
    return rejected({ code: 'too-large', message: `글이 ${MAX_INPUT_LINES.toLocaleString('ko-KR')}줄을 넘습니다.` });
  }
  const selection = selectBody(lines);
  if ('rejection' in selection) {
    return rejected(selection.rejection);
  }
  return new PlanReader(selection.body).read();
}
