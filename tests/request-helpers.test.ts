import { describe, expect, it } from 'vitest';
import {
  applyLastAnswers,
  applyPreset,
  LAST_ANSWERS_KEY,
  loadLastAnswers,
  pickLastAnswers,
  saveLastAnswers,
  STYLE_PRESETS,
} from '../src/plan-import/prep-helpers';
import {
  INTEREST_OPTIONS,
  PACE_OPTIONS,
  VISIT_OPTIONS,
  buildTravelBrief,
  type TravelAnswers,
} from '../src/plan-import/travel-brief';
import { buildUpdateRequest, FILL_BLANKS_REQUEST, REQUEST_PLACEHOLDER, requestTextOf } from '../src/plan-update';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

const FULL: TravelAnswers = {
  destination: '후쿠오카',
  startDate: '2027-04-15',
  endDate: '2027-04-18',
  interests: ['관광', '미식'],
  pace: '보통',
  budget: '100만원',
  companion: '부부',
  headcount: 2,
  visit: '재방문',
  transport: '도보+대중교통',
  stayTypes: ['호텔'],
  stayPriorities: ['교통'],
  notes: '비 오면 실내',
};

describe('스타일 프리셋(C)', () => {
  it('세 가지이고 값은 기존 선택지 안에 있다', () => {
    expect(STYLE_PRESETS.map((preset) => preset.label)).toEqual(['첫 방문 핵심 관광', '여유로운 휴식', '미식 중심']);
    for (const preset of STYLE_PRESETS) {
      expect(preset.interests.every((value) => INTEREST_OPTIONS.includes(value))).toBe(true);
      expect(PACE_OPTIONS).toContain(preset.pace);
      if (preset.visit) {
        expect(VISIT_OPTIONS).toContain(preset.visit);
      }
    }
  });

  it('관심사·속도(·방문)만 바꾸고 나머지 칸은 그대로 둔다', () => {
    const relaxed = applyPreset(FULL, STYLE_PRESETS[1]);
    expect(relaxed).toEqual({ ...FULL, interests: ['휴식', '자연'], pace: '여유' });
    const first = applyPreset(FULL, STYLE_PRESETS[0]);
    expect(first).toEqual({ ...FULL, interests: ['관광', '문화예술'], pace: '보통', visit: '처음' });
    const empty = applyPreset({}, STYLE_PRESETS[2]);
    expect(empty).toEqual({ interests: ['미식', '관광'], pace: '보통' });
  });
});

describe('지난번 답(D)', () => {
  it('여덟 칸만 남기고 여행지·날짜·방문·메모는 남기지 않는다', () => {
    const storage = memoryStorage();
    expect(saveLastAnswers(storage, FULL)).toBe(true);
    const saved = JSON.parse(storage.map.get(LAST_ANSWERS_KEY) ?? '{}');
    expect(saved.version).toBe(1);
    expect(Object.keys(saved.answers).sort()).toEqual(
      ['budget', 'companion', 'headcount', 'interests', 'pace', 'stayPriorities', 'stayTypes', 'transport'].sort(),
    );
    expect(JSON.stringify(saved)).not.toMatch(/후쿠오카|2027|재방문|비 오면/);
  });

  it('불러오면 여덟 칸을 덮고 여행지·날짜·방문·메모는 그대로 둔다', () => {
    const storage = memoryStorage();
    saveLastAnswers(storage, FULL);
    const last = loadLastAnswers(storage);
    expect(last).toBeDefined();
    const target: TravelAnswers = {
      destination: '삿포로',
      startDate: '2027-09-01',
      visit: '처음',
      notes: '메모',
      pace: '여유',
    };
    const filled = applyLastAnswers(target, last!);
    expect(filled.destination).toBe('삿포로');
    expect(filled.startDate).toBe('2027-09-01');
    expect(filled.visit).toBe('처음');
    expect(filled.notes).toBe('메모');
    expect(filled.pace).toBe('보통');
    expect(filled.interests).toEqual(['관광', '미식']);
    expect(filled.headcount).toBe(2);
  });

  it('깨진 값·다른 버전·모양 불일치는 없는 것으로 본다', () => {
    expect(loadLastAnswers(undefined)).toBeUndefined();
    expect(loadLastAnswers(memoryStorage({ [LAST_ANSWERS_KEY]: '{깨짐' }))).toBeUndefined();
    expect(loadLastAnswers(memoryStorage({ [LAST_ANSWERS_KEY]: '[1]' }))).toBeUndefined();
    expect(
      loadLastAnswers(memoryStorage({ [LAST_ANSWERS_KEY]: JSON.stringify({ version: 2, answers: { pace: '보통' } }) })),
    ).toBeUndefined();
    expect(
      loadLastAnswers(memoryStorage({ [LAST_ANSWERS_KEY]: JSON.stringify({ version: 1, answers: 'x' }) })),
    ).toBeUndefined();
  });

  it('선택지 밖의 값은 버리고, 남길 것이 없으면 저장하지 않는다', () => {
    expect(pickLastAnswers({ pace: '번개', interests: ['없는것'], headcount: -1, budget: '  ' })).toEqual({});
    const storage = memoryStorage();
    expect(saveLastAnswers(storage, { destination: '후쿠오카' })).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it('읽기·쓰기가 막혀도 던지지 않는다', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadLastAnswers(blocked)).toBeUndefined();
    expect(saveLastAnswers(blocked, FULL)).toBe(false);
  });

  it('요청서에는 지난번 답을 넣어도 기존 요청서 만들기가 그대로 동작한다', () => {
    expect(buildTravelBrief(applyLastAnswers({}, pickLastAnswers(FULL as Record<string, unknown>)))).toContain('관광');
  });
});

describe('빈 칸 채우기 요청문(B)', () => {
  it('자유 요청은 자리 표시, 빈 칸 채우기는 정해진 글이 [요청] 줄에 들어간다', () => {
    const exported = '# 내보낸 글';
    expect(buildUpdateRequest(exported, requestTextOf('free'))).toContain(REQUEST_PLACEHOLDER);
    const filled = buildUpdateRequest(exported, requestTextOf('fill-blanks'));
    expect(filled).toContain(`[요청] ${FILL_BLANKS_REQUEST}`);
    expect(filled).not.toContain(REQUEST_PLACEHOLDER);
  });

  it('시간·제목·순서를 바꾸지 않고 ID 있는 장소 줄을 고치지 않는다는 뜻이 든다', () => {
    expect(FILL_BLANKS_REQUEST).toMatch(/시간·제목·순서는 바꾸지 말고/);
    expect(FILL_BLANKS_REQUEST).toMatch(/메모·링크 칸만/);
    expect(FILL_BLANKS_REQUEST).toMatch(/ID 없는 새 줄/);
    expect(FILL_BLANKS_REQUEST).toMatch(/ID가 있는 장소 줄은 고치지 말아/);
    expect(FILL_BLANKS_REQUEST).toMatch(/확인되지 않은 것은 채우지 말고/);
  });
});
