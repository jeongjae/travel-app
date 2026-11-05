import { describe, expect, it } from 'vitest';
import { guideLabels, localClock, regionDisplayName, tripDisplayName } from '../src/content/display-names';
import type { ContentRevision } from '../src/contracts/v2/index';

/** C-14: 화면 표시 이름 규칙. 저장값은 바꾸지 않고 표시용 문자열만 만든다. */

type Guide = Extract<ContentRevision, { kind: 'guide' }>;
type Region = Extract<ContentRevision, { kind: 'region' }>;

const region = (entityId: string, name: string) => ({ entityId, payload: { name } }) as unknown as Region;
const guide = (entityId: string, title: string, owner: { targetKind: string; entityId: string }, source = '') =>
  ({
    entityId,
    sourceRefs: source ? [{ sourcePath: source }] : [],
    payload: { title, ownerRef: { tripId: 't', ...owner } },
  }) as unknown as Guide;

describe('tripDisplayName', () => {
  it('Day 나열은 (N일)로 줄인다', () => {
    const days = Array.from({ length: 43 }, (_, index) => index + 1).join('·');
    expect(tripDisplayName(`SP-FR 대표 구간 Day ${days}`)).toBe('SP-FR 대표 구간 (43일)');
  });
  it('짧은 이름은 그대로, 긴 이름은 한 줄 말줄임', () => {
    expect(tripDisplayName('가상 산책 여행 A')).toBe('가상 산책 여행 A');
    expect(tripDisplayName('Day 1 여행')).toBe('Day 1 여행');
    const shortened = tripDisplayName('아주 긴 가상 여행 이름 '.repeat(8));
    expect(shortened.length).toBeLessThanOrEqual(40);
    expect(shortened.endsWith('…')).toBe(true);
  });
});

describe('regionDisplayName', () => {
  it('소문자 키 모양만 첫 글자를 대문자로 한다', () => {
    expect(regionDisplayName('aix')).toBe('Aix');
    expect(regionDisplayName('paris')).toBe('Paris');
    expect(regionDisplayName('Barcelona')).toBe('Barcelona');
    expect(regionDisplayName('삿포로')).toBe('삿포로');
    expect(regionDisplayName('Girona · Empordà')).toBe('Girona · Empordà');
  });
});

describe('guideLabels', () => {
  const regions = [region('paris', 'Paris'), region('aix', 'aix')];
  it('같은 제목은 소유 지역 또는 원천 파일의 지역 이름을 붙인다', () => {
    const labels = guideLabels(
      [
        guide('a', '생활·도착·귀가 안내', { targetKind: 'region', entityId: 'paris' }),
        guide('b', '생활·도착·귀가 안내', { targetKind: 'region', entityId: 'aix' }),
        guide(
          'c',
          'Commercial Guide Module',
          { targetKind: 'trip', entityId: 't' },
          'source/CURRENT/20_Regional_Chapters/11_Paris_Long_Stay_v2.0.md',
        ),
        guide(
          'd',
          'Commercial Guide Module',
          { targetKind: 'trip', entityId: 't' },
          'source/CURRENT/20_Regional_Chapters/07_Aix_en_Provence_v2.0.md',
        ),
      ],
      regions,
    ).map((entry) => entry.label);
    expect(new Set(labels).size).toBe(4);
    expect(labels).toContain('Paris · 생활·도착·귀가 안내');
    expect(labels).toContain('Aix · 생활·도착·귀가 안내');
    expect(labels).toContain('Paris · 지역 상세 안내');
    expect(labels).toContain('Aix · 지역 상세 안내');
  });
  it('제목이 하나뿐이면 그대로 두고 순서도 유지한다', () => {
    const labels = guideLabels(
      [
        guide('x', '출발 전 준비', { targetKind: 'trip', entityId: 't' }),
        guide('y', '가이드', { targetKind: 'region', entityId: 'paris' }),
      ],
      regions,
    ).map((entry) => entry.label);
    expect(labels).toEqual(['출발 전 준비', '가이드']);
  });
});

describe('localClock', () => {
  it('ISO를 기기 현지 M/D HH:mm로 바꾸고 해석 불가는 원문 유지', () => {
    const iso = '2026-11-04T06:50:54.107Z';
    const date = new Date(iso);
    const expected = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    expect(localClock(iso)).toBe(expected);
    expect(localClock('모름')).toBe('모름');
  });
});

describe('guideLabels 소문자 키 제목', () => {
  it('`aix · 지역 가이드`는 `Aix · 지역 가이드`로 보인다', () => {
    const [entry] = guideLabels([guide('g', 'aix · 지역 가이드', { targetKind: 'region', entityId: 'aix' })], []);
    expect(entry.label).toBe('Aix · 지역 가이드');
  });
});
