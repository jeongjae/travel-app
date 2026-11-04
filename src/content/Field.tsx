import { useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { ContentRepository } from '../repository';
import {
  timeSpecSchema,
  type ContentRevision,
  type FieldRecord,
  type PlanVersion,
  type RevisionRef,
  type TimeSpec,
  type TripDataset,
} from '../contracts/v2';
import { TimeFields } from './TimeFields';
import { confirmedZone } from './quick-time';
import {
  actualPayload,
  correctionLinks,
  groupActualsByDate,
  type ActualChainEntry,
  type ChainLink,
} from './field-rules';
import { errorText, ErrorText, Modal, reuseRequest, timeLabel, type RequestAttempt } from './ui';
export type RecordEditor = {
  header: TripDataset['header'];
  plan?: PlanVersion;
  item?: PlanVersion['items'][number];
  original?: Extract<FieldRecord, { kind: 'actual' }>;
  outcome: 'visited' | 'skipped' | 'unplanned';
  /** 새 기록은 계획 항목 또는 현재 맥락, 정정은 원본의 당시 맥락. */
  context: RevisionRef[];
  /** 폼을 연 시점의 현재 맥락. 정정에서 장소를 바꿀 때만 쓴다. */
  current: RevisionRef[];
  /** 새 기록의 시작값: 보고 있는 날짜와(오늘이면) 지금 시각. */
  defaultStart?: TimeSpec;
  /** 새 장소를 먼저 저장하고 돌아올 때 이어서 쓰는 입력. */
  draft?: RecordDraft;
};
export type RecordDraft = {
  title: string;
  note: string;
  outcome: RecordEditor['outcome'];
  time: TimeSpec;
  placeId: string;
};
type Place = Extract<ContentRevision, { kind: 'place' }>;
export function ActualEditor({
  repo,
  editor,
  places,
  onClose,
  onSaved,
  onNewPlace,
}: {
  repo: ContentRepository;
  editor: RecordEditor;
  /** 이 여행의 활성 장소. 기존에 연결된 비활성 장소는 목록에 없어도 유지된다. */
  places: Place[];
  onClose: () => void;
  onSaved: () => void;
  onNewPlace: (draft: RecordDraft) => void;
}) {
  const original = editor.original;
  const linkedToPlan = Boolean(editor.item || original?.payload.activityId);
  const [recordId] = useState(() => crypto.randomUUID()),
    attempt = useRef<RequestAttempt>(undefined),
    [title, setTitle] = useState(editor.draft?.title ?? original?.payload.title ?? editor.item?.title ?? ''),
    [note, setNote] = useState(editor.draft?.note ?? original?.payload.note ?? ''),
    [outcome, setOutcome] = useState(editor.draft?.outcome ?? editor.outcome),
    [time, setTime] = useState<TimeSpec>(
      editor.draft?.time ?? original?.payload.time.start ?? editor.defaultStart ?? { precision: 'unspecified' },
    ),
    [placeId, setPlaceId] = useState(editor.draft?.placeId ?? original?.payload.placeRef?.entityId ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const originalPlaceId = original?.payload.placeRef?.entityId;
  const inactivePlace = originalPlaceId && !places.some((place) => place.entityId === originalPlaceId);
  return (
    <Modal title={original ? '실제 기록 정정' : '실제 활동 기록'} onClose={onClose}>
      <form
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) {
            return;
          }
          setBusy(true);
          try {
            const payload = actualPayload(
              original,
              { title, outcome, note, start: timeSpecSchema.parse(time), placeId, tripId: editor.header.tripId },
              editor.context,
              editor.current,
              editor.item && editor.plan
                ? { planVersionId: editor.plan.planVersionId, activityId: editor.item.activityId }
                : undefined,
            );
            const record = {
              tripId: editor.header.tripId,
              recordId,
              kind: 'actual',
              sourceRefs: original?.sourceRefs ?? [],
              ...(original ? { supersedes: original.recordId } : {}),
              payload,
            };
            await repo.execute(
              reuseRequest(
                attempt,
                editor.header.tripId,
                original ? 'CorrectActual' : 'RecordActual',
                original ? { supersedes: original.recordId, record } : { record },
                editor.header.domainRevision,
              ),
            );
            onSaved();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          활동 이름
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          실행 결과
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="visited">방문</option>
            <option value="skipped">건너뜀</option>
            <option value="unplanned">예정 외 활동</option>
          </select>
        </label>
        {linkedToPlan ? null : (
          <fieldset>
            <legend>장소 (선택)</legend>
            <label>
              기록할 장소
              <select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
                <option value="">장소 없음</option>
                {inactivePlace ? <option value={originalPlaceId}>연결된 장소 (현재 비활성)</option> : null}
                {places.map((place) => (
                  <option key={place.entityId} value={place.entityId}>
                    {place.payload.name}
                  </option>
                ))}
              </select>
            </label>
            {original ? null : (
              <p className="muted">
                목록에 없으면 장소를 먼저 저장한 뒤 기록하세요. 장소 저장과 기록 저장은 별개이며, 기록을 저장하지 못해도
                저장한 장소는 남습니다.
                <button type="button" onClick={() => onNewPlace({ title, note, outcome, time, placeId })}>
                  새 장소 먼저 저장
                </button>
              </p>
            )}
          </fieldset>
        )}
        <TimeFields value={time} onChange={setTime} defaultZone={confirmedZone(editor.header)} emptyAs="date" />
        <label>
          기록 메모
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <ErrorText error={error} />
        {original && /변경|정정 대상/.test(error) ? (
          <p className="muted">
            입력한 내용은 그대로 남아 있습니다. 창을 닫고 최신 실제 기록을 확인한 뒤 다시 정정하세요.
          </p>
        ) : null}
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            실제 기록 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
const outcomeText = { visited: '방문', skipped: '건너뜀', unplanned: '예정 외 활동' } as const;
const weekdays = ['월', '화', '수', '목', '금', '토', '일'];

/** `12월 31일 (목)` 형식의 날짜 머리. 기록이 여러 해에 걸치면 연도를 앞에 붙인다. */
export function dateHeading(date: string, withYear: boolean) {
  const day = Temporal.PlainDate.from(date);
  const text = `${day.month}월 ${day.day}일 (${weekdays[day.dayOfWeek - 1]})`;
  return withYear ? `${day.year}년 ${text}` : text;
}

/** 날짜 머리 아래에서는 날짜를 되풀이하지 않고 시각만 보인다. 정밀도 용어는 보조 문구로 따로 둔다. */
function clockText(time: TimeSpec) {
  switch (time.precision) {
    case 'instant':
    case 'local':
      return time.localTime;
    case 'text':
      return time.rawText;
    case 'date':
      return '시각 없음';
    case 'unspecified':
      return '시각 미정';
  }
}
const precisionText: Record<TimeSpec['precision'], string> = {
  instant: '확인된 발생 시점',
  local: '현지 시각',
  text: '원문 시각',
  date: '날짜만 확인',
  unspecified: '시각 미상',
};

type ActualRow = Extract<FieldRecord, { kind: 'actual' }>;

export function ActualTimeline({
  records,
  placeNames,
  onCorrect,
  onContext,
}: {
  records: FieldRecord[];
  /** 기록 ID별로, 기록 당시 고정한 revision에서 읽은 장소 이름. */
  placeNames: Map<string, string>;
  onCorrect: (record: ActualRow) => void;
  onContext: (record: ActualRow) => void;
}) {
  const links = correctionLinks(records);
  const superseded = new Set(records.flatMap((r) => (r.supersedes ? [r.supersedes] : [])));
  const { days, unknown } = groupActualsByDate(records);
  const years = new Set(days.map((day) => day.date.slice(0, 4)));
  const renderRow = (entry: ActualChainEntry) => (
    <ActualRowView
      key={entry.latest.recordId}
      entry={entry}
      links={links}
      placeName={placeNames.get(entry.latest.recordId)}
      onCorrect={onCorrect}
      onContext={onContext}
    />
  );
  return (
    <>
      <h2>실제 활동 기록</h2>
      {!days.length && !unknown.length ? <p>실제 기록이 없습니다.</p> : null}
      {days.map((group) => (
        <section key={group.date} className="record-day">
          <h3>{dateHeading(group.date, years.size > 1)}</h3>
          {group.entries.map(renderRow)}
        </section>
      ))}
      {unknown.length ? (
        <section className="record-day">
          <h3>발생일 미상</h3>
          {unknown.map(renderRow)}
        </section>
      ) : null}
      <h3>이전 원천의 상태</h3>
      {records
        .filter((r) => r.kind === 'legacy-state')
        .map((r) => (
          <p key={r.recordId}>
            {r.payload.note} · {r.payload.state} · 실제 방문 시각으로 추정하지 않음
          </p>
        ))}
      <h3>메모</h3>
      {records
        .filter((r): r is Extract<FieldRecord, { kind: 'note' }> => r.kind === 'note' && !superseded.has(r.recordId))
        .map((r) => (
          <p key={r.recordId}>{r.payload.body}</p>
        ))}
    </>
  );
}

/** 정정 체인 하나를 최신 정정본 한 행으로 보인다. 원문·중간본은 접기 안에 두고 정정 버튼은 최신본에만 둔다. */
function ActualRowView({
  entry,
  links,
  placeName,
  onCorrect,
  onContext,
}: {
  entry: ActualChainEntry;
  links: Map<string, ChainLink>;
  placeName: string | undefined;
  onCorrect: (record: ActualRow) => void;
  onContext: (record: ActualRow) => void;
}) {
  const { latest, chain } = entry;
  const corrections = chain.length - 1;
  const time = latest.payload.time.start;
  const aux = [
    [precisionText[time.precision], time.precision === 'local' || time.precision === 'instant' ? time.timeZone : '']
      .filter(Boolean)
      .join(' · '),
    placeName ? `장소 · ${placeName} (기록 당시 이름)` : '',
    corrections ? `정정 ${corrections}회 · 최신 정정본` : '',
  ].filter(Boolean);
  return (
    <article className="content-row record-row">
      <h4>{latest.payload.title}</h4>
      <p>
        {outcomeText[latest.payload.outcome]} · {clockText(time)}
      </p>
      {latest.payload.note ? <p>{latest.payload.note}</p> : null}
      <p className="muted record-aux">{aux.join(' · ')}</p>
      <div className="button-row">
        <button onClick={() => onCorrect(latest)}>정정</button>
        <details className="row-more">
          <summary aria-label="기록 더 보기">⋯</summary>
          <button onClick={() => onContext(latest)}>기록 당시 내용</button>
          <p className="muted">앱에 남긴 시각 {latest.recordedAt} · 실제로 한 시각과 따로 보관</p>
        </details>
      </div>
      {corrections ? (
        <details className="correction-fold">
          <summary>정정 {corrections}회 · 원문 보기</summary>
          <ol>
            {chain.map((record) => (
              <li key={record.recordId}>
                <strong>{record.payload.title}</strong> · {outcomeText[record.payload.outcome]} ·{' '}
                {timeLabel(record.payload.time.start)}
                {record.payload.note ? <p>{record.payload.note}</p> : null}
                <CorrectionTrail link={links.get(record.recordId)} />
                {record.recordId !== latest.recordId ? <p className="muted">정정된 기록 · 원본 보존</p> : null}
                <button type="button" onClick={() => onContext(record)}>
                  이 단계의 기록 당시 내용
                </button>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  );
}

/** 정정 체인에서 이 기록의 위치와 앞뒤 기록을 보여 준다. 정정하지 않은 기록에는 아무것도 표시하지 않는다. */
function CorrectionTrail({ link }: { link: ChainLink | undefined }) {
  if (!link || link.length < 2) {
    return null;
  }
  return (
    <p className="muted">
      정정 {link.position}/{link.length}단계 · {link.after ? '이후 정정본 있음' : '최신 정정본'}
      {link.before ? ` · 정정한 이전 기록: ${link.before.payload.title}` : ' · 원본'}
      {link.after ? ` · 이후 기록: ${link.after.payload.title}` : ''}
    </p>
  );
}
