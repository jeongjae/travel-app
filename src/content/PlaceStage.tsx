import { useEffect, useRef, useState } from 'react';
import type { PlanVersion } from '../contracts/v2';
import type { ContentRepository } from '../repository';
import {
  applyPlaceEdit,
  buildLinkPlan,
  buildPlaceContent,
  chunkPlaces,
  collectMarkCandidates,
  PLACE_KIND_LABEL,
  placeEditIsFresh,
  type CatalogPlace,
  type CatalogRegion,
  type ExistingPlaceLines,
  type LinkPlan,
  type PlaceCandidate,
  type PlaceEdit,
} from '../plan-update';
import { command, errorText, ErrorText, Modal } from './ui';

type Action = 'create' | 'link' | 'skip';

export type StageDone = {
  placeIds: Map<string, string>;
  created: number;
  linked: number;
  /** 장소 만들기가 올린 여행 revision(만든 것이 없으면 없다). */
  revision?: { from: number; to: number };
};

type StageProps = {
  repo: ContentRepository;
  tripId: string;
  candidates: PlaceCandidate[];
  existingLines?: ExistingPlaceLines;
  regions: CatalogRegion[];
  onDone: (done: StageDone) => void;
  /** 장소 없이 계속한다. 이름은 메모에 남는다. */
  onSkip?: () => void;
};

function defaultAction(candidate: PlaceCandidate): Action {
  return candidate.existing ? 'skip' : 'create';
}

function CandidateDetail({ candidate }: { candidate: PlaceCandidate }) {
  const parts = [
    `종류 ${PLACE_KIND_LABEL[candidate.kind]}`,
    candidate.region === '' ? '' : `지역 ${candidate.region}`,
    candidate.hours === '' ? '' : `영업시간 ${candidate.hours}`,
    candidate.usedBy > 0 ? `활동 ${candidate.usedBy}곳` : '',
  ].filter((part) => part !== '');
  return (
    <>
      <p className="muted">{parts.join(' · ')}</p>
      {candidate.description === '' ? null : <p className="muted">{candidate.description}</p>}
      {candidate.warnings.map((warning) => (
        <p key={warning} className="muted">
          {warning}
        </p>
      ))}
    </>
  );
}

/**
 * 장소 단계: 새 장소 후보를 보이고 고른 것만 `CreateContentBatch`로 만든다(한 번에 최대 20개).
 * 같은 이름의 기존 장소가 있으면 "연결" 후보로만 보이고 자동으로 합치지 않는다.
 */
export function PlaceStage({ repo, tripId, candidates, existingLines, regions, onDone, onSkip }: StageProps) {
  const [actions, setActions] = useState<ReadonlyMap<string, Action>>(
    () => new Map(candidates.map((candidate) => [candidate.name, defaultAction(candidate)])),
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const createdRef = useRef(new Map<string, string>());
  const workingRef = useRef(false);
  const revisionRef = useRef<{ from: number; to: number } | undefined>(undefined);

  const actionOf = (candidate: PlaceCandidate) => actions.get(candidate.name) ?? defaultAction(candidate);
  const creates = candidates.filter((candidate) => actionOf(candidate) === 'create');
  const links = candidates.filter((candidate) => actionOf(candidate) === 'link' && candidate.existing);

  function setAction(name: string, action: Action) {
    setActions(new Map(actions).set(name, action));
    setError('');
  }

  async function approve() {
    if (workingRef.current) {
      return;
    }
    workingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const pending = creates.filter((candidate) => !createdRef.current.has(candidate.name));
      const batches = chunkPlaces(pending.map((candidate) => buildPlaceContent(tripId, candidate, regions)));
      let done = 0;
      for (const batch of batches) {
        const header = (await repo.list()).find((row) => row.tripId === tripId);
        if (!header) {
          throw new Error('여행을 찾을 수 없습니다.');
        }
        const result = await repo.execute(
          command(tripId, 'CreateContentBatch', { create: batch, updateOwners: [] }, header.domainRevision),
        );
        revisionRef.current = {
          from: revisionRef.current?.from ?? header.domainRevision,
          to: result.domainRevision,
        };
        batch.forEach((content) => createdRef.current.set(content.payload.name, content.entityId));
        done += batch.length;
        setProgress(`장소를 만드는 중 ${done}/${pending.length}`);
      }
      const placeIds = new Map(createdRef.current);
      for (const candidate of links) {
        placeIds.set(candidate.name, candidate.existing!.entityId);
      }
      onDone({
        placeIds,
        created: createdRef.current.size,
        linked: links.length,
        ...(revisionRef.current ? { revision: revisionRef.current } : {}),
      });
    } catch (err) {
      const made = createdRef.current.size;
      setError(
        `${errorText(err)}${made > 0 ? ` 이미 만든 장소 ${made}개는 남아 있습니다. 다시 누르면 남은 것만 만듭니다.` : ''}`,
      );
    } finally {
      workingRef.current = false;
      setBusy(false);
    }
  }

  const total = creates.length + links.length;
  return (
    <section aria-label="장소 단계">
      <h3>장소 단계 · 후보 {candidates.length}개</h3>
      <p className="muted">고른 장소만 만들어 활동에 연결합니다. 고르지 않은 장소는 남지 않고 이름은 메모에 둡니다.</p>
      {existingLines && (existingLines.nameIgnored > 0 || existingLines.unknown > 0) ? (
        <p className="muted" data-testid="place-existing-lines">
          {existingLines.nameIgnored > 0
            ? `이름은 글로 고치지 않습니다 (이름이 다른 줄 ${existingLines.nameIgnored}줄). `
            : ''}
          {existingLines.unknown > 0 ? `이 여행에 없는 ID ${existingLines.unknown}줄은 받지 않습니다.` : ''}
        </p>
      ) : null}
      <ul>
        {candidates.map((candidate) => (
          <li key={candidate.name}>
            <strong>{candidate.name}</strong>
            <label>
              <span className="muted"> 처리 </span>
              <select
                aria-label={`${candidate.name} 처리`}
                value={actionOf(candidate)}
                disabled={busy}
                onChange={(event) => setAction(candidate.name, event.target.value as Action)}
              >
                <option value="create">새 장소로 만들기</option>
                {candidate.existing ? <option value="link">기존 장소에 연결</option> : null}
                <option value="skip">고르지 않음</option>
              </select>
            </label>
            {candidate.existing ? (
              <p className="muted">같은 이름의 장소가 이미 있습니다. 자동으로 합치지 않으니 고르세요.</p>
            ) : null}
            <CandidateDetail candidate={candidate} />
          </li>
        ))}
      </ul>
      {progress ? (
        <p role="status" data-testid="place-progress">
          {progress}
        </p>
      ) : null}
      <div className="button-row prep-actions">
        <button type="button" className="primary" disabled={busy || total === 0} onClick={() => void approve()}>
          {`장소 ${creates.length}개 만들기${links.length > 0 ? ` · 연결 ${links.length}개` : ''}`}
        </button>
        {onSkip ? (
          <button type="button" disabled={busy} onClick={onSkip}>
            장소 없이 계속
          </button>
        ) : null}
      </div>
      <ErrorText error={error} />
    </section>
  );
}

export type EditDone = {
  count: number;
  /** 장소 수정이 올린 여행 revision. */
  revision: { from: number; to: number };
};

/**
 * 기존 장소 수정 단계: 고른 줄만 `UpdateContent`로 저장한다(장소마다 한 번). 새 장소 만들기와 따로 승인한다.
 * 저장 직전에 장소를 다시 읽어, 후보를 만든 뒤 바뀌었으면 그 줄은 저장하지 않고 멈춘다.
 */
export function PlaceEditStage({
  repo,
  tripId,
  edits,
  onDone,
}: {
  repo: ContentRepository;
  tripId: string;
  edits: PlaceEdit[];
  onDone: (done: EditDone) => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const workingRef = useRef(false);
  const chosen = edits.filter((edit) => picked.has(edit.entityId));

  function toggle(entityId: string) {
    const next = new Set(picked);
    if (next.has(entityId)) {
      next.delete(entityId);
    } else {
      next.add(entityId);
    }
    setPicked(next);
    setError('');
  }

  async function approve() {
    if (workingRef.current || chosen.length === 0) {
      return;
    }
    workingRef.current = true;
    setBusy(true);
    setError('');
    let from: number | undefined;
    let to = 0;
    let saved = 0;
    try {
      for (const edit of chosen) {
        const header = (await repo.list()).find((row) => row.tripId === tripId);
        if (!header) {
          throw new Error('여행을 찾을 수 없습니다.');
        }
        const content = (await repo.catalog(tripId, 'place')).find((row) => row.entityId === edit.entityId);
        const fresh =
          content?.kind === 'place' &&
          placeEditIsFresh(edit, {
            entityId: content.entityId,
            name: content.payload.name,
            summary: content.payload.summary,
            wikiRef: content.payload.wikiRef,
            regionIds: content.payload.regionIds,
          });
        if (content?.kind !== 'place' || !fresh) {
          throw new Error(`장소 "${edit.name}"이 그사이 바뀌었습니다. 다시 'AI로 수정하기'로 복사해 작업하세요.`);
        }
        const { commitSeq: _seq, recordedAt: _at, actor: _actor, ...stable } = content;
        const next = {
          ...applyPlaceEdit(stable, edit.patch),
          revisionId: crypto.randomUUID(),
          previousRevisionId: content.revisionId,
        };
        const result = await repo.execute(
          command(
            tripId,
            'UpdateContent',
            { expectedRevisionId: content.revisionId, content: next },
            header.domainRevision,
          ),
        );
        from ??= header.domainRevision;
        to = result.domainRevision;
        saved++;
      }
      onDone({ count: saved, revision: { from: from ?? 0, to } });
    } catch (err) {
      setError(`${errorText(err)}${saved > 0 ? ` 이미 저장한 장소 ${saved}개는 남아 있습니다.` : ''}`);
    } finally {
      workingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-label="기존 장소 수정">
      <h3>기존 장소 수정 {edits.length}건</h3>
      <p className="muted">고른 장소만 고칩니다. 이름은 바꾸지 않고, 고르지 않으면 그대로 둡니다.</p>
      <ul>
        {edits.map((edit) => (
          <li key={edit.entityId}>
            <label>
              <input
                type="checkbox"
                checked={picked.has(edit.entityId)}
                disabled={busy}
                onChange={() => toggle(edit.entityId)}
              />{' '}
              <strong>{edit.name}</strong>
            </label>
            {edit.changes.map((change) => (
              <p key={change.column} className="muted">
                {change.column}: {change.before === '' ? '(없음)' : change.before} →{' '}
                {change.cleared ? '(비움)' : change.after}
              </p>
            ))}
            {edit.warnings.map((warning) => (
              <p key={warning} className="muted">
                {warning}
              </p>
            ))}
          </li>
        ))}
      </ul>
      <div className="button-row prep-actions">
        <button type="button" className="primary" disabled={busy || chosen.length === 0} onClick={() => void approve()}>
          {`장소 ${chosen.length}건 수정`}
        </button>
      </div>
      <ErrorText error={error} />
    </section>
  );
}

type Loaded = {
  plan: PlanVersion;
  places: CatalogPlace[];
  regions: CatalogRegion[];
};

async function loadTrip(
  repo: ContentRepository,
  tripId: string,
): Promise<Loaded & { header: Awaited<ReturnType<ContentRepository['list']>>[number] }> {
  const header = (await repo.list()).find((row) => row.tripId === tripId);
  if (!header) {
    throw new Error('여행을 찾을 수 없습니다.');
  }
  const [plan, places, regions] = await Promise.all([
    repo.plan(tripId, header.currentPlanVersionId),
    repo.catalog(tripId, 'place'),
    repo.catalog(tripId, 'region'),
  ]);
  return {
    header,
    plan,
    places: places.flatMap((content) =>
      content.kind === 'place'
        ? [
            {
              entityId: content.entityId,
              name: content.payload.name,
              summary: content.payload.summary,
              wikiRef: content.payload.wikiRef,
              regionIds: content.payload.regionIds,
            },
          ]
        : [],
    ),
    regions: regions.flatMap((content) =>
      content.kind === 'region' ? [{ entityId: content.entityId, name: content.payload.name }] : [],
    ),
  };
}

type FlowProps = {
  repo: ContentRepository;
  tripId: string;
  /** 후보를 정한다. 새 여행은 글에서, 여행 메뉴는 메모의 `[장소: 이름]`에서. */
  source?: (loaded: Loaded) => { candidates: PlaceCandidate[]; existingLines?: ExistingPlaceLines };
  intro: string;
  onFinish: (resultText: string) => void;
};

/** 장소 단계(만들기 승인) → 연결(`ChangePlan` 승인). 두 승인은 따로이며 각각 전부 또는 전무다. */
export function PlaceFlow({ repo, tripId, source, intro, onFinish }: FlowProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [done, setDone] = useState<StageDone | null>(null);
  const [link, setLink] = useState<{ plan: LinkPlan; planVersionId: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const applyingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadTrip(repo, tripId)
      .then((value) => {
        if (!cancelled) {
          setLoaded(value);
        }
      })
      .catch((err) => setError(errorText(err)));
    return () => {
      cancelled = true;
    };
  }, [repo, tripId]);

  async function toLink(result: StageDone) {
    setDone(result);
    try {
      const fresh = await loadTrip(repo, tripId);
      setLink({
        plan: buildLinkPlan(fresh.plan, result.placeIds),
        planVersionId: fresh.plan.planVersionId,
        revision: fresh.header.domainRevision,
      });
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function applyLink() {
    if (!link || link.plan.operations.length === 0 || applyingRef.current) {
      return;
    }
    applyingRef.current = true;
    setBusy(true);
    setError('');
    try {
      await repo.execute(
        command(
          tripId,
          'ChangePlan',
          {
            currentPlanVersionId: link.planVersionId,
            operations: link.plan.operations,
            reason: `장소 연결: 활동 ${link.plan.linked.length}개`,
          },
          link.revision,
        ),
      );
      onFinish(`장소 ${done?.created ?? 0}개를 만들고 활동 ${link.plan.linked.length}개에 연결했습니다.`);
    } catch (err) {
      const message = errorText(err);
      setError(message.includes('CONFLICT') ? '계획이 그사이 바뀌었습니다. 이 창을 닫고 다시 여세요.' : message);
    } finally {
      applyingRef.current = false;
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <>
        <p role="status">장소를 불러오는 중…</p>
        <ErrorText error={error} />
      </>
    );
  }
  const found = source
    ? source(loaded)
    : { candidates: collectMarkCandidates(loaded.plan, { places: loaded.places }), existingLines: undefined };
  return (
    <>
      <p className="muted">{intro}</p>
      {!done ? (
        found.candidates.length === 0 ? (
          <p role="status">장소로 만들 후보가 없습니다.</p>
        ) : (
          <PlaceStage
            repo={repo}
            tripId={tripId}
            candidates={found.candidates}
            existingLines={found.existingLines}
            regions={loaded.regions}
            onDone={(result) => void toLink(result)}
          />
        )
      ) : (
        <section aria-label="장소 연결">
          <h3>활동에 연결 · {link ? link.plan.linked.length : 0}개</h3>
          <p className="muted">
            만든 장소 {done.created}개{done.linked > 0 ? ` · 기존 장소에 연결 ${done.linked}개` : ''}. 연결하면 메모
            앞의 [장소: 이름] 표시가 빠집니다. 연결하지 않으면 장소는 만들어진 채 활동의 메모에 이름이 그대로 남습니다.
          </p>
          <ul>
            {(link?.plan.linked ?? []).map((item, index) => (
              <li key={index}>
                {item.date} · {item.title} → {item.place}
              </li>
            ))}
          </ul>
          <div className="button-row prep-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || !link || link.plan.operations.length === 0}
              onClick={() => void applyLink()}
            >
              {`활동 ${link?.plan.linked.length ?? 0}개에 연결`}
            </button>
          </div>
        </section>
      )}
      <ErrorText error={error} />
    </>
  );
}

/** B2: 여행 메뉴의 "메모의 장소 표시를 장소로 만들기". */
export function PlaceMarksDialog({
  repo,
  tripId,
  onClose,
  onFinished,
}: {
  repo: ContentRepository;
  tripId: string;
  onClose: () => void;
  onFinished: (resultText: string) => void;
}) {
  return (
    <Modal title="메모의 장소 표시를 장소로 만들기" onClose={onClose}>
      <PlaceFlow
        repo={repo}
        tripId={tripId}
        intro="활동 메모 앞에 [장소: 이름]으로 남은 이름을 모았습니다. 고른 것만 장소로 만들고 활동에 연결합니다."
        onFinish={onFinished}
      />
    </Modal>
  );
}
