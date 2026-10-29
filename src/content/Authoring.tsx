import { useState } from 'react';
import type { ContentRevision, TripDataset } from '../contracts/v2';
import type { ContentRepository } from '../repository';
import { command, ErrorText, Modal, errorText } from './ui';

type Region = Extract<ContentRevision, { kind: 'region' }>;

const placeSections = [
  { key: 'why_go', title: '왜 가는가', label: '왜 가는가 (필수)' },
  { key: 'deep', title: '더 깊이', label: '더 깊이' },
  { key: 'practical', title: '실용', label: '실용 정보' },
];

function newContent(tripId: string, entityId: string) {
  return { tripId, entityId, revisionId: crypto.randomUUID(), schemaVersion: 2, sourceRefs: [] };
}

/** 지역 하나를 만든다. 새 지역은 장소가 참조할 수 있는 활성 콘텐츠로 저장된다. */
export function RegionAuthoring({
  repo,
  header,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripDataset['header'];
  onClose: () => void;
  onSaved: (regionId: string) => void;
}) {
  const [name, setName] = useState(''),
    [tagline, setTagline] = useState(''),
    [introduction, setIntroduction] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    // 열 때의 여행 revision을 기준으로 저장한다. 다른 탭이 먼저 저장했다면 입력을 보존한 채 충돌을 알린다.
    [expected] = useState(header.domainRevision);
  return (
    <Modal title="지역 작성" onClose={onClose}>
      <form
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) {
            return;
          }
          setBusy(true);
          try {
            if (!name.trim()) {
              throw new Error('지역 이름을 입력하세요.');
            }
            const regionId = crypto.randomUUID();
            await repo.execute(
              command(
                header.tripId,
                'CreateContentBatch',
                {
                  create: [
                    {
                      ...newContent(header.tripId, regionId),
                      kind: 'region',
                      payload: {
                        name: name.trim(),
                        ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
                        ...(introduction.trim() ? { introduction: introduction.trim() } : {}),
                        guideIds: [],
                        assetRefs: [],
                      },
                    },
                  ],
                  updateOwners: [],
                },
                expected,
              ),
            );
            onSaved(regionId);
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          지역 이름
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          한 줄 소개
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <label>
          지역 설명
          <textarea rows={5} value={introduction} onChange={(e) => setIntroduction(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>
          지역 저장
        </button>
      </form>
    </Modal>
  );
}

/** 장소와 장소 설명(필수 세 섹션)을 한 번에 저장한다. 어느 쪽이 실패해도 둘 다 저장되지 않는다. */
export function PlaceAuthoring({
  repo,
  header,
  regions,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripDataset['header'];
  regions: Region[];
  onClose: () => void;
  onSaved: (placeId: string) => void;
}) {
  const [name, setName] = useState(''),
    [placeKind, setPlaceKind] = useState('명소'),
    [summary, setSummary] = useState(''),
    [regionIds, setRegionIds] = useState<string[]>([]),
    [bodies, setBodies] = useState<Record<string, string>>({ why_go: '', deep: '', practical: '' }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [expected] = useState(header.domainRevision);
  return (
    <Modal title="장소 작성" onClose={onClose}>
      <form
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) {
            return;
          }
          setBusy(true);
          try {
            if (!name.trim()) {
              throw new Error('장소 이름을 입력하세요.');
            }
            if (!bodies.why_go.trim()) {
              throw new Error("'왜 가는가' 설명을 입력하세요.");
            }
            const placeId = crypto.randomUUID(),
              guideId = crypto.randomUUID();
            await repo.execute(
              command(
                header.tripId,
                'CreateContentBatch',
                {
                  create: [
                    {
                      ...newContent(header.tripId, placeId),
                      kind: 'place',
                      payload: {
                        regionIds,
                        name: name.trim(),
                        aliases: [],
                        placeKind: placeKind.trim() || '명소',
                        summary: summary.trim(),
                        dontMiss: [],
                        guideId,
                        assetRefs: [],
                      },
                    },
                    {
                      ...newContent(header.tripId, guideId),
                      kind: 'guide',
                      payload: {
                        documentKind: 'place-guide',
                        ownerRef: { tripId: header.tripId, targetKind: 'place', entityId: placeId },
                        title: `${name.trim()} 안내`,
                        sections: placeSections.map((section, order) => ({
                          key: section.key,
                          title: section.title,
                          order,
                          bodyMd: bodies[section.key],
                          factRefs: [],
                          assetRefs: [],
                          linkRefs: [],
                        })),
                        factBindings: [],
                        assetRefs: [],
                      },
                    },
                  ],
                  updateOwners: [],
                },
                expected,
              ),
            );
            onSaved(placeId);
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          장소 이름
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          장소 종류
          <input value={placeKind} onChange={(e) => setPlaceKind(e.target.value)} />
        </label>
        <label>
          한 줄 요약
          <input value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <fieldset>
          <legend>속한 지역 (선택)</legend>
          {regions.length ? (
            regions.map((region) => (
              <label key={region.entityId}>
                <input
                  type="checkbox"
                  checked={regionIds.includes(region.entityId)}
                  onChange={(e) =>
                    setRegionIds(
                      e.target.checked
                        ? [...regionIds, region.entityId]
                        : regionIds.filter((value) => value !== region.entityId),
                    )
                  }
                />
                {region.payload.name}
              </label>
            ))
          ) : (
            <p className="muted">아직 지역이 없습니다. 지역 없이도 장소를 저장할 수 있습니다.</p>
          )}
        </fieldset>
        {placeSections.map((section) => (
          <label key={section.key}>
            {section.label}
            <textarea
              rows={4}
              value={bodies[section.key]}
              onChange={(e) => setBodies({ ...bodies, [section.key]: e.target.value })}
            />
          </label>
        ))}
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>
          장소 저장
        </button>
      </form>
    </Modal>
  );
}
