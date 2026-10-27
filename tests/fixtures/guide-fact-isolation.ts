import { contentRevisionSchema, type RevisionRef, type TripDataset } from '../../src/contracts/v2';
import { pilotTrip } from './pilot';

/**
 * Entirely fictional trip whose two place guides share the revision string "r1" and the body token
 * `{{fact:opening}}` but bind that token to different Fact entities with different values and states.
 *
 *   guide-place   (place 가상 장소 1) -> fact-opening   r1  "미확인"
 *   guide-place-b (place 가상 장소 2) -> fact-opening-b r1  "확인됨"
 *
 * `pilotTrip(true)` (trip "fixture-b") reuses the very same guide-place / fact-opening / r1 / opening ids
 * with a different value, which is the cross-trip collision this fixture is meant to expose.
 */
export const factIsolation = {
  tripName: '가상 Fact 격리 여행',
  guideA: { guideId: 'guide-place', factId: 'fact-opening', placeName: '가상 장소 1' },
  guideB: { guideId: 'guide-place-b', factId: 'fact-opening-b', placeName: '가상 장소 2' },
  token: 'opening',
  valueA: '가상 원문: 오후 개방',
  valueB: 'B 가이드 운영시간 오전 개방',
  valueAUpdated: 'A 개정 운영시간 정오 개방',
  statusA: '사실 확인 상태: 미확인 · 원천 신뢰 표기: fixture-unverified · 원천 확인일: 2026-01-01',
  statusB: '사실 확인 상태: 확인됨 · 원천 신뢰 표기: fixture-verified-b · 원천 확인일: 2026-02-02',
  statusAUpdated: '사실 확인 상태: 검토 필요 · 원천 신뢰 표기: fixture-reviewed-a2 · 원천 확인일: 2026-03-03',
  otherTripValue: '운영시간 미확인 B',
};

export async function factIsolationTrip(): Promise<TripDataset> {
  const trip = await pilotTrip();
  const tripId = trip.header.tripId;
  trip.header.name = factIsolation.tripName;
  const plan = trip.plans[0];
  const revisionId = 'r1';
  const ref = (kind: RevisionRef['targetKind'], entityId: string): RevisionRef => ({
    tripId,
    targetKind: kind,
    entityId,
    revisionId,
  });

  const placeB = trip.contents.find((content) => content.kind === 'place' && content.entityId === 'place-2');
  if (placeB?.kind !== 'place') {
    throw new Error('place-2 fixture가 없습니다.');
  }
  placeB.payload.guideId = factIsolation.guideB.guideId;

  const factA = trip.contents.find((content) => content.kind === 'fact' && content.entityId === 'fact-opening');
  const guideA = trip.contents.find((content) => content.kind === 'guide' && content.entityId === 'guide-place');
  if (factA?.kind !== 'fact' || guideA?.kind !== 'guide') {
    throw new Error('A 가이드 fixture가 없습니다.');
  }
  factA.payload.valueText = factIsolation.valueA;

  const factB = contentRevisionSchema.parse({
    ...structuredClone(factA),
    entityId: factIsolation.guideB.factId,
    payload: {
      ...structuredClone(factA.payload),
      targetRef: { tripId, targetKind: 'place', entityId: 'place-2' },
      valueText: factIsolation.valueB,
      sourceConfidence: 'fixture-verified-b',
      verifiedAt: { precision: 'date', date: '2026-02-02' },
      appReviewStatus: 'verified',
    },
  });
  const guideB = contentRevisionSchema.parse({
    ...structuredClone(guideA),
    entityId: factIsolation.guideB.guideId,
    payload: {
      documentKind: 'place-guide',
      ownerRef: { tripId, targetKind: 'place', entityId: 'place-2' },
      title: '가상 장소 2 본문',
      language: 'ko',
      sections: [
        {
          key: 'why_go',
          title: '왜 가는가',
          order: 0,
          bodyMd: 'B 가이드 소개',
          factRefs: [],
          assetRefs: [],
          linkRefs: [],
        },
        { key: 'deep', title: '더 깊이', order: 1, bodyMd: 'B 가이드 깊이', factRefs: [], assetRefs: [], linkRefs: [] },
        {
          key: 'practical',
          title: '실용',
          order: 2,
          bodyMd: '시간: {{fact:opening}}',
          factRefs: [factIsolation.guideB.factId],
          assetRefs: [],
          linkRefs: [],
        },
      ],
      factBindings: [{ token: factIsolation.token, ref: ref('fact', factIsolation.guideB.factId) }],
      assetRefs: [],
    },
  });
  for (const content of [factB, guideB]) {
    trip.contents.push(content);
    trip.heads.push({ tripId, targetKind: content.kind, entityId: content.entityId, revisionId, status: 'active' });
    plan.contextRefs.push(ref(content.kind, content.entityId));
  }
  return trip;
}
