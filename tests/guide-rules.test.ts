import { describe, expect, it } from 'vitest';
import type { ContentRevision } from '../src/contracts/v2/index';
import { isAuthoredGuide, isEditableGuide, isReadingGuide } from '../src/content/guide-rules';
import { reuseRequest, type RequestAttempt } from '../src/content/ui';
import { pilotTrip } from './fixtures/pilot';

/** C-03: 준비 화면 목록 규칙은 가져온 문서에는 이전과 같고, 앱에서 작성한 가이드만 새로 포함한다. */
function previousRule(content: ContentRevision) {
  return (
    content.kind === 'guide' &&
    content.payload.documentKind !== 'place-guide' &&
    (content.payload.documentKind !== 'preparation' ||
      content.entityId.startsWith('source-common-prose-') ||
      content.entityId.startsWith('source-document-') ||
      content.payload.sections.some((section) => section.assetRefs.length > 0))
  );
}
const authored = (documentKind: 'preparation' | 'region-guide' | 'place-guide', sourceRefs: unknown[] = []) =>
  ({
    tripId: 't',
    kind: 'guide',
    entityId: 'new-1',
    revisionId: 'r',
    schemaVersion: 2,
    sourceRefs,
    recordedAt: '2032-01-01T00:00:00.000Z',
    actor: 'user',
    commitSeq: 1,
    payload: {
      documentKind,
      ownerRef: { tripId: 't', targetKind: 'trip', entityId: 't' },
      title: '가상 가이드',
      sections: [],
      factBindings: [],
      assetRefs: [],
    },
  }) as unknown as ContentRevision;

describe('가이드 분류 규칙', () => {
  it('가져온 문서의 읽기 목록 분류는 이전 규칙과 같다', async () => {
    const source = [{ sourcePath: 'source/x', locator: 'y' }];
    const withAsset = authored('preparation', source) as ContentRevision & { payload: { sections: unknown[] } };
    withAsset.payload.sections = [
      { key: 'a', title: 'a', order: 0, bodyMd: '', factRefs: [], assetRefs: [{ assetId: 'z' }], linkRefs: [] },
    ];
    const imported = [
      ...(await pilotTrip()).contents,
      { ...authored('preparation', source), entityId: 'source-document-1' },
      { ...authored('preparation', source), entityId: 'source-common-prose-1' },
      { ...authored('preparation', source), entityId: 'source-checklist' },
      { ...authored('region-guide', source), entityId: 'source-region' },
      withAsset,
    ] as ContentRevision[];
    let guides = 0;
    for (const content of imported) {
      if (content.kind === 'guide') {
        guides += 1;
        expect(isReadingGuide(content), content.entityId).toBe(previousRule(content));
        expect(isAuthoredGuide(content), content.entityId).toBe(false);
      }
    }
    expect(guides).toBeGreaterThan(5);
  });

  it('원천 출처가 없는 준비 가이드는 읽기 목록에 올라가고 편집할 수 있다', () => {
    const content = authored('preparation');
    expect(previousRule(content)).toBe(false);
    expect(isAuthoredGuide(content)).toBe(true);
    expect(isReadingGuide(content)).toBe(true);
    expect(isEditableGuide(content)).toBe(true);
  });

  it('원천 출처가 있는 준비 문서는 편집 대상이 아니고 기존 규칙을 따른다', () => {
    const content = authored('preparation', [{ sourcePath: 'x', locator: 'y' }]);
    expect(isReadingGuide(content)).toBe(false);
    expect(isEditableGuide(content)).toBe(false);
  });
});

describe('같은 입력의 재시도 요청', () => {
  it('같은 입력은 같은 요청 ID를 다시 쓰고 입력이 바뀌면 새 요청 ID를 만든다', () => {
    const attempt: { current: RequestAttempt } = { current: undefined };
    const first = reuseRequest(attempt, 'trip', 'UpdateContent', { a: 1 }, 3);
    expect(reuseRequest(attempt, 'trip', 'UpdateContent', { a: 1 }, 3)).toBe(first);
    const changed = reuseRequest(attempt, 'trip', 'UpdateContent', { a: 2 }, 3);
    expect(changed.requestId).not.toBe(first.requestId);
    expect(reuseRequest(attempt, 'trip', 'UpdateContent', { a: 2 }, 4).requestId).not.toBe(changed.requestId);
  });
});
