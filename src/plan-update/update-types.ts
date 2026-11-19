import type { PlanVersion, TripDataset } from '../contracts/v2';

type TripHeader = TripDataset['header'];

/** `ChangePlan`에 넣는 연산 하나(`planEditOperationSchema`의 항목·숙소 연산만 쓴다). */
export type UpdateOperation =
  | { type: 'upsert-item'; item: PlanVersion['items'][number] }
  | { type: 'remove-item'; activityId: string }
  | { type: 'upsert-stay'; stay: PlanVersion['stays'][number] }
  | { type: 'remove-stay'; stayId: string };

/** 수정 글을 대조할 현재 여행. `plan`은 여행의 현재 계획 버전이어야 한다. */
export type CurrentTrip = {
  header: TripHeader;
  plan: PlanVersion;
  /** 장소 id → 이름(활동에 연결된 장소의 이름을 장소 칸과 비교하는 데 쓴다). */
  placeNames?: ReadonlyMap<string, string>;
};

export type FieldChange = {
  name: string;
  before: string;
  after: string;
  /** `(비움)`으로 값을 지우는 칸. */
  cleared: boolean;
};

export type ChangeKind = 'add' | 'edit' | 'move' | 'delete';

export type ChangeEntry = {
  /** 고르기·재검사에서 쓰는 이 변경의 열쇠. 같은 계산 결과 안에서만 유일하다. */
  key: string;
  kind: ChangeKind;
  entity: 'activity' | 'stay';
  /** 보여 줄 날짜. 활동은 그 활동이 들어가는 날, 숙소는 체크인 날. */
  date: string;
  title: string;
  fields: FieldChange[];
  notes: string[];
  operation: UpdateOperation;
};

export type UnchangedEntry = { entity: 'activity' | 'stay'; date: string; title: string };

export type UpdateProblem = { where: string; section: string; message: string };

export type BlockReason = 'other-trip' | 'stale-plan' | 'stale-revision' | 'bad-header';

export const STALE_REVISION_MESSAGE =
  "복사한 뒤 이 여행에 다른 변경이 저장됐습니다. 다시 'AI로 수정하기'로 복사해 작업하세요.";
export const STALE_PLAN_MESSAGE = "계획이 그사이 바뀌었습니다. 다시 'AI로 수정하기'로 복사해 작업하세요.";

export type UpdateResult =
  | { status: 'blocked'; reason: BlockReason; message: string; otherTripId?: string }
  | {
      status: 'ready';
      /** 날짜 범위로 내보낸 글이다(정보로만 보인다). */
      rangeExport: boolean;
      changes: ChangeEntry[];
      unchanged: UnchangedEntry[];
      /** 이미 있는 항목과 같아 보이는 새 줄. 기본은 넣지 않는다(AC-09). */
      skipped: ChangeEntry[];
      /** 반영하지 않고 지나간 칸의 안내. */
      ignored: string[];
      errors: UpdateProblem[];
    };

export type SelectionResult =
  | {
      ok: true;
      operations: UpdateOperation[];
      counts: { edit: number; add: number; remove: number };
      reason: string;
      /** 내용은 그대로이고 번호만 밀리는 기존 활동 수(수정 수에 넣지 않는다). */
      shifted: number;
      /** 새 활동·날짜를 옮긴 활동이 들어갈 자리. `beforeTitle`이 없으면 그날 마지막. */
      placements: { key: string; beforeTitle?: string; mode: 'insert' | 'relocate'; legCount: number }[];
    }
  | { ok: false; problems: string[] };
