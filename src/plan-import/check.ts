import { isKnownTimeZone, webUrl } from '../contracts/v2';
import { MAX_TRIP_DAYS } from '../content/trip-factory';
import { Temporal } from '@js-temporal/polyfill';
import { isRealDate, parseTimeCell, spansOverlap, timeSpecProblem } from './time-cell';
import type {
  ActivityRow,
  CheckedPlanFile,
  DeletionRow,
  PlaceRow,
  PlanDay,
  PlanFile,
  PlanIssue,
  ResolvedHeader,
  StayRow,
} from './types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const PERIOD_PATTERN = /^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/;
const DELETABLE_KINDS = ['활동', '숙소'];

function knownZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return isKnownTimeZone(value);
  } catch {
    return false;
  }
}

function validLink(value: string) {
  return /^https:\/\/\S+$/.test(value) && webUrl.safeParse(value).success;
}

/** 검사 중 쌓이는 오류·경고. 단위(표·날짜)별 오류 수를 세기 위해 전체 개수를 노출한다. */
class IssueSink {
  readonly issues: PlanIssue[];
  errorCount = 0;

  constructor(initial: PlanIssue[]) {
    this.issues = [...initial];
    this.errorCount = initial.filter((issue) => issue.severity === 'error').length;
  }

  error(line: number, section: string, code: string, message: string) {
    this.errorCount++;
    this.issues.push({ severity: 'error', line, section, code, message });
  }

  warn(line: number, section: string, code: string, message: string) {
    this.issues.push({ severity: 'warning', line, section, code, message });
  }
}

class PlanChecker {
  private readonly sink: IssueSink;
  private readonly resolved: ResolvedHeader = {};
  private readonly isNewFile: boolean;
  private headerErrors = 0;
  private readonly seenIds = new Map<string, number>();

  constructor(private readonly plan: PlanFile) {
    this.sink = new IssueSink(plan.issues);
    this.isNewFile = plan.kind === 'new';
    this.headerErrors = plan.issues.filter((issue) => issue.severity === 'error' && issue.section === '머리 줄').length;
  }

  run(): CheckedPlanFile {
    this.checkHeader();
    this.checkDays();
    this.checkStays();
    this.checkPlaces();
    this.checkDeletions();
    const issues = [...this.sink.issues].sort((a, b) => a.line - b.line);
    return {
      ...this.plan,
      issues,
      resolved: this.resolved,
      saveable: this.isNewFile && this.headerErrors === 0,
    };
  }

  // ── 머리 줄 ────────────────────────────────────────────

  private headerProblem(line: number, code: string, message: string) {
    if (this.isNewFile) {
      this.headerErrors++;
      this.sink.error(line, '머리 줄', code, message);
    } else {
      this.sink.warn(line, '머리 줄', code, message);
    }
  }

  private checkHeader() {
    const { header } = this.plan;
    if (this.isNewFile) {
      this.checkName();
    }
    this.checkPeriod();
    if (header.timeZone) {
      if (knownZone(header.timeZone.value)) {
        this.resolved.timeZone = header.timeZone.value;
      } else {
        this.headerProblem(
          header.timeZone.line,
          'timezone-invalid',
          `알 수 없는 시간대입니다: ${header.timeZone.value}`,
        );
      }
    }
    this.checkHeaderIds();
  }

  private checkName() {
    const name = this.plan.header.name;
    if (!name || name.value === '') {
      this.headerProblem(name?.line ?? 0, 'name-missing', '여행 이름(# 여행: 이름) 줄이 없거나 비어 있습니다.');
      return;
    }
    this.resolved.name = name.value;
  }

  private checkPeriod() {
    const period = this.plan.header.period;
    if (!period) {
      if (this.isNewFile) {
        this.headerProblem(0, 'period-missing', '기간(- 기간: YYYY-MM-DD ~ YYYY-MM-DD) 줄이 없습니다.');
      }
      return;
    }
    const match = PERIOD_PATTERN.exec(period.value);
    if (!match || !isRealDate(match[1]) || !isRealDate(match[2])) {
      this.headerProblem(period.line, 'period-invalid', `기간 "${period.value}"을 읽을 수 없습니다.`);
      return;
    }
    if (match[2] < match[1]) {
      this.headerProblem(period.line, 'period-reversed', '기간의 끝이 시작보다 이릅니다.');
      return;
    }
    const days = Temporal.PlainDate.from(match[1]).until(Temporal.PlainDate.from(match[2]), {
      largestUnit: 'days',
    }).days;
    if (days + 1 > MAX_TRIP_DAYS) {
      this.headerProblem(period.line, 'period-too-long', `여행 날짜 수 한도는 ${MAX_TRIP_DAYS}일입니다.`);
      return;
    }
    this.resolved.start = match[1];
    this.resolved.end = match[2];
  }

  private checkHeaderIds() {
    const { header } = this.plan;
    for (const key of ['tripId', 'basePlanId'] as const) {
      const entry = header[key];
      if (entry && !ID_PATTERN.test(entry.value)) {
        this.headerProblem(entry.line, 'id-format', `머리 줄 ID 값이 형식에 맞지 않습니다: ${entry.value}`);
      }
    }
    const revision = header.baseRevision;
    if (revision) {
      if (/^\d+$/.test(revision.value) && Number.isSafeInteger(Number(revision.value))) {
        this.resolved.baseRevision = Number(revision.value);
      } else {
        this.headerProblem(
          revision.line,
          'revision-invalid',
          `기준revision은 0 이상 정수여야 합니다: ${revision.value}`,
        );
      }
    }
  }

  // ── 공통 칸 검사 ────────────────────────────────────────

  private inPeriod(date: string) {
    const { start, end } = this.resolved;
    return !start || !end || (date >= start && date <= end);
  }

  private checkRowId(row: { line: number; id: string }, section: string, kindLabel: string) {
    if (row.id === '') {
      return;
    }
    if (!ID_PATTERN.test(row.id) || row.id.length > 160) {
      this.sink.error(row.line, section, 'id-format', `ID "${row.id}"의 형식이 맞지 않습니다.`);
    }
    if (this.isNewFile) {
      this.sink.error(row.line, section, 'id-in-new-file', `새 여행 파일에는 ID를 넣을 수 없습니다(${row.id}).`);
    }
    const key = `${kindLabel}:${row.id}`;
    const first = this.seenIds.get(key);
    if (first !== undefined) {
      this.sink.error(row.line, section, 'duplicate-id', `ID "${row.id}"가 ${first}줄에도 있습니다.`);
    } else {
      this.seenIds.set(key, row.line);
    }
  }

  private checkClearMarks(
    row: { line: number; id: string; cleared: string[] },
    section: string,
    requiredColumns: string[],
  ) {
    if (row.cleared.length > 0 && row.id === '') {
      this.sink.error(row.line, section, 'clear-without-id', '(비움)은 ID가 있는 줄에서만 쓸 수 있습니다.');
    }
    row.cleared
      .filter((name) => requiredColumns.includes(name))
      .forEach((name) => {
        this.sink.error(row.line, section, 'clear-required', `${name} 칸은 필수 값이라 (비움)을 쓸 수 없습니다.`);
      });
  }

  private checkRequired(row: { line: number; id: string }, section: string, values: Record<string, string>) {
    if (row.id !== '') {
      return;
    }
    Object.entries(values).forEach(([name, value]) => {
      if (value === '') {
        this.sink.error(row.line, section, 'blank-required', `새 줄에는 ${name} 값이 필요합니다.`);
      }
    });
  }

  private checkLink(row: { line: number }, section: string, link: string) {
    if (link !== '' && !validLink(link)) {
      this.sink.error(row.line, section, 'link-invalid', `링크는 https://로 시작하는 주소 하나여야 합니다: ${link}`);
    }
  }

  // ── 일정 ───────────────────────────────────────────────

  private checkDays() {
    const seenDates = new Set<string>();
    this.plan.days = this.plan.days.map((day) => this.checkDay(day, seenDates));
  }

  private checkDay(day: PlanDay, seenDates: Set<string>): PlanDay {
    const section = `일정 ${day.date}`;
    const before = this.sink.errorCount;
    this.checkDayHeading(day, section, seenDates);
    const zone = this.dayZone(day);
    day.rows.forEach((row) => this.checkActivity(row, section, day.date, zone));
    const failed = day.broken || this.sink.errorCount > before;
    if (failed) {
      this.plan.dropped.push({ section: '일정', label: day.date, line: day.line, rowCount: day.rows.length });
      return { ...day, rows: [] };
    }
    this.warnOverlaps(day, section);
    return day;
  }

  private checkDayHeading(day: PlanDay, section: string, seenDates: Set<string>) {
    if (!isRealDate(day.date)) {
      this.sink.error(
        day.line,
        section,
        'date-invalid',
        `날짜 제목 "${day.date}"이 YYYY-MM-DD 형식의 실제 날짜가 아닙니다.`,
      );
      return;
    }
    if (!this.inPeriod(day.date)) {
      this.sink.error(day.line, section, 'date-out-of-range', `${day.date}은 여행 기간 밖입니다.`);
    }
    if (seenDates.has(day.date)) {
      this.sink.error(day.line, section, 'duplicate-day', `${day.date} 날짜 제목이 두 번 있습니다.`);
    }
    seenDates.add(day.date);
  }

  private dayZone(day: PlanDay) {
    if (day.timeZone === undefined) {
      return this.resolved.timeZone;
    }
    if (!knownZone(day.timeZone)) {
      this.sink.error(day.line, `일정 ${day.date}`, 'timezone-invalid', `알 수 없는 시간대입니다: ${day.timeZone}`);
      return this.resolved.timeZone;
    }
    return day.timeZone;
  }

  private checkActivity(row: ActivityRow, section: string, date: string, zone: string | undefined) {
    this.checkRowId(row, section, '활동');
    this.checkClearMarks(row, section, ['제목', '종류']);
    this.checkRequired(row, section, { 제목: row.title, 종류: row.category });
    this.checkLink(row, section, row.link);
    const time = parseTimeCell(row.time);
    if (!time.ok) {
      this.sink.error(row.line, section, time.code, time.message);
      return;
    }
    row.span = time.span;
    if (isRealDate(date)) {
      const problem = timeSpecProblem(time.span, { date, timeZone: zone });
      if (problem) {
        this.sink.error(row.line, section, 'time-nonexistent', `시간 "${row.time}": ${problem}`);
      }
    }
  }

  private warnOverlaps(day: PlanDay, section: string) {
    const timed = day.rows.filter((row) => row.span?.endMinute !== undefined);
    timed.forEach((first, index) => {
      timed.slice(index + 1).forEach((second) => {
        if (spansOverlap(first.span!, second.span!)) {
          this.sink.warn(
            second.line,
            section,
            'time-overlap',
            `"${second.title || second.id}"(${second.time})이 ${first.line}줄 "${first.title || first.id}"(${first.time})와 시간이 겹칩니다.`,
          );
        }
      });
    });
  }

  // ── 숙소·장소·삭제 ──────────────────────────────────────

  /** 표 단위로 오류를 세어, 오류가 있는 표의 줄을 모두 뺀다. */
  private filterByTable<Row extends { tableLine: number; line: number }>(
    section: string,
    rows: Row[],
    checkRow: (row: Row) => void,
  ): Row[] {
    const failedTables = new Set<number>();
    rows.forEach((row) => {
      const before = this.sink.errorCount;
      checkRow(row);
      if (this.sink.errorCount > before) {
        failedTables.add(row.tableLine);
      }
    });
    failedTables.forEach((tableLine) => {
      const rowCount = rows.filter((row) => row.tableLine === tableLine).length;
      this.plan.dropped.push({ section, label: section, line: tableLine, rowCount });
    });
    return rows.filter((row) => !failedTables.has(row.tableLine));
  }

  private checkStays() {
    this.plan.stays = this.filterByTable('숙소', this.plan.stays, (row) => this.checkStay(row));
  }

  private checkStay(row: StayRow) {
    this.checkRowId(row, '숙소', '숙소');
    this.checkClearMarks(row, '숙소', ['체크인', '체크아웃', '이름']);
    this.checkRequired(row, '숙소', { 체크인: row.checkIn, 체크아웃: row.checkOut, 이름: row.name });
    const dates = [
      { name: '체크인', value: row.checkIn },
      { name: '체크아웃', value: row.checkOut },
    ];
    dates.forEach(({ name, value }) => {
      if (value === '') {
        return;
      }
      if (!isRealDate(value)) {
        this.sink.error(row.line, '숙소', 'date-invalid', `${name} "${value}"이 실제 날짜가 아닙니다.`);
      } else if (!this.inPeriod(value)) {
        this.sink.error(row.line, '숙소', 'date-out-of-range', `${name} ${value}이 여행 기간 밖입니다.`);
      }
    });
    if (isRealDate(row.checkIn) && isRealDate(row.checkOut) && row.checkOut <= row.checkIn) {
      this.sink.error(row.line, '숙소', 'stay-order', '체크아웃은 체크인보다 늦어야 합니다.');
    }
  }

  private checkPlaces() {
    this.plan.places = this.filterByTable('장소', this.plan.places, (row) => this.checkPlace(row));
  }

  private checkPlace(row: PlaceRow) {
    this.checkRowId(row, '장소', '장소');
    this.checkClearMarks(row, '장소', ['이름']);
    this.checkRequired(row, '장소', { 이름: row.name });
    this.checkPlaceLink(row);
  }

  /** 장소의 링크는 http(s) 주소 하나여야 한다. 아니면 오류로 표를 버리지 않고, 링크만 넣지 않고 경고한다. */
  private checkPlaceLink(row: PlaceRow) {
    if (row.link === '' || (/^https?:\/\/\S+$/.test(row.link) && webUrl.safeParse(row.link).success)) {
      return;
    }
    this.sink.warn(row.line, '장소', 'place-link-skipped', `링크가 http(s) 주소가 아니라 넣지 않습니다: ${row.link}`);
    row.link = '';
  }

  private checkDeletions() {
    this.plan.deletions = this.filterByTable('삭제', this.plan.deletions, (row) => this.checkDeletion(row));
  }

  private checkDeletion(row: DeletionRow) {
    if (!DELETABLE_KINDS.includes(row.kind)) {
      this.sink.error(row.line, '삭제', 'delete-kind', `삭제할 수 있는 종류는 활동·숙소뿐입니다("${row.kind}").`);
    }
    if (row.id === '') {
      this.sink.error(row.line, '삭제', 'blank-required', '삭제 줄에는 ID가 필요합니다.');
      return;
    }
    if (!ID_PATTERN.test(row.id) || row.id.length > 160) {
      this.sink.error(row.line, '삭제', 'id-format', `ID "${row.id}"의 형식이 맞지 않습니다.`);
    }
    if (this.isNewFile) {
      this.sink.error(row.line, '삭제', 'id-in-new-file', `새 여행 파일에는 삭제할 항목이 없습니다(${row.id}).`);
    }
    const otherKind = row.kind === '활동' ? '숙소' : '활동';
    if (DELETABLE_KINDS.includes(row.kind) && this.seenIds.has(`${otherKind}:${row.id}`)) {
      this.sink.error(
        row.line,
        '삭제',
        'delete-kind-mismatch',
        `ID ${row.id}는 ${otherKind} 표의 항목인데 종류가 ${row.kind}입니다.`,
      );
    }
  }
}

/** 값 검사: 날짜·시간·링크·ID·숙소·삭제. 오류가 난 표(일정은 날짜)는 결과에서 빼고 `dropped`에 남긴다. */
export function checkPlanFile(parsed: PlanFile): CheckedPlanFile {
  const copy = structuredClone(parsed);
  if (copy.kind === 'rejected') {
    return { ...copy, resolved: {}, saveable: false };
  }
  return new PlanChecker(copy).run();
}
