import type { ContentRevision } from '../contracts/v2';

/**
 * 가이드 상세의 읽기 모델(C-15). 저장된 섹션은 그대로 두고, 읽을 본문과 맨 아래로 보낼 원천 정보를 나누며
 * 본문 머리말(`##`/`###`)로 목차를 만든다.
 */

type Guide = Extract<ContentRevision, { kind: 'guide' }>;
type Section = Guide['payload']['sections'][number];

export type TocHeading = { index: number; level: 2 | 3; text: string };

/** 원천 속성(frontmatter) 섹션은 읽기 본문이 아니다. */
export function isSourceSection(section: Section): boolean {
  return section.key.startsWith('source-frontmatter');
}

export function readingSections(guide: Guide): Section[] {
  return guide.payload.sections.filter((section) => !isSourceSection(section)).toSorted((a, b) => a.order - b.order);
}

export function sourceSections(guide: Guide): Section[] {
  return guide.payload.sections.filter(isSourceSection).toSorted((a, b) => a.order - b.order);
}

/** 코드 블록 밖의 `##`/`###` 머리말을 순서대로 뽑는다. 번호는 화면에서 같은 순서로 붙는 머리말 id와 맞는다. */
export function extractHeadings(markdown: string): TocHeading[] {
  const headings: TocHeading[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.push({
        index: headings.length,
        level: match[1].length === 2 ? 2 : 3,
        text: match[2].replace(/[*_`]/g, ''),
      });
    }
  }
  return headings;
}

export function headingId(guideId: string, sectionKey: string, index: number): string {
  return `guide-heading-${guideId}-${sectionKey}-${index}`;
}
