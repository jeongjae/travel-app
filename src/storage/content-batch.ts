import { contentRevisionSchema } from '../contracts/v2/index';
import type { Command, ContentRevision, TripDataset } from '../contracts/v2/index';

type Payload = Extract<Command, { kind: 'CreateContentBatch' }>['payload'];
type Fail = (code: string, message: string) => never;
type Guide = Extract<ContentRevision, { kind: 'guide' }>;

/**
 * 신규 region/place/guide 생성과 기존 소유자(region/place)의 연결 갱신을 한 번에 데이터셋에 반영한다.
 * 저장소 트랜잭션 안에서 호출되며, 어느 검사든 실패하면 예외로 전체가 롤백된다.
 * 모든 행을 만든 뒤 최종 참조 그래프를 검사하므로 중간 상태는 노출되지 않는다.
 */
export function applyContentBatch(
  t: TripDataset,
  payload: Payload,
  seq: number,
  recordedAt: string,
  refs: { kind: string; id: string; revisionId?: string }[],
  fail: Fail,
) {
  function must(ok: unknown, code: string, message: string): asserts ok {
    if (!ok) {
      fail(code, message);
    }
  }
  const seen = new Set<string>();
  const touched: ContentRevision[] = [];
  const replaced: { previous: ContentRevision; next: ContentRevision }[] = [];
  const stamp = (input: Payload['create'][number]) =>
    contentRevisionSchema.parse({ ...input, commitSeq: seq, recordedAt, actor: 'user' });

  for (const update of payload.updateOwners) {
    const next = stamp(update.content);
    const head = t.heads.find((h) => h.targetKind === next.kind && h.entityId === next.entityId);
    must(head, 'NOT_FOUND', '연결을 갱신할 소유자가 없습니다.');
    must(head.status === 'active', 'INVALID_INPUT', '비활성 소유자는 갱신할 수 없습니다.');
    must(head.revisionId === update.expectedRevisionId, 'CONFLICT', '콘텐츠 revision이 변경되었습니다.');
    must(
      next.previousRevisionId === update.expectedRevisionId && next.revisionId !== update.expectedRevisionId,
      'INVALID_INPUT',
      '새 revision과 이전 연결이 필요합니다.',
    );
    must(!seen.has(`${next.kind}/${next.entityId}`), 'INVALID_INPUT', '같은 소유자를 두 번 갱신할 수 없습니다.');
    seen.add(`${next.kind}/${next.entityId}`);
    const previous = t.contents.find(
      (c) => c.kind === next.kind && c.entityId === next.entityId && c.revisionId === update.expectedRevisionId,
    );
    must(previous && previous.kind === next.kind, 'INVALID_INPUT', '갱신할 소유자의 종류가 다릅니다.');
    replaced.push({ previous, next });
    t.contents.push(next);
    head.revisionId = next.revisionId;
    touched.push(next);
    refs.push({ kind: next.kind, id: next.entityId, revisionId: next.revisionId });
  }
  for (const input of payload.create) {
    const next = stamp(input);
    must(!next.previousRevisionId, 'INVALID_INPUT', '새 콘텐츠에는 이전 revision이 없어야 합니다.');
    must(
      !t.heads.some((h) => h.targetKind === next.kind && h.entityId === next.entityId) &&
        !seen.has(`${next.kind}/${next.entityId}`),
      'CONFLICT',
      '이미 있는 콘텐츠 ID입니다.',
    );
    must(
      !t.contents.some((c) => c.revisionId === next.revisionId && c.kind === next.kind && c.entityId === next.entityId),
      'CONFLICT',
      '이미 있는 revision ID입니다.',
    );
    seen.add(`${next.kind}/${next.entityId}`);
    t.contents.push(next);
    t.heads.push({
      tripId: t.header.tripId,
      targetKind: next.kind,
      entityId: next.entityId,
      revisionId: next.revisionId,
      status: 'active',
    });
    touched.push(next);
    refs.push({ kind: next.kind, id: next.entityId, revisionId: next.revisionId });
  }

  const current = <K extends ContentRevision['kind']>(kind: K, entityId: string) => {
    const head = t.heads.find((h) => h.targetKind === kind && h.entityId === entityId);
    if (head?.status !== 'active') {
      return undefined;
    }
    return t.contents.find((c) => c.kind === kind && c.entityId === entityId && c.revisionId === head.revisionId) as
      Extract<ContentRevision, { kind: K }> | undefined;
  };
  const owns = (guide: Guide, kind: 'place' | 'region', entityId: string) =>
    guide.payload.ownerRef.tripId === t.header.tripId &&
    guide.payload.ownerRef.targetKind === kind &&
    guide.payload.ownerRef.entityId === entityId;

  // 기존 활성 본문과의 소유 연결을 이 배치가 끊으면 양방향 관계가 깨지므로, 교체·제거 명령이 없는 한 거부한다.
  for (const { previous, next } of replaced) {
    const dropped: string[] = [];
    if (previous.kind === 'place' && next.kind === 'place' && previous.payload.guideId) {
      if (previous.payload.guideId !== next.payload.guideId) {
        dropped.push(previous.payload.guideId);
      }
    }
    if (previous.kind === 'region' && next.kind === 'region') {
      dropped.push(...previous.payload.guideIds.filter((guideId) => !next.payload.guideIds.includes(guideId)));
    }
    for (const guideId of dropped) {
      must(!current('guide', guideId), 'CONFLICT', '기존 활성 본문의 소유 연결을 이 작업으로 끊을 수 없습니다.');
    }
  }
  for (const row of touched) {
    if (row.kind === 'place') {
      for (const regionId of row.payload.regionIds) {
        must(current('region', regionId), 'BROKEN_REFERENCE', '활성 지역을 찾을 수 없습니다.');
      }
      if (row.payload.guideId) {
        const guide = current('guide', row.payload.guideId);
        must(
          guide && guide.payload.documentKind === 'place-guide' && owns(guide, 'place', row.entityId),
          'BROKEN_REFERENCE',
          '장소 본문의 소유 연결이 맞지 않습니다.',
        );
      }
    }
    if (row.kind === 'region') {
      for (const guideId of row.payload.guideIds) {
        const guide = current('guide', guideId);
        must(
          guide && owns(guide, 'region', row.entityId),
          'BROKEN_REFERENCE',
          '지역 가이드의 소유 연결이 맞지 않습니다.',
        );
      }
    }
    if (row.kind === 'guide') {
      const owner = row.payload.ownerRef;
      must(owner.tripId === t.header.tripId, 'BROKEN_REFERENCE', '다른 여행의 소유자입니다.');
      if (row.payload.documentKind === 'place-guide') {
        const place = owner.targetKind === 'place' ? current('place', owner.entityId) : undefined;
        must(place?.payload.guideId === row.entityId, 'BROKEN_REFERENCE', '장소가 이 본문을 가리키지 않습니다.');
      } else if (row.payload.documentKind === 'region-guide') {
        const region = owner.targetKind === 'region' ? current('region', owner.entityId) : undefined;
        must(
          region?.payload.guideIds.includes(row.entityId),
          'BROKEN_REFERENCE',
          '지역이 이 가이드를 가리키지 않습니다.',
        );
      } else {
        must(false, 'INVALID_INPUT', '이 작성 흐름에서 만들 수 없는 가이드 종류입니다.');
      }
    }
  }
}
