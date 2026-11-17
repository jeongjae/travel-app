import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGuide, type GuideResult } from '../src/guide-import';

const HAKODATE = readFileSync('tests/fixtures/guide-format/hakodate.md', 'utf8');

const HEAD = '# 가이드: 가상 여행지\n- 양식: travel-app-guide/1\n';
const TABLE_HEAD = '## 항목\n| 종류 | 이름 | 지역 | 한 줄 설명 | 예상 소요 | 확인 필요 |\n|---|---|---|---|---|---|\n';

function guideOf(rows: string[], head = HEAD) {
  return `${head}\n${TABLE_HEAD}${rows.join('\n')}\n`;
}

function accepted(result: GuideResult) {
  if (!result.accepted) {
    throw new Error(`거부됨: ${JSON.stringify(result.rejection ?? result.issues)}`);
  }
  return result;
}

function errorsOf(result: GuideResult) {
  return result.issues.filter((issue) => issue.severity === 'error');
}

describe('고정 자료: 하코다테 가이드', () => {
  const result = accepted(parseGuide(HAKODATE));

  it('34항목이고 종류별 4·15·8·4·3(지역·볼거리·먹거리·체험·코스), 오류 0', () => {
    expect(result.items).toHaveLength(34);
    const count = (kind: string) => result.items.filter((item) => item.kind === kind).length;
    expect([count('지역'), count('볼거리'), count('먹거리'), count('체험'), count('코스')]).toEqual([4, 15, 8, 4, 3]);
    expect(errorsOf(result)).toEqual([]);
    expect(result.destination).toBe('일본 하코다테');
    expect(result.referenceDate).toBe('2026-11-16');
  });

  it('줄 순서가 보존되고 key가 모두 다르다', () => {
    expect(result.items[0].name).toBe('하코다테역·아침시장 주변');
    expect(new Set(result.items.map((item) => item.key)).size).toBe(34);
    const lines = result.items.map((item) => item.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });

  it('같은 글이면 같은 key, 글이 다르면 다른 key', () => {
    const again = accepted(parseGuide(HAKODATE));
    expect(again.items.map((item) => item.key)).toEqual(result.items.map((item) => item.key));
    const changed = accepted(parseGuide(HAKODATE.replace('하코다테산 전망대', '하코다테산 전망대2')));
    expect(changed.items[0].key).not.toBe(result.items[0].key);
  });
});

describe('입력 변형은 같은 결과', () => {
  const base = accepted(parseGuide(HAKODATE));
  const names = (result: GuideResult) => accepted(result).items.map((item) => [item.kind, item.name, item.area]);

  it.each([
    ['코드 블록', `\`\`\`markdown\n${HAKODATE}\n\`\`\``],
    ['앞뒤 설명문', `아래가 가이드입니다.\n\n\`\`\`\n${HAKODATE}\n\`\`\`\n\n도움이 되길 바랍니다.`],
    ['CRLF', HAKODATE.replace(/\n/g, '\r\n')],
    ['BOM', `﻿${HAKODATE}`],
  ])('%s', (_label, text) => {
    expect(names(parseGuide(text))).toEqual(names(parseGuide(HAKODATE)));
    expect(accepted(parseGuide(text)).destination).toBe(base.destination);
  });
});

describe('거부와 오류', () => {
  it('양식 줄이 없으면 거부(not-guide)', () => {
    expect(parseGuide('# 가이드: 어딘가\n').accepted).toBe(false);
    expect(parseGuide('# 가이드: 어딘가\n').rejection?.code).toBe('not-guide');
  });

  it('양식 줄이 두 번이면 거부(ambiguous)', () => {
    const text = `${HEAD}- 양식: travel-app-guide/1\n`;
    expect(parseGuide(text).rejection?.code).toBe('ambiguous');
  });

  it('다른 양식 값이면 거부(format-version)', () => {
    expect(parseGuide('# 가이드: 어딘가\n- 양식: travel-app-guide/2\n').rejection?.code).toBe('format-version');
  });

  it('계획 양식 글은 is-plan으로 구분한다', () => {
    const plan = '# 가상 여행\n- 양식: travel-app-plan/1\n- 기간: 2027-04-15 ~ 2027-04-16\n';
    const result = parseGuide(plan);
    expect(result.rejection?.code).toBe('is-plan');
    expect(result.rejection?.message).toContain('AI 결과 붙여넣기');
  });

  it('모르는 종류는 오류이고 가이드 전체를 받지 않는다', () => {
    const result = parseGuide(guideOf(['| 볼거리 | 가 | | | | |', '| 숙소 | 나 | | | | |']));
    expect(result.accepted).toBe(false);
    const errors = errorsOf(result);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('숙소');
    expect(errors[0].line).toBe(8);
  });

  it('열 개수가 제목 줄과 다르면 줄 번호와 함께 오류', () => {
    const result = parseGuide(guideOf(['| 볼거리 | 가 | |']));
    expect(result.accepted).toBe(false);
    expect(errorsOf(result)[0].message).toContain('칸이 3개');
  });

  it('이름이 비면 오류, 오류는 모두 모은다', () => {
    const result = parseGuide(guideOf(['| 볼거리 | | | | | |', '| 없는종류 | | | | | |']));
    expect(errorsOf(result)).toHaveLength(3);
  });

  it('필수 열이 없으면 오류', () => {
    const text = `${HEAD}\n## 항목\n| 이름 | 지역 |\n|---|---|\n| 가 | 나 |\n`;
    const result = parseGuide(text);
    expect(result.accepted).toBe(false);
    expect(errorsOf(result)[0].message).toContain('종류');
  });

  it('항목 구역·표·항목이 없으면 오류', () => {
    expect(parseGuide(HEAD).accepted).toBe(false);
    expect(parseGuide(`${HEAD}\n## 항목\n설명만 있음\n`).accepted).toBe(false);
    expect(parseGuide(`${HEAD}\n${TABLE_HEAD}`).accepted).toBe(false);
  });

  it('목적지 줄이 없으면 오류', () => {
    expect(parseGuide(guideOf(['| 볼거리 | 가 | | | | |'], '- 양식: travel-app-guide/1\n')).accepted).toBe(false);
  });

  it('항목이 200줄을 넘으면 오류', () => {
    const rows = Array.from({ length: 201 }, (_, index) => `| 볼거리 | 항목${index} | | | | |`);
    expect(parseGuide(guideOf(rows)).accepted).toBe(false);
    expect(parseGuide(guideOf(rows.slice(0, 200))).accepted).toBe(true);
  });

  it('글이 너무 크면 too-large', () => {
    expect(parseGuide('가'.repeat(200_001)).rejection?.code).toBe('too-large');
  });
});

describe('경고와 읽기', () => {
  it('종류+이름+지역이 같으면 경고하고 둘 다 보여 준다', () => {
    const result = accepted(
      parseGuide(guideOf(['| 볼거리 | 가 | 나 | | | |', '| 볼거리 | 가 | 나 | 다른 설명 | | |'])),
    );
    expect(result.items).toHaveLength(2);
    expect(result.issues.filter((issue) => issue.severity === 'warning')).toHaveLength(1);
  });

  it('지역만 다르면 중복이 아니다', () => {
    const result = accepted(parseGuide(guideOf(['| 볼거리 | 가 | 나 | | | |', '| 볼거리 | 가 | 라 | | | |'])));
    expect(result.issues).toEqual([]);
  });

  it('열 순서가 바뀌어도 이름으로 읽는다', () => {
    const text = `${HEAD}\n## 항목\n| 이름 | 확인 필요 | 종류 |\n|---|---|---|\n| 가 | 휴무 확인 | 먹거리 |\n`;
    const [item] = accepted(parseGuide(text)).items;
    expect(item).toMatchObject({ kind: '먹거리', name: '가', needsCheck: '휴무 확인', area: '' });
  });

  it('모르는 열·구역·머리 줄은 가져오지 않음으로 모은다', () => {
    const text = `${HEAD}- 작성자: 누구\n\n## 메모\n글\n\n## 항목\n| 종류 | 이름 | 별점 |\n|---|---|---|\n| 볼거리 | 가 | 5 |\n`;
    const result = accepted(parseGuide(text));
    expect(result.notImported.map((entry) => entry.what)).toEqual(
      expect.arrayContaining(['머리 줄 `작성자`', '`## 메모` 구역', '열 "별점"']),
    );
  });

  it('기준일 형식이 틀리면 경고하고 쓰지 않는다. 없으면 undefined', () => {
    const bad = accepted(parseGuide(guideOf(['| 볼거리 | 가 | | | | |'], `${HEAD}- 기준일: 어제\n`)));
    expect(bad.referenceDate).toBeUndefined();
    expect(bad.issues[0].severity).toBe('warning');
    expect(accepted(parseGuide(guideOf(['| 볼거리 | 가 | | | | |']))).referenceDate).toBeUndefined();
  });

  it('칸 안의 \\|는 글자 |로 읽는다', () => {
    const [item] = accepted(parseGuide(guideOf(['| 볼거리 | 가 \\| 나 | | | | |']))).items;
    expect(item.name).toBe('가 | 나');
  });
});
