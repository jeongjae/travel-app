import { Temporal } from '@js-temporal/polyfill';
import type { PlanVersion } from '../contracts/v2';
import { buildNewTrip } from '../content/trip-factory';
import { buildActivityTime } from './time-cell';
import type { ActivityRow, CheckedPlanFile, StayRow } from './types';

type NewTrip = ReturnType<typeof buildNewTrip>;
type PlanItem = PlanVersion['items'][number];

/** 미리보기에 따로 보여 줄 앱의 보탬: 앱이 만든 활동과 메모에 덧붙인 글. */
export type NewTripPreview = {
  addedActivities: { date: string; title: string }[];
  memoAdditions: { date: string; activityTitle: string; text: string }[];
};

export type NewTripResult =
  | { ok: true; header: NewTrip['header']; initialPlan: NewTrip['initialPlan']; preview: NewTripPreview }
  | { ok: false; reason: string };

const LODGING_CATEGORY = '숙박';

function joinText(parts: string[]) {
  return parts.filter((part) => part !== '').join(' ');
}

function buildSummary(row: ActivityRow) {
  const placeMark = row.place === '' ? '' : `[장소: ${row.place}]`;
  return joinText([placeMark, row.memo]);
}

function stayMemoText(stay: StayRow) {
  return joinText([
    stay.region === '' ? '' : `[숙소 지역: ${stay.region}]`,
    stay.booking === '' ? '' : `[숙소 예약: ${stay.booking}]`,
  ]);
}

class NewTripAssembler {
  private readonly trip: NewTrip;
  private readonly itemsByDate = new Map<string, PlanItem[]>();
  private readonly preview: NewTripPreview = { addedActivities: [], memoAdditions: [] };

  constructor(private readonly file: CheckedPlanFile) {
    const { name, start, end, timeZone } = file.resolved;
    this.trip = buildNewTrip({ name: name!, start: start!, end: end!, timeZone });
  }

  assemble(): NewTripResult {
    this.applyDays();
    this.applyStays();
    const items = this.trip.initialPlan.days.flatMap((day) => this.itemsByDate.get(day.date) ?? []);
    return {
      ok: true,
      header: this.trip.header,
      initialPlan: { ...this.trip.initialPlan, items },
      preview: this.preview,
    };
  }

  private dayIdOf(date: string) {
    return this.trip.initialPlan.days.find((day) => day.date === date)!.dayId;
  }

  private applyDays() {
    for (const day of this.file.days) {
      const planDay = this.trip.initialPlan.days.find((candidate) => candidate.date === day.date);
      if (!planDay || day.rows.length === 0) {
        continue;
      }
      if (day.title !== '') {
        planDay.title = day.title;
      }
      const zone = day.timeZone ?? this.file.resolved.timeZone;
      const items = day.rows.map((row, order) => this.buildItem(row, planDay.dayId, day.date, order, zone));
      this.itemsByDate.set(day.date, items);
    }
  }

  private buildItem(row: ActivityRow, dayId: string, date: string, order: number, zone: string | undefined): PlanItem {
    const { tripId, currentPlanVersionId } = this.trip.header;
    return {
      tripId,
      planVersionId: currentPlanVersionId,
      activityId: crypto.randomUUID(),
      dayId,
      order,
      title: row.title,
      category: row.category,
      time: buildActivityTime(row.span, { date, timeZone: zone }),
      summary: buildSummary(row),
      ...(row.reservation === '' ? {} : { reservationText: row.reservation }),
      optional: false,
      placeLinks: [],
      bookingIds: [],
      taskRefs: [],
      executionMarkers: [],
      ...(row.link === '' ? {} : { officialUrl: row.link }),
      sourceFlags: [],
    };
  }

  private applyStays() {
    this.trip.initialPlan.stays = this.file.stays.map((stay) => {
      this.noteStayMemo(stay);
      return this.buildStay(stay);
    });
  }

  private buildStay(stay: StayRow): PlanVersion['stays'][number] {
    const { tripId, currentPlanVersionId } = this.trip.header;
    const nights = Temporal.PlainDate.from(stay.checkIn).until(Temporal.PlainDate.from(stay.checkOut), {
      largestUnit: 'days',
    }).days;
    return {
      tripId,
      planVersionId: currentPlanVersionId,
      stayId: crypto.randomUUID(),
      baseText: stay.name,
      time: { start: { precision: 'date', date: stay.checkIn }, end: { precision: 'date', date: stay.checkOut } },
      plannedNights: nights,
    };
  }

  /** 규격 §5-1: 지역·예약 원문은 체크인 날의 숙박 활동 메모에 남기고, 없으면 활동을 하나 만든다. */
  private noteStayMemo(stay: StayRow) {
    const memo = stayMemoText(stay);
    if (memo === '') {
      return;
    }
    const items = this.itemsByDate.get(stay.checkIn) ?? [];
    const lodging = items.find((item) => item.category === LODGING_CATEGORY);
    if (lodging) {
      lodging.summary = joinText([lodging.summary, memo]);
      this.preview.memoAdditions.push({ date: stay.checkIn, activityTitle: lodging.title, text: memo });
      return;
    }
    const added = this.buildAddedLodgingItem(stay, items.length, memo);
    this.itemsByDate.set(stay.checkIn, [...items, added]);
    this.preview.addedActivities.push({ date: stay.checkIn, title: added.title });
  }

  private buildAddedLodgingItem(stay: StayRow, order: number, memo: string): PlanItem {
    const row: ActivityRow = {
      line: 0,
      tableLine: 0,
      cleared: [],
      id: '',
      time: '',
      title: `숙소: ${stay.name}`,
      category: LODGING_CATEGORY,
      place: '',
      memo,
      reservation: '',
      link: '',
    };
    return this.buildItem(row, this.dayIdOf(stay.checkIn), stay.checkIn, order, undefined);
  }
}

/**
 * 새 여행 파일을 `CreateTrip`에 넣을 `{ header, initialPlan }`로 만든다.
 * 오류로 빠진 표는 이미 결과에서 빠져 있으므로 표 오류가 있어도 만들 수 있다(저장 여부는 화면에서 확인).
 * 머리 줄이 온전하지 않거나 새 여행 파일이 아니면 만들지 않는다. 호출마다 새 ID가 만들어진다.
 */
export function toNewTrip(file: CheckedPlanFile): NewTripResult {
  if (file.kind !== 'new') {
    return { ok: false, reason: '새 여행 파일이 아닙니다.' };
  }
  if (!file.saveable) {
    return { ok: false, reason: '머리 줄(이름·기간·시간대)에 오류가 있어 새 여행을 만들 수 없습니다.' };
  }
  return new NewTripAssembler(file).assemble();
}
