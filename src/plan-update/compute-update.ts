import { Temporal } from '@js-temporal/polyfill';
import { planItemSchema, planStaySchema, type PlanVersion } from '../contracts/v2';
import { buildActivityTime, parseTimeCell, timeSpecProblem } from '../plan-import/time-cell';
import type { ActivityRow, CheckedPlanFile, DeletionRow, PlanDay as FileDay, StayRow } from '../plan-import/types';
import { activityCellsOf, joinText, linkedPlaceName, viaTable, withoutTimeNote } from './cells';
import {
  STALE_PLAN_MESSAGE,
  STALE_REVISION_MESSAGE,
  type ChangeEntry,
  type CurrentTrip,
  type FieldChange,
  type UpdateProblem,
  type UpdateResult,
  type UnchangedEntry,
} from './update-types';

type PlanItem = PlanVersion['items'][number];
type PlanStay = PlanVersion['stays'][number];
type PlanDay = PlanVersion['days'][number];
type ReadyResult = Extract<UpdateResult, { status: 'ready' }>;

const NO_TIME_LABEL = '시간 미정';

/** 머리 줄이 이 여행·현재 계획·현재 revision과 맞는지 본다. 맞지 않으면 적용할 수 없다(AC-08·17). */
function checkTarget(file: CheckedPlanFile, current: CurrentTrip): UpdateResult | undefined {
  const { header, plan } = current;
  const tripId = file.header.tripId?.value;
  const basePlanId = file.header.basePlanId?.value;
  const baseRevision = file.resolved.baseRevision;
  if (file.kind !== 'update' || !tripId || !basePlanId || baseRevision === undefined) {
    return {
      status: 'blocked',
      reason: 'bad-header',
      message: '여행ID·기준계획·기준revision 줄을 읽을 수 없어 어느 여행의 어느 시점 글인지 알 수 없습니다.',
    };
  }
  if (tripId !== header.tripId) {
    return {
      status: 'blocked',
      reason: 'other-trip',
      message: '이 글은 지금 열려 있는 여행의 글이 아닙니다.',
      otherTripId: tripId,
    };
  }
  if (basePlanId !== header.currentPlanVersionId || plan.planVersionId !== header.currentPlanVersionId) {
    return { status: 'blocked', reason: 'stale-plan', message: STALE_PLAN_MESSAGE };
  }
  if (baseRevision !== header.domainRevision) {
    return { status: 'blocked', reason: 'stale-revision', message: STALE_REVISION_MESSAGE };
  }
  return undefined;
}

function nightsBetween(checkIn: string, checkOut: string) {
  return Temporal.PlainDate.from(checkIn).until(Temporal.PlainDate.from(checkOut), { largestUnit: 'days' }).days;
}

function dateStayTime(checkIn: string, checkOut: string): PlanStay['time'] {
  return { start: { precision: 'date', date: checkIn }, end: { precision: 'date', date: checkOut } };
}

class UpdateComputer {
  private readonly changes: ChangeEntry[] = [];
  private readonly skipped: ChangeEntry[] = [];
  private readonly unchanged: UnchangedEntry[] = [];
  private readonly ignored: string[] = [];
  private readonly errors: UpdateProblem[] = [];
  private readonly itemById = new Map<string, PlanItem>();
  private readonly stayById = new Map<string, PlanStay>();
  private readonly dayById = new Map<string, PlanDay>();
  private readonly dayByDate = new Map<string, PlanDay>();
  private readonly nextOrder = new Map<string, number>();
  private readonly newKeys = new Set<string>();
  private readonly touched = new Set<string>();
  private readonly placeNames: ReadonlyMap<string, string>;
  private keyCount = 0;

  constructor(
    private readonly file: CheckedPlanFile,
    private readonly current: CurrentTrip,
  ) {
    const { plan } = current;
    this.placeNames = current.placeNames ?? new Map();
    plan.items.forEach((item) => this.itemById.set(item.activityId, item));
    plan.stays.forEach((stay) => this.stayById.set(stay.stayId, stay));
    plan.days.forEach((day) => {
      this.dayById.set(day.dayId, day);
      this.dayByDate.set(day.date, day);
      const orders = plan.items.filter((item) => item.dayId === day.dayId).map((item) => item.order);
      this.nextOrder.set(day.dayId, orders.length === 0 ? 0 : Math.max(...orders) + 1);
    });
  }

  run(): ReadyResult {
    this.file.days.forEach((day) => day.rows.forEach((row) => this.activityRow(row, day)));
    this.file.stays.forEach((row) => this.stayRow(row));
    this.file.deletions.forEach((row) => this.deletionRow(row));
    return {
      status: 'ready',
      rangeExport: this.file.notImported.some((item) => item.kind === 'header' && item.name === '범위'),
      changes: this.changes,
      unchanged: this.unchanged,
      skipped: this.skipped,
      ignored: this.ignored,
      errors: this.errors,
    };
  }

  // ── 공통 ───────────────────────────────────────────────

  private fail(line: number, section: string, message: string) {
    this.errors.push({ where: `${line}줄`, section, message });
  }

  private key(prefix: string) {
    this.keyCount++;
    return `${prefix}-${this.keyCount}`;
  }

  private allocOrder(dayId: string) {
    const order = this.nextOrder.get(dayId) ?? 0;
    this.nextOrder.set(dayId, order + 1);
    return order;
  }

  private dateOfItem(item: PlanItem) {
    return this.dayById.get(item.dayId)?.date ?? '';
  }

  private hasLegs(activityId: string) {
    return this.current.plan.legs.some((leg) => leg.fromActivityId === activityId || leg.toActivityId === activityId);
  }

  private zoneFor(day: FileDay) {
    return day.timeZone ?? this.file.resolved.timeZone ?? this.current.header.defaultTimeZone;
  }

  /**
   * 칸 하나를 현재 값과 비교한다. 빈 칸은 변경 없음, `(비움)`은 지움.
   * 바뀌면 `fields`에 넣고 새 값(지움은 빈 문자열)을, 바뀌지 않으면 undefined를 돌려준다.
   */
  private compare(
    fields: FieldChange[],
    row: { cleared: string[] },
    label: string,
    rowValue: string,
    currentValue: string,
  ) {
    if (row.cleared.includes(label)) {
      if (viaTable(currentValue) === '') {
        return undefined;
      }
      fields.push({ name: label, before: currentValue, after: '', cleared: true });
      return '';
    }
    if (rowValue === '' || viaTable(currentValue) === rowValue) {
      return undefined;
    }
    fields.push({ name: label, before: currentValue, after: rowValue, cleared: false });
    return rowValue;
  }

  // ── 활동 ───────────────────────────────────────────────

  private activityRow(row: ActivityRow, day: FileDay) {
    const section = `일정 ${day.date}`;
    const target = this.dayByDate.get(day.date);
    if (!target) {
      this.fail(row.line, section, `${day.date}은 이 여행의 날짜가 아닙니다.`);
      return;
    }
    if (row.id === '') {
      this.addActivity(row, day, target);
    } else {
      this.editActivity(row, day, target);
    }
  }

  private addActivity(row: ActivityRow, day: FileDay, target: PlanDay) {
    const { header, plan } = this.current;
    const zone = this.zoneFor(day);
    const problem = timeSpecProblem(row.span, { date: day.date, timeZone: zone });
    if (problem) {
      this.fail(row.line, `일정 ${day.date}`, `시간 "${row.time}": ${problem}`);
      return;
    }
    const placeMark = row.place === '' ? '' : `[장소: ${row.place}]`;
    const item: PlanItem = {
      tripId: header.tripId,
      planVersionId: plan.planVersionId,
      activityId: crypto.randomUUID(),
      dayId: target.dayId,
      order: this.allocOrder(target.dayId),
      title: row.title,
      category: row.category,
      time: buildActivityTime(row.span, { date: day.date, timeZone: zone }),
      summary: joinText([placeMark, row.memo]),
      ...(row.reservation === '' ? {} : { reservationText: row.reservation }),
      optional: false,
      placeLinks: [],
      bookingIds: [],
      taskRefs: [],
      executionMarkers: [],
      ...(row.link === '' ? {} : { officialUrl: row.link }),
      sourceFlags: [],
    };
    if (!planItemSchema.safeParse(item).success) {
      this.fail(row.line, `일정 ${day.date}`, `새 활동 "${row.title}"이 저장 형식에 맞지 않습니다.`);
      return;
    }
    const shown = [
      { name: '시간', value: row.time },
      { name: '종류', value: row.category },
      { name: '장소', value: row.place },
      { name: '메모', value: row.memo },
      { name: '예약', value: row.reservation },
      { name: '링크', value: row.link },
    ];
    const fields: FieldChange[] = shown
      .filter((field) => field.value !== '')
      .map((field) => ({ name: field.name, before: '', after: field.value, cleared: false }));
    const entry: ChangeEntry = {
      key: this.key('add'),
      kind: 'add',
      entity: 'activity',
      date: day.date,
      title: row.title,
      fields,
      notes: [],
      operation: { type: 'upsert-item', item },
    };
    this.placeNew(entry, `${target.dayId}|${row.title}`, this.hasSameActivity(target, row.title));
  }

  private hasSameActivity(target: PlanDay, title: string) {
    return this.current.plan.items.some((item) => item.dayId === target.dayId && item.title.trim() === title);
  }

  /** 새 줄: 이미 있는(또는 같은 글의 앞선 줄과 같은) 항목이면 건너뜀 후보로 둔다(AC-09). */
  private placeNew(entry: ChangeEntry, identity: string, existsAlready: boolean) {
    const duplicate = existsAlready || this.newKeys.has(identity);
    this.newKeys.add(identity);
    if (duplicate) {
      entry.notes.push('이미 같은 항목이 있어 기본으로 넣지 않습니다. 정말 하나 더 넣으려면 고르세요.');
      this.skipped.push(entry);
    } else {
      this.changes.push(entry);
    }
  }

  private editActivity(row: ActivityRow, day: FileDay, target: PlanDay) {
    const section = `일정 ${day.date}`;
    const item = this.itemById.get(row.id);
    if (!item) {
      const message = this.stayById.has(row.id)
        ? `ID ${row.id}는 숙소의 ID인데 일정 표에 있습니다.`
        : `ID ${row.id}인 활동이 이 여행에 없습니다.`;
      this.fail(row.line, section, message);
      return;
    }
    this.touched.add(`활동:${row.id}`);
    const currentDate = this.dateOfItem(item);
    const moved = currentDate !== day.date;
    if (moved && this.hasLegs(item.activityId)) {
      this.fail(
        row.line,
        section,
        `"${item.title}"에 연결된 이동이 있어 다른 날짜로 옮길 수 없습니다. 앱 화면에서 이동을 먼저 정리하세요.`,
      );
      return;
    }
    const { cells, notes } = activityCellsOf(item, {
      date: currentDate,
      placeNames: this.placeNames,
      includeReservation: true,
    });
    const timeProblem = notes.length > 0;
    const fields: FieldChange[] = [];
    const entryNotes: string[] = [];
    const next: PlanItem = { ...item };

    const title = this.compare(fields, row, '제목', row.title, cells.title);
    if (title !== undefined) {
      next.title = title;
    }
    const category = this.compare(fields, row, '종류', row.category, cells.category);
    if (category !== undefined) {
      next.category = category;
    }
    const reservation = this.compare(fields, row, '예약', row.reservation, cells.reservation);
    if (reservation !== undefined) {
      this.setOptional(next, 'reservationText', reservation);
    }
    const link = this.compare(fields, row, '링크', row.link, cells.link);
    if (link !== undefined) {
      this.setOptional(next, 'officialUrl', link);
    }

    this.applySummary(next, { row, cells, fields, notes: entryNotes, timeProblem });

    const timeResult = this.timeFor({ row, day, item, cells, moved, timeProblem, fields });
    if (timeResult === 'error') {
      return;
    }
    if (timeResult) {
      next.time = timeResult;
    }
    if (moved) {
      next.dayId = target.dayId;
      next.order = this.allocOrder(target.dayId);
      fields.push({ name: '날짜', before: currentDate, after: day.date, cleared: false });
    }
    if (fields.length === 0) {
      this.unchanged.push({ entity: 'activity', date: currentDate, title: item.title });
      return;
    }
    if (!planItemSchema.safeParse(next).success) {
      this.fail(row.line, section, `"${item.title}"의 수정 결과가 저장 형식에 맞지 않습니다.`);
      return;
    }
    this.changes.push({
      key: this.key(moved ? 'move' : 'edit'),
      kind: moved ? 'move' : 'edit',
      entity: 'activity',
      date: day.date,
      title: item.title,
      fields,
      notes: entryNotes,
      operation: { type: 'upsert-item', item: next },
    });
  }

  private setOptional(item: PlanItem, key: 'reservationText' | 'officialUrl', value: string) {
    if (value === '') {
      delete item[key];
    } else {
      item[key] = value;
    }
  }

  /**
   * 장소 칸과 메모 칸은 저장 값 하나(`summary`)로 합친다. 한 칸만 바뀌어도 다른 칸의 현재 값을 지키고,
   * 연결된 장소는 바꾸지 않는다.
   */
  private applySummary(
    next: PlanItem,
    context: {
      row: ActivityRow;
      cells: ReturnType<typeof activityCellsOf>['cells'];
      fields: FieldChange[];
      notes: string[];
      timeProblem: boolean;
    },
  ) {
    const { row, cells, fields, notes, timeProblem } = context;
    const linked = linkedPlaceName(next, this.placeNames);
    const placeFields: FieldChange[] = [];
    const placeAfter = this.compare(placeFields, row, '장소', row.place, cells.place);
    const memoFields: FieldChange[] = [];
    const memoRaw = this.compare(memoFields, row, '메모', row.memo, cells.memo);
    if (linked !== undefined && placeAfter === '') {
      this.ignored.push(`"${next.title}": 연결된 장소는 바뀌지 않아 장소 칸의 (비움)은 반영하지 않습니다.`);
      placeFields.length = 0;
    }
    const placeChanged = placeFields.length > 0;
    if (!placeChanged && memoRaw === undefined) {
      return;
    }
    const memo = memoRaw === undefined ? withoutTimeNote(cells.memo) : timeProblem ? withoutTimeNote(memoRaw) : memoRaw;
    const memoField = memoFields.map((field) => ({
      ...field,
      before: timeProblem ? withoutTimeNote(field.before) : field.before,
      after: timeProblem ? withoutTimeNote(field.after) : field.after,
    }));
    if (linked !== undefined) {
      const placeName = placeChanged ? (placeAfter ?? '') : '';
      next.summary = placeName === '' ? memo : joinText([`[장소: ${placeName}]`, memo]);
      if (placeChanged) {
        notes.push('연결된 장소는 바뀌지 않습니다. 새 장소 이름은 메모 앞에 적힙니다.');
      }
    } else {
      const placeName = placeAfter === undefined ? cells.place : placeAfter;
      next.summary = joinText([placeName === '' ? '' : `[장소: ${placeName}]`, memo]);
    }
    fields.push(...placeFields, ...memoField);
  }

  /** 시간 칸 결과. 바뀐 시간·undefined(그대로)·'error'. 날짜를 옮기면 시간도 새 날짜로 옮긴다. */
  private timeFor(context: {
    row: ActivityRow;
    day: FileDay;
    item: PlanItem;
    cells: ReturnType<typeof activityCellsOf>['cells'];
    moved: boolean;
    timeProblem: boolean;
    fields: FieldChange[];
  }): PlanItem['time'] | undefined | 'error' {
    const { row, day, item, cells, moved, timeProblem, fields } = context;
    const section = `일정 ${day.date}`;
    const zone = this.zoneFor(day);
    const changed = this.compare(fields, row, '시간', row.time, cells.time);
    if (changed !== undefined) {
      const problem = timeSpecProblem(row.span, { date: day.date, timeZone: zone });
      if (problem) {
        this.fail(row.line, section, `시간 "${row.time}": ${problem}`);
        return 'error';
      }
      this.relabelTime(fields);
      return buildActivityTime(row.span, { date: day.date, timeZone: zone });
    }
    if (!moved) {
      return undefined;
    }
    if (timeProblem) {
      this.fail(
        row.line,
        section,
        `"${item.title}"의 시간을 양식으로 적을 수 없어 날짜를 옮길 수 없습니다. 시간 칸에 시각을 적으세요.`,
      );
      return 'error';
    }
    const parsed = parseTimeCell(cells.time);
    const keepZone = item.time.start.precision === 'local' ? item.time.start.timeZone : undefined;
    return buildActivityTime(parsed.ok ? parsed.span : undefined, { date: day.date, timeZone: keepZone ?? zone });
  }

  private relabelTime(fields: FieldChange[]) {
    const entry = fields.find((field) => field.name === '시간');
    if (entry && entry.before === '') {
      entry.before = NO_TIME_LABEL;
    }
    if (entry && entry.after === '') {
      entry.after = NO_TIME_LABEL;
    }
  }

  // ── 숙소 ───────────────────────────────────────────────

  private stayRow(row: StayRow) {
    if (row.region !== '' || row.booking !== '') {
      this.ignored.push(`숙소 "${row.name || row.id}": 지역·예약 칸은 이 단계에서 반영하지 않습니다.`);
    }
    if (row.id === '') {
      this.addStay(row);
    } else {
      this.editStay(row);
    }
  }

  private addStay(row: StayRow) {
    const { header, plan } = this.current;
    const stay: PlanStay = {
      tripId: header.tripId,
      planVersionId: plan.planVersionId,
      stayId: crypto.randomUUID(),
      baseText: row.name,
      time: dateStayTime(row.checkIn, row.checkOut),
      plannedNights: nightsBetween(row.checkIn, row.checkOut),
    };
    if (!planStaySchema.safeParse(stay).success) {
      this.fail(row.line, '숙소', `새 숙소 "${row.name}"이 저장 형식에 맞지 않습니다.`);
      return;
    }
    const entry: ChangeEntry = {
      key: this.key('add'),
      kind: 'add',
      entity: 'stay',
      date: row.checkIn,
      title: row.name,
      fields: [
        { name: '체크인', before: '', after: row.checkIn, cleared: false },
        { name: '체크아웃', before: '', after: row.checkOut, cleared: false },
      ],
      notes: [],
      operation: { type: 'upsert-stay', stay },
    };
    const exists = plan.stays.some(
      (other) => other.baseText.trim() === row.name && other.time.start.date === row.checkIn,
    );
    this.placeNew(entry, `stay|${row.name}|${row.checkIn}`, exists);
  }

  private editStay(row: StayRow) {
    const stay = this.stayById.get(row.id);
    if (!stay) {
      const message = this.itemById.has(row.id)
        ? `ID ${row.id}는 활동의 ID인데 숙소 표에 있습니다.`
        : `ID ${row.id}인 숙소가 이 여행에 없습니다.`;
      this.fail(row.line, '숙소', message);
      return;
    }
    this.touched.add(`숙소:${row.id}`);
    const currentCheckIn = stay.time.start.date ?? '';
    const currentCheckOut = stay.time.end?.date ?? '';
    const fields: FieldChange[] = [];
    const checkIn = this.compare(fields, row, '체크인', row.checkIn, currentCheckIn);
    const checkOut = this.compare(fields, row, '체크아웃', row.checkOut, currentCheckOut);
    const name = this.compare(fields, row, '이름', row.name, stay.baseText);
    if (fields.length === 0) {
      this.unchanged.push({ entity: 'stay', date: currentCheckIn, title: stay.baseText });
      return;
    }
    const nextIn = checkIn ?? currentCheckIn;
    const nextOut = checkOut ?? currentCheckOut;
    if (nextIn === '' || nextOut === '' || nextOut <= nextIn) {
      this.fail(row.line, '숙소', `"${stay.baseText}"의 체크아웃은 체크인보다 늦어야 합니다.`);
      return;
    }
    const next: PlanStay = { ...stay, baseText: name ?? stay.baseText };
    if (checkIn !== undefined || checkOut !== undefined) {
      next.time = dateStayTime(nextIn, nextOut);
      next.plannedNights = nightsBetween(nextIn, nextOut);
    }
    if (!planStaySchema.safeParse(next).success) {
      this.fail(row.line, '숙소', `"${stay.baseText}"의 수정 결과가 저장 형식에 맞지 않습니다.`);
      return;
    }
    this.changes.push({
      key: this.key('edit'),
      kind: 'edit',
      entity: 'stay',
      date: nextIn,
      title: stay.baseText,
      fields,
      notes: [],
      operation: { type: 'upsert-stay', stay: next },
    });
  }

  // ── 삭제 ───────────────────────────────────────────────

  private deletionRow(row: DeletionRow) {
    if (this.touched.has(`${row.kind}:${row.id}`)) {
      this.fail(row.line, '삭제', `ID ${row.id}는 같은 글에서 수정되고 있어 함께 삭제할 수 없습니다.`);
      return;
    }
    if (row.kind === '활동') {
      this.deleteActivity(row);
    } else {
      this.deleteStay(row);
    }
  }

  private deleteActivity(row: DeletionRow) {
    const item = this.itemById.get(row.id);
    if (!item) {
      const message = this.stayById.has(row.id)
        ? `ID ${row.id}는 숙소의 ID인데 종류가 활동입니다.`
        : `삭제할 활동 ID ${row.id}가 이 여행에 없습니다.`;
      this.fail(row.line, '삭제', message);
      return;
    }
    if (this.hasLegs(item.activityId)) {
      this.fail(
        row.line,
        '삭제',
        `"${item.title}"에 연결된 이동이 있어 삭제할 수 없습니다. 앱 화면에서 이동을 먼저 정리하세요.`,
      );
      return;
    }
    this.changes.push({
      key: this.key('delete'),
      kind: 'delete',
      entity: 'activity',
      date: this.dateOfItem(item),
      title: item.title,
      fields: [],
      notes: [],
      operation: { type: 'remove-item', activityId: item.activityId },
    });
  }

  private deleteStay(row: DeletionRow) {
    const stay = this.stayById.get(row.id);
    if (!stay) {
      const message = this.itemById.has(row.id)
        ? `ID ${row.id}는 활동의 ID인데 종류가 숙소입니다.`
        : `삭제할 숙소 ID ${row.id}가 이 여행에 없습니다.`;
      this.fail(row.line, '삭제', message);
      return;
    }
    this.changes.push({
      key: this.key('delete'),
      kind: 'delete',
      entity: 'stay',
      date: stay.time.start.date ?? '',
      title: stay.baseText,
      fields: [],
      notes: [],
      operation: { type: 'remove-stay', stayId: stay.stayId },
    });
  }
}

/**
 * 수정 글(`kind: 'update'`의 검사 결과)을 현재 여행과 줄 단위로 맞춰 변경으로 계산한다. 순수 함수.
 * 기준이 다르면 `blocked`. 오류가 있는 표는 검사 단계에서 이미 빠져 있다.
 */
export function computeUpdate(file: CheckedPlanFile, current: CurrentTrip): UpdateResult {
  return checkTarget(file, current) ?? new UpdateComputer(file, current).run();
}
