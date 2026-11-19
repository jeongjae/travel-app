import type { PlanVersion, TripDataset } from '../contracts/v2';
import { PLAN_FORMAT } from '../plan-import/input-text';
import { activityCellsOf, tableCell } from './cells';
import { EXPORT_RULE_LINES } from './export-rules';
import { placeCellsOf, type CatalogPlace, type CatalogRegion } from './places';

type TripHeader = TripDataset['header'];
type PlanDay = PlanVersion['days'][number];
type PlanItem = PlanVersion['items'][number];
type PlanStay = PlanVersion['stays'][number];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_ID_LENGTH = 160;

export type ExportOptions = {
  /** 이 날짜 범위(양끝 포함)의 일정만 내보낸다. 없으면 전체. */
  range?: { start: string; end: string };
  /** 예약 메모 칸을 채운다. 기본은 비운다(결정 G-d). */
  includeReservation?: boolean;
};

/** 내보내기에 필요한 계획 부분만 요구한다(저장된 `PlanVersion` 전체도 그대로 들어간다). */
export type ExportablePlan = Pick<PlanVersion, 'planVersionId' | 'days' | 'items' | 'stays'>;

export type ExportInput = {
  header: TripHeader;
  plan: ExportablePlan;
  /** 장소 id → 이름. 활동에 연결된 장소의 이름을 장소 칸에 적는 데 쓴다. */
  placeNames?: ReadonlyMap<string, string>;
  /** 이 여행의 장소·지역. 있으면 활동에 연결된 장소를 `## 장소` 표로 내보낸다. */
  places?: readonly CatalogPlace[];
  regions?: readonly CatalogRegion[];
};

export type ExportWarningCode = 'newline-flattened' | 'time-unrepresentable' | 'id-format' | 'stay-incomplete';

/** 다시 가져왔을 때 변경 0건이 되지 않을 수 있는 줄. */
export type ExportWarning = { code: ExportWarningCode; where: string; message: string };

export type ExportResult = {
  text: string;
  warnings: ExportWarning[];
  counts: { days: number; activities: number; stays: number; places: number };
};

class PlanExporter {
  private readonly lines: string[] = [];
  private readonly warnings: ExportWarning[] = [];
  private readonly placeNames: ReadonlyMap<string, string>;
  private activityCount = 0;
  private stayCount = 0;
  private placeCount = 0;

  constructor(
    private readonly input: ExportInput,
    private readonly options: ExportOptions,
  ) {
    this.placeNames = input.placeNames ?? new Map(input.places?.map((place) => [place.entityId, place.name]));
  }

  run(): ExportResult {
    const days = this.visibleDays();
    this.writeHeader();
    this.lines.push('', '## 일정');
    for (const day of days) {
      this.writeDay(day);
    }
    this.writeStays();
    this.writePlaces(days);
    this.lines.push('', '## 삭제', '| 종류 | ID | 제목 |', '|---|---|---|');
    return {
      text: `${this.lines.join('\n')}\n`,
      warnings: this.warnings,
      counts: { days: days.length, activities: this.activityCount, stays: this.stayCount, places: this.placeCount },
    };
  }

  private visibleDays(): PlanDay[] {
    const { range } = this.options;
    return this.input.plan.days
      .filter((day) => !range || (day.date >= range.start && day.date <= range.end))
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  private warn(code: ExportWarningCode, where: string, message: string) {
    this.warnings.push({ code, where, message });
  }

  /** 표에 쓸 칸. 줄바꿈을 공백으로 바꾼 칸은 경고로 모은다. */
  private cell(value: string, where: string) {
    const result = tableCell(value);
    if (result.changed) {
      this.warn(
        'newline-flattened',
        where,
        '칸 안의 줄바꿈을 공백으로 바꿨습니다. 다시 가져오면 이 칸이 수정으로 잡힐 수 있습니다.',
      );
    }
    return result.text;
  }

  private checkId(id: string, where: string) {
    if (!ID_PATTERN.test(id) || id.length > MAX_ID_LENGTH) {
      this.warn('id-format', where, `ID "${id}"가 양식의 ID 형식과 달라 다시 가져올 때 오류가 됩니다.`);
    }
    return id;
  }

  private writeHeader() {
    const { header, plan } = this.input;
    const { range } = this.options;
    this.lines.push(`# 여행: ${this.cell(header.name, '여행 이름')}`);
    this.lines.push(`- 양식: ${PLAN_FORMAT}`);
    this.lines.push(`- 기간: ${header.startDate} ~ ${header.endDate}`);
    if (header.defaultTimeZone) {
      this.lines.push(`- 시간대: ${header.defaultTimeZone}`);
    }
    this.lines.push(`- 여행ID: ${header.tripId}`);
    this.lines.push(`- 기준계획: ${plan.planVersionId}`);
    this.lines.push(`- 기준revision: ${header.domainRevision}`);
    if (range) {
      this.lines.push(`- 범위: ${range.start} ~ ${range.end}`);
    }
    this.lines.push('', ...EXPORT_RULE_LINES);
  }

  private itemsOf(day: PlanDay): PlanItem[] {
    return this.input.plan.items.filter((item) => item.dayId === day.dayId).sort((a, b) => a.order - b.order);
  }

  /** 그날 시간 있는 활동이 모두 같은 시간대이고 여행 기본과 다를 때만 날짜 제목에 붙인다. */
  private dayZoneSuffix(items: PlanItem[], day: PlanDay) {
    const zones = new Set<string>();
    for (const item of items) {
      const start = item.time.start;
      if ((start.precision === 'local' || start.precision === 'instant') && start.timeZone) {
        zones.add(start.timeZone);
      }
    }
    if (zones.size > 1) {
      this.warn(
        'time-unrepresentable',
        day.date,
        '그날 활동의 시간대가 여러 개라 날짜 제목에 시간대를 적지 못했습니다.',
      );
      return '';
    }
    const [zone] = [...zones];
    return zone && zone !== this.input.header.defaultTimeZone ? `(시간대: ${zone})` : '';
  }

  private writeDay(day: PlanDay) {
    const items = this.itemsOf(day);
    const heading = [day.date, this.cell(day.title, day.date), this.dayZoneSuffix(items, day)];
    this.lines.push(`### ${heading.filter((part) => part !== '').join(' ')}`);
    this.lines.push('| ID | 시간 | 제목 | 종류 | 장소 | 메모 | 예약 | 링크 |', '|---|---|---|---|---|---|---|---|');
    for (const item of items) {
      this.writeActivity(item, day.date);
    }
    this.lines.push('');
  }

  private writeActivity(item: PlanItem, date: string) {
    const where = `${date} ${item.title}`;
    const { cells, notes } = activityCellsOf(item, {
      date,
      placeNames: this.placeNames,
      includeReservation: this.options.includeReservation ?? false,
    });
    for (const note of notes) {
      this.warn(note.code, where, note.message);
    }
    const values = [
      this.checkId(item.activityId, where),
      cells.time,
      this.cell(cells.title, where),
      this.cell(cells.category, where),
      this.cell(cells.place, where),
      this.cell(cells.memo, where),
      this.cell(cells.reservation, where),
      this.cell(cells.link, where),
    ];
    this.lines.push(`| ${values.join(' | ')} |`);
    this.activityCount++;
  }

  /** 장소 표: 보이는 날짜의 활동에 연결된 장소만. 지역·영업시간은 설명 끝 표시에서 칸으로 올린다. */
  private writePlaces(days: PlanDay[]) {
    const { places = [], regions = [] } = this.input;
    const dayIds = new Set(days.map((day) => day.dayId));
    const linkedIds: string[] = [];
    for (const day of days) {
      for (const item of this.itemsOf(day)) {
        for (const link of item.placeLinks) {
          if (!linkedIds.includes(link.placeId)) {
            linkedIds.push(link.placeId);
          }
        }
      }
    }
    const shown = linkedIds.flatMap((id) => places.filter((place) => place.entityId === id));
    if (shown.length === 0 || dayIds.size === 0) {
      return;
    }
    this.lines.push('', '## 장소', '| ID | 이름 | 지역 | 설명 | 영업시간 | 링크 |', '|---|---|---|---|---|---|');
    for (const place of shown) {
      const where = `장소 ${place.name}`;
      const cells = placeCellsOf(place, regions);
      const values = [
        this.checkId(place.entityId, where),
        this.cell(place.name, where),
        this.cell(cells.region, where),
        this.cell(cells.description, where),
        this.cell(cells.hours, where),
        this.cell(cells.link, where),
      ];
      this.lines.push(`| ${values.join(' | ')} |`);
      this.placeCount++;
    }
  }

  private datesOf(stay: PlanStay) {
    return { checkIn: stay.time.start.date ?? '', checkOut: stay.time.end?.date ?? '' };
  }

  private stayInRange(stay: PlanStay) {
    const { range } = this.options;
    if (!range) {
      return true;
    }
    const { checkIn, checkOut } = this.datesOf(stay);
    const reachesRange = checkOut === '' ? checkIn >= range.start : checkOut >= range.start;
    return checkIn <= range.end && reachesRange;
  }

  /** 숙소 표: 지역·예약 칸은 비운다(결정 G-c). T-E1이 메모에 남긴 `[숙소 지역: …]`은 메모에 그대로 둔다. */
  private writeStays() {
    this.lines.push('', '## 숙소', '| ID | 체크인 | 체크아웃 | 이름 | 지역 | 예약 |', '|---|---|---|---|---|---|');
    for (const stay of this.input.plan.stays.filter((candidate) => this.stayInRange(candidate))) {
      const { checkIn, checkOut } = this.datesOf(stay);
      const where = `숙소 ${stay.baseText}`;
      if (checkIn === '' || checkOut === '') {
        this.warn(
          'stay-incomplete',
          where,
          '체크인 또는 체크아웃 날짜가 없어 그 칸을 비웠습니다(다시 가져오면 변경 없음).',
        );
      }
      const values = [this.checkId(stay.stayId, where), checkIn, checkOut, this.cell(stay.baseText, where), '', ''];
      this.lines.push(`| ${values.join(' | ')} |`);
      this.stayCount++;
    }
  }
}

/** 저장된 계획을 양식 글로 내보낸다. 순수 함수이며 DB·화면에 의존하지 않는다. */
export function exportPlan(input: ExportInput, options: ExportOptions = {}): ExportResult {
  return new PlanExporter(input, options).run();
}
