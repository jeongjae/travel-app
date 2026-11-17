import { useRef, useState } from 'react';
import type { ContentRepository } from '../repository';
import { buildPlanPreview, canSavePreview, type ExistingTrip, type PlanPreview } from '../plan-import/preview';
import { ChosenList } from './ChosenList';
import { readPrepDraft } from './prep-state';
import { command, errorText, ErrorText, Modal } from './ui';

type Props = {
  repo: ContentRepository;
  existing: ExistingTrip[];
  onClose: () => void;
  onSaved: (tripId: string, resultText: string) => void;
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
    lines.push(`구역 "장소" ${preview.placeCount}줄 — 장소는 다음 단계에서 지원합니다. 이름은 메모에 남깁니다.`);
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

export function PlanPasteDialog({ repo, existing, onClose, onSaved }: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [confirmedDropped, setConfirmedDropped] = useState(false);
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const savingRef = useRef(false);
  const [draft] = useState(readPrepDraft);

  function showPreview(source: string) {
    setPreview(buildPlanPreview(source, existing));
    setConfirmedDropped(false);
    setConfirmedDuplicate(false);
    setError('');
  }

  /** 원문을 고치면 이전 미리보기와 확인란은 무효다. */
  function changeText(value: string) {
    setText(value);
    setPreview(null);
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
      onSaved(trip.header.tripId, `활동 ${preview.activityCount}개 · 숙소 ${preview.stayCount}곳`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  const saveable = preview ? canSavePreview(preview, confirmedDropped, confirmedDuplicate) : false;
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
            {preview.state === 'ready' ? <PreviewSummary preview={preview} /> : null}
            <Problems title="오류" problems={preview.errors} />
            <Problems title="경고" problems={preview.warnings} />
            <DroppedList preview={preview} />
            <NotImportedList preview={preview} />
            {preview.state === 'ready' && preview.dropped.length > 0 ? (
              <label>
                <input
                  type="checkbox"
                  checked={confirmedDropped}
                  onChange={(event) => setConfirmedDropped(event.target.checked)}
                />
                위 표는 빼고 나머지만 저장하는 것을 확인했습니다
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
