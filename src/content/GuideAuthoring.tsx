import { useRef, useState } from 'react';
import type { ContentRevision, TripDataset } from '../contracts/v2';
import type { ContentRepository } from '../repository';
import { ErrorText, Modal, errorText, reuseRequest, type RequestAttempt } from './ui';

type Region = Extract<ContentRevision, { kind: 'region' }>;
type SectionDraft = { key: string; title: string; body: string };

/**
 * 지역 가이드(region이 있을 때) 또는 여행 공통 가이드를 작성한다.
 * 지역 가이드는 가이드 생성과 지역의 가이드 목록 갱신을 한 번에 저장하고, 기존 가이드 연결은 그대로 유지한다.
 */
export function GuideAuthoring({
  repo,
  header,
  region,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripDataset['header'];
  region?: Region;
  onClose: () => void;
  onSaved: (guideId: string) => void;
}) {
  const [title, setTitle] = useState(''),
    [sections, setSections] = useState<SectionDraft[]>([{ key: 'section-1', title: '', body: '' }]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    // 폼을 연 시점의 기준과 새 ID를 고정한다. 같은 입력으로 다시 저장해도 중복 가이드·revision이 생기지 않는다.
    [expected] = useState(header.domainRevision),
    [baseRegion] = useState(region),
    [ids] = useState(() => ({
      guideId: crypto.randomUUID(),
      guideRevisionId: crypto.randomUUID(),
      regionRevisionId: crypto.randomUUID(),
    })),
    nextKey = useRef(2),
    attempt = useRef<RequestAttempt>(undefined);
  const update = (key: string, patch: Partial<SectionDraft>) =>
    setSections(sections.map((section) => (section.key === key ? { ...section, ...patch } : section)));
  return (
    <Modal title={region ? '지역 가이드 작성' : '여행 가이드 작성'} onClose={onClose}>
      <form
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) {
            return;
          }
          setBusy(true);
          try {
            if (!title.trim()) {
              throw new Error('가이드 제목을 입력하세요.');
            }
            sections.forEach((section, index) => {
              if (!section.title.trim() || !section.body.trim()) {
                throw new Error(`섹션 ${index + 1}의 제목과 본문을 입력하세요.`);
              }
            });
            const owner = baseRegion
              ? { tripId: header.tripId, targetKind: 'region', entityId: baseRegion.entityId }
              : { tripId: header.tripId, targetKind: 'trip', entityId: header.tripId };
            const guide = {
              tripId: header.tripId,
              entityId: ids.guideId,
              revisionId: ids.guideRevisionId,
              schemaVersion: 2,
              sourceRefs: [],
              kind: 'guide',
              payload: {
                documentKind: baseRegion ? 'region-guide' : 'preparation',
                ownerRef: owner,
                title: title.trim(),
                language: 'ko',
                sections: sections.map((section, order) => ({
                  key: section.key,
                  title: section.title.trim(),
                  order,
                  bodyMd: section.body.trim(),
                  factRefs: [],
                  assetRefs: [],
                  linkRefs: [],
                })),
                factBindings: [],
                assetRefs: [],
              },
            };
            let updateOwners: unknown[] = [];
            if (baseRegion) {
              const { commitSeq: _seq, recordedAt: _at, actor: _actor, ...stable } = baseRegion;
              updateOwners = [
                {
                  expectedRevisionId: baseRegion.revisionId,
                  content: {
                    ...stable,
                    revisionId: ids.regionRevisionId,
                    previousRevisionId: baseRegion.revisionId,
                    payload: { ...baseRegion.payload, guideIds: [...baseRegion.payload.guideIds, ids.guideId] },
                  },
                },
              ];
            }
            await repo.execute(
              reuseRequest(attempt, header.tripId, 'CreateContentBatch', { create: [guide], updateOwners }, expected),
            );
            onSaved(ids.guideId);
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          가이드 제목
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {sections.map((section, index) => (
          <fieldset key={section.key}>
            <legend>섹션 {index + 1}</legend>
            <label>
              섹션 {index + 1} 제목
              <input value={section.title} onChange={(e) => update(section.key, { title: e.target.value })} />
            </label>
            <label>
              섹션 {index + 1} 본문
              <textarea rows={5} value={section.body} onChange={(e) => update(section.key, { body: e.target.value })} />
            </label>
            {sections.length > 1 ? (
              <button type="button" onClick={() => setSections(sections.filter((s) => s.key !== section.key))}>
                섹션 {index + 1} 삭제
              </button>
            ) : null}
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() => {
            setSections([...sections, { key: `section-${nextKey.current}`, title: '', body: '' }]);
            nextKey.current += 1;
          }}
        >
          섹션 추가
        </button>
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>
          가이드 저장
        </button>
      </form>
    </Modal>
  );
}
