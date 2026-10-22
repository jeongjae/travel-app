import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ZodError } from 'zod';
import {
  currentPlan,
  effectiveActuals,
  localDate,
  localInput,
  fromLocal,
  dateRange,
  sortByStart,
  uid,
  type Activity,
  type ActualRecord,
  type Trip,
} from './domain';
import { repository } from './repository';
import { aiContext, downloadJson, parseFile } from './import-export';
import { demoTrips } from './demo';
import { AiPlanner } from './AiPlanner';

type Action = (task: () => Promise<unknown>, success?: string) => Promise<boolean>;
type DialogContent =
  | { kind: 'activity'; activity?: Activity }
  | { kind: 'actual'; activity?: Activity; actual?: ActualRecord; outcome: 'visited' | 'skipped' };
type DialogKind = DialogContent & { baseRevision: number };
const tabs = ['일정', '실제 기록', '변경안', '여행 설정'] as const;
type Tab = (typeof tabs)[number];
function describeError(error: unknown) {
  if (error instanceof ZodError)
    return `입력 형식 오류: ${error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')} ${i.message}`)
      .join(' / ')}`;
  return error instanceof Error ? error.message : '작업 중 오류가 발생했습니다. 저장 상태를 확인하세요.';
}
function Icon({ kind }: { kind: 'left' | 'right' | 'plus' }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={kind === 'plus' ? 'M12 5v14M5 12h14' : kind === 'left' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
    </svg>
  );
}
function Modal({
  title,
  onClose,
  children,
  busy = false,
  error,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" onClick={onClose} disabled={busy}>
          닫기
        </button>
      </div>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {children}
    </dialog>
  );
}
export function App() {
  const trips = useLiveQuery(() => repository.list(), []);
  const [selected, setSelected] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof parseFile> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const run: Action = async (task, success = '이 기기에 저장했습니다.') => {
    if (busy) return false;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
      setMessage(success);
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const trip = trips?.find((t) => t.id === selected) ?? trips?.[0];
  const openFile = () => file.current?.click();
  async function loadExamples() {
    await run(async () => {
      const demos = demoTrips();
      await repository.db.transaction('rw', repository.db.trips, async () => {
        if (await repository.db.trips.count()) throw new Error('예시는 빈 저장소에서만 불러옵니다.');
        await repository.db.trips.bulkAdd(demos);
      });
      setSelected(demos[0].id);
    }, '가상 예시 여행 두 개를 불러왔습니다.');
  }
  async function confirmImport() {
    if (!preview) return;
    const ok = await run(async () => {
      if (preview.kind === 'trip') {
        await repository.importTrip(preview.trip);
        setSelected(preview.trip.id);
      } else if (preview.kind === 'backup') {
        const restored = await repository.restore(preview.backup);
        setSelected(restored[0]?.id ?? '');
      } else {
        await repository.propose(preview.proposal);
        setSelected(preview.proposal.tripId);
      }
    });
    if (ok) setPreview(null);
  }
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <aside className="sidebar" aria-label="여행 선택">
        <a className="brand" href="#main">
          travel-app
        </a>
        <div className="trip-list">
          <h2>내 여행</h2>
          {trips?.map((t) => (
            <button
              key={t.id}
              className={trip?.id === t.id ? 'trip-item selected' : 'trip-item'}
              onClick={() => setSelected(t.id)}
              aria-current={trip?.id === t.id ? 'true' : undefined}
            >
              {t.name}
            </button>
          ))}
          {trips?.length === 0 ? <p className="muted">첫 여행을 만들어 보세요.</p> : null}
        </div>
        <div className="sidebar-actions">
          <button className="primary" onClick={() => setNewOpen(true)} disabled={busy}>
            <Icon kind="plus" />새 여행
          </button>
          <button onClick={openFile} disabled={busy}>
            가져오기
          </button>
          <button
            onClick={() =>
              run(
                async () => downloadJson('travel-app-backup.json', await repository.backup()),
                '백업 파일을 다운로드했습니다.',
              )
            }
            disabled={busy || !trips?.length}
          >
            백업
          </button>
        </div>
      </aside>
      <main id="main" className="main" aria-busy={busy}>
        <div className="notifications" aria-live="polite">
          {message ? (
            <p role="status" className="success">
              {message}
              <button aria-label="알림 닫기" onClick={() => setMessage('')}>
                닫기
              </button>
            </p>
          ) : null}
        </div>
        {error ? (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError('')}>닫기</button>
          </div>
        ) : null}
        {!online ? (
          <p className="offline" role="status">
            오프라인 · 이 기기에 계속 저장됩니다.
          </p>
        ) : null}
        {trips === undefined ? (
          <p role="status">여행을 불러오는 중입니다.</p>
        ) : trip ? (
          <TripWorkspace key={trip.id} trip={trip} run={run} busy={busy} openFile={openFile} error={error} />
        ) : (
          <section className="empty-start">
            <h1>다음 여행을 위한 공간</h1>
            <p>
              계획을 세우고, 실제로 보낸 하루를 기록하세요.
              <br />
              일정을 바꿔도 지나온 여행은 남습니다.
            </p>
            <div className="button-row">
              <button className="primary" onClick={() => setNewOpen(true)}>
                첫 여행 만들기
              </button>
              <button onClick={loadExamples} disabled={busy}>
                예시 여행 불러오기
              </button>
            </div>
            <p className="muted">예시는 가상 데이터입니다. 여행 데이터는 이 브라우저에 저장됩니다.</p>
          </section>
        )}
      </main>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        aria-label="JSON 파일 선택"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0];
          event.target.value = '';
          if (selectedFile)
            void run(async () => {
              if (selectedFile.size > 10 * 1024 * 1024) throw new Error('10 MiB 이하 파일만 지원합니다.');
              setPreview(parseFile(await selectedFile.text()));
            }, '파일을 검증했습니다. 미리보기를 확인하세요.');
        }}
      />
      {newOpen ? (
        <Modal title="새 여행" onClose={() => setNewOpen(false)} busy={busy} error={error}>
          <NewTripForm
            busy={busy}
            onSubmit={async (input) => {
              const ok = await run(async () => {
                const created = await repository.create(input);
                setSelected(created.id);
              });
              if (ok) setNewOpen(false);
            }}
          />
        </Modal>
      ) : null}
      {preview ? (
        <Modal title="가져오기 미리보기" onClose={() => setPreview(null)} busy={busy} error={error}>
          {preview.kind === 'trip' ? (
            <>
              <h3>{preview.trip.name}</h3>
              <p>
                {preview.trip.startDate} – {preview.trip.endDate} · {preview.trip.timeZone}
              </p>
              <p>
                계획 {preview.trip.versions.length}개 버전 · 현재 일정 {currentPlan(preview.trip).activities.length}개 ·
                실제 기록 {preview.trip.actuals.length}개
              </p>
              <p className="muted">같은 ID의 여행은 덮어쓰지 않습니다.</p>
            </>
          ) : preview.kind === 'backup' ? (
            <>
              <p>전체 백업 · 여행 {preview.backup.trips.length}개</p>
              <p>빈 저장소에만 복원할 수 있습니다.</p>
              <ul>
                {preview.backup.trips.map((t) => (
                  <li key={t.id}>{t.name}</li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p>대상 여행: {trips?.find((t) => t.id === preview.proposal.tripId)?.name ?? '이 기기에 없는 여행'}</p>
              <p>기준 revision {preview.proposal.baseRevision}</p>
              <h3>{preview.proposal.reason}</h3>
              <p>
                {preview.proposal.operations.length}개 변경 · 예약 영향: {preview.proposal.reservationImpact}
              </p>
              <p>변경안으로만 저장합니다. 현재 계획을 바꾸려면 변경안 화면에서 확인 후 적용하세요.</p>
            </>
          )}
          <button className="primary" onClick={confirmImport} disabled={busy}>
            확인하고 {preview.kind === 'backup' ? '복원' : '가져오기'}
          </button>
        </Modal>
      ) : null}
    </div>
  );
}

function NewTripForm({
  onSubmit,
  busy,
}: {
  onSubmit: (input: { name: string; startDate: string; endDate: string; timeZone: string }) => Promise<void>;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void onSubmit({
          name: String(data.get('name')),
          startDate: String(data.get('startDate')),
          endDate: String(data.get('endDate')),
          timeZone: String(data.get('timeZone')),
        });
      }}
    >
      <label>
        여행 이름
        <input name="name" required maxLength={120} placeholder="예: 가을 교토 여행" autoFocus />
      </label>
      <div className="form-grid">
        <label>
          시작일
          <input name="startDate" type="date" required />
        </label>
        <label>
          종료일
          <input name="endDate" type="date" required />
        </label>
      </div>
      <label>
        기본 시간대
        <input name="timeZone" defaultValue="Asia/Seoul" required list="time-zones" />
      </label>
      <TimeZones />
      <p className="muted">도착지의 시간대입니다. 일정마다 다른 시간대도 지정할 수 있습니다.</p>
      <button className="primary" type="submit" disabled={busy}>
        여행 만들기
      </button>
    </form>
  );
}
function TimeZones() {
  return (
    <datalist id="time-zones">
      <option>Asia/Seoul</option>
      <option>Asia/Tokyo</option>
      <option>Europe/Paris</option>
      <option>Europe/Madrid</option>
      <option>America/New_York</option>
      <option>Pacific/Honolulu</option>
    </datalist>
  );
}

function TripWorkspace({
  trip,
  run,
  busy,
  openFile,
  error,
}: {
  trip: Trip;
  run: Action;
  busy: boolean;
  openFile: () => void;
  error: string;
}) {
  const [tab, setTab] = useState<Tab>('일정');
  const [date, setDate] = useState(trip.startDate);
  const [version, setVersion] = useState<number | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const openDialog = (content: DialogContent) => setDialog({ ...content, baseRevision: trip.revision });
  const plan = version === null ? currentPlan(trip) : trip.versions.find((v) => v.number === version)!;
  const historical = plan.number !== currentPlan(trip).number;
  const dates = dateRange(trip.startDate, trip.endDate);
  const rows = sortByStart(plan.activities.filter((a) => localDate(a.start, a.timeZone) === date));
  const pending = trip.proposals.filter((p) => p.status === 'pending');
  const actuals = effectiveActuals(trip).filter((a) => localDate(a.start, a.timeZone) === date);
  const dateLabel = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  const move = (step: number) => setDate(dates[dates.indexOf(date) + step]);
  return (
    <>
      <header className="trip-header">
        <div>
          <h1>{trip.name}</h1>
          <p>
            {trip.startDate.replaceAll('-', '. ')} – {trip.endDate.replaceAll('-', '. ')} · {trip.timeZone}
          </p>
        </div>
        <span className="save-state">{busy ? '저장 중…' : '이 기기에 저장됨'}</span>
      </header>
      <nav className="tabs" aria-label="여행 화면">
        {tabs.map((t) => (
          <button
            key={t}
            aria-current={tab === t ? 'page' : undefined}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === '일정' || tab === '실제 기록' ? (
        <>
          <div className="day-toolbar">
            <div>
              <h2>{dateLabel}</h2>
              <label className="compact-label">
                날짜
                <select aria-label="조회 날짜" value={date} onChange={(e) => setDate(e.target.value)}>
                  {dates.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="button-row">
              <button aria-label="이전 날짜" onClick={() => move(-1)} disabled={dates.indexOf(date) === 0}>
                <Icon kind="left" />
              </button>
              <button
                aria-label="다음 날짜"
                onClick={() => move(1)}
                disabled={dates.indexOf(date) === dates.length - 1}
              >
                <Icon kind="right" />
              </button>
              <button
                className="primary"
                disabled={busy || (tab === '일정' && historical)}
                onClick={() =>
                  openDialog(tab === '일정' ? { kind: 'activity' } : { kind: 'actual', outcome: 'visited' })
                }
              >
                <Icon kind="plus" />
                {tab === '일정' ? '일정 추가' : '예정 외 기록'}
              </button>
            </div>
          </div>
          <div className="workspace-columns">
            <section aria-label={tab === '일정' ? '날짜별 일정' : '실제 여행 타임라인'}>
              {tab === '일정' ? (
                <>
                  <label className="version-select">
                    계획 버전
                    <select
                      aria-label="계획 버전"
                      value={version ?? 'current'}
                      onChange={(e) => setVersion(e.target.value === 'current' ? null : Number(e.target.value))}
                    >
                      <option value="current">현재 계획 v{currentPlan(trip).number}</option>
                      {trip.versions
                        .slice(0, -1)
                        .toReversed()
                        .map((v) => (
                          <option key={v.number} value={v.number}>
                            과거 계획 v{v.number}
                          </option>
                        ))}
                    </select>
                  </label>
                  {historical ? (
                    <p className="notice">
                      과거 계획 v{plan.number} · {plan.reason}
                    </p>
                  ) : null}
                  {rows.length ? (
                    <ol className="timeline">
                      {rows.map((a) => (
                        <li key={a.id} className="timeline-row">
                          <div className="time">
                            <TimeRange row={a} />
                          </div>
                          <div className="activity-copy">
                            <h3>
                              <button
                                className="title-button"
                                disabled={historical || busy}
                                onClick={() => openDialog({ kind: 'activity', activity: a })}
                              >
                                {a.title}
                              </button>
                            </h3>
                            <p>{a.note}</p>
                            {a.timeZone !== trip.timeZone ? <small>{a.timeZone}</small> : null}
                            {a.sourceRef ? (
                              <details>
                                <summary>가져오기 출처</summary>
                                <p>{a.sourceRef}</p>
                              </details>
                            ) : null}
                          </div>
                          <div className="row-actions">
                            <button
                              className="soft"
                              disabled={historical || busy}
                              onClick={() => openDialog({ kind: 'actual', activity: a, outcome: 'visited' })}
                            >
                              방문 기록
                            </button>
                            <button
                              disabled={historical || busy}
                              onClick={() => openDialog({ kind: 'actual', activity: a, outcome: 'skipped' })}
                            >
                              건너뜀
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="empty-list">
                      <h3>비워 둔 하루</h3>
                      <p>이 날짜에 계획된 일정이 없습니다.</p>
                    </div>
                  )}
                  <details className="plan-reason">
                    <summary>이 계획의 변경 이유와 근거</summary>
                    <p>{plan.reason}</p>
                    <EvidenceList evidence={plan.evidence} />
                  </details>
                </>
              ) : (
                <>
                  <p className="muted">실제 시각순으로 표시합니다. 정정해도 원본 기록은 보존됩니다.</p>
                  {actuals.length ? (
                    <ol className="timeline">
                      {actuals.map((a) => (
                        <li key={a.id} className="timeline-row actual-row">
                          <div className="time">
                            <TimeRange row={a} />
                          </div>
                          <div className="activity-copy">
                            <h3>{a.title}</h3>
                            <p className="outcome">
                              {a.outcome === 'visited' ? '방문함' : '건너뜀'} ·{' '}
                              {a.activityId ? '계획과 연결된 기록' : '예정 외 활동'}
                            </p>
                            <p>{a.note}</p>
                            {a.supersedes ? <small>정정된 기록 · 원본 보존</small> : null}
                          </div>
                          <button
                            onClick={() => openDialog({ kind: 'actual', actual: a, outcome: a.outcome })}
                            disabled={busy}
                          >
                            정정
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="empty-list">
                      <h3>아직 남긴 기록이 없어요</h3>
                      <p>일정에서 방문을 기록하거나 예정 외 활동을 추가하세요.</p>
                    </div>
                  )}
                  <details>
                    <summary>원본·정정 이력 ({trip.actuals.length}개)</summary>
                    {trip.actuals.map((a) => (
                      <p key={a.id}>
                        {a.title} · {localDate(a.start, a.timeZone)} · {a.supersedes ? '정정' : '원본'} · {a.note}
                      </p>
                    ))}
                  </details>
                </>
              )}
            </section>
            <aside className="context-column">
              <div className="context-panel">
                <h3>
                  계획은 유연하게,
                  <br />
                  기록은 그대로
                </h3>
                <p>일정을 바꿔도 실제 여행 기록은 보존됩니다.</p>
                <hr />
                <p>
                  현재 계획 v{currentPlan(trip).number}
                  <br />
                  변경안 {pending.length}개
                </p>
                <button onClick={openFile} disabled={busy}>
                  변경안 가져오기
                </button>
              </div>
              <p className="muted">표시 시각은 일정의 현지 시각입니다.</p>
            </aside>
          </div>
        </>
      ) : tab === '변경안' ? (
        <ProposalPanel trip={trip} run={run} busy={busy} openFile={openFile} />
      ) : (
        <section className="settings">
          <h2>여행 설정과 데이터</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void run(() => repository.rename(trip.id, trip.revision, String(data.get('name'))));
            }}
          >
            <label>
              여행 이름
              <input name="name" defaultValue={trip.name} key={trip.name} required maxLength={120} />
            </label>
            <button className="primary" type="submit" disabled={busy}>
              이름 저장
            </button>
          </form>
          <dl>
            <dt>기본 시간대</dt>
            <dd>{trip.timeZone}</dd>
            <dt>여행 기간</dt>
            <dd>
              {trip.startDate} – {trip.endDate}
            </dd>
            <dt>데이터 revision</dt>
            <dd>{trip.revision}</dd>
          </dl>
          <h3>이 여행 내보내기</h3>
          <p>여행 파일에는 계획 버전, 실제 기록, 근거, 변경안 이력이 함께 포함됩니다.</p>
          <button
            onClick={() => downloadJson('travel-app-trip.json', { format: 'travel-app-trip', schemaVersion: 1, trip })}
          >
            여행 JSON 다운로드
          </button>
          <h3>저장 범위</h3>
          <p>
            이 브라우저·기기에 저장됩니다. 다른 기기와 자동 동기화되지 않습니다. 브라우저 데이터를 지우기 전에 전체
            백업을 다운로드하세요.
          </p>
          <p>
            앱 내부 AI는 로컬 서버의 OpenAI API로 실행합니다. 모든 변경안은 사용자 확인 후 적용하며, 오프라인에서는
            조회·현장 기록을 사용할 수 있습니다.
          </p>
        </section>
      )}
      {dialog ? (
        <Modal
          title={
            dialog.kind === 'activity'
              ? dialog.activity
                ? '일정 수정'
                : '일정 추가'
              : dialog.actual
                ? '실제 기록 정정'
                : dialog.outcome === 'skipped'
                  ? '건너뜀 기록'
                  : '실제 방문 기록'
          }
          onClose={() => setDialog(null)}
          busy={busy}
          error={error}
        >
          <ActivityForm
            trip={trip}
            date={date}
            dialog={dialog}
            busy={busy}
            onSave={async (row, note, outcome) => {
              const expected = dialog.baseRevision;
              const ok = await run(() =>
                dialog.kind === 'activity'
                  ? repository.changePlan(
                      trip.id,
                      expected,
                      [
                        {
                          type: 'upsert',
                          activity: { ...row, id: dialog.activity?.id ?? uid(), sourceRef: dialog.activity?.sourceRef },
                        },
                      ],
                      note || (dialog.activity ? '사용자 일정 수정' : '사용자 일정 추가'),
                    )
                  : repository.record(trip.id, expected, {
                      ...row,
                      outcome: outcome ?? dialog.outcome,
                      activityId: dialog.actual?.activityId ?? dialog.activity?.id,
                      supersedes: dialog.actual?.id,
                    }),
              );
              if (ok) {
                setDialog(null);
                setVersion(null);
              }
            }}
            onDelete={
              dialog.kind === 'activity' && dialog.activity
                ? async () => {
                    const activity = dialog.activity!;
                    const ok = await run(() =>
                      repository.changePlan(
                        trip.id,
                        dialog.baseRevision,
                        [{ type: 'remove', activityId: activity.id }],
                        '사용자 일정 제거',
                      ),
                    );
                    if (ok) setDialog(null);
                  }
                : undefined
            }
          />
        </Modal>
      ) : null}
    </>
  );
}

function TimeRange({ row }: { row: { start: string; end: string; timeZone: string } }) {
  const start = localInput(row.start, row.timeZone);
  const end = localInput(row.end, row.timeZone);
  return (
    <>
      {start.slice(11)} – {end.slice(11)}
      {start.slice(0, 10) !== end.slice(0, 10) ? <small>{end.slice(0, 10)} 종료</small> : null}
    </>
  );
}
type RowInput = Omit<Activity, 'id' | 'sourceRef'>;
function ActivityForm({
  trip,
  date,
  dialog,
  busy,
  onSave,
  onDelete,
}: {
  trip: Trip;
  date: string;
  dialog: DialogKind;
  busy: boolean;
  onSave: (row: RowInput, reason: string, outcome?: 'visited' | 'skipped') => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const base = dialog.kind === 'activity' ? dialog.activity : (dialog.actual ?? dialog.activity);
  const timeZone = base?.timeZone ?? trip.timeZone;
  const [formError, setFormError] = useState('');
  const [zone, setZone] = useState(timeZone);
  const [removing, setRemoving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const data = new FormData(event.currentTarget);
    try {
      await onSave(
        {
          title: String(data.get('title')),
          start: fromLocal(String(data.get('start')), zone),
          end: fromLocal(String(data.get('end')), zone),
          timeZone: zone,
          note: String(data.get('note')),
          placeId: base?.placeId,
        },
        String(data.get('reason') ?? ''),
        dialog.kind === 'actual' ? (data.get('outcome') === 'skipped' ? 'skipped' : 'visited') : undefined,
      );
    } catch (e) {
      setFormError(describeError(e));
    }
  }
  return (
    <form onSubmit={submit}>
      {dialog.kind === 'actual' ? (
        <p className="notice">
          {dialog.outcome === 'skipped'
            ? '방문하지 못한 시각과 이유를 기록합니다.'
            : '실제 방문 시각을 확인해 주세요. 기본값은 계획 시각입니다.'}{' '}
          현재 계획은 바뀌지 않습니다.
        </p>
      ) : null}
      <label>
        활동 이름
        <input name="title" defaultValue={base?.title ?? ''} maxLength={120} required autoFocus />
      </label>
      {dialog.kind === 'actual' ? (
        <label>
          실행 결과
          <select name="outcome" aria-label="실행 결과" defaultValue={dialog.outcome}>
            <option value="visited">방문함</option>
            <option value="skipped">건너뜀</option>
          </select>
        </label>
      ) : null}
      <div className="form-grid">
        <label>
          {dialog.kind === 'actual' ? '실제 시작' : '시작 시각'}
          <input
            type="datetime-local"
            name="start"
            required
            defaultValue={base ? localInput(base.start, timeZone) : `${date}T09:00`}
          />
        </label>
        <label>
          {dialog.kind === 'actual' ? '실제 종료' : '종료 시각'}
          <input
            type="datetime-local"
            name="end"
            required
            defaultValue={base ? localInput(base.end, timeZone) : `${date}T10:00`}
          />
        </label>
      </div>
      <label>
        활동 시간대
        <input value={zone} onChange={(e) => setZone(e.target.value)} required list="time-zones" />
      </label>
      <TimeZones />
      <p className="muted">시간대를 바꾸면 입력한 현지 시각을 새 시간대로 해석합니다.</p>
      <label>
        메모
        <textarea
          aria-label="메모"
          name="note"
          rows={3}
          defaultValue={dialog.kind === 'actual' && !dialog.actual ? '' : (base?.note ?? '')}
          maxLength={5000}
        />
      </label>
      {dialog.kind === 'activity' ? (
        <label>
          변경 이유
          <input
            name="reason"
            defaultValue={dialog.activity ? '사용자 일정 수정' : '사용자 일정 추가'}
            required
            maxLength={2000}
          />
        </label>
      ) : null}
      {formError ? (
        <p role="alert" className="error">
          {formError}
        </p>
      ) : null}
      <div className="button-row">
        <button className="primary" type="submit" disabled={busy}>
          {dialog.kind === 'activity' ? '일정 저장' : '실제 기록 저장'}
        </button>
        {onDelete ? (
          <button type="button" className="danger" disabled={busy} onClick={() => setRemoving(true)}>
            일정 제거
          </button>
        ) : null}
      </div>
      {removing ? (
        <div className="notice">
          <p>현재 계획에서 제거할까요? 과거 계획과 실제 기록은 보존됩니다.</p>
          <div className="button-row">
            <button type="button" className="danger" disabled={busy} onClick={onDelete}>
              확인하고 제거
            </button>
            <button type="button" onClick={() => setRemoving(false)}>
              돌아가기
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function EvidenceList({ evidence }: { evidence: Trip['versions'][number]['evidence'] }) {
  return evidence.length ? (
    <ul className="evidence-list">
      {evidence.map((e) => (
        <li key={e.id}>
          <strong>{e.status === 'verified' ? '확인된 근거' : '미확인 근거'}</strong>
          <p>{e.claim}</p>
          {/^https?:\/\//.test(e.source) ? (
            <a href={e.source} target="_blank" rel="noreferrer noopener">
              {e.source}
            </a>
          ) : (
            <p>{e.source}</p>
          )}
          <small>
            확인 시각 {e.checkedAt} · 적용 {e.appliesFrom} – {e.appliesTo}
          </small>
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">별도 조사 근거 없음 · 사용자 입력에 따른 변경</p>
  );
}
function ProposalPanel({
  trip,
  run,
  busy,
  openFile,
}: {
  trip: Trip;
  run: Action;
  busy: boolean;
  openFile: () => void;
}) {
  return (
    <section className="proposals">
      <div className="section-heading">
        <h2>변경안을 검토하세요</h2>
        <button onClick={openFile} disabled={busy}>
          변경안 가져오기
        </button>
      </div>
      <p className="muted">적용 전에는 현재 계획이 바뀌지 않습니다. 실제 기록은 변경 대상에서 제외됩니다.</p>
      <AiPlanner trip={trip} />
      <details>
        <summary>외부 AI와 JSON 파일로 작업하기</summary>
        <button onClick={() => downloadJson('travel-app-context.json', aiContext(trip))}>AI 컨텍스트 내보내기</button>
      </details>
      {!trip.proposals.length ? (
        <div className="empty-list">
          <h3>아직 변경안이 없어요</h3>
          <p>조사 근거와 이유를 포함한 변경안을 가져오면 여기에서 비교할 수 있습니다.</p>
        </div>
      ) : null}
      {trip.proposals.toReversed().map((p) => (
        <article className="proposal" key={p.id}>
          <div className="section-heading">
            <h3>{p.reason}</h3>
            <span>{p.status === 'pending' ? '결정 대기' : p.status === 'applied' ? '적용됨' : '거절됨'}</span>
          </div>
          <p>
            기준 revision {p.baseRevision} · 현재 {trip.revision}
          </p>
          <p>
            <strong>예약 영향</strong> · {p.reservationImpact}
          </p>
          {p.baseRevision !== trip.revision && p.status === 'pending' ? (
            <p className="error">
              충돌 · 변경안 작성 뒤 여행 데이터가 바뀌었습니다. 최신 컨텍스트로 새 변경안을 작성하세요.
            </p>
          ) : null}
          <ul className="changes-list">
            {p.operations.map((op) => {
              const previous = trip.versions
                .find((v) => v.number === p.basePlanNumber)
                ?.activities.find((a) => a.id === (op.type === 'remove' ? op.activityId : op.activity.id));
              return (
                <li key={op.type === 'remove' ? op.activityId : op.activity.id}>
                  {op.type === 'remove' ? (
                    <>
                      <strong>제거</strong> {previous?.title ?? op.activityId}
                      {previous ? (
                        <p>
                          {localInput(previous.start, previous.timeZone)} · {previous.timeZone}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <strong>{previous ? '수정' : '추가'}</strong> {op.activity.title}
                      {previous ? (
                        <p>
                          이전: {previous.title} · {localInput(previous.start, previous.timeZone)} –{' '}
                          {localInput(previous.end, previous.timeZone)} · {previous.timeZone}
                          <br />
                          {previous.note}
                        </p>
                      ) : null}
                      <p>
                        이후: {localInput(op.activity.start, op.activity.timeZone)} –{' '}
                        {localInput(op.activity.end, op.activity.timeZone)} · {op.activity.timeZone}
                        <br />
                        {op.activity.note}
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <EvidenceList evidence={p.evidence} />
          {p.status === 'pending' ? (
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || p.baseRevision !== trip.revision}
                onClick={() => run(() => repository.decide(trip.id, p.id, 'apply'))}
              >
                확인하고 적용
              </button>
              <button disabled={busy} onClick={() => run(() => repository.decide(trip.id, p.id, 'reject'))}>
                거절
              </button>
            </div>
          ) : (
            <p className="muted">사용자 결정 · {p.decidedAt}</p>
          )}
        </article>
      ))}
    </section>
  );
}
