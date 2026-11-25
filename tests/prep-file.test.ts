import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guideOf, EMPTY_PREP, type PrepState } from '../src/guide-import/draft';
import { buildPrepFile, parsePrepFile, parseGuide, type PrepFileResult } from '../src/guide-import';
import { parsePlanFile } from '../src/plan-import/parse';

const HAKODATE = readFileSync('tests/fixtures/guide-format/hakodate.md', 'utf8');

function prepWith(selected: Record<string, 'must' | 'interest' | 'exclude'>, answers = {}): PrepState {
  const guide = guideOf(HAKODATE)!;
  const selections = Object.fromEntries(
    guide.items.filter((item) => selected[item.name]).map((item) => [item.key, selected[item.name]]),
  );
  return { answers, guideText: HAKODATE, guide, selections };
}

function ready(result: PrepFileResult | undefined) {
  if (!result?.accepted) {
    throw new Error(`거절됨: ${JSON.stringify(result)}`);
  }
  return result;
}

function names(result: Extract<PrepFileResult, { accepted: true }>, choice: string) {
  return result.items.filter((item) => result.selections[item.key] === choice).map((item) => item.name);
}

const SAMPLE = prepWith(
  { '하코다테역·아침시장 주변': 'must' },
  {
    destination: '하코다테',
    budget: '1인 80만원 | 항공 제외',
    interests: ['미식', '관광'],
    companion: '부부',
    headcount: 2,
    notes: '메모',
  },
);
const FIRST = SAMPLE.guide!.items.find((item) => SAMPLE.selections[item.key])!;
const TEXT = buildPrepFile(SAMPLE, '2026-11-25')!;

describe('준비 자료 만들기 → 읽기', () => {
  it('가이드·고른 것·취향 답이 그대로 돌아온다', () => {
    const result = ready(parsePrepFile(TEXT));
    expect(result.destination).toBe('일본 하코다테');
    expect(result.guideText).toBe(
      HAKODATE.trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .join('\n'),
    );
    expect(result.items).toHaveLength(34);
    expect(names(result, 'must')).toEqual([FIRST.name]);
    expect(result.counts).toEqual({ must: 1, interest: 0, exclude: 0 });
    expect(result.dropped).toBe(0);
    expect(result.answers).toEqual({
      interests: ['미식', '관광'],
      budget: '1인 80만원 | 항공 제외',
      companion: '부부',
      headcount: 2,
    });
  });

  it('가이드 글이 같으면 항목 key도 같아 초안에 그대로 넣을 수 있다', () => {
    const result = ready(parsePrepFile(TEXT));
    expect(guideOf(result.guideText)!.items.map((item) => item.key)).toEqual(
      SAMPLE.guide!.items.map((item) => item.key),
    );
  });

  it('여행지·날짜·방문·메모는 담지 않고, 빈 칸은 줄을 만들지 않는다', () => {
    expect(TEXT).not.toContain('메모');
    expect(TEXT).not.toContain('여행지');
    const rows = TEXT.split('\n').filter((line) =>
      /^\| (관심사|속도|예산|동행|인원|이동수단|숙소 유형|숙소 우선순위) \|/.test(line),
    );
    expect(rows).toHaveLength(4);
  });

  it('고른 것이 없거나 답이 없어도 만들고 읽는다', () => {
    const plain = ready(parsePrepFile(buildPrepFile({ ...SAMPLE, selections: {}, answers: {} }, '2026-11-25')!));
    expect(plain.counts).toEqual({ must: 0, interest: 0, exclude: 0 });
    expect(plain.answers).toEqual({});
    expect(buildPrepFile(EMPTY_PREP, '2026-11-25')).toBeUndefined();
  });
});

describe('읽기는 관대하다', () => {
  const same = (text: string) => ready(parsePrepFile(text));

  it('CRLF·줄 끝 공백·둥근 따옴표(바깥)·코드 블록으로 싼 글', () => {
    expect(same(TEXT.replace(/\n/g, '\r\n')).counts.must).toBe(1);
    expect(same(TEXT.replace(/\n/g, '  \n')).counts.must).toBe(1);
    expect(same(`\`\`\`markdown\n${TEXT}\`\`\`\n`).counts.must).toBe(1);
    expect(same(`\`\`\`\n${TEXT}\n\`\`\``).items).toHaveLength(34);
    const quoted = TEXT.replace('1인 80만원', '“1인 80만원”');
    expect(same(quoted).answers.budget).toBe('“1인 80만원” | 항공 제외');
  });
});

describe('거절', () => {
  const reason = (text: string) => {
    const result = parsePrepFile(text);
    expect(result && !result.accepted).toBe(true);
    return result && !result.accepted ? result.message : '';
  };

  it('양식 판이 다르다', () => {
    expect(reason(TEXT.replace('travel-app-prep/1', 'travel-app-prep/2'))).toContain('지원하지 않는 준비 자료 양식');
  });

  it('가이드 원문이 가이드로 읽히지 않는다', () => {
    const broken = TEXT.slice(0, TEXT.indexOf('## 가이드 원문')) + '## 가이드 원문\n아무 글\n';
    expect(reason(broken)).toContain('가이드 원문을 읽을 수 없습니다');
    expect(reason(TEXT.slice(0, TEXT.indexOf('## 가이드 원문')))).toContain('가이드 원문');
  });

  it('표가 깨졌다', () => {
    expect(reason(TEXT.replace('| 선택 | 종류 | 이름 | 지역 |', '| 선택 | 종류 | 이름 |'))).toContain(
      '표가 깨졌습니다',
    );
    expect(reason(TEXT.replace('|---|---|\n| ', '| ').replace('| 항목 | 값 |\n', '| 항목 | 값 |\n'))).toContain(
      '표가 깨졌습니다',
    );
  });
});

describe('맞지 않는 고른 것', () => {
  it('파일 안 가이드에 없는 것은 버리고 건수를 센다. 같은 세 값의 항목은 모두에 적용한다', () => {
    const extra = TEXT.replace(
      '\n\n## 가이드 원문',
      '\n| 관심 | 먹거리 | 없는 가게 | 어딘가 |\n| 모름 | 먹거리 | 없는 가게 | 어딘가 |\n\n## 가이드 원문',
    );
    const result = ready(parsePrepFile(extra));
    expect(result.dropped).toBe(2);
    expect(result.counts.must).toBe(1);
    const guide =
      '# 가이드: 가상\n- 양식: travel-app-guide/1\n\n## 항목\n| 종류 | 이름 | 지역 |\n|---|---|---|\n| 볼거리 | 같은 곳 | 가 |\n| 볼거리 | 같은 곳 | 가 |\n| 볼거리 | 다른 곳 | 가 |\n';
    const twin = ready(
      parsePrepFile(
        `# 준비 자료: 가상\n- 양식: travel-app-prep/1\n\n## 고른 것\n| 선택 | 종류 | 이름 | 지역 |\n|---|---|---|---|\n| 제외 | 볼거리 | 같은 곳 | 가 |\n\n## 가이드 원문\n${guide}`,
      ),
    );
    expect(twin.counts.exclude).toBe(2);
    expect(twin.dropped).toBe(0);
  });
});

describe('기존 가이드·계획 쪽 동작', () => {
  it('순수 가이드 글은 준비 자료로 보지 않고 변환 결과도 그대로다', () => {
    expect(parsePrepFile(HAKODATE)).toBeUndefined();
    const result = parseGuide(HAKODATE);
    expect(result.accepted && result.items).toHaveLength(34);
  });

  it('계획 쪽에 준비 자료가 오면 안내와 함께 거절한다', () => {
    const file = parsePlanFile(TEXT);
    expect(file.rejection?.code).toBe('is-prep');
    expect(file.rejection?.message).toContain('가이드 칸');
  });
});
