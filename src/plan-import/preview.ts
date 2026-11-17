import type { PlanVersion } from '../contracts/v2';
import { checkPlanFile } from './check';
import { parsePlanFile } from './parse';
import { toNewTrip, type NewTripPreview, type NewTripResult } from './to-new-trip';
import type { CheckedPlanFile, NotImported, PlanIssue } from './types';

type CreatedTrip = Extract<NewTripResult, { ok: true }>;

/** 미리보기 화면 상태. 양식 아님·수정 파일·머리 줄 오류는 저장할 수 없다. */
export type PreviewState = 'not-plan' | 'update' | 'invalid' | 'header-error' | 'ready';

export type PreviewActivity = { time: string; title: string; category: string; addedByApp: boolean };

export type PreviewDay = { date: string; title: string; activities: PreviewActivity[] };

export type PreviewProblem = { where: string; section: string; message: string };

export type PreviewDropped = { section: string; label: string; where: string; rowCount: number };

export type PlanPreview = {
  state: PreviewState;
  /** 거부·분류 사유를 사람이 읽는 문장으로. */
  message?: string;
  file: CheckedPlanFile;
  tripName?: string;
  period?: string;
  timeZoneLabel: string;
  days: PreviewDay[];
  stays: { name: string; period: string }[];
  activityCount: number;
  stayCount: number;
  placeCount: number;
  appChanges: NewTripPreview;
  errors: PreviewProblem[];
  warnings: PreviewProblem[];
  dropped: PreviewDropped[];
  notImported: string[];
  /** 같은 이름·같은 기간의 여행이 이미 있다. */
  duplicateOfExisting: boolean;
  /** 저장 때 그대로 쓰는 변환 결과. 호출마다 ID가 새로 만들어지므로 미리보기에서 한 번만 만든다. */
  trip?: CreatedTrip;
};

export type ExistingTrip = { name: string; startDate: string; endDate: string };

export const RETRY_REQUEST_HINT =
  '챗봇에게 "앱 양식의 코드 블록 하나로 다시 정리해 줘"라고 요청한 뒤 그 블록을 복사해 붙여 넣으세요.';

const UPDATE_MESSAGE = '기존 여행을 고치는 글입니다. 이 기능은 다음 단계에서 지원합니다.';
const INVALID_MESSAGE =
  '여행ID·기준계획·기준revision 줄이 일부만 있거나 중복되어 새 여행인지 수정인지 알 수 없습니다. 저장할 수 없습니다.';

function whereOf(line: number) {
  return line === 0 ? '머리 줄' : `${line}줄`;
}

function problemOf(issue: PlanIssue): PreviewProblem {
  return { where: whereOf(issue.line), section: issue.section, message: issue.message };
}

function notImportedText(item: NotImported) {
  if (item.kind === 'section') {
    return `구역 "${item.name}" ${item.lineCount}줄`;
  }
  if (item.kind === 'column') {
    return `열 "${item.name}"(${item.where ?? ''}) ${item.lineCount}줄`;
  }
  return `머리 줄 "${item.name}"`;
}

function clockOf(spec: PlanVersion['items'][number]['time']['start'] | undefined) {
  return spec && spec.precision === 'local' ? spec.localTime.slice(0, 5) : undefined;
}

function timeLabelOf(time: PlanVersion['items'][number]['time']) {
  const start = clockOf(time.start);
  if (!start) {
    return '시간 미정';
  }
  const end = clockOf(time.end);
  if (!end) {
    return start;
  }
  const nextDay = time.end?.date !== undefined && time.end.date !== time.start.date;
  return `${start}-${end}${nextDay ? '(+1)' : ''}`;
}

function stateOf(file: CheckedPlanFile): PreviewState {
  if (file.kind === 'rejected') {
    return 'not-plan';
  }
  if (file.kind === 'update') {
    return 'update';
  }
  if (file.kind === 'invalid') {
    return 'invalid';
  }
  return file.saveable ? 'ready' : 'header-error';
}

function messageOf(file: CheckedPlanFile, state: PreviewState) {
  if (state === 'not-plan' && file.rejection?.code === 'is-guide') {
    return file.rejection.message;
  }
  if (state === 'not-plan') {
    return `${file.rejection?.message ?? '앱 양식이 아닙니다.'} ${RETRY_REQUEST_HINT}`;
  }
  if (state === 'update') {
    return UPDATE_MESSAGE;
  }
  if (state === 'invalid') {
    return INVALID_MESSAGE;
  }
  if (state === 'header-error') {
    return '머리 줄(이름·기간·시간대)에 오류가 있어 저장할 수 없습니다. 아래 오류를 챗봇에게 알려 고쳐 달라고 하세요.';
  }
  return undefined;
}

function daysOf(trip: CreatedTrip, appChanges: NewTripPreview): PreviewDay[] {
  const addedKeys = new Set(appChanges.addedActivities.map((added) => `${added.date}|${added.title}`));
  return trip.initialPlan.days
    .map((day) => {
      const items = trip.initialPlan.items.filter((item) => item.dayId === day.dayId);
      const activities = items.map((item) => ({
        time: timeLabelOf(item.time),
        title: item.title,
        category: item.category,
        addedByApp: addedKeys.has(`${day.date}|${item.title}`),
      }));
      return { date: day.date, title: day.title, activities };
    })
    .filter((day) => day.activities.length > 0);
}

function timeZoneLabelOf(file: CheckedPlanFile) {
  return file.resolved.timeZone ?? '시간대 미확인';
}

function sameTrip(file: CheckedPlanFile, existing: ExistingTrip[]) {
  const { name, start, end } = file.resolved;
  return existing.some((trip) => trip.name === name && trip.startDate === start && trip.endDate === end);
}

/**
 * 붙여넣은 글 → 미리보기 계산(순수 함수). 저장할 수 있는 상태면 변환 결과(`trip`)를 한 번 만들어 함께 돌려준다.
 */
export function buildPlanPreview(text: string, existing: ExistingTrip[] = []): PlanPreview {
  const file = checkPlanFile(parsePlanFile(text));
  const state = stateOf(file);
  const result = state === 'ready' ? toNewTrip(file) : undefined;
  const trip = result?.ok ? result : undefined;
  const appChanges = trip?.preview ?? { addedActivities: [], memoAdditions: [] };
  const { start, end } = file.resolved;
  return {
    state,
    message: messageOf(file, state),
    file,
    tripName: file.resolved.name,
    period: start && end ? `${start} ~ ${end}` : undefined,
    timeZoneLabel: timeZoneLabelOf(file),
    days: trip ? daysOf(trip, appChanges) : [],
    stays: file.stays.map((stay) => ({ name: stay.name, period: `${stay.checkIn} ~ ${stay.checkOut}` })),
    activityCount: trip?.initialPlan.items.length ?? 0,
    stayCount: file.stays.length,
    placeCount: file.places.length,
    appChanges,
    errors: file.issues.filter((issue) => issue.severity === 'error').map(problemOf),
    warnings: file.issues.filter((issue) => issue.severity === 'warning').map(problemOf),
    dropped: file.dropped.map((item) => ({
      section: item.section,
      label: item.label,
      where: whereOf(item.line),
      rowCount: item.rowCount,
    })),
    notImported: file.notImported.map(notImportedText),
    duplicateOfExisting: trip ? sameTrip(file, existing) : false,
    trip,
  };
}

/** 저장 단추를 켤 수 있는가: 확인란을 모두 체크했을 때만 저장할 수 있다. */
export function canSavePreview(preview: PlanPreview, confirmedDropped: boolean, confirmedDuplicate: boolean) {
  if (preview.state !== 'ready' || !preview.trip) {
    return false;
  }
  if (preview.dropped.length > 0 && !confirmedDropped) {
    return false;
  }
  return !preview.duplicateOfExisting || confirmedDuplicate;
}
