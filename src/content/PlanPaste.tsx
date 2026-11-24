import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TripDataset } from '../contracts/v2';
import type { CheckedPlanFile } from '../plan-import';
import type { ContentRepository } from '../repository';
import { buildPlanPreview, canSavePreview, type ExistingTrip, type PlanPreview } from '../plan-import/preview';
import { ChosenList } from './ChosenList';
import { readPrepDraft } from './prep-state';
import { collectPlaceCandidates, type CatalogPlace, type CatalogRegion } from '../plan-update';
import { PlaceEditStage, PlaceFlow, PlaceStage, type EditDone, type StageDone } from './PlaceStage';
import { UpdatePreview } from './UpdatePreview';
import { command, errorText, ErrorText, Modal } from './ui';

type Props = {
  repo: ContentRepository;
  existing: ExistingTrip[];
  onClose: () => void;
  onSaved: (tripId: string, resultText: string) => void;
  /** 지금 열려 있는 여행. 있으면 수정 글(`update`)을 이 여행과 비교해 적용할 수 있다. */
  current?: {
    header: TripDataset['header'];
    places: CatalogPlace[];
    regions: CatalogRegion[];
    trips: { tripId: string; name: string }[];
  };
  onUpdated?: (resultText: string) => void;
};

function Problems({ title, problems }: { title: string; problems: PlanPreview['errors'] }) {
  if (problems.length === 0) {
    return null;
  }
  return (
    <section aria-label={title}>
      <h3>
        {title} {problems.length}건
      </h3>
      <ul>
        {problems.map((problem, index) => (
          <li key={`${problem.where}-${index}`}>
            {problem.where} · {problem.section} · {problem.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PreviewSummary({ preview }: { preview: PlanPreview }) {
  return (
    <section aria-label="미리보기 요약">
      <h3>{preview.tripName}</h3>
      <p>
        {preview.period} · {preview.timeZoneLabel}
      </p>
      <p data-testid="preview-counts">
        활동 {preview.activityCount}개 · 숙소 {preview.stayCount}곳
      </p>
      {preview.days.map((day) => (
        <details key={day.date} open={preview.days.length <= 2}>
          <summary>
            {day.date} {day.title} · 활동 {day.activities.length}개
          </summary>
          <ul>
            {day.activities.map((activity, index) => (
              <li key={index}>
                {activity.time} · {activity.title} · {activity.category}
                {activity.addedByApp ? ' (앱이 추가하는 활동)' : ''}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {preview.stays.length > 0 ? (
        <ul aria-label="숙소">
          {preview.stays.map((stay, index) => (
            <li key={index}>
              숙소 · {stay.name} · {stay.period}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.appChanges.memoAdditions.length > 0 ? (
        <details>
          <summary>메모에 덧붙이는 내용 {preview.appChanges.memoAdditions.length}건</summary>
          <ul>
            {preview.appChanges.memoAdditions.map((addition, index) => (
              <li key={index}>
                {addition.date} {addition.activityTitle} · {addition.text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function NotImportedList({ preview }: { preview: PlanPreview }) {
  const lines = [...preview.notImported];
  if (preview.placeCount > 0) {
    lines.push(
      `구역 "장소" ${preview.placeCount}줄 — 장소 단계에서 만들 장소를 고릅니다(새 여행은 저장한 뒤). 고르지 않은 이름은 메모에 남깁니다.`,
    );
  }
  if (lines.length === 0) {
    return null;
  }
  return (
    <section aria-label="가져오지 않음">
      <h3>가져오지 않는 것</h3>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

function DroppedList({ preview }: { preview: PlanPreview }) {
  if (preview.dropped.length === 0) {
    return null;
  }
  return (
    <section aria-label="빠지는 표">
      <h3>오류 때문에 빠지는 표 {preview.dropped.length}개</h3>
      <ul>
        {preview.dropped.map((item, index) => (
          <li key={index}>
            {item.section} {item.label} · {item.where} · {item.rowCount}줄
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 장소 만들기·수정이 올린 revision 구간을 하나로 잇는다. 둘 다 이 화면의 저장이므로 사이의 변경은 모두 우리 것이다. */
function bridgeOf(...parts: ({ from: number; to: number } | undefined)[]) {
  const found = parts.filter((part): part is { from: number; to: number } => part !== undefined);
  if (found.length === 0) {
    return undefined;
  }
  return { from: Math.min(...found.map((part) => part.from)), to: Math.max(...found.map((part) => part.to)) };
}

export function PlanPasteDialog({ repo, existing, onClose, onSaved, current, onUpdated }: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [confirmedDropped, setConfirmedDropped] = useState(false);
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [stage, setStage] = useState<StageDone | null>(null);
  const [edited, setEdited] = useState<EditDone | null>(null);
  const [created, setCreated] = useState<{ tripId: string; resultText: string; file: CheckedPlanFile } | null>(null);
  const savingRef = useRef(false);
  const [draft] = useState(readPrepDraft);
  const currentPlan = useLiveQuery(
    () => (current ? repo.plan(current.header.tripId, current.header.currentPlanVersionId) : undefined),
    [current?.header.tripId, current?.header.currentPlanVersionId],
  );
  const bridge = useMemo(() => bridgeOf(stage?.revision, edited?.revision), [stage, edited]);
  const currentTrip = useMemo(
    () =>
      current && currentPlan
        ? {
            header: current.header,
            plan: currentPlan,
            placeNames: new Map(current.places.map((place) => [place.entityId, place.name])),
            ...(stage ? { placeIds: stage.placeIds } : {}),
            ...(bridge ? { revisionBridge: bridge } : {}),
          }
        : undefined,
    [current, currentPlan, stage, bridge],
  );
  const updateCollection = useMemo(
    () =>
      preview?.state === 'update' && current && currentPlan
        ? collectPlaceCandidates(preview.file, { plan: currentPlan, places: current.places, regions: current.regions })
        : undefined,
    [preview, current, currentPlan],
  );

  function showPreview(source: string) {
    setPreview(buildPlanPreview(source, existing));
    setStage(null);
    setEdited(null);
    setConfirmedDropped(false);
    setConfirmedDuplicate(false);
    setError('');
  }

  /** 원문을 고치면 이전 미리보기와 확인란은 무효다. */
  function changeText(value: string) {
    setText(value);
    setPreview(null);
    setStage(null);
    setEdited(null);
    setConfirmedDropped(false);
    setConfirmedDuplicate(false);
    setError('');
  }

  async function readClipboard() {
    setHint('');
    try {
      const clipboardText = await navigator.clipboard.readText();
      setText(clipboardText);
      showPreview(clipboardText);
    } catch {
      setHint('클립보드를 읽을 수 없습니다. 아래 입력 칸에 길게 눌러 직접 붙여 넣으세요.');
    }
  }

  async function readFile(file: File) {
    setHint('');
    try {
      const fileText = await file.text();
      setText(fileText);
      showPreview(fileText);
    } catch {
      setHint('파일을 읽을 수 없습니다. 내용을 복사해 입력 칸에 붙여 넣어 보세요.');
    }
  }

  async function save() {
    if (!preview?.trip || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const { trip } = preview;
      await repo.execute(
        command(trip.header.tripId, 'CreateTrip', { header: trip.header, initialPlan: trip.initialPlan }),
      );
      const resultText = `활동 ${preview.activityCount}개 · 숙소 ${preview.stayCount}곳`;
      const hasPlaces = collectPlaceCandidates(preview.file, { places: [], regions: [] }).candidates.length > 0;
      if (hasPlaces) {
        setCreated({ tripId: trip.header.tripId, resultText, file: preview.file });
      } else {
        onSaved(trip.header.tripId, resultText);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  const saveable = preview ? canSavePreview(preview, confirmedDropped, confirmedDuplicate) : false;
  if (created) {
    return (
      <Modal title="장소 단계" onClose={() => onSaved(created.tripId, created.resultText)}>
        <p role="status" data-testid="new-trip-created">
          여행을 만들었습니다. 장소 이름은 지금 활동 메모의 [장소: 이름]에 남아 있습니다. 아래에서 장소를 만들고 연결할
          수 있고, 건너뛰면 메모에 그대로 남습니다.
        </p>
        <PlaceFlow
          repo={repo}
          tripId={created.tripId}
          intro="새 여행의 장소 후보입니다. 장소 표와 일정의 장소 칸에서 모았습니다."
          source={(loaded) => collectPlaceCandidates(created.file, { places: loaded.places, regions: loaded.regions })}
          onFinish={(text) => onSaved(created.tripId, `${created.resultText}. ${text}`)}
        />
        <div className="button-row prep-actions">
          <button type="button" onClick={() => onSaved(created.tripId, created.resultText)}>
            장소 없이 닫기
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="AI 결과 붙여넣기" onClose={onClose}>
      <p className="muted">
        챗봇이 정리해 준 여행 계획의 코드 블록을 복사해 붙여 넣으세요. 이 화면은 서버에 아무것도 보내지 않습니다.
      </p>
      <div className="button-row prep-actions">
        <button type="button" onClick={() => void readClipboard()} disabled={busy}>
          클립보드에서 붙여넣기
        </button>
        <label className="file-picker">
          파일 선택 (.md·.txt)
          <input
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) {
                void readFile(file);
              }
            }}
          />
        </label>
      </div>
      {hint ? <p role="status">{hint}</p> : null}
      <label>
        붙여 넣은 글
        <textarea
          rows={8}
          value={text}
          disabled={busy}
          onChange={(event) => changeText(event.target.value)}
          placeholder="여기에 길게 눌러 붙여 넣기"
        />
      </label>
      <div className="button-row prep-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || text.trim() === ''}
          onClick={() => showPreview(text)}
        >
          미리보기
        </button>
      </div>
      <div className="paste-compare">
        {preview ? (
          <section aria-label="해석 결과" aria-live="polite">
            {preview.message ? (
              <p role="alert" className="notice">
                {preview.message}
              </p>
            ) : null}
            {updateCollection &&
            current &&
            (updateCollection.candidates.length > 0 ||
              updateCollection.existingLines.nameIgnored + updateCollection.existingLines.unknown > 0) ? (
              stage ? (
                <p role="status" data-testid="place-stage-done">
                  장소 단계 완료: 만든 장소 {stage.created}개 · 기존 장소 연결 {stage.linked}개. 아래 미리보기에서
                  활동에 연결합니다.
                </p>
              ) : (
                <PlaceStage
                  repo={repo}
                  tripId={current.header.tripId}
                  candidates={updateCollection.candidates}
                  existingLines={updateCollection.existingLines}
                  regions={current.regions}
                  onDone={setStage}
                />
              )
            ) : null}
            {updateCollection && current && (updateCollection.edits.length > 0 || edited) ? (
              edited ? (
                <p role="status" data-testid="place-edit-done">
                  장소 수정 완료: {edited.count}건. 아래 미리보기에서 일정 변경을 이어서 적용합니다.
                </p>
              ) : (
                <PlaceEditStage
                  repo={repo}
                  tripId={current.header.tripId}
                  edits={updateCollection.edits}
                  onDone={setEdited}
                />
              )
            ) : null}
            {preview.state === 'update' && current && currentTrip ? (
              <UpdatePreview
                key={`${stage ? `placed-${stage.placeIds.size}` : 'plain'}-${edited ? `edited-${edited.count}` : 'none'}`}
                repo={repo}
                file={preview.file}
                current={currentTrip}
                trips={current.trips}
                droppedConfirmed={preview.dropped.length === 0 || confirmedDropped}
                onApplied={(resultText) => onUpdated?.(resultText)}
              />
            ) : null}
            {preview.state === 'update' && !current ? (
              <p role="alert" className="notice">
                고칠 여행을 먼저 여세요. 수정 글은 열려 있는 여행과 비교해 적용합니다.
              </p>
            ) : null}
            {preview.state === 'ready' ? <PreviewSummary preview={preview} /> : null}
            <Problems title="오류" problems={preview.errors} />
            <Problems title="경고" problems={preview.warnings} />
            <DroppedList preview={preview} />
            <NotImportedList preview={preview} />
            {(preview.state === 'ready' || preview.state === 'update') && preview.dropped.length > 0 ? (
              <label>
                <input
                  type="checkbox"
                  checked={confirmedDropped}
                  onChange={(event) => setConfirmedDropped(event.target.checked)}
                />
                {preview.state === 'update'
                  ? '위 표는 빼고 나머지만 적용하는 것을 확인했습니다'
                  : '위 표는 빼고 나머지만 저장하는 것을 확인했습니다'}
              </label>
            ) : null}
            {preview.state === 'ready' && preview.duplicateOfExisting ? (
              <label>
                <input
                  type="checkbox"
                  checked={confirmedDuplicate}
                  onChange={(event) => setConfirmedDuplicate(event.target.checked)}
                />
                같은 이름의 여행이 있습니다. 새 여행으로 하나 더 만듭니다
              </label>
            ) : null}
            {preview.state === 'ready' ? (
              <div className="button-row prep-actions">
                <button type="button" className="primary" disabled={busy || !saveable} onClick={() => void save()}>
                  새 여행으로 저장
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
        {draft?.guide ? <ChosenList guide={draft.guide} selections={draft.selections} /> : null}
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}
