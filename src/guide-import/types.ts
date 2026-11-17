/** 가이드 양식 `travel-app-guide/1` 변환 결과. 가이드는 고르기 위한 임시 자료이며 여행 DB와 무관하다. */

export const GUIDE_KINDS = ['볼거리', '먹거리', '체험', '코스', '지역'] as const;

export type GuideKind = (typeof GUIDE_KINDS)[number];

export type GuideItem = {
  /** 가이드 글의 지문 + 줄 순번. 같은 글이면 같은 key. */
  key: string;
  kind: GuideKind;
  name: string;
  area: string;
  description: string;
  durationText: string;
  needsCheck: string;
  /** 입력 글 전체 기준 줄 번호(1부터). */
  line: number;
};

export type GuideIssue = {
  severity: 'error' | 'warning';
  line: number;
  message: string;
};

export type GuideNotImported = { line: number; what: string };

export type GuideRejectionCode = 'too-large' | 'not-guide' | 'ambiguous' | 'format-version' | 'is-plan';

export type GuideRejection = { code: GuideRejectionCode; message: string };

export type GuideResult =
  | {
      accepted: true;
      rejection?: undefined;
      destination: string;
      referenceDate?: string;
      items: GuideItem[];
      issues: GuideIssue[];
      notImported: GuideNotImported[];
    }
  | {
      accepted: false;
      rejection?: GuideRejection;
      issues: GuideIssue[];
      notImported: GuideNotImported[];
    };
