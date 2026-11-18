import { useMemo, useRef, useState } from 'react';
import type { ContentRepository } from '../repository';
import type { CheckedPlanFile } from '../plan-import';
import { buildSelection, computeUpdate, type ChangeEntry, type CurrentTrip, type UpdateResult } from '../plan-update';
import { command, errorText, ErrorText } from './ui';

export const CHANGED_DURING_MESSAGE = '계획이 그사이 바뀌었습니다. 다시 복사해 작업하세요';

type ReadyResult = Extract<UpdateResult, { status: 'ready' }>;

type Props = {
  repo: ContentRepository;
  file: CheckedPlanFile;
  current: CurrentTrip;
  /** 다른 여행 ID를 만났을 때 그 여행의 이름을 알려 주는 데 쓴다. */
  trips: { tripId: string; name: string }[];
  /** 오류로 빠진 표가 있을 때 사용자가 그것을 확인했는가. */
  droppedConfirmed: boolean;
  onApplied: (resultText: string) => void;
};

function ChangeItem({
  entry,
  checked,
  onToggle,
  disabled,
}: {
  entry: ChangeEntry;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <li>
      <label className="update-entry">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
        <span>
          {entry.date} · {entry.entity === 'stay' ? '숙소' : '활동'} · {entry.title}
          {entry.kind === 'move' ? ' (날짜 이동)' : ''}
        </span>
      </label>
      {entry.fields.length > 0 ? (
        <ul>
          {entry.fields.map((field) => (
            <li key={field.name}>
              {field.name}: {field.before === '' ? '(비어 있음)' : field.before} →{' '}
              {field.cleared ? <strong>(비움)</strong> : field.after}
            </li>
          ))}
        </ul>
      ) : null}
      {entry.notes.map((note) => (
        <p key={note} className="muted">
          {note}
        </p>
      ))}
    </li>
  );
}

type GroupProps = {
  title: string;
  entries: ChangeEntry[];
  selected: ReadonlySet<string>;
  toggle: (key: string) => void;
  disabled: boolean;
  note?: string;
};

function Group({ title, entries, selected, toggle, disabled, note }: GroupProps) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <section aria-label={title}>
      <h3>
        {title} {entries.length}건
      </h3>
      {note ? <p className="muted">{note}</p> : null}
      <ul>
        {entries.map((entry) => (
          <ChangeItem
            key={entry.key}
            entry={entry}
            checked={selected.has(entry.key)}
            onToggle={() => toggle(entry.key)}
            disabled={disabled}
          />
        ))}
      </ul>
    </section>
  );
}

function ReadyView({ repo, result, current, droppedConfirmed, onApplied }: Props & { result: ReadyResult }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(result.changes.map((c) => c.key)));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const applyingRef = useRef(false);

  const picked = useMemo(() => buildSelection(result, selected, current), [result, selected, current]);
  const deleteCount = [...result.changes, ...result.skipped].filter(
    (change) => change.kind === 'delete' && selected.has(change.key),
  ).length;

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelected(next);
    setConfirmDelete(false);
    setError('');
  }

  async function apply() {
    if (!picked.ok || applyingRef.current) {
      return;
    }
    applyingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const { header, plan } = current;
      await repo.execute(
        command(
          header.tripId,
          'ChangePlan',
          { currentPlanVersionId: plan.planVersionId, operations: picked.operations, reason: picked.reason },
          header.domainRevision,
        ),
      );
      const { edit, add, remove } = picked.counts;
      onApplied(`수정 ${edit}·추가 ${add}·삭제 ${remove}`);
    } catch (err) {
      const message = errorText(err);
      setError(message.includes('CONFLICT') ? CHANGED_DURING_MESSAGE : message);
    } finally {
      applyingRef.current = false;
      setBusy(false);
    }
  }

  const groupOf = (kinds: ChangeEntry['kind'][]) => result.changes.filter((change) => kinds.includes(change.kind));
  const canApply = picked.ok && (deleteCount === 0 || confirmDelete) && droppedConfirmed && !busy;
  const nothing = result.changes.length + result.skipped.length === 0;
  return (
    <section aria-label="수정 미리보기">
      <p data-testid="update-counts">
        추가 {groupOf(['add']).length} · 수정 {groupOf(['edit', 'move']).length} · 삭제 {groupOf(['delete']).length} ·
        변경 없음 {result.unchanged.length} · 건너뜀 후보 {result.skipped.length} · 오류 {result.errors.length}
      </p>
      {result.rangeExport ? (
        <p className="muted">범위 내보내기: 날짜 범위만 내보낸 글입니다. 범위 밖 계획은 그대로 둡니다.</p>
      ) : null}
      {nothing ? <p role="status">바뀐 곳이 없습니다.</p> : null}
      <Group title="추가" entries={groupOf(['add'])} selected={selected} toggle={toggle} disabled={busy} />
      <Group title="수정" entries={groupOf(['edit', 'move'])} selected={selected} toggle={toggle} disabled={busy} />
      <Group title="삭제" entries={groupOf(['delete'])} selected={selected} toggle={toggle} disabled={busy} />
      <Group
        title="건너뜀 후보"
        entries={result.skipped}
        selected={selected}
        toggle={toggle}
        disabled={busy}
        note="이미 있는 항목과 같아 보이는 새 줄입니다. 기본은 넣지 않습니다. 넣으려면 체크하세요."
      />
      {result.errors.length > 0 ? (
        <section aria-label="수정 오류">
          <h3>오류 {result.errors.length}건 (이 줄은 적용되지 않습니다)</h3>
          <ul>
            {result.errors.map((problem, index) => (
              <li key={index}>
                {problem.where} · {problem.section} · {problem.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.ignored.length > 0 ? (
        <details>
          <summary>가져오지 않는 칸 {result.ignored.length}건</summary>
          <ul>
            {result.ignored.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {result.unchanged.length > 0 ? (
        <details>
          <summary>변경 없음 {result.unchanged.length}건</summary>
          <ul>
            {result.unchanged.map((entry, index) => (
              <li key={index}>
                {entry.date} · {entry.entity === 'stay' ? '숙소' : '활동'} · {entry.title}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!picked.ok && selected.size > 0 ? (
        <ul role="alert" className="error">
          {picked.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {deleteCount > 0 ? (
        <label>
          <input type="checkbox" checked={confirmDelete} onChange={(event) => setConfirmDelete(event.target.checked)} />
          삭제 {deleteCount}건을 확인했습니다
        </label>
      ) : null}
      <div className="button-row prep-actions">
        <button type="button" className="primary" disabled={!canApply} onClick={() => void apply()}>
          {picked.ok
            ? `고른 ${picked.operations.length}건 적용 (수정 ${picked.counts.edit}·추가 ${picked.counts.add}·삭제 ${picked.counts.remove})`
            : '적용'}
        </button>
      </div>
      <ErrorText error={error} />
    </section>
  );
}

/** "AI 결과 붙여넣기"에 수정 글이 들어왔을 때: 열려 있는 여행과 비교해 고른 변경만 `ChangePlan` 1회로 적용한다. */
export function UpdatePreview(props: Props) {
  const result = useMemo(() => computeUpdate(props.file, props.current), [props.file, props.current]);
  if (result.status === 'blocked') {
    const other = result.otherTripId ? props.trips.find((trip) => trip.tripId === result.otherTripId) : undefined;
    return (
      <section aria-label="수정 미리보기">
        <p role="alert" className="notice">
          {result.message}
          {other ? ` 이 글은 "${other.name}" 여행의 것입니다.` : ''}
        </p>
      </section>
    );
  }
  return <ReadyView {...props} result={result} />;
}
