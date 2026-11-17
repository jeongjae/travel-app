import type { GuideItem } from './types';

export type Choice = 'must' | 'interest' | 'exclude';

export const CHOICES: readonly Choice[] = ['must', 'interest', 'exclude'];

export const CHOICE_LABEL: Record<Choice, string> = { must: '꼭 포함', interest: '관심', exclude: '제외' };

/** 항목 key → 고른 상태. 고르지 않은 항목은 키가 없다. */
export type Selections = Record<string, Choice>;

/** 같은 상태를 다시 누르면 고르지 않음으로 돌아간다. */
export function toggleChoice(selections: Selections, key: string, choice: Choice): Selections {
  const next = { ...selections };
  if (next[key] === choice) {
    delete next[key];
  } else {
    next[key] = choice;
  }
  return next;
}

/** 보이는 항목 모두에게 같은 상태를 준다. `undefined`는 고르지 않음. */
export function setChoices(selections: Selections, keys: string[], choice: Choice | undefined): Selections {
  const next = { ...selections };
  for (const key of keys) {
    if (choice === undefined) {
      delete next[key];
    } else {
      next[key] = choice;
    }
  }
  return next;
}

/** 일괄 적용 전에 보여 줄, 실제로 바뀌는 항목 수. */
export function countChanges(selections: Selections, keys: string[], choice: Choice | undefined): number {
  return keys.filter((key) => selections[key] !== choice).length;
}

export function countByChoice(selections: Selections, items: GuideItem[]): Record<Choice, number> {
  const counts: Record<Choice, number> = { must: 0, interest: 0, exclude: 0 };
  for (const item of items) {
    const choice = selections[item.key];
    if (choice) {
      counts[choice]++;
    }
  }
  return counts;
}

/** 가이드에 없는 key는 버린다(깨진 초안·다른 가이드의 선택). */
export function pruneSelections(selections: Selections, items: GuideItem[]): Selections {
  const keys = new Set(items.map((item) => item.key));
  return Object.fromEntries(
    Object.entries(selections).filter(([key, choice]) => keys.has(key) && CHOICES.includes(choice)),
  );
}

const MIN_NAME_LENGTH = 2;

/** `text` 안에 `name` 전체가 글자 그대로 들어 있는지. 짧은 이름은 우연히 겹치기 쉬워 비교하지 않는다. */
function mentions(text: string, name: string) {
  const target = name.trim();
  return target.length >= MIN_NAME_LENGTH && text.trim().includes(target);
}

function isRelated(excluded: GuideItem, other: GuideItem) {
  const otherTexts = [other.name, other.area, other.description];
  return otherTexts.some((text) => mentions(text, excluded.name)) || mentions(excluded.name, other.name);
}

/**
 * 제외한 항목과 이어진 다른 항목들(제외하지 않은 것만). 자동으로 바꾸지 않고 알리는 데만 쓴다.
 * 이어짐: 다른 항목의 이름·지역·설명이 제외한 항목의 이름 전체를 포함하거나, 제외한 항목의 이름이 그 항목의 이름 전체를 포함한다.
 */
export function similarRemaining(item: GuideItem, items: GuideItem[], selections: Selections): GuideItem[] {
  if (selections[item.key] !== 'exclude') {
    return [];
  }
  return items.filter(
    (other) => other.key !== item.key && selections[other.key] !== 'exclude' && isRelated(item, other),
  );
}
