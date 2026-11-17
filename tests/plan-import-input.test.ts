import { describe, expect, it } from 'vitest';
import { act, check, createdTrip, fixture, newPlan, withoutLines } from './plan-import-helpers';
import { parsePlanFile } from '../src/plan-import';
import { buildPlanPreview } from '../src/plan-import/preview';

const FIXTURES = ['chatgpt-t1-run2.md', 'claude-t1-run2.md', 'chatgpt-t3-run2.md', 'claude-t2-run2.md'];

function wrapInCodeBlock(text: string) {
  return ['```markdown', text.trim(), '```'].join('\n');
}

function withChatterAround(text: string) {
  return ['네, 앱 양식으로 정리했습니다.', '', text.trim(), '', '고칠 곳이 있으면 말씀해 주세요.'].join('\n');
}

function withInvisibleCharacters(text: string) {
  const mixed = text
    .split('\n')
    .map((line, index) => (index % 2 === 0 ? `​ ${line}⁠` : `﻿  ${line}‌`))
    .join('\r\n');
  return `﻿${mixed}`;
}

describe.each(FIXTURES)('입력 글 변형은 같은 결과를 낸다 (AC-19): %s', (name) => {
  const text = fixture(name);
  const base = withoutLines(check(text));

  it.each([
    ['코드 블록으로 싼 글', wrapInCodeBlock(text)],
    ['앞뒤 설명 문장', withChatterAround(text)],
    ['설명 문장 + 코드 블록', withChatterAround(wrapInCodeBlock(text))],
    ['CRLF·BOM·폭 없는 공백·줄바꿈 없는 공백', withInvisibleCharacters(text)],
    ['CRLF만', text.replace(/\n/g, '\r\n')],
    ['4개 백틱 코드 블록', ['````', text.trim(), '````'].join('\n')],
  ])('%s', (_label, variant) => {
    expect(withoutLines(check(variant))).toEqual(base);
  });
});

describe('양식 줄 검사', () => {
  const text = fixture('chatgpt-t1-run2.md');

  it('양식 줄이 두 번 있으면 거부', () => {
    const doubled = `${text}\n\n- 양식: travel-app-plan/1\n`;
    expect(check(doubled).rejection?.code).toBe('ambiguous');
  });

  it('서로 다른 코드 블록에 계획이 하나씩 있으면 거부', () => {
    const two = [
      wrapInCodeBlock(text),
      '',
      '두 번째 안입니다.',
      '',
      wrapInCodeBlock(fixture('claude-t1-run2.md')),
    ].join('\n');
    const file = check(two);
    expect(file.kind).toBe('rejected');
    expect(file.rejection?.code).toBe('ambiguous');
  });

  it('같은 코드 블록 안에 두 번 있어도 거부', () => {
    expect(check(wrapInCodeBlock(`${text}\n- 양식: travel-app-plan/1`)).rejection?.code).toBe('ambiguous');
  });

  it('표 안 글자와 인용으로 든 예시는 양식 줄로 세지 않는다', () => {
    const quoted = ['> 예시: ', '> - 양식: travel-app-plan/1', '', text].join('\n');
    expect(check(quoted).kind).toBe('new');
    const inCell = text.replace('항공편 미예약.', '- 양식: travel-app-plan/1 항공편 미예약.');
    expect(check(inCell).kind).toBe('new');
  });

  it('양식 줄이 없으면 양식 아님', () => {
    const file = check(text.replace('- 양식: travel-app-plan/1\n', ''));
    expect(file.rejection?.code).toBe('not-plan');
  });

  it('다른 양식 값이면 거부', () => {
    expect(check(text.replace('travel-app-plan/1', 'travel-app-plan/2')).rejection?.code).toBe('format-version');
  });

  it('코드 블록이 있어도 양식 줄이 든 블록이 없으면 양식 아님', () => {
    const file = check(['```', '그냥 코드', '```', text].join('\n'));
    expect(file.rejection?.code).toBe('not-plan');
  });

  it('상한을 넘으면 거부', () => {
    expect(parsePlanFile('가'.repeat(200_001)).rejection?.code).toBe('too-large');
    expect(parsePlanFile('\n'.repeat(3_001)).rejection?.code).toBe('too-large');
  });
});

describe('여행ID 머리 줄 분류', () => {
  const base = newPlan({ days: [{ heading: '2027-05-01 하루', rows: [act('', '산책', '관광')] }] });
  const idLines = ['- 여행ID: trip-1', '- 기준계획: plan-1', '- 기준revision: 3'];

  function withHeaderLines(lines: string[]) {
    return base.replace('\n\n## 일정', `\n${lines.join('\n')}\n\n## 일정`);
  }

  it('3줄이 모두 없으면 new, 모두 있으면 update', () => {
    expect(check(base).kind).toBe('new');
    expect(check(withHeaderLines(idLines)).kind).toBe('update');
  });

  it.each([[[idLines[0]]], [[idLines[1], idLines[2]]]])('일부만 있으면 invalid로 저장을 막는다 %#', (lines) => {
    const file = check(withHeaderLines(lines));
    expect(file.kind).toBe('invalid');
    expect(file.saveable).toBe(false);
    expect(file.issues.map((issue) => issue.code)).toContain('id-header-partial');
  });

  it('같은 줄이 중복되면 invalid', () => {
    const file = check(withHeaderLines([...idLines, '- 여행ID: trip-2']));
    expect(file.kind).toBe('invalid');
    expect(file.issues.map((issue) => issue.code)).toContain('id-header-duplicate');
  });

  it('여행ID가 있는 파일은 이름 줄을 읽지 않는다', () => {
    const noName = withHeaderLines(idLines).replace('# 여행: 시험 여행\n', '');
    expect(check(noName).issues).toEqual([]);
  });

  it('새 여행을 만드는 일은 new에서만 된다', () => {
    expect(createdTrip(base).header.name).toBe('시험 여행');
  });
});

describe('가이드 글이 계획 쪽에 들어왔을 때', () => {
  it('is-guide로 거부하고 안내한다', () => {
    const file = parsePlanFile('# 가이드: 어딘가\n- 양식: travel-app-guide/1\n');
    expect(file.rejection?.code).toBe('is-guide');
    expect(file.rejection?.message).toContain('가이드');
  });

  it('미리보기는 챗봇 재요청 안내 없이 가이드 안내만 보여 준다', () => {
    const preview = buildPlanPreview('# 가이드: 어딘가\n- 양식: travel-app-guide/1\n');
    expect(preview.state).toBe('not-plan');
    expect(preview.message).toContain('가이드');
    expect(preview.message).not.toContain('다시 정리해 줘');
  });
});
