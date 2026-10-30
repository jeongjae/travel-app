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
import { actualPayload, correctionLinks, type ChainLink } from './field-rules';
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
      editor.draft?.time ?? original?.payload.time.start ?? { precision: 'unspecified' },
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
        <TimeEditor value={time} onChange={setTime} />
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
        <button className="primary" disabled={busy}>
          실제 기록 저장
        </button>
      </form>
    </Modal>
  );
}
export function TimeEditor({ value, onChange }: { value: TimeSpec; onChange: (value: TimeSpec) => void }) {
  const [precision, setPrecision] = useState(value.precision),
    [date, setDate] = useState(value.date ?? ''),
    [localTime, setLocalTime] = useState('localTime' in value ? value.localTime : ''),
    [zone, setZone] = useState('timeZone' in value ? (value.timeZone ?? '') : ''),
    [offset, setOffset] = useState('offset' in value ? value.offset : ''),
    [raw, setRaw] = useState(value.rawText ?? ''),
    [error, setError] = useState('');
  function update(fields: {
    precision?: TimeSpec['precision'];
    date?: string;
    localTime?: string;
    zone?: string;
    offset?: string;
    raw?: string;
  }) {
    const p = fields.precision ?? precision,
      d = fields.date ?? date,
      l = fields.localTime ?? localTime,
      z = fields.zone ?? zone,
      o = fields.offset ?? offset,
      r = fields.raw ?? raw;
    let candidate: unknown;
    try {
      if (p === 'unspecified') {
        candidate = { precision: p, ...(d ? { date: d } : {}) };
      } else if (p === 'date') {
        candidate = { precision: p, date: d };
      } else if (p === 'text') {
        candidate = { precision: p, ...(d ? { date: d } : {}), rawText: r };
      } else if (p === 'local') {
        candidate = {
          precision: p,
          date: d,
          localTime: l,
          timeZoneStatus: z ? 'confirmed' : 'unknown',
          ...(z ? { timeZone: z } : {}),
        };
      } else {
        const instant = Temporal.ZonedDateTime.from(`${d}T${l}${o}[${z}]`, {
          offset: 'reject',
          disambiguation: 'reject',
        })
          .toInstant()
          .toString();
        candidate = { precision: p, date: d, localTime: l, timeZone: z, offset: o, instant };
      }
      onChange(timeSpecSchema.parse(candidate));
      setError('');
    } catch {
      setError('날짜·시각·시간대·오프셋을 모두 확인하세요. 유효한 값을 입력한 뒤 저장할 수 있습니다.');
      onChange((candidate as TimeSpec) ?? ({ precision: p } as TimeSpec));
    }
  }
  return (
    <fieldset>
      <legend>발생 시각</legend>
      <label>
        시각 정밀도
        <select
          value={precision}
          onChange={(e) => {
            const p = e.target.value as typeof precision;
            setPrecision(p);
            update({ precision: p });
          }}
        >
          <option value="unspecified">시각 미상</option>
          <option value="date">날짜만 확인</option>
          <option value="text">원문 표현</option>
          <option value="local">현지 시각</option>
          <option value="instant">정확한 시점</option>
        </select>
      </label>
      <label>
        발생 날짜
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            update({ date: e.target.value });
          }}
        />
      </label>
      {precision === 'text' ? (
        <label>
          시각 원문
          <input
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              update({ raw: e.target.value });
            }}
            placeholder="점심 후"
          />
        </label>
      ) : null}
      {precision === 'local' || precision === 'instant' ? (
        <>
          <label>
            현지 시각
            <input
              type="time"
              value={localTime}
              onChange={(e) => {
                setLocalTime(e.target.value);
                update({ localTime: e.target.value });
              }}
            />
          </label>
          <label>
            IANA 시간대
            <input
              value={zone}
              onChange={(e) => {
                setZone(e.target.value);
                update({ zone: e.target.value });
              }}
              placeholder="Asia/Seoul"
            />
          </label>
        </>
      ) : null}
      {precision === 'instant' ? (
        <label>
          확인된 UTC 오프셋
          <input
            value={offset}
            onChange={(e) => {
              setOffset(e.target.value);
              update({ offset: e.target.value });
            }}
            placeholder="+09:00"
          />
        </label>
      ) : null}
      <ErrorText error={error} />
    </fieldset>
  );
}
export function ActualTimeline({
  records,
  placeNames,
  onCorrect,
  onContext,
}: {
  records: FieldRecord[];
  /** 기록 ID별로, 기록 당시 고정한 revision에서 읽은 장소 이름. */
  placeNames: Map<string, string>;
  onCorrect: (record: Extract<FieldRecord, { kind: 'actual' }>) => void;
  onContext: (record: Extract<FieldRecord, { kind: 'actual' }>) => void;
}) {
  const links = correctionLinks(records);
  const superseded = new Set(records.flatMap((r) => (r.supersedes ? [r.supersedes] : [])));
  const actuals = records.filter((r): r is Extract<FieldRecord, { kind: 'actual' }> => r.kind === 'actual');
  const exact = actuals
    .filter((r) => r.payload.time.start.precision === 'instant')
    .toSorted((a, b) =>
      Temporal.Instant.compare(
        (a.payload.time.start as Extract<TimeSpec, { precision: 'instant' }>).instant,
        (b.payload.time.start as Extract<TimeSpec, { precision: 'instant' }>).instant,
      ),
    );
  const dated = actuals
    .filter((r) => r.payload.time.start.precision !== 'instant' && Boolean(r.payload.time.start.date))
    .toSorted(
      (a, b) => a.payload.time.start.date!.localeCompare(b.payload.time.start.date!) || a.commitSeq - b.commitSeq,
    );
  const unknown = actuals.filter((r) => !r.payload.time.start.date).toSorted((a, b) => a.commitSeq - b.commitSeq);
  return (
    <>
      <h2>실제 활동 기록</h2>
      {!actuals.length ? <p>실제 기록이 없습니다.</p> : null}
      {[
        { label: '확인된 발생 시점', rows: exact },
        { label: '날짜·현지 시각·원문으로 확인한 기록', rows: dated },
        { label: '발생일 미상', rows: unknown },
      ]
        .filter((g) => g.rows.length)
        .map((group) => (
          <section key={group.label}>
            <h3>{group.label}</h3>
            {group.rows.map((r) => (
              <article className="content-row" key={r.recordId}>
                <h3>{r.payload.title}</h3>
                <p>
                  {r.payload.outcome === 'visited'
                    ? '방문'
                    : r.payload.outcome === 'skipped'
                      ? '건너뜀'
                      : '예정 외 활동'}{' '}
                  · {timeLabel(r.payload.time.start)}
                </p>
                {placeNames.has(r.recordId) ? <p>장소 · {placeNames.get(r.recordId)} (기록 당시 이름)</p> : null}
                <p>{r.payload.note}</p>
                {superseded.has(r.recordId) ? (
                  <p className="muted">정정된 기록 · 원본 보존</p>
                ) : (
                  <button onClick={() => onCorrect(r)}>정정</button>
                )}
                <CorrectionTrail link={links.get(r.recordId)} />
                <button onClick={() => onContext(r)}>기록 당시 내용</button>
                <details>
                  <summary>저장 정보</summary>
                  <p>저장 시각 {r.recordedAt} · 발생 시각과 구분</p>
                </details>
              </article>
            ))}
          </section>
        ))}
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
