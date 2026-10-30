import { lazy, Suspense, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Temporal } from '@js-temporal/polyfill';
import { repository, ContentRepository } from '../repository';
import { readPackage } from '../transfer/package';
import type { Review } from '../transfer/reimport';
import type { ContentRevision, FieldRecord, PlanVersion, RevisionRef, TimeSpec, TripDataset } from '../contracts/v2';
import { GuideDetail } from './Guide';
import { buildNewTrip } from './trip-factory';
import { isProblem, stayRange } from '../plan/manual-stays';
import { PlaceAuthoring, RegionAuthoring } from './Authoring';
import { GuideAuthoring } from './GuideAuthoring';
import { isReadingGuide } from './guide-rules';
import { LegEditor, StayEditor, type LegEditorState, type StayEditorState } from './StayLegEditors';
import { DayDetails } from './DayDetails';
import {
  clockLabel,
  DayLead,
  DayStrip,
  GuideCard,
  JourneyIcon,
  journeyTabs,
  MapLink,
  ScheduleOverview,
} from './Journey';
import { reviewWorkspace, workspaceUrl } from '../storage/workspace-name';
import { Retrospective } from './Retrospective';
import { retrospectiveDates, UNKNOWN_DATE } from './retro-rules';
import { ActualEditor, ActualTimeline, TimeEditor, type RecordDraft, type RecordEditor } from './Field';
import { notesForTarget, SavedNotes } from './Notes';
import { ProposalPanel, ReimportReview } from './Workflows';
import { command, errorText, ErrorText, Modal, timeLabel } from './ui';
import './content.css';
import './journey.css';
import { appAssetUrl } from '../hosting';
const repo = new ContentRepository(repository.db);
const Recovery = lazy(() => import('./Recovery'));
type Target = { kind: ContentRevision['kind']; id: string };
const tabs = [
  '일정',
  '전체 일정',
  '장소·지역',
  '지도',
  '예약·할 일',
  '준비·회화',
  '실제 기록',
  '변경안',
  '가져오기 기록',
] as const;
type Tab = (typeof tabs)[number];
export function ContentApp() {
  const [recovery, setRecovery] = useState(false);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [selected, setSelected] = useState(''),
    [tab, setTab] = useState<Tab>('일정'),
    [target, setTarget] = useState<Target | null>(null),
    [recordContext, setRecordContext] = useState<RevisionRef[] | undefined>(),
    [planId, setPlanId] = useState(''),
    [dayId, setDayId] = useState(''),
    [search, setSearch] = useState(''),
    [online, setOnline] = useState(navigator.onLine),
    [busy, setBusy] = useState(false),
    [sample, setSample] = useState(false),
    [newTrip, setNewTrip] = useState(false),
    [authoring, setAuthoring] = useState<'region' | 'place' | 'guide' | null>(null),
    [stayEditor, setStayEditor] = useState<StayEditorState | null>(null),
    [legEditor, setLegEditor] = useState<LegEditorState | null>(null);
  const [backTrail, setBackTrail] = useState<{ tab: Tab; target: Target | null; context?: RevisionRef[] }[]>([]);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof readPackage>> | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [legacy, setLegacy] = useState<Awaited<ReturnType<ContentRepository['prepareLegacy']>> | null>(null),
    [actualEditor, setActualEditor] = useState<RecordEditor | null>(null),
    [placeDraft, setPlaceDraft] = useState<RecordDraft | null>(null),
    [retroOpen, setRetroOpen] = useState(false),
    [retroDate, setRetroDate] = useState(''),
    [retroPlanId, setRetroPlanId] = useState(''),
    [planEditor, setPlanEditor] = useState<{
      header: TripDataset['header'];
      plan: PlanVersion;
      item?: PlanVersion['items'][number];
    } | null>(null),
    [noteTarget, setNoteTarget] = useState<{
      header: TripDataset['header'];
      label: string;
      ref: {
        tripId: string;
        targetKind: 'trip' | 'activity' | 'place' | 'booking';
        entityId: string;
        planVersionId?: string;
      };
    } | null>(null);
  useEffect(() => {
    let live = true;
    repo
      .init()
      .then(() => {
        if (live) {
          setReady(true);
        }
      })
      .catch((e) => setError(errorText(e)));
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      live = false;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const meta = useLiveQuery(() => (ready ? repo.meta() : undefined), [ready]),
    // 목록이 읽히기 전(undefined)에는 여행 보관함을 그리지 않는다. 열린 채 나타났다 닫히는 깜박임(과 시험 경쟁)을 막는다.
    loadedHeaders = useLiveQuery(() => (ready ? repo.list() : undefined), [ready]),
    headers = loadedHeaders ?? [];
  const tripId = selected || headers[0]?.tripId,
    header = headers.find((h) => h.tripId === tripId),
    currentPlanId = planId || header?.currentPlanVersionId;
  const plan = useLiveQuery(
    () => (tripId && currentPlanId ? repo.plan(tripId, currentPlanId) : undefined),
    [tripId, currentPlanId],
  );
  const catalog = useLiveQuery(
    async () => {
      if (!tripId) {
        return [];
      }
      return (
        await Promise.all(
          (['place', 'region', 'booking', 'task', 'phrase-book', 'map-target'] as const).map((k) =>
            repo.catalog(tripId, k),
          ),
        )
      ).flat();
    },
    [tripId],
    [] as ContentRevision[],
  );
  const activePlaces = catalog.filter((c): c is Extract<ContentRevision, { kind: 'place' }> => c.kind === 'place');
  const guides = useLiveQuery(
    () => (tripId && tab === '준비·회화' ? repo.catalog(tripId, 'guide') : []),
    [tripId, tab],
    [] as ContentRevision[],
  );
  const records = useLiveQuery(() => (tripId ? repo.timeline(tripId) : []), [tripId], [] as FieldRecord[]),
    proposals = useLiveQuery(
      () => (tripId ? repo.proposals(tripId) : []),
      [tripId],
      [] as import('../contracts/v2').Proposal[],
    ),
    history = useLiveQuery(() => (tripId ? repo.history(tripId) : []), [tripId], []),
    imports = useLiveQuery(
      () => (tripId && tab === '가져오기 기록' ? repo.importHistory(tripId) : []),
      [tripId, tab],
      [],
    );
  // 회고는 저장소를 읽기만 한다. 회고를 열었을 때만 전체 여행 데이터를 읽는다.
  const retroTrip = useLiveQuery(
    () => (tripId && tab === '실제 기록' && retroOpen ? repo.get(tripId) : undefined),
    [tripId, tab, retroOpen, records, history],
  );
  // 기록에 연결한 장소 이름은 기록 당시 고정한 revision에서 읽는다(현재 이름과 다를 수 있다).
  const recordedPlaces = useLiveQuery(
    async () => {
      const names = new Map<string, string>();
      for (const row of records) {
        if (row.kind !== 'actual' || !row.payload.placeRef) {
          continue;
        }
        const placeId = row.payload.placeRef.entityId;
        const pinned = row.payload.contextRefs.find((ref) => ref.targetKind === 'place' && ref.entityId === placeId);
        const place = await repo.content(row.tripId, 'place', placeId, pinned?.revisionId);
        if (place?.kind === 'place') {
          names.set(row.recordId, place.payload.name);
        }
      }
      return names;
    },
    [records],
    new Map<string, string>(),
  );
  const activeDay = plan?.days.find((d) => d.dayId === dayId) ?? plan?.days[0],
    historical = Boolean(planId),
    context = recordContext ?? (historical ? plan?.contextRefs : undefined);
  const dayItems =
    plan?.items.filter((item) => item.dayId === activeDay?.dayId).toSorted((a, b) => a.order - b.order) ?? [];
  const regionName = (regionId: string) => {
    const region = catalog.find((c) => c.kind === 'region' && c.entityId === regionId);
    return region?.kind === 'region' ? region.payload.name : regionId;
  };
  /** 선택한 회고 날짜. 목록에 없으면(다른 여행 등) 실제 기록이 있는 첫 날짜, 없으면 여행 시작일. */
  function retroDateFor(trip: NonNullable<typeof retroTrip>) {
    const { dates, hasUnknown } = retrospectiveDates(trip);
    if (retroDate === UNKNOWN_DATE ? hasUnknown : dates.includes(retroDate)) {
      return retroDate;
    }
    const withRecords = trip.records.flatMap((r) =>
      r.kind === 'actual' && r.payload.time.start.date ? [r.payload.time.start.date] : [],
    );
    return withRecords.toSorted()[0] ?? dates[0] ?? trip.header.startDate;
  }
  function openTab(next: Tab) {
    setTab(next);
    setTarget(null);
    setRecordContext(undefined);
    setBackTrail([]);
    setRetroOpen(false);
    window.scrollTo(0, 0);
  }
  function openDay(id: string) {
    openTab('일정');
    setDayId(id);
  }
  async function action(fn: () => Promise<unknown>, message = '저장했습니다.') {
    setError('');
    setBusy(true);
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  /** 같은 날 이웃 항목과 순서를 맞바꾼다. 새 계획 버전 하나로 저장하며 이전 버전은 그대로다. */
  async function moveItem(item: PlanVersion['items'][number], offset: -1 | 1) {
    const neighbor = dayItems[dayItems.findIndex((i) => i.activityId === item.activityId) + offset];
    if (!plan || !header || !neighbor) {
      return;
    }
    await action(
      () =>
        repo.execute(
          command(
            header.tripId,
            'ChangePlan',
            {
              currentPlanVersionId: plan.planVersionId,
              operations: [
                { type: 'upsert-item', item: { ...item, order: neighbor.order } },
                { type: 'upsert-item', item: { ...neighbor, order: item.order } },
              ],
              reason: '사용자가 일정 순서 변경',
            },
            header.domainRevision,
          ),
        ),
      '일정 순서를 바꿨습니다.',
    );
  }
  function select(id: string) {
    setSelected(id);
    setTarget(null);
    setRecordContext(undefined);
    setPlanId('');
    setRetroOpen(false);
    setRetroDate('');
    setRetroPlanId('');
    setDayId('');
    setSearch('');
    setTab('일정');
    setBackTrail([]);
  }
  function navigate(kind: ContentRevision['kind'], id: string) {
    setBackTrail((trail) => [...trail, { tab, target, context: recordContext }]);
    setTarget({ kind, id });
    setTab('장소·지역');
    window.scrollTo(0, 0);
  }
  function goBack() {
    const previous = backTrail.at(-1);
    setBackTrail((trail) => trail.slice(0, -1));
    setTab(previous?.tab ?? '장소·지역');
    setTarget(previous?.target ?? null);
    setRecordContext(previous?.context);
    window.scrollTo(0, 0);
  }
  async function load(blob: Blob) {
    await action(async () => {
      setPreview(await readPackage(blob));
    }, '패키지를 확인했습니다. 추가 전에 내용을 검토하세요.');
  }
  async function record(
    outcome: RecordEditor['outcome'],
    item?: PlanVersion['items'][number],
    original?: Extract<FieldRecord, { kind: 'actual' }>,
    draft?: RecordDraft,
  ) {
    if (!header) {
      return;
    }
    await action(async () => {
      // 새 장소를 방금 저장했을 수 있으므로 기준 revision과 맥락은 저장소의 최신 값을 읽는다.
      const latest = (await repo.list()).find((row) => row.tripId === header.tripId) ?? header;
      const current = await repo.currentContext(header.tripId);
      setActualEditor({
        header: { ...latest },
        outcome,
        ...(plan ? { plan } : {}),
        ...(item ? { item } : {}),
        ...(original ? { original } : {}),
        ...(draft ? { draft } : {}),
        current,
        context: original?.payload.contextRefs ?? (item && plan ? plan.contextRefs : current),
      });
    }, '');
  }
  /**
   * 기록 당시 연결된 장소를 당시 고정 revision으로 연다. 장소는 기록에 직접 연결했거나 기록한 계획 항목이 연결한 장소만 쓴다.
   * 맥락(contextRefs)에 우연히 들어 있는 다른 장소를 대신 열지 않는다.
   */
  async function openRecordedPlace(row: Extract<FieldRecord, { kind: 'actual' }>) {
    setError('');
    try {
      let placeId = row.payload.placeRef?.entityId;
      if (!placeId && row.payload.planVersionId && row.payload.activityId) {
        const linked = await repo.plan(row.tripId, row.payload.planVersionId);
        placeId = linked?.items.find((item) => item.activityId === row.payload.activityId)?.placeLinks[0]?.placeId;
      }
      if (!placeId) {
        setNotice('이 기록에는 연결된 장소 본문이 없습니다.');
        return;
      }
      setRecordContext(row.payload.contextRefs);
      navigate('place', placeId);
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function toggleTask(task: Extract<ContentRevision, { kind: 'task' }>) {
    if (!header) {
      return;
    }
    const states = records
      .filter(
        (r): r is Extract<FieldRecord, { kind: 'task-state' }> =>
          r.kind === 'task-state' &&
          r.payload.taskRef.entityId === task.entityId &&
          r.payload.taskRef.revisionId === task.revisionId,
      )
      .sort((a, b) => b.commitSeq - a.commitSeq);
    const previous = states[0];
    await action(async () => {
      await repo.execute(
        command(
          header.tripId,
          'SetTaskState',
          {
            record: {
              tripId: header.tripId,
              recordId: crypto.randomUUID(),
              kind: 'task-state',
              sourceRefs: [],
              ...(previous ? { supersedes: previous.recordId } : {}),
              payload: {
                taskRef: {
                  tripId: header.tripId,
                  targetKind: 'task',
                  entityId: task.entityId,
                  revisionId: task.revisionId,
                },
                meaningFingerprint: task.payload.meaningFingerprint,
                completed: !previous?.payload.completed,
                contextRefs: await repo.currentContext(header.tripId),
              },
            },
          },
          header.domainRevision,
        ),
      );
    });
  }
  if (!ready && !error) {
    return (
      <main className="main">
        <p>여행 저장소를 여는 중입니다.</p>
      </main>
    );
  }
  return (
    <div className="content-app journey-layout">
      <header className="journey-topbar">
        <a className="brand" aria-label="여행 가이드 열기" href={workspaceUrl('content', location.search)}>
          travel-app
        </a>
        {header ? (
          <h1 className="journey-location">{header.name}</h1>
        ) : (
          <span className="journey-location">여행 가이드</span>
        )}
        <nav className="sidebar-tools" aria-label="저장소 도구">
          <button disabled={!ready} onClick={() => setRecovery(true)}>
            저장소·백업
          </button>
        </nav>
      </header>
      {loadedHeaders !== undefined ? (
        <details className="journey-library" open={!header}>
          <summary>여행 선택·가져오기</summary>
          {header ? (
            <p className="muted">
              {header.startDate} — {header.endDate} · 이 브라우저에 저장됨
            </p>
          ) : null}
          <nav className="trip-list" aria-label="여행 선택">
            {headers.map((h) => (
              <button
                className={`trip-item ${h.tripId === tripId ? 'selected' : ''}`}
                key={h.tripId}
                onClick={() => select(h.tripId)}
              >
                {h.name}
              </button>
            ))}
          </nav>
          <div className="sidebar-actions">
            <button onClick={() => setNewTrip(true)} disabled={meta?.mode !== 'v2'}>
              새 여행
            </button>
            <button onClick={() => setSample(true)} disabled={busy || meta?.mode !== 'v2'}>
              가상 여행 둘러보기
            </button>
          </div>
          <label className="file-picker">
            여행 패키지 선택
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={busy || meta?.mode !== 'v2'}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void load(file);
                }
                e.target.value = '';
              }}
            />
          </label>
          <a href={workspaceUrl('legacy', location.search)}>기존 일정 열기</a>
        </details>
      ) : null}
      <main className="main" id="content-main">
        {reviewWorkspace(location.search) ? (
          <p className="notice">검증용 저장소 · 평소 사용하는 여행 저장소와 분리되어 있습니다.</p>
        ) : null}
        <ErrorText error={error} />
        {notice ? (
          <p role="status" className="success">
            {notice}
            <button onClick={() => setNotice('')}>알림 닫기</button>
          </p>
        ) : null}
        {!online ? (
          <p role="status" className="offline">
            오프라인 · 저장된 가이드 조회와 현장 기록을 이용할 수 있습니다.
          </p>
        ) : null}
        {meta?.mode === 'legacy' ? (
          <section className="notice">
            <h1>기존 여행을 확인해 주세요</h1>
            <p>기존 원문을 보존한 채 새 가이드 저장소로 전환할 수 있습니다.</p>
            <button
              onClick={() =>
                void action(async () => setLegacy(await repo.prepareLegacy()), '전환 전 내용을 검토하세요.')
              }
            >
              기존 여행 전환 검토
            </button>
          </section>
        ) : !header ? (
          <section className="empty-start">
            <h1>어느 여행을 열까요?</h1>
            <p>여행 패키지를 선택하거나 가상 여행으로 가이드와 기록 흐름을 둘러보세요.</p>
          </section>
        ) : (
          <>
            <details className="journey-extras">
              <summary>예약·기록·계획 도구</summary>
              <nav className="journey-tools" aria-label="여행 도구">
                {(['예약·할 일', '실제 기록', '변경안'] as const).map((t) => (
                  <button aria-pressed={tab === t} key={t} onClick={() => openTab(t)}>
                    {t}
                  </button>
                ))}
              </nav>
              <details className="journey-settings">
                <summary>계획 버전·이행 점검</summary>
                <div className="version-controls">
                  <label>
                    계획 버전
                    <select
                      value={planId}
                      onChange={(e) => {
                        setPlanId(e.target.value);
                        setTarget(null);
                        setRecordContext(undefined);
                        setDayId('');
                        setBackTrail([]);
                      }}
                    >
                      <option value="">현재 계획</option>
                      {history
                        .toSorted((a, b) => b.number - a.number)
                        .map((p) => (
                          <option key={p.planVersionId} value={p.planVersionId}>
                            계획 {p.number} · {p.reason}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button onClick={() => openTab('가져오기 기록')}>가져오기 기록</button>
                  <span className="muted">revision {header.domainRevision}</span>
                </div>
              </details>
            </details>
            {historical ? <p className="notice">과거 계획 · 당시 콘텐츠를 고정해 조회합니다.</p> : null}
            {tab === '전체 일정' && plan ? (
              <ScheduleOverview plan={plan} onSelect={openDay} regionName={regionName} />
            ) : null}
            {tab === '일정' && plan ? (
              <section className="day-page">
                <DayStrip plan={plan} dayId={activeDay?.dayId} onSelect={openDay} />
                {activeDay ? (
                  <DayLead day={activeDay} items={dayItems} catalog={catalog} onNavigate={navigate} />
                ) : null}
                <div className="day-toolbar">
                  <label>
                    날짜
                    <select aria-label="날짜" value={activeDay?.dayId ?? ''} onChange={(e) => setDayId(e.target.value)}>
                      {plan.days.map((d) => (
                        <option key={d.dayId} value={d.dayId}>
                          {d.date} · {d.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="button-row">
                    <button onClick={() => void record('unplanned')}>예정 외 활동 기록</button>
                    <button disabled={historical} onClick={() => setPlanEditor({ header: { ...header }, plan })}>
                      활동 추가
                    </button>
                  </div>
                </div>
                <div className="day-timeline">
                  {dayItems.map((i) => (
                    <article className="content-row timeline-stop" key={i.activityId}>
                      <p className="timeline-time" title={timeLabel(i.time.start)}>
                        {clockLabel(i.time.start)}
                        {i.time.end ? ` ~ ${clockLabel(i.time.end)}` : ''}
                      </p>
                      <h3>{i.title}</h3>
                      <p>{i.summary}</p>
                      {i.menuText ? <p>식사·메뉴: {i.menuText}</p> : null}
                      {i.reservationText ? <p>예약 안내: {i.reservationText}</p> : null}
                      {i.executionNote ? <p>{i.executionNote}</p> : null}
                      {i.executionMarkers.map((marker, index) => (
                        <p key={index} className="muted">
                          {marker.label} · {marker.detail}
                        </p>
                      ))}
                      {i.optional ? <p className="muted">선택 활동</p> : null}
                      {i.officialUrl ? (
                        <a href={i.officialUrl} target="_blank" rel="noreferrer">
                          공식 안내
                        </a>
                      ) : null}
                      <div className="button-row">
                        <MapLink
                          target={catalog.find(
                            (content) => content.kind === 'map-target' && content.entityId === i.mapTargetId,
                          )}
                        />
                        {i.placeLinks.map((l) => (
                          <button key={`${l.placeId}-${l.relation}`} onClick={() => navigate('place', l.placeId)}>
                            장소 안내 ·{' '}
                            {catalog.find(
                              (c): c is Extract<ContentRevision, { kind: 'place' }> =>
                                c.kind === 'place' && c.entityId === l.placeId,
                            )?.payload.name ?? l.placeId}
                          </button>
                        ))}
                        <button onClick={() => void record('visited', i)}>방문 기록</button>
                        <button onClick={() => void record('skipped', i)}>건너뜀 기록</button>
                        <button
                          disabled={historical}
                          onClick={() => setPlanEditor({ header: { ...header }, plan, item: i })}
                        >
                          일정 수정
                        </button>
                        <button
                          aria-label={`${i.title} 위로`}
                          disabled={historical || busy || i.activityId === dayItems[0]?.activityId}
                          onClick={() => void moveItem(i, -1)}
                        >
                          위로
                        </button>
                        <button
                          aria-label={`${i.title} 아래로`}
                          disabled={historical || busy || i.activityId === dayItems.at(-1)?.activityId}
                          onClick={() => void moveItem(i, 1)}
                        >
                          아래로
                        </button>
                        <button
                          disabled={historical || busy}
                          onClick={() =>
                            void action(() =>
                              repo.execute(
                                command(
                                  header.tripId,
                                  'ChangePlan',
                                  {
                                    currentPlanVersionId: plan.planVersionId,
                                    operations: [{ type: 'remove-item', activityId: i.activityId }],
                                    reason: '사용자가 활동을 일정에서 제거',
                                  },
                                  header.domainRevision,
                                ),
                              ),
                            )
                          }
                        >
                          일정에서 제거
                        </button>
                        <button
                          onClick={() =>
                            setNoteTarget({
                              header: { ...header },
                              label: i.title,
                              ref: {
                                tripId: header.tripId,
                                targetKind: 'activity',
                                entityId: i.activityId,
                                planVersionId: plan.planVersionId,
                              },
                            })
                          }
                        >
                          메모
                        </button>
                      </div>
                      {plan.legs.some(
                        (leg) => leg.fromActivityId === i.activityId || leg.toActivityId === i.activityId,
                      ) ? (
                        <p className="muted">
                          연결된 이동{' '}
                          {
                            plan.legs.filter(
                              (leg) => leg.fromActivityId === i.activityId || leg.toActivityId === i.activityId,
                            ).length
                          }
                          개 — 이 활동을 제거하거나 다른 날로 옮기면 함께 제거됩니다.
                        </p>
                      ) : null}
                      <SavedNotes
                        notes={notesForTarget(records, {
                          tripId: header.tripId,
                          targetKind: 'activity',
                          entityId: i.activityId,
                        })}
                      />
                      {plan.legs
                        .filter((leg) => leg.dayId === activeDay?.dayId && leg.fromActivityId === i.activityId)
                        .map((leg) => (
                          <div className="timeline-leg" key={leg.legId}>
                            <p>
                              {i.title} → {plan.items.find((item) => item.activityId === leg.toActivityId)?.title}
                            </p>
                            <p className="muted">
                              {[leg.mode, leg.durationText, leg.distanceText, leg.lineText].filter(Boolean).join(' · ')}
                            </p>
                            <MapLink
                              target={catalog.find(
                                (content) => content.kind === 'map-target' && content.entityId === leg.mapTargetId,
                              )}
                            />
                          </div>
                        ))}
                    </article>
                  ))}
                </div>
                {activeDay ? <DayDetails repo={repo} day={activeDay} context={context} onNavigate={navigate} /> : null}
                {plan.stays
                  .filter(
                    (stay) =>
                      !activeDay ||
                      (stay.time.start.date &&
                        stay.time.start.date <= activeDay.date &&
                        (!stay.time.end?.date || activeDay.date < stay.time.end.date)),
                  )
                  .map((s) => (
                    <p key={s.stayId}>
                      숙박: {s.baseText} · {timeLabel(s.time.start)}
                    </p>
                  ))}
                {activeDay ? (
                  <section className="stay-leg-editing" aria-label="지역·숙박·이동">
                    <h3 className="editorial-heading">지역·숙박·이동</h3>
                    <p className="muted">
                      하루 지역 {activeDay.regionIds.map((id) => regionName(id)).join(', ') || '없음'} · 밤을 보내는
                      지역 {activeDay.overnightRegionId ? regionName(activeDay.overnightRegionId) : '없음'}
                    </p>
                    <div className="button-row">
                      <button
                        disabled={historical}
                        onClick={() => setStayEditor({ header: { ...header }, plan, date: activeDay.date })}
                      >
                        숙박 추가
                      </button>
                      <button
                        disabled={historical || dayItems.length < 2}
                        onClick={() => setLegEditor({ header: { ...header }, plan, dayId: activeDay.dayId })}
                      >
                        이동 추가
                      </button>
                    </div>
                    {plan.stays
                      .filter((stay) => {
                        const range = stayRange(stay);
                        return !isProblem(range) && range.checkin <= activeDay.date && activeDay.date <= range.checkout;
                      })
                      .map((stay) => (
                        <p key={stay.stayId} className="content-row">
                          {stay.baseText} · {stay.time.start.date} ~ {stay.time.end?.date}
                          {stay.regionId ? ` · ${regionName(stay.regionId)}` : ''}{' '}
                          <button
                            aria-label={`${stay.baseText} 수정`}
                            disabled={historical}
                            onClick={() => setStayEditor({ header: { ...header }, plan, stay })}
                          >
                            수정
                          </button>
                        </p>
                      ))}
                    {plan.legs
                      .filter((leg) => leg.dayId === activeDay.dayId)
                      .map((leg) => {
                        const label = `${plan.items.find((item) => item.activityId === leg.fromActivityId)?.title} → ${plan.items.find((item) => item.activityId === leg.toActivityId)?.title}`;
                        return (
                          <p key={leg.legId} className="content-row">
                            이동 {label} · {leg.mode}
                            {leg.durationText ? ` · ${leg.durationText}` : ''}{' '}
                            <button
                              aria-label={`이동 ${label} 수정`}
                              disabled={historical}
                              onClick={() => setLegEditor({ header: { ...header }, plan, dayId: activeDay.dayId, leg })}
                            >
                              수정
                            </button>
                          </p>
                        );
                      })}
                  </section>
                ) : null}
              </section>
            ) : null}
            {tab === '장소·지역' ? (
              target ? (
                <>
                  <button onClick={goBack}>
                    {backTrail.at(-1)?.tab === '일정'
                      ? '일정으로 돌아가기'
                      : backTrail.at(-1)?.tab === '실제 기록'
                        ? '실제 기록으로 돌아가기'
                        : backTrail.at(-1)?.target
                          ? '이전 안내로'
                          : '목록으로'}
                  </button>
                  <GuideDetail
                    key={`${header.tripId}-${target.kind}-${target.id}`}
                    repo={repo}
                    header={header}
                    target={target}
                    context={context}
                    regions={catalog.filter(
                      (c): c is Extract<ContentRevision, { kind: 'region' }> => c.kind === 'region',
                    )}
                    onNavigate={navigate}
                    onSaved={(message) => setNotice(message ?? '본문을 저장했습니다.')}
                  />
                </>
              ) : (
                <section>
                  <h2>가이드</h2>
                  <div className="button-row">
                    <button disabled={historical} onClick={() => setAuthoring('region')}>
                      지역 작성
                    </button>
                    <button disabled={historical} onClick={() => setAuthoring('place')}>
                      장소 작성
                    </button>
                  </div>
                  {catalog.every((c) => c.kind !== 'place' && c.kind !== 'region') ? (
                    <p className="notice">아직 지역이나 장소가 없습니다. 위 버튼으로 첫 장소를 작성해 보세요.</p>
                  ) : null}
                  <label>
                    이름·지역 검색
                    <input value={search} onChange={(e) => setSearch(e.target.value)} />
                  </label>
                  <div className="journey-grid">
                    {catalog
                      .filter(
                        (c): c is Extract<ContentRevision, { kind: 'place' | 'region' }> =>
                          c.kind === 'place' || c.kind === 'region',
                      )
                      .toSorted((a, b) => Number(b.kind === 'region') - Number(a.kind === 'region'))
                      .filter((c) =>
                        `${c.payload.name} ${
                          c.kind === 'place'
                            ? c.payload.regionIds
                                .map((id) => {
                                  const r = catalog.find((r) => r.kind === 'region' && r.entityId === id);
                                  return r?.kind === 'region' ? r.payload.name : '';
                                })
                                .join(' ')
                            : ''
                        }`.includes(search),
                      )
                      .map((c) => (
                        <GuideCard
                          key={`${c.kind}-${c.entityId}`}
                          repo={repo}
                          content={c}
                          context={context}
                          onOpen={() => navigate(c.kind, c.entityId)}
                        />
                      ))}
                  </div>
                </section>
              )
            ) : null}
            {tab === '예약·할 일' || tab === '지도' ? (
              <section>
                {tab === '예약·할 일' ? (
                  <>
                    <h2>예약·할 일</h2>
                    {catalog
                      .filter((c): c is Extract<ContentRevision, { kind: 'booking' }> => c.kind === 'booking')
                      .map((b) => (
                        <Booking
                          key={b.entityId}
                          repo={repo}
                          header={header}
                          booking={b}
                          onSaved={() => setNotice('예약 상태를 저장했습니다.')}
                        />
                      ))}
                    <h3>실행 작업</h3>
                    {catalog
                      .filter((c): c is Extract<ContentRevision, { kind: 'task' }> => c.kind === 'task')
                      .map((task) => {
                        const state = records
                          .filter(
                            (r): r is Extract<FieldRecord, { kind: 'task-state' }> =>
                              r.kind === 'task-state' &&
                              r.payload.taskRef.entityId === task.entityId &&
                              r.payload.taskRef.revisionId === task.revisionId,
                          )
                          .toSorted((a, b) => b.commitSeq - a.commitSeq)[0];
                        return (
                          <article className="content-row" key={task.entityId}>
                            <h4>{task.payload.label}</h4>
                            <p>{task.payload.detail}</p>
                            <button
                              disabled={busy}
                              aria-pressed={state?.payload.completed ?? false}
                              onClick={() => void toggleTask(task)}
                            >
                              {state?.payload.completed ? '완료 취소' : '작업 완료'}
                            </button>
                          </article>
                        );
                      })}
                  </>
                ) : null}
                <h2>{tab === '지도' ? '지도·동선' : '지도·동선 링크'}</h2>
                <p className="muted">장소·이동 경로를 외부 지도에서 엽니다. 지도 연결에는 인터넷이 필요합니다.</p>
                {catalog
                  .filter((c): c is Extract<ContentRevision, { kind: 'map-target' }> => c.kind === 'map-target')
                  .map((m) => (
                    <p key={m.entityId}>
                      {m.payload.label} ·{' '}
                      {m.payload.mapKind === 'place' ? (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.payload.query)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          외부 지도 열기
                        </a>
                      ) : m.payload.mapKind === 'route' ? (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(m.payload.routeOrigin)}&destination=${encodeURIComponent(m.payload.routeDestination)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          외부 동선 열기
                        </a>
                      ) : (
                        '지도 대상 아님'
                      )}
                    </p>
                  ))}
              </section>
            ) : null}
            {tab === '준비·회화' ? (
              <section>
                <h2>준비·회화</h2>
                <div className="button-row">
                  <button disabled={historical} onClick={() => setAuthoring('guide')}>
                    여행 가이드 작성
                  </button>
                </div>
                <nav className="button-row preparation-links" aria-label="여행 자료">
                  {guides.filter(isReadingGuide).map((content) => (
                    <button key={content.entityId} onClick={() => navigate('guide', content.entityId)}>
                      {content.kind === 'guide' ? content.payload.title : content.entityId}
                    </button>
                  ))}
                </nav>
                {catalog
                  .filter((c): c is Extract<ContentRevision, { kind: 'phrase-book' }> => c.kind === 'phrase-book')
                  .map((c) => (
                    <section key={c.entityId}>
                      <h3>{c.payload.locale}</h3>
                      <p>{c.payload.note}</p>
                      {c.payload.phrases.map((p) => (
                        <article className="content-row" key={p.id}>
                          <h4>{p.text}</h4>
                          <p>
                            {p.translation} · {p.pronunciationHint}
                          </p>
                          <p>{p.usageNote}</p>
                        </article>
                      ))}
                    </section>
                  ))}
                <details className="source-inspection">
                  <summary>자료·원천 대조</summary>
                  {guides
                    .filter((c) => c.kind === 'guide' && c.payload.documentKind !== 'place-guide' && !isReadingGuide(c))
                    .map((c) => (
                      <button key={c.entityId} onClick={() => navigate('guide', c.entityId)}>
                        {c.kind === 'guide' ? c.payload.title : c.entityId}
                      </button>
                    ))}
                </details>
              </section>
            ) : null}
            {tab === '실제 기록' ? (
              <section>
                {retroOpen ? (
                  <>
                    <button onClick={() => setRetroOpen(false)}>실제 기록 목록으로</button>
                    {retroTrip && retroTrip.header.tripId === header.tripId ? (
                      <Retrospective
                        repo={repo}
                        trip={retroTrip}
                        date={retroDateFor(retroTrip)}
                        planVersionId={retroPlanId}
                        onDate={setRetroDate}
                        onPlanVersion={setRetroPlanId}
                        onOpenPlace={(r) => void openRecordedPlace(r)}
                        onOpenPlanPlace={(placeId, refs) => {
                          setRecordContext(refs);
                          navigate('place', placeId);
                        }}
                        onOpenEvidence={(ref) => {
                          setRecordContext([ref]);
                          navigate('evidence', ref.entityId);
                        }}
                      />
                    ) : (
                      <p>회고를 읽는 중입니다.</p>
                    )}
                  </>
                ) : (
                  <>
                    <button onClick={() => setRetroOpen(true)}>날짜별 회고 보기</button>
                    <button onClick={() => void record('unplanned')}>예정 외 활동 기록</button>
                    <button
                      onClick={() =>
                        setNoteTarget({
                          header: { ...header },
                          label: header.name,
                          ref: { tripId: header.tripId, targetKind: 'trip', entityId: header.tripId },
                        })
                      }
                    >
                      여행 메모 쓰기
                    </button>
                    <ActualTimeline
                      records={records}
                      placeNames={recordedPlaces}
                      onCorrect={(r) => void record(r.payload.outcome, undefined, r)}
                      onContext={(r) => void openRecordedPlace(r)}
                    />
                  </>
                )}
              </section>
            ) : null}
            {tab === '변경안' && plan ? (
              <ProposalPanel
                repo={repo}
                header={header}
                plan={plan}
                proposals={proposals}
                onSaved={() => setNotice('변경안 처리를 저장했습니다.')}
              />
            ) : null}
            {tab === '가져오기 기록' ? (
              <section>
                <h2>가져오기 기록</h2>
                <p>새 패키지의 여행 ID가 같으면 차이를 검토한 뒤 적용합니다.</p>
                {imports.map((p) => (
                  <article key={p.packageId} className="content-row">
                    <p>원본 계보: {p.lineageId}</p>
                    <p>패키지 {p.packageId}</p>
                    <details>
                      <summary>변환·손실 보고서</summary>
                      <pre>{JSON.stringify(p.report, null, 2)}</pre>
                    </details>
                  </article>
                ))}
              </section>
            ) : null}
          </>
        )}
      </main>
      {header ? (
        <nav className="journey-bottomnav" aria-label="주요 메뉴">
          {journeyTabs.map((item) => (
            <button
              key={item.tab}
              aria-current={tab === item.tab ? 'page' : undefined}
              onClick={() => openTab(item.tab)}
            >
              <JourneyIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
      {recovery ? (
        <Suspense fallback={<p role="status">저장소 도구를 여는 중입니다.</p>}>
          <Recovery repo={repo} tripId={tripId} onClose={() => setRecovery(false)} />
        </Suspense>
      ) : null}
      {sample ? (
        <Modal title="가상 여행 선택" onClose={() => setSample(false)}>
          <p>실제 여행 데이터가 없는 가상 표본입니다.</p>
          {[false, true].map((short) => (
            <button
              key={String(short)}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const r = await fetch(appAssetUrl(`pilot/fixture-${short ? 'b' : 'a'}.zip`));
                  if (!r.ok) {
                    throw new Error('가상 패키지를 읽을 수 없습니다.');
                  }
                  setPreview(await readPackage(await r.blob()));
                  setSample(false);
                }, '가져오기 미리보기를 확인하세요.')
              }
            >
              {short ? '가상 미술 여행 B · 1일' : '가상 산책 여행 A · 3일'}
            </button>
          ))}
        </Modal>
      ) : null}
      {preview ? (
        <Modal title="여행 패키지 미리보기" onClose={() => setPreview(null)}>
          <h3>{preview.dataset.header.name}</h3>
          <p>
            {
              preview.dataset.plans.find((p) => p.planVersionId === preview.dataset.header.currentPlanVersionId)?.days
                .length
            }
            일 · 콘텐츠 {preview.dataset.heads.length}개 · 첨부 {preview.assets.size}개
          </p>
          <p>검증된 파일·참조를 확인했습니다. 실제 원천의 표시·권리 검증과는 구분됩니다.</p>
          <ErrorText error={error} />
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void action(
                async () => {
                  const p = preview,
                    jobId = await repo.prepareImport(p.dataset, p.assets, p.provenance);
                  if (headers.some((h) => h.tripId === p.dataset.header.tripId)) {
                    setReview(await repo.reviewReimport(jobId));
                    setPreview(null);
                  } else {
                    await repo.execute(
                      command(p.dataset.header.tripId, 'ImportNewTrip', {
                        packageId: p.provenance.packageId,
                        packageDigest: p.provenance.packageDigest,
                      }),
                    );
                    setPreview(null);
                    select(p.dataset.header.tripId);
                  }
                },
                headers.some((h) => h.tripId === preview.dataset.header.tripId)
                  ? '차이 검토를 준비했습니다.'
                  : '여행을 추가했습니다.',
              )
            }
          >
            {headers.some((h) => h.tripId === preview.dataset.header.tripId) ? '재가져오기 차이 검토' : '여행에 추가'}
          </button>
        </Modal>
      ) : null}
      {review ? (
        <ReimportReview
          repo={repo}
          review={review}
          onClose={() => setReview(null)}
          onSaved={() => {
            setReview(null);
            setNotice('검토한 선택을 저장했습니다.');
          }}
        />
      ) : null}
      {legacy ? (
        <Modal title="기존 여행 전환 확인" onClose={() => setLegacy(null)}>
          <p>{legacy.originals.length}개 여행 · 원문과 과거 계획/실제 기록을 보존합니다.</p>
          {legacy.converted
            .flatMap((c) => c.warnings)
            .map((w, n) => (
              <p key={n}>{w}</p>
            ))}
          <ErrorText error={error} />
          <button
            disabled={busy}
            className="primary"
            onClick={() =>
              void action(async () => {
                await repo.activateLegacy(legacy);
                setLegacy(null);
              }, '기존 여행을 전환했습니다. 옛 화면은 읽기 전용입니다.')
            }
          >
            원문 보존 후 전환
          </button>
        </Modal>
      ) : null}
      {newTrip ? (
        <TripCreator
          repo={repo}
          onClose={() => setNewTrip(false)}
          onSaved={(id) => {
            setNewTrip(false);
            select(id);
            setNotice('여행을 만들었습니다.');
          }}
        />
      ) : null}
      {actualEditor ? (
        <ActualEditor
          repo={repo}
          editor={actualEditor}
          places={activePlaces}
          onClose={() => setActualEditor(null)}
          onNewPlace={(draft) => {
            setActualEditor(null);
            setPlaceDraft(draft);
            setAuthoring('place');
          }}
          onSaved={() => {
            setActualEditor(null);
            setNotice('실제 기록을 저장했습니다.');
          }}
        />
      ) : null}
      {authoring === 'region' && header ? (
        <RegionAuthoring
          repo={repo}
          header={{ ...header }}
          onClose={() => setAuthoring(null)}
          onSaved={(regionId) => {
            setAuthoring(null);
            setNotice('지역을 저장했습니다.');
            navigate('region', regionId);
          }}
        />
      ) : null}
      {authoring === 'place' && header ? (
        <PlaceAuthoring
          repo={repo}
          header={{ ...header }}
          regions={catalog.filter((c): c is Extract<ContentRevision, { kind: 'region' }> => c.kind === 'region')}
          onClose={() => {
            setAuthoring(null);
            if (placeDraft) {
              const draft = placeDraft;
              setPlaceDraft(null);
              void record(draft.outcome, undefined, undefined, draft);
            }
          }}
          onSaved={(placeId) => {
            setAuthoring(null);
            setNotice('장소와 설명을 저장했습니다.');
            if (placeDraft) {
              const draft = { ...placeDraft, placeId };
              setPlaceDraft(null);
              void record(draft.outcome, undefined, undefined, draft);
              return;
            }
            navigate('place', placeId);
          }}
        />
      ) : null}
      {authoring === 'guide' && header ? (
        <GuideAuthoring
          repo={repo}
          header={{ ...header }}
          onClose={() => setAuthoring(null)}
          onSaved={(guideId) => {
            setAuthoring(null);
            setNotice('여행 가이드를 저장했습니다.');
            navigate('guide', guideId);
          }}
        />
      ) : null}
      {stayEditor ? (
        <StayEditor
          repo={repo}
          editor={stayEditor}
          regions={catalog.filter((c): c is Extract<ContentRevision, { kind: 'region' }> => c.kind === 'region')}
          onClose={() => setStayEditor(null)}
          onSaved={(message) => {
            setStayEditor(null);
            setNotice(message);
          }}
        />
      ) : null}
      {legEditor ? (
        <LegEditor
          repo={repo}
          editor={legEditor}
          onClose={() => setLegEditor(null)}
          onSaved={(message) => {
            setLegEditor(null);
            setNotice(message);
          }}
        />
      ) : null}
      {planEditor ? (
        <PlanEditor
          repo={repo}
          places={catalog.filter((c): c is Extract<ContentRevision, { kind: 'place' }> => c.kind === 'place')}
          editor={planEditor}
          onClose={() => setPlanEditor(null)}
          onSaved={() => {
            setPlanEditor(null);
            setNotice('새 계획 버전을 저장했습니다.');
          }}
        />
      ) : null}
      {noteTarget ? (
        <NoteEditor
          repo={repo}
          target={noteTarget}
          records={records}
          onClose={() => setNoteTarget(null)}
          onSaved={() => {
            setNoteTarget(null);
            setNotice('메모를 저장했습니다.');
          }}
        />
      ) : null}
    </div>
  );
}
function Booking({
  repo,
  header,
  booking,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripDataset['header'];
  booking: Extract<ContentRevision, { kind: 'booking' }>;
  onSaved: () => void;
}) {
  const [edit, setEdit] = useState(false),
    [status, setStatus] = useState(booking.payload.status),
    [expected, setExpected] = useState({ domain: header.domainRevision, revision: booking.revisionId }),
    [error, setError] = useState('');
  return (
    <article className="content-row" data-booking-id={booking.entityId}>
      <h3>{booking.payload.title}</h3>
      <p className="muted">
        원천:{' '}
        {booking.sourceRefs
          .map(
            (ref) =>
              (({ python: '코드', xlsx: '통합문서', json: 'JSON' }) as Record<string, string>)[ref.sourceKind] ??
              ref.sourceKind,
          )
          .join(' · ')}
      </p>
      <details>
        <summary>예약 원천 위치</summary>
        {booking.sourceRefs.map((ref, index) => (
          <p key={index}>
            {ref.sourcePath} · {ref.locator}
          </p>
        ))}
      </details>
      <p>
        상태: {booking.payload.status} · 원천 표기: {booking.payload.sourceStatusRaw}
      </p>
      <p>
        {timeLabel(booking.payload.time.start)} · 다음 행동: {timeLabel(booking.payload.actionTiming)}
      </p>
      <p>{booking.payload.nextActionText}</p>
      {booking.payload.stageText ? <p>원천 단계: {booking.payload.stageText}</p> : null}
      <p>{booking.payload.passNote}</p>
      <p>대안: {booking.payload.planB}</p>
      <p>{booking.payload.note}</p>
      {booking.payload.privateDetails ? (
        <details>
          <summary>예약 번호·주소·보충 정보</summary>
          <p>{booking.payload.privateDetails.confirmationCode}</p>
          <p>{booking.payload.privateDetails.address}</p>
          <p>{booking.payload.privateDetails.note}</p>
        </details>
      ) : null}
      {booking.payload.officialUrl ? (
        <a href={booking.payload.officialUrl} target="_blank" rel="noreferrer">
          공식 예약 안내
        </a>
      ) : null}
      {edit ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const { commitSeq: _, recordedAt: _r, actor: _a, ...input } = booking;
              await repo.execute(
                command(
                  header.tripId,
                  'SetBookingState',
                  {
                    expectedRevisionId: expected.revision,
                    booking: {
                      ...input,
                      revisionId: crypto.randomUUID(),
                      previousRevisionId: expected.revision,
                      payload: { ...input.payload, status },
                    },
                  },
                  expected.domain,
                ),
              );
              setEdit(false);
              onSaved();
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          <label>
            새 예약 상태
            <input required value={status} onChange={(e) => setStatus(e.target.value)} />
          </label>
          <ErrorText error={error} />
          <button>예약 상태 저장</button>
          <button type="button" onClick={() => setEdit(false)}>
            취소
          </button>
        </form>
      ) : (
        <button
          onClick={() => {
            setExpected({ domain: header.domainRevision, revision: booking.revisionId });
            setStatus(booking.payload.status);
            setEdit(true);
          }}
        >
          예약 상태 수정
        </button>
      )}
    </article>
  );
}
function PlanEditor({
  repo,
  places,
  editor,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  places: Extract<ContentRevision, { kind: 'place' }>[];
  editor: { header: TripDataset['header']; plan: PlanVersion; item?: PlanVersion['items'][number] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(editor.item?.title ?? ''),
    [day, setDay] = useState(editor.item?.dayId ?? editor.plan.days[0]?.dayId ?? ''),
    [time, setTime] = useState<TimeSpec>(editor.item?.time.start ?? { precision: 'unspecified' }),
    [placeId, setPlaceId] = useState(editor.item?.placeLinks[0]?.placeId ?? ''),
    [error, setError] = useState('');
  const connectedLegs = editor.item
    ? editor.plan.legs.filter(
        (leg) => leg.fromActivityId === editor.item!.activityId || leg.toActivityId === editor.item!.activityId,
      ).length
    : 0;
  return (
    <Modal title={editor.item ? '일정 수정' : '활동 추가'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const base: PlanVersion['items'][number] = editor.item ?? {
              tripId: editor.header.tripId,
              planVersionId: editor.plan.planVersionId,
              activityId: crypto.randomUUID(),
              dayId: day,
              order: Math.max(-1, ...editor.plan.items.filter((i) => i.dayId === day).map((i) => i.order)) + 1,
              title,
              category: 'activity',
              time: { start: time },
              summary: '',
              optional: false,
              placeLinks: [],
              bookingIds: [],
              taskRefs: [],
              executionMarkers: [],
              sourceFlags: [],
            };
            const originalLinks = editor.item?.placeLinks ?? [];
            // 첫 장소 링크만 이 화면에서 바꾼다. 나머지 연결은 그대로 둔다.
            const placeLinks = placeId
              ? [{ placeId, relation: originalLinks[0]?.relation ?? ('visit' as const) }, ...originalLinks.slice(1)]
              : originalLinks.slice(1);
            const item = { ...base, dayId: day, title, time: { start: time }, placeLinks };
            if (editor.item && editor.item.dayId !== day) {
              item.order = Math.max(-1, ...editor.plan.items.filter((i) => i.dayId === day).map((i) => i.order)) + 1;
            }
            await repo.execute(
              command(
                editor.header.tripId,
                'ChangePlan',
                {
                  currentPlanVersionId: editor.plan.planVersionId,
                  operations: [{ type: 'upsert-item', item }],
                  reason: '사용자 일정 수정',
                },
                editor.header.domainRevision,
              ),
            );
            onSaved();
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <label>
          활동 제목
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          연결할 장소
          <select
            value={placeId}
            onChange={(e) => {
              setPlaceId(e.target.value);
              const chosen = places.find((place) => place.entityId === e.target.value);
              if (chosen && !title.trim()) {
                setTitle(chosen.payload.name);
              }
            }}
          >
            <option value="">장소 없음</option>
            {places.map((place) => (
              <option key={place.entityId} value={place.entityId}>
                {place.payload.name}
              </option>
            ))}
          </select>
        </label>
        {editor.item && editor.item.dayId !== day && connectedLegs > 0 ? (
          <p className="notice">날짜를 바꾸면 이 활동에 연결된 이동 {connectedLegs}개가 함께 제거됩니다.</p>
        ) : null}
        <label>
          계획 날짜
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {editor.plan.days.map((d) => (
              <option key={d.dayId} value={d.dayId}>
                {d.date}
              </option>
            ))}
          </select>
        </label>
        <TimeEditor value={time} onChange={setTime} />
        <ErrorText error={error} />
        <button className="primary">계획 저장</button>
      </form>
    </Modal>
  );
}
function NoteEditor({
  repo,
  target,
  records,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  records: FieldRecord[];
  target: {
    header: TripDataset['header'];
    label: string;
    ref: {
      tripId: string;
      targetKind: 'trip' | 'activity' | 'place' | 'booking';
      entityId: string;
      planVersionId?: string;
    };
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={`${target.label} 메모`} onClose={onClose}>
      <SavedNotes notes={notesForTarget(records, target.ref)} emptyText="아직 저장된 메모가 없습니다." />
      <h3>새 메모 추가</h3>
      <p className="muted">입력칸은 새 메모를 추가하는 곳입니다. 이전 메모는 위 목록에 보존됩니다.</p>
      <form
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) {
            return;
          }
          if (!body.trim()) {
            setError('메모 내용을 입력해 주세요.');
            return;
          }
          setBusy(true);
          try {
            await repo.execute(
              command(
                target.header.tripId,
                'AddNote',
                {
                  record: {
                    tripId: target.header.tripId,
                    recordId: crypto.randomUUID(),
                    kind: 'note',
                    sourceRefs: [],
                    payload: {
                      targetRef: target.ref,
                      body,
                      contextRefs: await repo.currentContext(target.header.tripId),
                    },
                  },
                },
                target.header.domainRevision,
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
          메모 본문
          <textarea required value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <button disabled={busy}>메모 저장</button>
      </form>
    </Modal>
  );
}
function TripCreator({
  repo,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [zone, setZone] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title="새 여행 만들기" onClose={onClose}>
      <form
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) {
            return;
          }
          setBusy(true);
          try {
            const trip = buildNewTrip({ name, start, end, timeZone: zone });
            await repo.execute(
              command(trip.tripId, 'CreateTrip', { header: trip.header, initialPlan: trip.initialPlan }),
            );
            onSaved(trip.tripId);
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          여행 이름
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          시작 날짜
          <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          종료 날짜
          <input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label>
          시간대 (확인한 경우만)
          <input
            value={zone}
            placeholder="예: Europe/Paris · 비우면 미확인"
            onChange={(e) => setZone(e.target.value)}
          />
        </label>
        <p className="muted">지역·숙박·일정은 만든 뒤 가이드와 오늘 화면에서 추가합니다.</p>
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>
          여행 만들기
        </button>
      </form>
    </Modal>
  );
}
