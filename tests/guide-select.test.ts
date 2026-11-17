import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clearDraft,
  DRAFT_STORAGE_KEY,
  guideOf,
  loadDraft,
  saveDraft,
  type PrepState,
  type StorageLike,
} from '../src/guide-import/draft';
import { buildGuideRequest, buildGuideSection, GUIDE_REQUEST_TEMPLATE } from '../src/guide-import/guide-request';
import {
  countByChoice,
  countChanges,
  pruneSelections,
  setChoices,
  similarRemaining,
  toggleChoice,
} from '../src/guide-import/selection';
import { buildTravelBrief } from '../src/plan-import/travel-brief';

const HAKODATE = readFileSync('tests/fixtures/guide-format/hakodate.md', 'utf8');
const guide = guideOf(HAKODATE)!;
const items = guide.items;
const byName = (name: string) => items.find((item) => item.name === name)!;

function memoryStorage(initial?: string): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  if (initial !== undefined) {
    map.set(DRAFT_STORAGE_KEY, initial);
  }
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('고르기', () => {
  const key = items[0].key;

  it('같은 단추를 다시 누르면 고르지 않음으로 돌아가고 원본은 바뀌지 않는다', () => {
    const before = {};
    const picked = toggleChoice(before, key, 'must');
    expect(picked).toEqual({ [key]: 'must' });
    expect(before).toEqual({});
    expect(toggleChoice(picked, key, 'must')).toEqual({});
    expect(toggleChoice(picked, key, 'exclude')).toEqual({ [key]: 'exclude' });
  });

  it('한 번에 고르기: 바뀌는 개수를 미리 센다', () => {
    const keys = items.slice(0, 4).map((item) => item.key);
    const start = toggleChoice({}, keys[0], 'interest');
    expect(countChanges(start, keys, 'interest')).toBe(3);
    const all = setChoices(start, keys, 'exclude');
    expect(keys.every((k) => all[k] === 'exclude')).toBe(true);
    expect(setChoices(all, keys, undefined)).toEqual({});
  });

  it('현황은 가이드 항목 기준으로 센다', () => {
    const selections = {
      [items[0].key]: 'must',
      [items[1].key]: 'must',
      [items[2].key]: 'exclude',
      낯선키: 'must',
    } as const;
    expect(countByChoice(selections, items)).toEqual({ must: 2, interest: 0, exclude: 1 });
    expect(pruneSelections(selections, items)).not.toHaveProperty('낯선키');
  });

  describe('비슷한 항목 알림 (R1)', () => {
    const similarTo = (name: string) => {
      const target = byName(name);
      const selections = toggleChoice({}, target.key, 'exclude');
      return similarRemaining(target, items, selections).map((item) => item.name);
    };

    it('이름이 다르게 시작해도 지역 칸이 제외 항목의 이름이면 알린다', () => {
      expect(similarTo('오누마 국정공원')).toContain('겨울 오누마 설경 산책·스노 액티비티');
    });

    it('이름·지역·설명에 이름 전체가 들어 있는 항목을 알린다', () => {
      const names = similarTo('유노카와 온천');
      expect(names).toEqual(
        expect.arrayContaining([
          '유노카와 온천 입욕',
          '하코다테 열대식물원 온천 원숭이 관찰',
          '고료카쿠·온천 휴식 코스',
        ]),
      );
    });

    it('앞 낱말만 같은 무관한 항목은 알리지 않는다', () => {
      const names = similarTo('하코다테 열대식물원 온천 원숭이 관찰');
      expect(names).not.toContain('하코다테 아침시장');
      expect(names).not.toContain('하코다테 시오라멘');
    });

    it('제외한 항목의 이름이 다른 항목 이름을 통째로 포함해도 알린다', () => {
      const long = { ...items[0], key: 'x1', name: '가나다라 마바사', area: '', description: '' };
      const short = { ...items[0], key: 'x2', name: '가나다라', area: '', description: '' };
      const selections = { x1: 'exclude' } as const;
      expect(similarRemaining(long, [long, short], selections)).toEqual([short]);
    });

    it('제외하지 않은 항목만, 이미 제외한 것은 빼고, 제외하지 않은 항목 자신은 알리지 않는다', () => {
      const target = byName('오누마 국정공원');
      const twin = byName('겨울 오누마 설경 산책·스노 액티비티');
      const both = setChoices({}, [target.key, twin.key], 'exclude');
      expect(similarRemaining(target, items, both).map((item) => item.name)).not.toContain(twin.name);
      expect(similarRemaining(target, items, {})).toEqual([]);
    });

    it('2글자 미만 이름은 비교하지 않는다', () => {
      const tiny = { ...items[0], key: 'y1', name: '온', area: '', description: '' };
      const other = { ...items[0], key: 'y2', name: '온천 마을', area: '', description: '온천' };
      expect(similarRemaining(tiny, [tiny, other], { y1: 'exclude' })).toEqual([]);
      expect(similarRemaining(other, [tiny, other], { y2: 'exclude' })).toEqual([]);
    });
  });
});

describe('요청서 결합', () => {
  const must = [byName('하코다테산 전망대'), byName('하코다테 시오라멘')];
  const interest = byName('가네모리 붉은 벽돌 창고');
  const exclude = byName('유노카와 온천 입욕');
  const selections = {
    [must[0].key]: 'must',
    [must[1].key]: 'must',
    [interest.key]: 'interest',
    [exclude.key]: 'exclude',
  } as const;

  it('고른 것이 없으면 빈 글이고 요청서는 가이드 없을 때와 같다', () => {
    expect(buildGuideSection(items, {})).toBe('');
    expect(buildTravelBrief({}, { guideSection: buildGuideSection(items, {}) })).toBe(buildTravelBrief({}));
  });

  it('묶음 순서·표기·확인할 것', () => {
    const section = buildGuideSection(items, selections);
    const order = ['[꼭 포함]', '[관심]', '[제외]', '[확인할 것]'].map((title) => section.indexOf(title));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(section).toContain(
      '[꼭 포함]\n반드시 넣어 줘. 어렵다면 이유와 대안을 알려 줘.\n- 볼거리 / 하코다테산 전망대 / 하코다테산',
    );
    expect(section).toContain('[제외]\n넣지 말아 줘.\n- 체험 / 유노카와 온천 입욕 / 유노카와 온천');
    expect(section).toContain('- 하코다테산 전망대: 로프웨이 운행과 날씨');
    expect(section).not.toContain('아침시장');
  });

  it('제외 항목의 확인 필요는 확인할 것에 넣지 않고, 빈 묶음은 제목도 뺀다', () => {
    const onlyExclude = buildGuideSection(items, { [exclude.key]: 'exclude' });
    expect(onlyExclude).toContain('[제외]');
    expect(onlyExclude).not.toContain('[확인할 것]');
    expect(onlyExclude).not.toContain('[꼭 포함]');
  });

  it('같은 선택이면 같은 요청서, 묶음은 [부탁할 일] 앞에 들어가고 안내 줄이 더해진다', () => {
    const section = buildGuideSection(items, selections);
    const brief = buildTravelBrief({ destination: '하코다테' }, { guideSection: section });
    expect(brief).toBe(
      buildTravelBrief({ destination: '하코다테' }, { guideSection: buildGuideSection(items, { ...selections }) }),
    );
    expect(brief.indexOf('[제외]')).toBeLessThan(brief.indexOf('[부탁할 일]'));
    expect(brief).toContain('4. 정해지지 않은 것은');
    expect(brief).toContain('5. [꼭 포함]을 넣기 어렵거나 [제외]를 넣어야 한다면 먼저 나에게 알려 줘.');
    expect(brief).toContain('6. 내가 "정리해 줘"라고 하면 아래 양식으로 내 줘.');
  });
});

describe('가이드 요청문', () => {
  it('두 선 사이의 글을 한 곳(문서)에서 읽고 목적지·기간을 채운다', () => {
    expect(GUIDE_REQUEST_TEMPLATE).toContain('travel-app-guide/1');
    const text = buildGuideRequest({ destination: '하코다테', startDate: '2027-01-02', endDate: '2027-01-05' });
    expect(text.startsWith('하코다테를 2027-01-02~2027-01-05에 여행하려고 한다.')).toBe(true);
    expect(text).not.toContain('{');
  });

  it('기간이 비어 있으면 그 말을 뺀다', () => {
    expect(buildGuideRequest({ destination: '삿포로' }).startsWith('삿포로를 여행하려고 한다.')).toBe(true);
  });
});

describe('준비 초안 저장·복원', () => {
  const state = (): PrepState => ({
    answers: { destination: '하코다테', interests: ['미식'] },
    guideText: HAKODATE,
    guide,
    selections: { [items[0].key]: 'must', [items[5].key]: 'exclude' },
  });

  it('저장한 것을 같은 모양으로 복원한다(가이드는 원문에서 다시 해석)', () => {
    const storage = memoryStorage();
    expect(saveDraft(storage, state())).toBe(true);
    const loaded = loadDraft(storage);
    expect(loaded.found).toBe(true);
    expect(loaded.state.answers).toEqual(state().answers);
    expect(loaded.state.selections).toEqual(state().selections);
    expect(loaded.state.guide?.items).toHaveLength(34);
  });

  it('없으면 빈 상태, 깨진 JSON·다른 버전은 버리고 알린다', () => {
    expect(loadDraft(memoryStorage()).found).toBe(false);
    for (const raw of ['{깨짐', JSON.stringify({ version: 99, answers: {} }), '[]']) {
      const loaded = loadDraft(memoryStorage(raw));
      expect(loaded.found).toBe(false);
      expect(loaded.discarded).toContain('버렸습니다');
    }
  });

  it('가이드 원문이 깨졌으면 가이드·고른 것을 버리고 답은 남긴다', () => {
    const raw = JSON.stringify({
      version: 1,
      answers: { destination: '교토' },
      guideText: '깨진 글',
      selections: { x: 'must' },
    });
    const loaded = loadDraft(memoryStorage(raw));
    expect(loaded.state.answers.destination).toBe('교토');
    expect(loaded.state.guide).toBeUndefined();
    expect(loaded.state.selections).toEqual({});
  });

  it('가이드에 없는 key의 선택은 버린다', () => {
    const raw = JSON.stringify({
      version: 1,
      answers: {},
      guideText: HAKODATE,
      selections: { 없는키: 'must', [items[0].key]: 'interest' },
    });
    expect(loadDraft(memoryStorage(raw)).state.selections).toEqual({ [items[0].key]: 'interest' });
  });

  it('저장이 막히면 false를 돌려주고 예외를 던지지 않는다', () => {
    const blocked: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(saveDraft(blocked, state())).toBe(false);
    expect(saveDraft(undefined, state())).toBe(false);
  });

  it('지우기', () => {
    const storage = memoryStorage();
    saveDraft(storage, state());
    expect(clearDraft(storage)).toBe(true);
    expect(loadDraft(storage).found).toBe(false);
  });
});
