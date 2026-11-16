import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractFormatPrompt, PLAN_FORMAT_PROMPT } from '../src/plan-import/format-prompt';
import { buildTravelBrief, travelBriefProblem, type TravelAnswers } from '../src/plan-import/travel-brief';

const OPENING = '아래 조건으로 여행 계획을 함께 세워 줘.';
const REQUEST_HEADING = '[부탁할 일]';

/** 안내문 본문에도 `- 기간:` 같은 글이 있으므로 조건 부분만 잘라 본다. */
function conditions(brief: string) {
  return brief.slice(0, brief.indexOf(REQUEST_HEADING));
}

describe('요청서 만들기', () => {
  it('아무것도 답하지 않아도 요청서가 만들어진다 (AC-22)', () => {
    const brief = buildTravelBrief({});
    expect(brief.startsWith('아직 여행지와 기간을 정하지 않았어. 먼저 그것부터 같이 정해 줘.')).toBe(true);
    expect(brief).toContain(REQUEST_HEADING);
    expect(brief).toContain('1. 먼저 기간에 맞는 지역별 일정 구도를 제안해 줘.');
    expect(brief).not.toContain('[기본 조건]');
    expect(brief).not.toContain('[취향]');
    expect(brief).not.toContain('[꼭 고려할 것]');
    expect(brief.endsWith(PLAN_FORMAT_PROMPT)).toBe(true);
  });

  it('공백만 답한 것은 답하지 않은 것과 같다', () => {
    expect(buildTravelBrief({ destination: '  ', notes: '\n', interests: [' '], headcount: 0 })).toBe(
      buildTravelBrief({}),
    );
  });

  it('여행지만 답하면 기간이 비었다고 알리고 여행지 줄만 들어간다', () => {
    const brief = buildTravelBrief({ destination: '후쿠오카' });
    expect(brief.startsWith('아직 기간을 정하지 않았어. 먼저 그것부터 같이 정해 줘.')).toBe(true);
    expect(brief).toContain('[기본 조건]\n- 여행지: 후쿠오카\n');
    expect(conditions(brief)).not.toContain('- 기간:');
  });

  it('기간만 답하면 여행지가 비었다고 알린다', () => {
    const brief = buildTravelBrief({ startDate: '2027-04-15', endDate: '2027-04-18' });
    expect(brief.startsWith('아직 여행지를 정하지 않았어. 먼저 그것부터 같이 정해 줘.')).toBe(true);
    expect(brief).toContain('- 기간: 2027-04-15 ~ 2027-04-18');
    expect(conditions(brief)).not.toContain('- 여행지:');
  });

  it('여행지·기간을 모두 답하면 첫 줄이 기본 문장이다', () => {
    const brief = buildTravelBrief({ destination: '삿포로', startDate: '2027-01-02', endDate: '2027-01-05' });
    expect(brief.startsWith(`${OPENING}\n\n[기본 조건]`)).toBe(true);
  });

  it('답한 것만 정해진 틀로 들어가고 답하지 않은 줄은 통째로 빠진다', () => {
    const answers: TravelAnswers = {
      destination: '후쿠오카, 다자이후',
      startDate: '2027-04-15',
      endDate: '2027-04-18',
      companion: '부부',
      headcount: 2,
      interests: ['미식', '문화예술'],
      pace: '여유',
      transport: '도보+대중교통',
      stayTypes: ['호텔'],
      budget: '1인 80만원',
      notes: '아침 일찍 움직이는 건 싫어요.',
    };
    expect(buildTravelBrief(answers, { formatPrompt: '안내문' })).toBe(
      [
        OPENING,
        '',
        '[기본 조건]',
        '- 여행지: 후쿠오카, 다자이후',
        '- 기간: 2027-04-15 ~ 2027-04-18',
        '- 동행: 부부, 2명',
        '',
        '[취향]',
        '- 중요한 것: 미식, 문화예술',
        '- 속도: 여유 / 이동: 도보+대중교통',
        '- 숙소 유형: 호텔 / 예산: 1인 80만원',
        '',
        '[꼭 고려할 것]',
        '아침 일찍 움직이는 건 싫어요.',
        '',
        REQUEST_HEADING,
        '1. 먼저 기간에 맞는 지역별 일정 구도를 제안해 줘.',
        '2. 숙소를 어느 지역에 잡으면 좋은지 설명해 줘.',
        '3. 날짜별 일정을 만들고 이동 동선과 소요 시간을 검토해 줘.',
        '4. 정해지지 않은 것은 추측해서 확정하지 말고 나에게 물어봐 줘.',
        '5. 내가 "정리해 줘"라고 하면 아래 양식으로 내 줘.',
        '',
        '안내문',
      ].join('\n'),
    );
  });

  it('동행과 인원은 따로 답해도 각자의 줄로 들어간다', () => {
    expect(buildTravelBrief({ companion: '가족' })).toContain('- 동행: 가족\n');
    expect(buildTravelBrief({ headcount: 3 })).toContain('- 인원: 3명');
  });

  it('같은 답이면 같은 요청서가 나온다', () => {
    const answers: TravelAnswers = { destination: '교토', interests: ['자연', '쇼핑'], stayPriorities: ['조용함'] };
    expect(buildTravelBrief(answers)).toBe(buildTravelBrief({ ...answers, interests: [...answers.interests!] }));
  });

  it('가이드 항목 묶음을 끼울 자리가 [부탁할 일] 앞에 있다', () => {
    const brief = buildTravelBrief({}, { guideSection: '[고른 가이드 항목]\n- 가상 항목' });
    expect(brief.indexOf('[고른 가이드 항목]')).toBeGreaterThan(-1);
    expect(brief.indexOf('[고른 가이드 항목]')).toBeLessThan(brief.indexOf(REQUEST_HEADING));
  });
});

describe('기간 검사', () => {
  it('기간이 뒤집히면 막는다', () => {
    expect(travelBriefProblem({ startDate: '2027-04-18', endDate: '2027-04-15' })).toContain('이릅니다');
  });

  it('한쪽만 있거나 올바른 기간이면 문제가 없다', () => {
    expect(travelBriefProblem({})).toBeUndefined();
    expect(travelBriefProblem({ startDate: '2027-04-18' })).toBeUndefined();
    expect(travelBriefProblem({ startDate: '2027-04-15', endDate: '2027-04-15' })).toBeUndefined();
  });

  it('실제 없는 날짜는 막는다', () => {
    expect(travelBriefProblem({ startDate: '2027-02-30' })).toContain('읽을 수 없습니다');
  });
});

describe('양식 안내문은 문서 한 곳에서만 관리한다', () => {
  const document = readFileSync('docs/plan-format-v1-prompt.md', 'utf8');

  it('두 --- 줄 사이의 글이 그대로 요청서 끝에 들어간다', () => {
    const lines = document.split(/\r?\n/);
    const first = lines.indexOf('---');
    const last = lines.lastIndexOf('---');
    const expected = lines
      .slice(first + 1, last)
      .join('\n')
      .trim();
    expect(PLAN_FORMAT_PROMPT).toBe(expected);
    expect(PLAN_FORMAT_PROMPT.length).toBeGreaterThan(1000);
    expect(PLAN_FORMAT_PROMPT.startsWith('너는 내 여행 계획을 도와주고')).toBe(true);
    expect(buildTravelBrief({}).endsWith(expected)).toBe(true);
  });

  it('구분선이 없으면 오류', () => {
    expect(() => extractFormatPrompt('구분선 없음')).toThrow();
  });
});
