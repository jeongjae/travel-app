import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
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

type MarkdownNode = {
  type: string;
  depth?: number;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
};

const markdownParser = unified().use(remarkParse).use(remarkGfm);

/** 문서 순서대로 `##`/`###` 머리말을 찾는다. 인용·목록 안의 머리말과 밑줄식 머리말도 화면과 같이 머리말이다. */
function visitHeadings(node: MarkdownNode, visit: (heading: MarkdownNode) => void) {
  if (node.type === 'heading' && (node.depth === 2 || node.depth === 3)) {
    visit(node);
  }
  node.children?.forEach((child) => visitHeadings(child, visit));
}

function nodeText(node: MarkdownNode): string {
  return node.value ?? (node.children ?? []).map(nodeText).join('');
}

/** 목차: 화면과 같은 Markdown 해석으로 머리말을 뽑는다. 번호는 `remarkHeadingIds`가 붙이는 id와 같은 순서다. */
export function extractHeadings(markdown: string): TocHeading[] {
  const headings: TocHeading[] = [];
  visitHeadings(markdownParser.parse(markdown) as MarkdownNode, (node) => {
    headings.push({ index: headings.length, level: node.depth === 2 ? 2 : 3, text: nodeText(node).trim() });
  });
  return headings;
}

/** 해석 단계에서 머리말에 id를 붙인다. 렌더 횟수와 무관하게 같은 본문이면 같은 id가 된다. */
export function remarkHeadingIds({ idFor }: { idFor: (index: number) => string }) {
  return (tree: MarkdownNode) => {
    let index = 0;
    visitHeadings(tree, (node) => {
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: idFor(index), tabIndex: -1 } };
      index += 1;
    });
  };
}

export function headingId(guideId: string, sectionKey: string, index: number): string {
  return `guide-heading-${guideId}-${sectionKey}-${index}`;
}
