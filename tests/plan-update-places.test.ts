import { describe, expect, it } from 'vitest';
import { contentRevisionSchema, planItemSchema } from '../src/contracts/v2';
import {
  buildLinkPlan,
  buildPlaceContent,
  chunkPlaces,
  collectMarkCandidates,
  collectPlaceCandidates,
  composePlaceSummary,
  computeUpdate,
  exportPlan,
  placeKindOf,
  splitPlaceSummary,
  type CatalogPlace,
  type CatalogRegion,
} from '../src/plan-update';
import { act, check, createdTrip, fixture, newPlan } from './plan-import-helpers';
import { currentOf, ready, rewriteRow } from './plan-update-helpers';

const NEW_TEXT = newPlan({
  period: '2027-03-01 ~ 2027-03-02',
  days: [
    {
      heading: '2027-03-01 첫날',
      rows: [
        act('09:00', '공항 이동', '이동', { place: '신치토세 공항' }),
        act('12:00', '점심', '식사', { place: '라멘집' }),
        act('15:00', '구경', '관광', { place: '라멘집' }),
      ],
    },
    {
      heading: '2027-03-02 둘째날',
      rows: [act('', '장보기', '쇼핑', { place: '시장' }), act('', '그냥', '기타', { place: '비밀장소' })],
    },
  ],
  after: [
    '## 장소',
    '| ID | 이름 | 지역 | 설명 | 영업시간 | 링크 |',
    '|---|---|---|---|---|---|',
    '| | 라멘집 | 삿포로 | 맛집 | 11:00-20:00 | not-a-url |',
    '| | 아무도 안 감 | | | | https://example.com/x |',
  ].join('\n'),
});

describe('장소 종류 판정', () => {
  it('양식의 종류 값으로 정하고 그 밖은 spot이다', () => {
    expect(placeKindOf('관광')).toBe('sight');
    expect(placeKindOf('식사')).toBe('food');
    expect(placeKindOf('이동')).toBe('transport');
    expect(placeKindOf('숙박')).toBe('lodging');
    expect(placeKindOf('쇼핑')).toBe('shopping');
    expect(placeKindOf('기타')).toBe('spot');
    expect(placeKindOf('체험')).toBe('spot');
    expect(placeKindOf(undefined)).toBe('spot');
  });

  it('후보의 종류는 그 이름을 적은 첫 활동(날짜순·줄 순서)의 종류다', () => {
    const { candidates } = collectPlaceCandidates(check(NEW_TEXT), { places: [], regions: [] });
    const kindOf = (name: string) => candidates.find((candidate) => candidate.name === name)?.kind;
    expect(kindOf('신치토세 공항')).toBe('transport');
    expect(kindOf('라멘집')).toBe('food');
    expect(kindOf('시장')).toBe('shopping');
    expect(kindOf('비밀장소')).toBe('spot');
    expect(kindOf('아무도 안 감')).toBe('spot');
    expect(candidates.find((candidate) => candidate.name === '라멘집')?.usedBy).toBe(2);
  });

  it('주소가 아닌 링크는 넣지 않고 경고한다', () => {
    const { candidates } = collectPlaceCandidates(check(NEW_TEXT), { places: [], regions: [] });
    const ramen = candidates.find((candidate) => candidate.name === '라멘집')!;
    expect(ramen.link).toBe('');
    const file = check(NEW_TEXT);
    expect(file.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(file.issues.map((issue) => issue.code)).toContain('place-link-skipped');
    expect(candidates.find((candidate) => candidate.name === '아무도 안 감')?.link).toBe('https://example.com/x');
  });

  it('같은 이름의 기존 장소는 연결 후보로 표시하고 합치지 않는다', () => {
    const places: CatalogPlace[] = [{ entityId: 'p-old', name: '시장', summary: '', regionIds: [] }];
    const { candidates } = collectPlaceCandidates(check(NEW_TEXT), { places, regions: [] });
    expect(candidates.find((candidate) => candidate.name === '시장')?.existing?.entityId).toBe('p-old');
  });
});

describe('설명 끝의 지역·영업시간 표시', () => {
  it('설명 [지역] [영업시간] 순서로 붙이고 빈 값은 만들지 않는다', () => {
    expect(composePlaceSummary({ description: '맛집', regionText: '삿포로', hours: '11-20' })).toBe(
      '맛집 [지역: 삿포로] [영업시간(미확인): 11-20]',
    );
    expect(composePlaceSummary({ description: '', regionText: '', hours: '11-20' })).toBe('[영업시간(미확인): 11-20]');
    expect(composePlaceSummary({ description: '맛집', regionText: '', hours: '' })).toBe('맛집');
  });

  it('떼어 내면 처음 값이 돌아온다', () => {
    const summary = composePlaceSummary({ description: '맛집', regionText: '삿포로', hours: '11-20' });
    expect(splitPlaceSummary(summary)).toEqual({ description: '맛집', regionText: '삿포로', hours: '11-20' });
    expect(splitPlaceSummary('그냥 설명')).toEqual({ description: '그냥 설명', regionText: '', hours: '' });
  });

  it('지역 이름이 맞으면 regionIds에 연결하고 표시는 만들지 않는다(앞뒤 공백 무시)', () => {
    const regions: CatalogRegion[] = [{ entityId: 'r-1', name: '삿포로' }];
    const { candidates } = collectPlaceCandidates(check(NEW_TEXT), { places: [], regions });
    const ramen = candidates.find((candidate) => candidate.name === '라멘집')!;
    const content = buildPlaceContent('trip-1', { ...ramen, region: ' 삿포로 ' }, regions);
    expect(content.payload.regionIds).toEqual(['r-1']);
    expect(content.payload.summary).toBe('맛집 [영업시간(미확인): 11:00-20:00]');
    expect(content.payload.placeKind).toBe('food');
  });

  it('지역 이름이 안 맞으면 regionIds는 비우고 설명 끝에 표시한다. 저장 형식 검사를 통과한다', () => {
    const { candidates } = collectPlaceCandidates(check(NEW_TEXT), { places: [], regions: [] });
    const ramen = candidates.find((candidate) => candidate.name === '라멘집')!;
    const content = buildPlaceContent('trip-1', ramen, [{ entityId: 'r-9', name: '오타루' }]);
    expect(content.payload.regionIds).toEqual([]);
    expect(content.payload.summary).toBe('맛집 [지역: 삿포로] [영업시간(미확인): 11:00-20:00]');
    expect('wikiRef' in content.payload).toBe(false);
    const stamped = { ...content, commitSeq: 1, recordedAt: '2027-01-01T00:00:00Z', actor: 'user' };
    expect(contentRevisionSchema.safeParse(stamped).success).toBe(true);
  });
});

describe('장소 만들기 묶음', () => {
  it('한 번에 20개까지로 나눈다', () => {
    const chunks = chunkPlaces(Array.from({ length: 45 }, (_, index) => index));
    expect(chunks.map((chunk) => chunk.length)).toEqual([20, 20, 5]);
    expect(chunkPlaces([])).toEqual([]);
  });
});

describe('장소가 든 여행: 내보내기 → 그대로 가져오기', () => {
  const created = createdTrip(fixture('chatgpt-t1-run2.md'));
  const regions: CatalogRegion[] = [{ entityId: 'r-1', name: '삿포로' }];
  const places: CatalogPlace[] = [
    {
      entityId: 'p-1',
      name: '오도리 공원',
      summary: composePlaceSummary({ description: '넓은 공원', regionText: '삿포로 중심', hours: '24시간' }),
      wikiRef: 'https://example.com/odori',
      regionIds: [],
    },
    { entityId: 'p-2', name: '라멘 골목', summary: '', regionIds: ['r-1'] },
  ];
  const plan = structuredClone(created.initialPlan);
  plan.items[0].placeLinks = [{ placeId: 'p-1', relation: 'visit' }];
  plan.items[1].placeLinks = [{ placeId: 'p-2', relation: 'visit' }];
  const placeNames = new Map(places.map((place) => [place.entityId, place.name]));
  const exported = exportPlan({ header: created.header, plan, placeNames, places, regions });

  it('활동에 연결된 장소만 장소 표에 내보내고 지역·영업시간은 칸으로 올린다', () => {
    expect(exported.counts.places).toBe(2);
    expect(exported.text).toContain('## 장소\n| ID | 이름 | 지역 | 설명 | 영업시간 | 링크 |');
    expect(exported.text).toContain(
      '| p-1 | 오도리 공원 | 삿포로 중심 | 넓은 공원 | 24시간 | https://example.com/odori |',
    );
    expect(exported.text).toContain('| p-2 | 라멘 골목 | 삿포로 |  |  |  |');
    expect(exported.text).not.toContain('[영업시간(미확인)');
  });

  it('연결되지 않은 장소는 내보내지 않는다', () => {
    const extra: CatalogPlace = { entityId: 'p-3', name: '안 쓴 곳', summary: '', regionIds: [] };
    const result = exportPlan({ header: created.header, plan, placeNames, places: [...places, extra], regions });
    expect(result.text).not.toContain('안 쓴 곳');
  });

  it('왕복: 변경 0건, 새 장소 후보 0건, 기존 장소 줄 안내 0건', () => {
    const again = check(exported.text);
    expect(again.issues).toEqual([]);
    const current = { ...currentOf({ ...created, initialPlan: plan }, placeNames) };
    const result = ready(computeUpdate(again, current));
    expect(result.changes).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    const collection = collectPlaceCandidates(again, { plan: current.plan, places, regions });
    expect(collection.candidates).toEqual([]);
    expect(collection.existingLines).toEqual({ changed: 0, unknown: 0 });
  });

  it('메모에만 이름이 남은 활동도 왕복에서 새 장소 후보가 되지 않는다', () => {
    const marked = createdTrip(NEW_TEXT);
    const text = exportPlan({ header: marked.header, plan: marked.initialPlan }).text;
    const again = check(text);
    const collection = collectPlaceCandidates(again, { plan: currentOf(marked).plan, places: [], regions: [] });
    expect(collection.candidates).toEqual([]);
  });

  it('기존 장소 줄(ID 있음)의 내용이 다르면 고치지 않고 줄 수만 센다', () => {
    const edited = exported.text
      .replace(
        '| p-1 | 오도리 공원 | 삿포로 중심 | 넓은 공원 | 24시간 |',
        '| p-1 | 오도리 공원 | 삿포로 중심 | 새 설명 | 24시간 |',
      )
      .replace('| p-2 |', '| p-9 |');
    const current = currentOf({ ...created, initialPlan: plan }, placeNames);
    const collection = collectPlaceCandidates(check(edited), { plan: current.plan, places, regions });
    expect(collection.existingLines).toEqual({ changed: 1, unknown: 1 });
    expect(collection.candidates).toEqual([]);
  });
});

describe('메모의 [장소: 이름] 연결', () => {
  const created = createdTrip(NEW_TEXT);
  const plan = currentOf(created).plan;

  it('메모 표시에서 후보를 모으고 종류는 그 메모가 달린 첫 활동의 종류다', () => {
    const candidates = collectMarkCandidates(plan, { places: [] });
    expect(candidates.map((candidate) => candidate.name).sort()).toEqual(
      ['라멘집', '비밀장소', '시장', '신치토세 공항'].sort(),
    );
    expect(candidates.find((candidate) => candidate.name === '라멘집')?.kind).toBe('food');
  });

  it('고른 이름만 연결하고 표시를 빼며 다른 칸은 그대로다', () => {
    const result = buildLinkPlan(plan, new Map([['라멘집', 'p-ramen']]));
    expect(result.operations).toHaveLength(2);
    expect(result.linked.map((entry) => entry.place)).toEqual(['라멘집', '라멘집']);
    for (const operation of result.operations) {
      expect(operation.type).toBe('upsert-item');
      if (operation.type === 'upsert-item') {
        const before = plan.items.find((item) => item.activityId === operation.item.activityId)!;
        expect(operation.item.summary).toBe('');
        expect(operation.item.placeLinks).toEqual([{ placeId: 'p-ramen', relation: 'visit' }]);
        expect({ ...operation.item, summary: before.summary, placeLinks: before.placeLinks }).toEqual(before);
        expect(planItemSchema.safeParse(operation.item).success).toBe(true);
      }
    }
  });

  it('고른 이름이 없으면 연산이 없다(아무것도 남지 않는다)', () => {
    expect(buildLinkPlan(plan, new Map()).operations).toEqual([]);
  });
});

describe('수정 글에서 승인된 장소에 연결', () => {
  const created = createdTrip(fixture('chatgpt-t1-run2.md'));
  const base = exportPlan({ header: created.header, plan: created.initialPlan }).text;
  const firstId = created.initialPlan.items[0].activityId;

  it('장소 단계를 승인하지 않으면 이전처럼 메모 앞에 이름이 남는다', () => {
    const text = rewriteRow(base, firstId, { 장소: '새로 만들 곳' });
    const result = ready(computeUpdate(check(text), currentOf(created)));
    const [change] = result.changes;
    expect(change.operation.type === 'upsert-item' && change.operation.item.summary).toContain('[장소: 새로 만들 곳]');
    expect(change.operation.type === 'upsert-item' && change.operation.item.placeLinks).toEqual([]);
  });

  it('승인된 이름이면 장소에 연결하고 표시를 만들지 않는다', () => {
    const text = rewriteRow(base, firstId, { 장소: '새로 만들 곳', 메모: '메모만' });
    const current = { ...currentOf(created), placeIds: new Map([['새로 만들 곳', 'p-new']]) };
    const result = ready(computeUpdate(check(text), current));
    const [change] = result.changes;
    if (change.operation.type !== 'upsert-item') {
      throw new Error('upsert-item 아님');
    }
    expect(change.operation.item.summary).toBe('메모만');
    expect(change.operation.item.placeLinks).toEqual([{ placeId: 'p-new', relation: 'visit' }]);
  });
});

describe('장소 만들기가 올린 revision', () => {
  const created = createdTrip(fixture('chatgpt-t1-run2.md'));
  const text = exportPlan({ header: created.header, plan: created.initialPlan }).text;
  const base = created.header.domainRevision;

  it('글의 기준revision → 장소 만들기로 올라간 revision은 오래된 기준으로 보지 않는다', () => {
    const current = currentOf(created);
    current.header.domainRevision = base + 1;
    expect(computeUpdate(check(text), current).status).toBe('blocked');
    const bridged = { ...current, revisionBridge: { from: base, to: base + 1 } };
    expect(computeUpdate(check(text), bridged).status).toBe('ready');
  });

  it('그 사이 다른 변경이 더 있으면 막는다', () => {
    const current = currentOf(created);
    current.header.domainRevision = base + 2;
    const bridged = { ...current, revisionBridge: { from: base, to: base + 1 } };
    expect(computeUpdate(check(text), bridged).status).toBe('blocked');
  });
});
