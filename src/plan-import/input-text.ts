import type { Rejection, SourceLine } from './types';

export const MAX_INPUT_CHARS = 200_000;
export const MAX_INPUT_LINES = 3_000;
export const PLAN_FORMAT = 'travel-app-plan/1';

// BOM과 폭 없는 글자는 버리고, 줄바꿈 없는 공백은 보통 공백으로 바꾼다.
const INVISIBLE_CHARACTERS = /[﻿​‌‍⁠]/g;
const NO_BREAK_SPACES = /[  ]/g;
const FORMAT_LINE = /^-\s*양식\s*:\s*(.*)$/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;

/** 보이지 않는 글자를 처리하고 줄 단위로 나눈다. 줄마다 앞뒤 공백을 버린다. */
export function splitSourceLines(text: string): SourceLine[] {
  const cleaned = text.replace(INVISIBLE_CHARACTERS, '').replace(NO_BREAK_SPACES, ' ');
  return cleaned.split(/\r\n|\r|\n/).map((raw, index) => ({ line: index + 1, text: raw.trim() }));
}

export function formatLineValue(text: string): string | undefined {
  const match = FORMAT_LINE.exec(text);
  return match ? match[1].trim() : undefined;
}

function isClosingFence(text: string, opener: string) {
  const fenceCharacter = opener[0];
  const run = text.match(new RegExp(`^\\${fenceCharacter}+`))?.[0] ?? '';
  return run.length >= opener.length && text === run;
}

/** 코드 블록 안쪽 줄들을 블록별로 모은다. 닫히지 않은 블록은 끝까지로 본다. */
export function findFencedBlocks(lines: SourceLine[]): SourceLine[][] {
  const blocks: SourceLine[][] = [];
  let current: SourceLine[] | undefined;
  let opener = '';
  for (const entry of lines) {
    if (!current) {
      const open = FENCE_OPEN.exec(entry.text);
      if (open) {
        opener = open[1];
        current = [];
      }
      continue;
    }
    if (isClosingFence(entry.text, opener)) {
      blocks.push(current);
      current = undefined;
      continue;
    }
    current.push(entry);
  }
  if (current) {
    blocks.push(current);
  }
  return blocks;
}

function countFormatLines(lines: SourceLine[]) {
  return lines.filter((entry) => formatLineValue(entry.text) !== undefined).length;
}

export type BodySelection = { body: SourceLine[] } | { rejection: Rejection };

/**
 * 양식 본문을 고른다. 본문을 고르기 전에 `- 양식:` 줄이 든 후보를 모두 센다.
 * 표 안의 글자(`|`로 시작하는 줄)와 인용(`> `)은 줄 시작이 달라 양식 줄로 세지 않는다.
 */
export function selectBody(lines: SourceLine[]): BodySelection {
  return selectFormattedBody(lines, PLAN_FORMAT_SPEC);
}

/** 양식 값이 다른 글(가이드 등)도 같은 규칙으로 본문을 고르도록 양식 정보를 받는다. */
export type FormatSpec = {
  format: string;
  /** 거부 문장에 쓰는 양식 줄 예시. */
  example: string;
  /** 양식 줄이 하나인데 값이 다를 때의 거부를 정한다. 없으면 `format-version`. */
  mismatch?: (value: string) => Rejection | undefined;
};

const PLAN_FORMAT_SPEC: FormatSpec = { format: PLAN_FORMAT, example: `- 양식: ${PLAN_FORMAT}` };

export function selectFormattedBody(lines: SourceLine[], spec: FormatSpec): BodySelection {
  const blocks = findFencedBlocks(lines);
  const candidates = blocks.length > 0 ? blocks : [lines];
  const counts = candidates.map(countFormatLines);
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return {
      rejection: {
        code: 'not-plan',
        message: `양식 줄(${spec.example})이 없어 앱 양식이 아닙니다.`,
      },
    };
  }
  if (total > 1) {
    return {
      rejection: {
        code: 'ambiguous',
        message: '양식 줄이 둘 이상이라 어느 계획을 쓸지 알 수 없습니다. 계획 하나만 남겨 주세요.',
      },
    };
  }
  const body = candidates[counts.findIndex((count) => count === 1)];
  const value = formatLineValue(body.find((entry) => formatLineValue(entry.text) !== undefined)!.text);
  if (value !== spec.format) {
    const other = spec.mismatch?.(value ?? '');
    if (other) {
      return { rejection: other };
    }
    return {
      rejection: {
        code: 'format-version',
        message: `지원하지 않는 양식 값입니다(${value || '비어 있음'}). ${spec.format}만 읽을 수 있습니다.`,
      },
    };
  }
  return { body };
}
