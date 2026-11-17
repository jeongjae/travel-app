import { parseGuide } from './parse';
import { pruneSelections, type Selections } from './selection';
import type { TravelAnswers } from '../plan-import/travel-brief';
import type { GuideItem } from './types';

/** 준비 초안은 이 기기의 localStorage 키 하나에만 둔다. 여행 DB·백업에 들어가지 않는다. */
export const DRAFT_STORAGE_KEY = 'travel-app.prep-draft.v1';
export const DRAFT_VERSION = 1;

export type PrepDraft = {
  version: typeof DRAFT_VERSION;
  answers: TravelAnswers;
  /** 붙여 넣은 가이드 원문. 해석 결과는 읽을 때 다시 만든다(같은 글이면 같은 결과). */
  guideText: string;
  selections: Selections;
};

export type PrepState = {
  answers: TravelAnswers;
  guideText: string;
  guide: { destination: string; referenceDate?: string; items: GuideItem[] } | undefined;
  selections: Selections;
};

export const EMPTY_PREP: PrepState = { answers: {}, guideText: '', guide: undefined, selections: {} };

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LoadResult = { state: PrepState; found: boolean; discarded?: string };

export function guideOf(guideText: string): PrepState['guide'] {
  if (guideText.trim() === '') {
    return undefined;
  }
  const result = parseGuide(guideText);
  if (!result.accepted) {
    return undefined;
  }
  return { destination: result.destination, referenceDate: result.referenceDate, items: result.items };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 초안 읽기. 없으면 found=false, 형식이 다르거나 깨졌으면 버리고 이유를 돌려준다. */
export function loadDraft(storage: StorageLike | undefined): LoadResult {
  if (!storage) {
    return { state: EMPTY_PREP, found: false };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return { state: EMPTY_PREP, found: false };
  }
  if (raw === null) {
    return { state: EMPTY_PREP, found: false };
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== DRAFT_VERSION || !isRecord(value.answers)) {
      throw new Error('형식');
    }
    const guideText = typeof value.guideText === 'string' ? value.guideText : '';
    const guide = guideOf(guideText);
    const selections = isRecord(value.selections) ? (value.selections as Selections) : {};
    return {
      found: true,
      state: {
        answers: value.answers as TravelAnswers,
        guideText: guide ? guideText : '',
        guide,
        selections: guide ? pruneSelections(selections, guide.items) : {},
      },
    };
  } catch {
    return { state: EMPTY_PREP, found: false, discarded: '저장된 준비 초안의 형식이 달라 버렸습니다.' };
  }
}

/** 저장. 실패(용량·차단)하면 false를 돌려주고 호출한 쪽이 알린다. */
export function saveDraft(storage: StorageLike | undefined, state: PrepState): boolean {
  if (!storage) {
    return false;
  }
  const draft: PrepDraft = {
    version: DRAFT_VERSION,
    answers: state.answers,
    guideText: state.guideText,
    selections: state.selections,
  };
  try {
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage: StorageLike | undefined): boolean {
  try {
    storage?.removeItem(DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** 요청서에 들어갈 "고른 것"이 하나라도 있는지(미리보기 옆 목록용). */
export function hasChosen(state: PrepState): boolean {
  return Object.keys(state.selections).length > 0;
}
