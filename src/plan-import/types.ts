/**
 * 여행계획 양식 v1(`travel-app-plan/1`) 변환기의 중간 구조.
 * 저장 스키마와 무관한 자체 타입이며 브라우저 API·DB에 의존하지 않는다.
 */

export type SourceLine = { line: number; text: string };

export type IssueSeverity = 'error' | 'warning';

/** 사람이 읽는 오류·경고. 줄 번호는 입력 글 전체 기준(1부터)이다. */
export type PlanIssue = {
  severity: IssueSeverity;
  line: number;
  section: string;
  code: string;
  message: string;
};

export type RejectionCode =
  'too-large' | 'not-plan' | 'ambiguous' | 'format-version' | 'is-plan' | 'is-guide' | 'is-prep';

export type Rejection = { code: RejectionCode; message: string };

export type HeaderValue = { value: string; line: number };

export type HeaderKey = 'format' | 'period' | 'timeZone' | 'tripId' | 'basePlanId' | 'baseRevision';

export type PlanHeader = {
  name?: HeaderValue;
  format?: HeaderValue;
  period?: HeaderValue;
  timeZone?: HeaderValue;
  tripId?: HeaderValue;
  basePlanId?: HeaderValue;
  baseRevision?: HeaderValue;
};

/** `new`: 여행ID 3줄 없음, `update`: 3줄 모두 있음, `invalid`: 일부만 있거나 중복, `rejected`: 양식 아님. */
export type PlanKind = 'new' | 'update' | 'invalid' | 'rejected';

/** 시간 칸 해석 결과. 분은 그날 0시부터의 분이며 `(+1)`이면 end가 1440을 넘는다. */
export type TimeSpan = { startMinute: number; endMinute?: number; overnight: boolean };

/** 값 없음(빈 칸)·`(비움)`(지움)을 구분하기 위해 지움 표시 열 이름을 따로 모은다. */
type RowBase = { line: number; tableLine: number; cleared: string[] };

export type ActivityRow = RowBase & {
  id: string;
  time: string;
  title: string;
  category: string;
  place: string;
  memo: string;
  reservation: string;
  link: string;
  span?: TimeSpan;
};

export type StayRow = RowBase & {
  id: string;
  checkIn: string;
  checkOut: string;
  name: string;
  region: string;
  booking: string;
};

export type PlaceRow = RowBase & {
  id: string;
  name: string;
  region: string;
  description: string;
  hours: string;
  link: string;
};

export type DeletionRow = RowBase & {
  kind: string;
  id: string;
  title: string;
};

export type PlanDay = {
  line: number;
  /** `### ` 줄의 첫 낱말. 검사 전에는 날짜가 아닐 수 있다. */
  date: string;
  title: string;
  timeZone?: string;
  rows: ActivityRow[];
  /** 이 날짜의 표에 구조 오류가 있어 날짜 전체를 결과에서 빼야 한다. */
  broken: boolean;
};

export type NotImportedKind = 'section' | 'column' | 'header';

/** 읽지 않고 지나간 것. `lineCount`는 표 제목·구분 줄을 뺀 줄 수다. */
export type NotImported = { kind: NotImportedKind; name: string; where?: string; lineCount: number };

/** 오류 때문에 결과에서 빠진 표. 일정은 날짜 단위로 기록한다. */
export type DroppedTable = {
  section: string;
  label: string;
  line: number;
  rowCount: number;
};

export type PlanFile = {
  kind: PlanKind;
  rejection?: Rejection;
  header: PlanHeader;
  days: PlanDay[];
  stays: StayRow[];
  places: PlaceRow[];
  deletions: DeletionRow[];
  issues: PlanIssue[];
  notImported: NotImported[];
  dropped: DroppedTable[];
};

export type ResolvedHeader = {
  name?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  baseRevision?: number;
};

export type CheckedPlanFile = PlanFile & {
  resolved: ResolvedHeader;
  /** 머리 줄이 새 여행을 만들 수 있을 만큼 온전한가(표 오류와 무관). */
  saveable: boolean;
};
