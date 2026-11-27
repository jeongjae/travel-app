import type { PlanVersion } from '../contracts/v2';

type PlanItem = PlanVersion['items'][number];

/** 활동 종류 선택지. 값은 글자 그대로 저장한다(가져오기 양식 v1의 자유 글 칸과 같다). */
export const ACTIVITY_CATEGORIES = ['관광', '식사', '쇼핑', '휴식', '이동', '기타'] as const;

export const DEFAULT_ACTIVITY_CATEGORY = '기타';

/** 기존 값이 목록에 없으면 그 값을 맨 앞 선택지로 둔다. 사용자가 바꾸지 않으면 그대로 저장된다. */
export function activityCategoryOptions(current?: string): string[] {
  const options: string[] = [...ACTIVITY_CATEGORIES];
  if (current !== undefined && !options.includes(current)) {
    options.unshift(current);
  }
  return options;
}

export type ActivityDetails = {
  category: string;
  summary: string;
  menuText: string;
  reservationText: string;
  optional: boolean;
};

/** 활동 양식의 추가 칸을 항목에 반영한다. 빈 식사·메뉴·예약 안내는 칸을 지운다. 설명은 빈 글을 허용한다. */
export function applyActivityDetails<T extends PlanItem>(item: T, details: ActivityDetails): T {
  const next: T = {
    ...item,
    category: details.category,
    summary: details.summary,
    optional: details.optional,
  };
  const menu = details.menuText.trim();
  if (menu) {
    next.menuText = menu;
  } else {
    delete next.menuText;
  }
  const reservation = details.reservationText.trim();
  if (reservation) {
    next.reservationText = reservation;
  } else {
    delete next.reservationText;
  }
  return next;
}
