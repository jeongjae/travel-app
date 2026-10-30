import { canonicalJson } from '../contracts/v2/json';
import type { ContentRevision, TripDataset } from '../contracts/v2/index';

type Fail = (code: string, message: string) => never;

/**
 * 범용 UpdateContent로 지역·장소·가이드를 고칠 때의 안전 규칙(C-03).
 * 기본정보 수정이 소유 연결·본문 구조를 몰래 바꾸거나 비활성 대상을 새로 가리키지 못하게 한다.
 * 연결 변경은 CreateContentBatch, 본문 섹션은 EditContentSection이 맡는다. Fact 같은 다른 종류는 검사하지 않는다.
 */
export function guardContentUpdate(t: TripDataset, previous: ContentRevision, next: ContentRevision, fail: Fail) {
  function must(ok: unknown, code: string, message: string): asserts ok {
    if (!ok) {
      fail(code, message);
    }
  }
  if (next.kind !== 'region' && next.kind !== 'place' && next.kind !== 'guide') {
    return;
  }
  must(previous.kind === next.kind, 'INVALID_INPUT', '콘텐츠 종류를 바꿀 수 없습니다.');
  const head = t.heads.find((h) => h.targetKind === next.kind && h.entityId === next.entityId);
  must(head?.status === 'active', 'INVALID_INPUT', '비활성 콘텐츠는 수정할 수 없습니다.');
  const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  if (previous.kind === 'region' && next.kind === 'region') {
    must(
      same(previous.payload.guideIds, next.payload.guideIds),
      'INVALID_INPUT',
      '지역의 가이드 연결은 여기서 바꿀 수 없습니다.',
    );
  }
  if (previous.kind === 'place' && next.kind === 'place') {
    must(
      previous.payload.guideId === next.payload.guideId,
      'INVALID_INPUT',
      '장소의 본문 연결은 여기서 바꿀 수 없습니다.',
    );
    const added = next.payload.regionIds.filter((regionId) => !previous.payload.regionIds.includes(regionId));
    for (const regionId of added) {
      const region = t.heads.find((h) => h.targetKind === 'region' && h.entityId === regionId);
      must(region?.status === 'active', 'BROKEN_REFERENCE', '활성 지역만 새로 연결할 수 있습니다.');
    }
  }
  if (previous.kind === 'guide' && next.kind === 'guide') {
    const before = previous.payload;
    const after = next.payload;
    must(before.documentKind === after.documentKind, 'INVALID_INPUT', '가이드 종류를 바꿀 수 없습니다.');
    must(same(before.ownerRef, after.ownerRef), 'INVALID_INPUT', '가이드의 소유자를 바꿀 수 없습니다.');
    must(
      same(before.sections, after.sections) &&
        same(before.factBindings, after.factBindings) &&
        same(before.assetRefs, after.assetRefs),
      'INVALID_INPUT',
      '가이드 본문 구조는 여기서 바꿀 수 없습니다. 섹션 편집을 사용하세요.',
    );
  }
}
