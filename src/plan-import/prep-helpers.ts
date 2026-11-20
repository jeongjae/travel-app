import {
  COMPANION_OPTIONS,
  INTEREST_OPTIONS,
  PACE_OPTIONS,
  STAY_PRIORITY_OPTIONS,
  STAY_TYPE_OPTIONS,
  TRANSPORT_OPTIONS,
  VISIT_OPTIONS,
  type TravelAnswers,
} from './travel-brief';

/** T-E3-1 C: "한 번에 채우기" 프리셋. 취향 쪽 세 칸(관심사·속도·방문)만 바꾼다. `visit`이 없으면 그 칸은 그대로 둔다. */
export type StylePreset = {
  id: string;
  label: string;
  interests: (typeof INTEREST_OPTIONS)[number][];
  pace: (typeof PACE_OPTIONS)[number];
  visit?: (typeof VISIT_OPTIONS)[number];
};

export const STYLE_PRESETS: readonly StylePreset[] = [
  { id: 'first-visit', label: '첫 방문 핵심 관광', interests: ['관광', '문화예술'], pace: '보통', visit: '처음' },
  { id: 'relaxed', label: '여유로운 휴식', interests: ['휴식', '자연'], pace: '여유' },
  { id: 'foodie', label: '미식 중심', interests: ['미식', '관광'], pace: '보통' },
];

export function applyPreset(answers: TravelAnswers, preset: StylePreset): TravelAnswers {
  const next: TravelAnswers = { ...answers, interests: [...preset.interests], pace: preset.pace };
  if (preset.visit) {
    next.visit = preset.visit;
  }
  return next;
}

/** T-E3-1 D: 요청서를 복사·저장할 때 남기는 "지난번 답". 여행마다 달라지는 것(여행지·날짜·방문·메모)은 넣지 않는다. */
export const LAST_ANSWERS_KEY = 'travel-app.last-answers.v1';
export const LAST_ANSWERS_VERSION = 1;

export type LastAnswers = Pick<
  TravelAnswers,
  'interests' | 'pace' | 'budget' | 'companion' | 'headcount' | 'transport' | 'stayTypes' | 'stayPriorities'
>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function nonEmptyText(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function pickOne(value: unknown, options: readonly string[]) {
  return typeof value === 'string' && options.includes(value) ? value : undefined;
}

function pickMany(value: unknown, options: readonly string[]) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const picked = value.filter((item): item is string => typeof item === 'string' && options.includes(item));
  return picked.length > 0 ? picked : undefined;
}

/** 답에서 지난번 답으로 남길 것만 골라 낸다. 선택지 밖의 값과 빈 값은 버린다. */
export function pickLastAnswers(answers: Record<string, unknown>): LastAnswers {
  const headcount =
    typeof answers.headcount === 'number' && Number.isFinite(answers.headcount) && answers.headcount > 0
      ? Math.floor(answers.headcount)
      : undefined;
  const picked: LastAnswers = {
    interests: pickMany(answers.interests, INTEREST_OPTIONS),
    pace: pickOne(answers.pace, PACE_OPTIONS),
    budget: nonEmptyText(answers.budget),
    companion: pickOne(answers.companion, COMPANION_OPTIONS),
    headcount,
    transport: pickOne(answers.transport, TRANSPORT_OPTIONS),
    stayTypes: pickMany(answers.stayTypes, STAY_TYPE_OPTIONS),
    stayPriorities: pickMany(answers.stayPriorities, STAY_PRIORITY_OPTIONS),
  };
  return Object.fromEntries(Object.entries(picked).filter(([, value]) => value !== undefined)) as LastAnswers;
}

export function hasLastAnswers(last: LastAnswers) {
  return Object.keys(last).length > 0;
}

/** 저장. 남길 것이 없으면 이전 값을 지우지 않고 그대로 둔다. 실패하면 false. */
export function saveLastAnswers(storage: StorageLike | undefined, answers: TravelAnswers): boolean {
  const last = pickLastAnswers(answers as Record<string, unknown>);
  if (!storage || !hasLastAnswers(last)) {
    return false;
  }
  try {
    storage.setItem(LAST_ANSWERS_KEY, JSON.stringify({ version: LAST_ANSWERS_VERSION, answers: last }));
    return true;
  } catch {
    return false;
  }
}

/** 읽기. 없거나 읽을 수 없거나 모양이 다르면 없는 것으로 본다. */
export function loadLastAnswers(storage: StorageLike | undefined): LastAnswers | undefined {
  if (!storage) {
    return undefined;
  }
  try {
    const raw = storage.getItem(LAST_ANSWERS_KEY);
    if (raw === null) {
      return undefined;
    }
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (record.version !== LAST_ANSWERS_VERSION || typeof record.answers !== 'object' || record.answers === null) {
      return undefined;
    }
    const last = pickLastAnswers(record.answers as Record<string, unknown>);
    return hasLastAnswers(last) ? last : undefined;
  } catch {
    return undefined;
  }
}

export function clearLastAnswers(storage: StorageLike | undefined): boolean {
  try {
    storage?.removeItem(LAST_ANSWERS_KEY);
    return true;
  } catch {
    return false;
  }
}

/** 지난번 답으로 여덟 칸을 덮는다. 여행지·날짜·방문·메모는 그대로 둔다. 지난번에 없던 칸은 비운다(덮어쓴다). */
export function applyLastAnswers(answers: TravelAnswers, last: LastAnswers): TravelAnswers {
  return {
    ...answers,
    interests: last.interests,
    pace: last.pace,
    budget: last.budget,
    companion: last.companion,
    headcount: last.headcount,
    transport: last.transport,
    stayTypes: last.stayTypes,
    stayPriorities: last.stayPriorities,
  };
}
