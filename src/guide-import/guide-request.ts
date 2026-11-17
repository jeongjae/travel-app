import guidePromptDocument from '../../docs/guide-format-v1-prompt.md?raw';
import { extractFormatPrompt } from '../plan-import/format-prompt';
import type { GuideItem } from './types';
import { CHOICE_LABEL, type Choice, type Selections } from './selection';

/** 가이드 요청문 문서에서 두 선 사이의 글. 챗봇에게 주는 글은 이 문서 한 곳에서만 관리한다. */
export const GUIDE_REQUEST_TEMPLATE = extractFormatPrompt(guidePromptDocument);

export type GuideRequestInput = { destination?: string; startDate?: string; endDate?: string };

function periodPhrase(input: GuideRequestInput) {
  const start = input.startDate?.trim() ?? '';
  const end = input.endDate?.trim() ?? '';
  if (start !== '' && end !== '') {
    return `${start}~${end}`;
  }
  return start || end;
}

/** `{목적지}`·`{기간}`을 채운다. 기간이 비어 있으면 그 말(조사 포함)을 뺀다. */
export function buildGuideRequest(input: GuideRequestInput, template = GUIDE_REQUEST_TEMPLATE): string {
  const destination = input.destination?.trim() || '목적지';
  const period = periodPhrase(input);
  return template.replace('{기간}에 ', period === '' ? '' : `${period}에 `).replace('{목적지}', destination);
}

const GROUP_RULE: Record<Choice, string> = {
  must: '반드시 넣어 줘. 어렵다면 이유와 대안을 알려 줘.',
  interest: '동선과 시간이 맞으면 넣어 줘.',
  exclude: '넣지 말아 줘.',
};

function itemLine(item: GuideItem) {
  return `- ${[item.kind, item.name, item.area].filter((part) => part !== '').join(' / ')}`;
}

/**
 * 고른 항목 묶음. 순서는 꼭 포함 → 관심 → 제외 → 확인할 것이고, 항목은 가이드의 줄 순서다.
 * 고르지 않은 항목은 넣지 않고, 항목이 없는 묶음은 제목도 뺀다. 아무것도 고르지 않았으면 빈 글.
 */
export function buildGuideSection(items: GuideItem[], selections: Selections): string {
  const blocks: string[] = [];
  for (const choice of ['must', 'interest', 'exclude'] as const) {
    const chosen = items.filter((item) => selections[item.key] === choice);
    if (chosen.length > 0) {
      blocks.push([`[${CHOICE_LABEL[choice]}]`, GROUP_RULE[choice], ...chosen.map(itemLine)].join('\n'));
    }
  }
  const checks = items.filter(
    (item) => (selections[item.key] === 'must' || selections[item.key] === 'interest') && item.needsCheck !== '',
  );
  if (checks.length > 0) {
    blocks.push(['[확인할 것]', ...checks.map((item) => `- ${item.name}: ${item.needsCheck}`)].join('\n'));
  }
  return blocks.join('\n\n');
}
