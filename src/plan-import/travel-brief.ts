import { PLAN_FORMAT_PROMPT } from './format-prompt';
import { isRealDate } from './time-cell';

export const PACE_OPTIONS = ['여유', '보통', '알차게'] as const;
export const INTEREST_OPTIONS = ['관광', '휴식', '미식', '자연', '문화예술', '쇼핑', '체험'] as const;
export const COMPANION_OPTIONS = ['혼자', '부부', '연인', '가족', '친구'] as const;
export const VISIT_OPTIONS = ['처음', '재방문'] as const;
export const TRANSPORT_OPTIONS = ['도보+대중교통', '렌터카', '택시', '혼합'] as const;
export const STAY_TYPE_OPTIONS = ['호텔', '료칸', '전통 숙소', '리조트', '아파트형', '게스트하우스'] as const;
export const STAY_PRIORITY_OPTIONS = ['교통', '관광지 접근', '조용함', '가격'] as const;

/** 모든 항목은 선택이다. 비어 있거나 답하지 않은 항목은 요청서에 넣지 않는다. */
export type TravelAnswers = {
  destination?: string;
  startDate?: string;
  endDate?: string;
  interests?: string[];
  pace?: string;
  budget?: string;
  companion?: string;
  headcount?: number;
  visit?: string;
  transport?: string;
  stayTypes?: string[];
  stayPriorities?: string[];
  notes?: string;
};

export type BriefOptions = {
  /** P1에서 쓸 "고른 가이드 항목" 묶음. 이번 단계에서는 만들지 않고 끼울 자리만 둔다. */
  guideSection?: string;
  /** 요청서 맨 끝에 붙이는 양식 안내문. 기본값은 안내문 문서에서 읽어 온 글이다. */
  formatPrompt?: string;
};

const REQUEST_STEPS = [
  '먼저 기간에 맞는 지역별 일정 구도를 제안해 줘.',
  '숙소를 어느 지역에 잡으면 좋은지 설명해 줘.',
  '날짜별 일정을 만들고 이동 동선과 소요 시간을 검토해 줘.',
  '정해지지 않은 것은 추측해서 확정하지 말고 나에게 물어봐 줘.',
  '내가 "정리해 줘"라고 하면 아래 양식으로 내 줘.',
];

function clean(value: string | undefined) {
  return value?.trim() ?? '';
}

function cleanList(values: string[] | undefined) {
  return (values ?? []).map((value) => value.trim()).filter((value) => value !== '');
}

/** 기간은 두 날짜가 모두 있을 때만 앞뒤를 검사한다. 문제가 있으면 사람이 읽는 문장을, 없으면 undefined. */
export function travelBriefProblem(answers: TravelAnswers): string | undefined {
  const start = clean(answers.startDate);
  const end = clean(answers.endDate);
  for (const value of [start, end]) {
    if (value !== '' && !isRealDate(value)) {
      return `날짜 "${value}"를 읽을 수 없습니다. 실제 있는 날짜를 YYYY-MM-DD로 입력하세요.`;
    }
  }
  if (start !== '' && end !== '' && end < start) {
    return '기간의 끝 날짜가 시작 날짜보다 이릅니다. 날짜를 확인하세요.';
  }
  return undefined;
}

function periodText(answers: TravelAnswers) {
  const start = clean(answers.startDate);
  const end = clean(answers.endDate);
  if (start !== '' && end !== '') {
    return `${start} ~ ${end}`;
  }
  if (start !== '') {
    return `${start} 시작 (끝 날짜는 아직 미정)`;
  }
  if (end !== '') {
    return `${end} 끝 (시작 날짜는 아직 미정)`;
  }
  return '';
}

function openingLine(answers: TravelAnswers) {
  const missing = [];
  if (clean(answers.destination) === '') {
    missing.push('여행지');
  }
  if (clean(answers.startDate) === '' && clean(answers.endDate) === '') {
    missing.push('기간');
  }
  if (missing.length === 0) {
    return '아래 조건으로 여행 계획을 함께 세워 줘.';
  }
  const object = missing.length === 2 ? '여행지와 기간을' : `${missing[0]}${missing[0] === '기간' ? '을' : '를'}`;
  return `아직 ${object} 정하지 않았어. 먼저 그것부터 같이 정해 줘.`;
}

function companionLines(answers: TravelAnswers) {
  const companion = clean(answers.companion);
  const headcount = answers.headcount && answers.headcount > 0 ? Math.floor(answers.headcount) : undefined;
  if (companion !== '' && headcount) {
    return [`- 동행: ${companion}, ${headcount}명`];
  }
  if (companion !== '') {
    return [`- 동행: ${companion}`];
  }
  return headcount ? [`- 인원: ${headcount}명`] : [];
}

function slashLine(parts: [string, string][]) {
  const answered = parts.filter(([, value]) => value !== '').map(([label, value]) => `${label}: ${value}`);
  return answered.length > 0 ? [`- ${answered.join(' / ')}`] : [];
}

function section(title: string, lines: string[]) {
  return lines.length > 0 ? [title, ...lines] : [];
}

function basicLines(answers: TravelAnswers) {
  const destination = clean(answers.destination);
  const period = periodText(answers);
  return [
    ...(destination === '' ? [] : [`- 여행지: ${destination}`]),
    ...(period === '' ? [] : [`- 기간: ${period}`]),
    ...companionLines(answers),
  ];
}

function tasteLines(answers: TravelAnswers) {
  const interests = cleanList(answers.interests).join(', ');
  return [
    ...(interests === '' ? [] : [`- 중요한 것: ${interests}`]),
    ...slashLine([
      ['속도', clean(answers.pace)],
      ['방문 경험', clean(answers.visit)],
      ['이동', clean(answers.transport)],
    ]),
    ...slashLine([
      ['숙소 유형', cleanList(answers.stayTypes).join(', ')],
      ['숙소에서 중요한 것', cleanList(answers.stayPriorities).join(', ')],
      ['예산', clean(answers.budget)],
    ]),
  ];
}

/**
 * 조건·취향 답변 → 챗봇에게 붙여 넣을 요청서. 순수 함수이며 같은 답이면 같은 글이 나온다.
 * 답하지 않은 줄은 통째로 빼고, 줄이 하나도 없는 묶음은 제목도 뺀다.
 */
export function buildTravelBrief(answers: TravelAnswers, options: BriefOptions = {}): string {
  const notes = clean(answers.notes);
  const blocks = [
    [openingLine(answers)],
    section('[기본 조건]', basicLines(answers)),
    section('[취향]', tasteLines(answers)),
    section('[꼭 고려할 것]', notes === '' ? [] : [notes]),
    options.guideSection ? [options.guideSection.trim()] : [],
    ['[부탁할 일]', ...REQUEST_STEPS.map((step, index) => `${index + 1}. ${step}`)],
    [(options.formatPrompt ?? PLAN_FORMAT_PROMPT).trim()],
  ];
  return blocks
    .filter((block) => block.length > 0)
    .map((block) => block.join('\n'))
    .join('\n\n');
}
