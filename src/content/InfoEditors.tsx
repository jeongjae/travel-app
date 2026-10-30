import { useRef, useState, type ReactNode } from 'react';
import type { ContentRevision, TripDataset } from '../contracts/v2';
import type { ContentRepository } from '../repository';
import { ErrorText, Modal, errorText, reuseRequest, type RequestAttempt } from './ui';

type Region = Extract<ContentRevision, { kind: 'region' }>;
type Place = Extract<ContentRevision, { kind: 'place' }>;
type Guide = Extract<ContentRevision, { kind: 'guide' }>;
type Header = TripDataset['header'];

/**
 * 폼을 연 시점의 콘텐츠·여행 revision과 새 revision ID를 고정한다.
 * 편집하지 않은 필드는 이전 payload를 그대로 두고, 같은 입력의 재시도는 같은 요청 ID로 보내 중복 저장을 막는다.
 */
function useUpdate<T extends ContentRevision>(repo: ContentRepository, header: Header, previous: T) {
  const [expected] = useState(header.domainRevision),
    [base] = useState(previous),
    [revisionId] = useState(() => crypto.randomUUID()),
    attempt = useRef<RequestAttempt>(undefined);
  return {
    base,
    save: (payload: object) => {
      const { commitSeq: _seq, recordedAt: _at, actor: _actor, ...stable } = base;
      const content = { ...stable, revisionId, previousRevisionId: base.revisionId, payload };
      return repo.execute(
        reuseRequest(
          attempt,
          header.tripId,
          'UpdateContent',
          { expectedRevisionId: base.revisionId, content },
          expected,
        ),
      );
    },
  };
}

/** 바뀐 선택 문자열만 반영한다. 비우면 항목을 제거하고, 그대로 두면 원래 값(공백 포함)을 유지한다. */
function optionalText(initial: string | undefined, value: string) {
  if (value === (initial ?? '')) {
    return initial;
  }
  return value.trim() ? value.trim() : undefined;
}

function EditorForm({
  title,
  busy,
  error,
  submitLabel,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  busy: boolean;
  error: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <form
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) {
            onSubmit();
          }
        }}
      >
        {children}
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>
          {submitLabel}
        </button>
      </form>
    </Modal>
  );
}

export function RegionInfoEditor({
  repo,
  header,
  region,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  header: Header;
  region: Region;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { base, save } = useUpdate(repo, header, region);
  const initial = base.payload;
  const [name, setName] = useState(initial.name),
    [tagline, setTagline] = useState(initial.tagline ?? ''),
    [introduction, setIntroduction] = useState(initial.introduction ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <EditorForm
      title="지역 기본정보 수정"
      busy={busy}
      error={error}
      submitLabel="기본정보 저장"
      onClose={onClose}
      onSubmit={async () => {
        setBusy(true);
        try {
          if (!name.trim()) {
            throw new Error('지역 이름을 입력하세요.');
          }
          const { tagline: _tagline, introduction: _introduction, ...rest } = initial;
          const nextName = name === initial.name ? initial.name : name.trim();
          const nextTagline = optionalText(initial.tagline, tagline);
          const nextIntroduction = optionalText(initial.introduction, introduction);
          const unchanged =
            nextName === initial.name && nextTagline === initial.tagline && nextIntroduction === initial.introduction;
          if (unchanged) {
            throw new Error('바뀐 내용이 없습니다.');
          }
          await save({
            ...rest,
            name: nextName,
            ...(nextTagline === undefined ? {} : { tagline: nextTagline }),
            ...(nextIntroduction === undefined ? {} : { introduction: nextIntroduction }),
          });
          onSaved();
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
    </EditorForm>
  );
}

export function PlaceInfoEditor({
  repo,
  header,
  place,
  regions,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  header: Header;
  place: Place;
  regions: Region[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { base, save } = useUpdate(repo, header, place);
  const initial = base.payload;
  const activeIds = regions.map((region) => region.entityId);
  const [name, setName] = useState(initial.name),
    [placeKind, setPlaceKind] = useState(initial.placeKind),
    [summary, setSummary] = useState(initial.summary),
    [checked, setChecked] = useState(initial.regionIds.filter((id) => activeIds.includes(id))),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <EditorForm
      title="장소 기본정보 수정"
      busy={busy}
      error={error}
      submitLabel="기본정보 저장"
      onClose={onClose}
      onSubmit={async () => {
        setBusy(true);
        try {
          if (!name.trim() || !placeKind.trim()) {
            throw new Error('장소 이름과 종류를 입력하세요.');
          }
          // 활성 목록에 없는 기존 연결은 건드리지 않고, 목록에 있는 지역만 선택에 따라 더하거나 뺀다.
          const kept = initial.regionIds.filter((id) => !activeIds.includes(id) || checked.includes(id));
          const regionIds = [...kept, ...checked.filter((id) => !initial.regionIds.includes(id))];
          const next = {
            ...initial,
            name: name === initial.name ? initial.name : name.trim(),
            placeKind: placeKind === initial.placeKind ? initial.placeKind : placeKind.trim(),
            summary: summary === initial.summary ? initial.summary : summary.trim(),
            regionIds,
          };
          if (JSON.stringify(next) === JSON.stringify(initial)) {
            throw new Error('바뀐 내용이 없습니다.');
          }
          await save(next);
          onSaved();
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
        <input required value={placeKind} onChange={(e) => setPlaceKind(e.target.value)} />
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
                checked={checked.includes(region.entityId)}
                onChange={(e) =>
                  setChecked(
                    e.target.checked
                      ? [...checked, region.entityId]
                      : checked.filter((value) => value !== region.entityId),
                  )
                }
              />
              {region.payload.name}
            </label>
          ))
        ) : (
          <p className="muted">선택할 수 있는 지역이 없습니다. 지역 없이도 장소를 둘 수 있습니다.</p>
        )}
      </fieldset>
    </EditorForm>
  );
}

export function GuideTitleEditor({
  repo,
  header,
  guide,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  header: Header;
  guide: Guide;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { base, save } = useUpdate(repo, header, guide);
  const [title, setTitle] = useState(base.payload.title),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <EditorForm
      title="가이드 제목 수정"
      busy={busy}
      error={error}
      submitLabel="제목 저장"
      onClose={onClose}
      onSubmit={async () => {
        setBusy(true);
        try {
          if (!title.trim()) {
            throw new Error('가이드 제목을 입력하세요.');
          }
          if (title.trim() === base.payload.title) {
            throw new Error('바뀐 내용이 없습니다.');
          }
          await save({ ...base.payload, title: title.trim() });
          onSaved();
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
    </EditorForm>
  );
}
