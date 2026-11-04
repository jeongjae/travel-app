import { Fragment, lazy, Suspense, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Temporal } from '@js-temporal/polyfill';
import { repository, ContentRepository } from '../repository';
import { readPackage } from '../transfer/package';
import type { Review } from '../transfer/reimport';
import {
  timeSpecSchema,
  type ContentRevision,
  type FieldRecord,
  type PlanVersion,
  type RevisionRef,
  type TimeSpec,
  type TripDataset,
} from '../contracts/v2';
import { actualPayload, dayRecordView, placeOnTimeline } from './field-rules';
import { RecordBadge, TimelineRecordCard } from './TimelineRecords';
import { GuideDetail } from './Guide';
import { buildNewTrip } from './trip-factory';
import { PlaceAuthoring, RegionAuthoring } from './Authoring';
import { GuideAuthoring } from './GuideAuthoring';
import { isReadingGuide } from './guide-rules';
import { LegEditor, StayEditor, type LegEditorState, type StayEditorState } from './StayLegEditors';
import { DayDetails } from './DayDetails';
import { ActionMenu } from './ActionMenu';
import {
  clockLabel,
  DayBookings,
  DayLead,
  DayStrip,
  JourneyIcon,
  journeyTabs,
  MapLink,
  ScheduleOverview,
} from './Journey';
import { reviewWorkspace, workspaceUrl } from '../storage/workspace-name';
import { GuideList } from './GuideList';
import { Retrospective } from './Retrospective';
import { retrospectiveDates, UNKNOWN_DATE } from './retro-rules';
import { ActualEditor, ActualTimeline, type RecordDraft, type RecordEditor } from './Field';
import { TimeFields } from './TimeFields';
import { confirmedZone, nextDay, recordFormDefault, visitNowTime } from './quick-time';
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
  '더보기',
  '계획 버전',
] as const;
type Tab = (typeof tabs)[number];
/** 하단 탭 `더보기` 아래에 모인 화면. 이 화면들을 보는 동안 `더보기` 탭이 선택 상태로 표시된다. */
const moreTabs: readonly Tab[] = ['더보기', '준비·회화', '예약·할 일', '변경안', '지도', '계획 버전', '가져오기 기록'];
const moreItems = ['준비·회화', '예약·할 일', '변경안', '지도', '계획 버전', '가져오기 기록'] as const;
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
    [legEditor, setLegEditor] = useState<LegEditorState | null>(null),
    [tripMenu, setTripMenu] = useState(false),
    [removeTarget, setRemoveTarget] = useState<PlanVersion['items'][number] | null>(null);
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
  // C8: 오늘 타임라인에 그날의 실제 기록을 함께 보인다. 계획 항목·계획 버전은 바뀌지 않는다.
  const dayRecords =
    plan && activeDay
      ? dayRecordView(records, new Set(plan.items.map((item) => item.activityId)), activeDay.date)
      : undefined;
  const timelinePlacement = placeOnTimeline(dayItems, dayRecords?.standalone ?? []);
  const renderRecordCard = (entry: NonNullable<typeof dayRecords>['standalone'][number]) => (
    <TimelineRecordCard
      key={entry.latest.recordId}
      entry={entry}
      onCorrect={(row) => void record(row.payload.outcome, undefined, row)}
      onShow={() => openTab('실제 기록')}
    />
  );
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
  const tripEnded = header !== undefined && header.endDate < new Date().toLocaleDateString('sv-SE');
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
  /** 확인 대화상자에서 누른 뒤에만 호출한다. 연결된 이동은 저장소가 함께 제거하고 이전 계획 버전에는 남는다. */
  async function removeItem(item: PlanVersion['items'][number]) {
    if (!plan || !header) {
      return;
    }
    await action(() =>
      repo.execute(
        command(
          header.tripId,
          'ChangePlan',
          {
            currentPlanVersionId: plan.planVersionId,
            operations: [{ type: 'remove-item', activityId: item.activityId }],
            reason: '사용자가 활동을 일정에서 제거',
          },
          header.domainRevision,
        ),
      ),
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
    setTripMenu(false);
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
        ...(original || draft ? {} : { defaultStart: recordFormDefault(latest, activeDay?.date) }),
        current,
        context: original?.payload.contextRefs ?? (item && plan ? plan.contextRefs : current),
      });
    }, '');
  }
  /**
   * `방문 기록` 한 번 누르기: 기기 시계의 지금을 여행 시간대의 현지 시각으로 바로 저장한다.
   * 시각·메모는 저장 뒤 `정정`으로 고친다. 시간대를 알 수 없거나 저장에 실패하면 기존 폼을 연다.
   */
  async function quickVisit(item: PlanVersion['items'][number]) {
    if (!header || !plan) {
      return;
    }
    const start = visitNowTime(header);
    if (!start) {
      await record('visited', item);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const latest = (await repo.list()).find((row) => row.tripId === header.tripId) ?? header;
      const current = await repo.currentContext(header.tripId);
      const payload = actualPayload(
        undefined,
        { title: item.title, outcome: 'visited', note: '', start, placeId: '', tripId: header.tripId },
        plan.contextRefs,
        current,
        { planVersionId: plan.planVersionId, activityId: item.activityId },
      );
      const clock = start.precision === 'local' ? start.localTime : '';
      await repo.execute(
        command(
          header.tripId,
          'RecordActual',
          { record: { tripId: header.tripId, recordId: crypto.randomUUID(), kind: 'actual', sourceRefs: [], payload } },
          latest.domainRevision,
        ),
      );
      setNotice(`${item.title} 방문을 ${clock}에 기록했습니다. 시각·메모는 기록 탭에서 정정할 수 있습니다.`);
    } catch {
      setBusy(false);
      await record('visited', item);
      return;
    }
    setBusy(false);
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
          <h1 className="journey-location">
            <button
              type="button"
              className="trip-switch"
              aria-expanded={tripMenu}
              aria-controls="trip-library"
              onClick={() => setTripMenu((open) => !open)}
            >
              {header.name}
              <span className="trip-caret" aria-hidden="true">
                ▾
              </span>
            </button>
          </h1>
        ) : (
          <span className="journey-location">여행 가이드</span>
        )}
        {reviewWorkspace(location.search) ? (
          <span className="review-badge" title="평소 사용하는 여행 저장소와 분리된 검토 공간입니다.">
            검토 공간
          </span>
        ) : null}
      </header>
      {loadedHeaders !== undefined && (tripMenu || !header) ? (
        <section className="journey-library" id="trip-library" aria-label="여행 전환·새 여행·가져오기">
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
            원천 패키지 가져오기 (pilot.zip)
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={busy || meta?.mode !== 'v2'}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) {
                  void load(file);
                }
              }}
            />
          </label>
          <a href={workspaceUrl('legacy', location.search)}>기존 일정 열기</a>
        </section>
      ) : null}
      <main className="main" id="content-main">
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
            <div className="button-row">
              <button disabled={!ready} onClick={() => setRecovery(true)}>
                저장소·백업
              </button>
            </div>
          </section>
        ) : (
          <>
            {historical ? <p className="notice">과거 계획 · 당시 콘텐츠를 고정해 조회합니다.</p> : null}
            {tab === '전체 일정' && plan ? (
              <ScheduleOverview plan={plan} onSelect={openDay} regionName={regionName} />
            ) : null}
            {tab === '일정' && plan ? (
              <section className="day-page">
                {tripEnded ? (
                  <p className="notice">
                    여행이 끝났습니다.{' '}
                    <button
                      onClick={() => {
                        openTab('실제 기록');
                        setRetroOpen(true);
                      }}
                    >
                      회고 보기
                    </button>
                  </p>
                ) : null}
                <DayStrip plan={plan} dayId={activeDay?.dayId} onSelect={openDay} />
                {activeDay ? (
                  <DayLead
                    day={activeDay}
                    dayNumber={plan.days.toSorted((a, b) => a.ordinal - b.ordinal).indexOf(activeDay) + 1}
                    items={dayItems}
                    catalog={catalog}
                    regionText={`하루 지역 ${activeDay.regionIds.map((id) => regionName(id)).join(', ') || '없음'} · 밤을 보내는 지역 ${activeDay.overnightRegionId ? regionName(activeDay.overnightRegionId) : '없음'}`}
                    stays={plan.stays
                      .filter(
                        (stay) =>
                          stay.time.start.date &&
                          stay.time.start.date <= activeDay.date &&
                          (!stay.time.end?.date || activeDay.date < stay.time.end.date),
                      )
                      .map((stay) => (
                        <p key={stay.stayId} className="day-stay">
                          숙박: {stay.baseText}
                          {stayClock(stay.time.start)}
                          <button
                            aria-label={`${stay.baseText} 수정`}
                            disabled={historical}
                            onClick={() => setStayEditor({ header: { ...header }, plan, stay })}
                          >
                            수정
                          </button>
                        </p>
                      ))}
                    onNavigate={navigate}
                  />
                ) : null}
                <div className="day-toolbar">
                  <button onClick={() => void record('unplanned')}>예정 외 활동 기록</button>
                  <button disabled={historical} onClick={() => setPlanEditor({ header: { ...header }, plan })}>
                    활동 추가
                  </button>
                </div>
                <div className="day-timeline">
                  {dayItems.map((i) => {
                    const placeId = i.placeLinks[0]?.placeId;
                    const placeName =
                      catalog.find(
                        (c): c is Extract<ContentRevision, { kind: 'place' }> =>
                          c.kind === 'place' && c.entityId === placeId,
                      )?.payload.name ?? placeId;
                    return (
                      <Fragment key={i.activityId}>
                        {(timelinePlacement.before.get(i.activityId) ?? []).map(renderRecordCard)}
                        <article className="content-row timeline-stop">
                          <p className="timeline-time" title={timeLabel(i.time.start)}>
                            {clockLabel(i.time.start)}
                            {i.time.end
                              ? ` ~ ${clockLabel(i.time.end)}${endsNextDay(i.time.start, i.time.end) ? ' (다음 날)' : ''}`
                              : ''}
                          </p>
                          <h3>{i.title}</h3>
                          <RecordBadge record={dayRecords?.byActivity.get(i.activityId)} />
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
                          <div className="button-row activity-actions">
                            <button className="primary" disabled={busy} onClick={() => void quickVisit(i)}>
                              방문 기록
                            </button>
                            {placeId ? (
                              <button
                                aria-label={`장소 안내 · ${placeName}`}
                                onClick={() => navigate('place', placeId)}
                              >
                                장소
                              </button>
                            ) : null}
                            <ActionMenu
                              label={`${i.title} 더보기 메뉴`}
                              actions={[
                                { label: '건너뜀 기록', onSelect: () => void record('skipped', i) },
                                {
                                  label: '일정 수정',
                                  disabled: historical,
                                  onSelect: () => setPlanEditor({ header: { ...header }, plan, item: i }),
                                },
                                {
                                  label: '위로',
                                  ariaLabel: `${i.title} 위로`,
                                  disabled: historical || busy || i.activityId === dayItems[0]?.activityId,
                                  onSelect: () => void moveItem(i, -1),
                                },
                                {
                                  label: '아래로',
                                  ariaLabel: `${i.title} 아래로`,
                                  disabled: historical || busy || i.activityId === dayItems.at(-1)?.activityId,
                                  onSelect: () => void moveItem(i, 1),
                                },
                                {
                                  label: '메모',
                                  onSelect: () =>
                                    setNoteTarget({
                                      header: { ...header },
                                      label: i.title,
                                      ref: {
                                        tripId: header.tripId,
                                        targetKind: 'activity',
                                        entityId: i.activityId,
                                        planVersionId: plan.planVersionId,
                                      },
                                    }),
                                },
                                {
                                  label: '일정에서 제거',
                                  danger: true,
                                  disabled: historical || busy,
                                  onSelect: () => setRemoveTarget(i),
                                },
                              ]}
                            >
                              <MapLink
                                target={catalog.find(
                                  (content) => content.kind === 'map-target' && content.entityId === i.mapTargetId,
                                )}
                              />
                            </ActionMenu>
                          </div>
                          <SavedNotes
                            notes={notesForTarget(records, {
                              tripId: header.tripId,
                              targetKind: 'activity',
                              entityId: i.activityId,
                            })}
                          />
                          {plan.legs
                            .filter((leg) => leg.dayId === activeDay?.dayId && leg.fromActivityId === i.activityId)
                            .map((leg) => {
                              const label = `${i.title} → ${plan.items.find((item) => item.activityId === leg.toActivityId)?.title}`;
                              return (
                                <div className="timeline-leg" key={leg.legId}>
                                  <p>
                                    이동 {label} ·{' '}
                                    {[leg.mode, leg.durationText, leg.distanceText, leg.lineText]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </p>
                                  <div className="button-row">
                                    <MapLink
                                      target={catalog.find(
                                        (content) =>
                                          content.kind === 'map-target' && content.entityId === leg.mapTargetId,
                                      )}
                                    />
                                    <button
                                      aria-label={`이동 ${label} 수정`}
                                      disabled={historical}
                                      onClick={() =>
                                        setLegEditor({ header: { ...header }, plan, dayId: leg.dayId, leg })
                                      }
                                    >
                                      수정
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                        </article>
                      </Fragment>
                    );
                  })}
                  {timelinePlacement.trailing.map(renderRecordCard)}
                </div>
                <DayBookings items={dayItems} />
                {activeDay ? <DayDetails repo={repo} day={activeDay} context={context} onNavigate={navigate} /> : null}
                {activeDay ? (
                  <div className="button-row stay-leg-actions" role="group" aria-label="숙박·이동 추가">
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
                ) : null}
              </section>
            ) : null}
            {tab === '더보기' ? (
              <section className="more-page">
                <h2>더보기</h2>
                <nav className="more-list" aria-label="더보기 메뉴">
                  {moreItems.map((item) => (
                    <button key={item} onClick={() => openTab(item)}>
                      {item}
                    </button>
                  ))}
                  <button disabled={!ready} onClick={() => setRecovery(true)}>
                    저장소·백업
                  </button>
                </nav>
              </section>
            ) : null}
            {tab === '계획 버전' ? (
              <section className="more-page">
                <button className="back-to-more" onClick={() => openTab('더보기')}>
                  더보기로
                </button>
                <h2>계획 버전</h2>
                <p className="muted">
                  이전 버전을 고르면 당시 일정과 콘텐츠를 그대로 조회합니다. 기록은 바꾸지 않습니다.
                </p>
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
                  <span className="muted">revision {header.domainRevision}</span>
                </div>
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
                  <GuideList
                    catalog={catalog}
                    search={search}
                    onClearSearch={() => setSearch('')}
                    onOpen={(kind, id) => navigate(kind, id)}
                  />
                </section>
              )
            ) : null}
            {tab === '예약·할 일' || tab === '지도' ? (
              <section>
                <button className="back-to-more" onClick={() => openTab('더보기')}>
                  더보기로
                </button>
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
                <button className="back-to-more" onClick={() => openTab('더보기')}>
                  더보기로
                </button>
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
              <section className="record-page">
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
                    <h2>실제 기록</h2>
                    <button className="primary" onClick={() => setRetroOpen(true)}>
                      날짜별 회고 보기
                    </button>
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
              <button className="back-to-more" onClick={() => openTab('더보기')}>
                더보기로
              </button>
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
                <button className="back-to-more" onClick={() => openTab('더보기')}>
                  더보기로
                </button>
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
              aria-current={(item.tab === '더보기' ? moreTabs.includes(tab) : tab === item.tab) ? 'page' : undefined}
              onClick={() => openTab(item.tab)}
            >
              <JourneyIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
      {removeTarget && plan ? (
        <RemoveItemDialog
          item={removeTarget}
          connectedLegs={
            plan.legs.filter(
              (leg) => leg.fromActivityId === removeTarget.activityId || leg.toActivityId === removeTarget.activityId,
            ).length
          }
          busy={busy}
          onClose={() => setRemoveTarget(null)}
          onConfirm={() => {
            const item = removeTarget;
            setRemoveTarget(null);
            void removeItem(item);
          }}
        />
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
            const savedUnplannedToday =
              actualEditor.outcome === 'unplanned' && !actualEditor.original && tab === '일정';
            setActualEditor(null);
            setNotice(
              savedUnplannedToday
                ? '예정 외 활동을 기록했습니다. 아래 타임라인과 `기록` 탭에서 볼 수 있습니다.'
                : '실제 기록을 저장했습니다.',
            );
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
/** 숙박 줄의 시각. 날짜는 날짜 머리에 이미 있으므로 체크인 시각이나 원문 표현이 있을 때만 붙인다. */
function stayClock(time: TimeSpec) {
  if (time.precision === 'local' || time.precision === 'instant') {
    return ` · 체크인 ${time.localTime.slice(0, 5)}`;
  }
  if (time.precision === 'text') {
    return ` · ${time.rawText}`;
  }
  return '';
}
function RemoveItemDialog({
  item,
  connectedLegs,
  busy,
  onClose,
  onConfirm,
}: {
  item: PlanVersion['items'][number];
  connectedLegs: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title="일정에서 제거할까요?" onClose={onClose}>
      <p>
        <strong>{item.title}</strong>을(를) 이 계획에서 제거합니다. 이전 계획 버전과 이미 남긴 기록은 그대로 남습니다.
      </p>
      {connectedLegs > 0 ? <p className="notice">연결된 이동 {connectedLegs}개 — 제거하면 함께 제거됩니다.</p> : null}
      <div className="button-row dialog-actions">
        <button className="danger" disabled={busy} onClick={onConfirm}>
          제거 확인
        </button>
        <button onClick={onClose}>취소</button>
      </div>
    </Modal>
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
  const item = editor.item;
  const [title, setTitle] = useState(item?.title ?? ''),
    [day, setDay] = useState(item?.dayId ?? editor.plan.days[0]?.dayId ?? ''),
    [time, setTime] = useState<TimeSpec>(item?.time.start ?? { precision: 'unspecified' }),
    [endClock, setEndClock] = useState(clockOfEnd(item?.time.end)),
    [endTouched, setEndTouched] = useState(false),
    [askNextDay, setAskNextDay] = useState(false),
    [reason, setReason] = useState(''),
    [placeId, setPlaceId] = useState(item?.placeLinks[0]?.placeId ?? ''),
    [error, setError] = useState('');
  const dayDate = editor.plan.days.find((d) => d.dayId === day)?.date ?? '';
  const startClock = 'localTime' in time ? time.localTime.slice(0, 5) : '';
  const endBeforeStart = Boolean(endClock && startClock && endClock < startClock);
  const connectedLegs = item
    ? editor.plan.legs.filter((leg) => leg.fromActivityId === item.activityId || leg.toActivityId === item.activityId)
        .length
    : 0;
  /** 계획 날짜 칸이 날짜의 기준이다. 시각이 있는 시작값은 그 날짜로 맞춘다. */
  function alignedStart(): TimeSpec {
    if (time.precision === 'local' || time.precision === 'date') {
      return timeSpecSchema.parse({ ...time, date: dayDate });
    }
    return time;
  }
  function endSpec(start: TimeSpec, spansMidnight: boolean): TimeSpec | undefined {
    if (!endTouched) {
      return item?.time.end;
    }
    if (!endClock) {
      return undefined;
    }
    if (start.precision !== 'local' && start.precision !== 'instant') {
      throw new Error('종료 시각은 시작 시각을 먼저 입력한 뒤 정할 수 있습니다.');
    }
    const zone = start.timeZone;
    return timeSpecSchema.parse({
      precision: 'local',
      date: spansMidnight ? nextDay(dayDate) : dayDate,
      localTime: endClock,
      timeZoneStatus: zone ? 'confirmed' : 'unknown',
      ...(zone ? { timeZone: zone } : {}),
    });
  }
  async function save(spansMidnight: boolean) {
    try {
      const start = alignedStart();
      const end = endSpec(start, spansMidnight);
      const base: PlanVersion['items'][number] = item ?? {
        tripId: editor.header.tripId,
        planVersionId: editor.plan.planVersionId,
        activityId: crypto.randomUUID(),
        dayId: day,
        order: Math.max(-1, ...editor.plan.items.filter((i) => i.dayId === day).map((i) => i.order)) + 1,
        title,
        category: 'activity',
        time: { start },
        summary: '',
        optional: false,
        placeLinks: [],
        bookingIds: [],
        taskRefs: [],
        executionMarkers: [],
        sourceFlags: [],
      };
      const originalLinks = item?.placeLinks ?? [];
      // 첫 장소 링크만 이 화면에서 바꾼다. 나머지 연결은 그대로 둔다.
      const placeLinks = placeId
        ? [{ placeId, relation: originalLinks[0]?.relation ?? ('visit' as const) }, ...originalLinks.slice(1)]
        : originalLinks.slice(1);
      const next = { ...base, dayId: day, title, time: { start, ...(end ? { end } : {}) }, placeLinks };
      if (item && item.dayId !== day) {
        next.order = Math.max(-1, ...editor.plan.items.filter((i) => i.dayId === day).map((i) => i.order)) + 1;
      }
      await repo.execute(
        command(
          editor.header.tripId,
          'ChangePlan',
          {
            currentPlanVersionId: editor.plan.planVersionId,
            operations: [{ type: 'upsert-item', item: next }],
            reason: reason.trim() || '사용자 일정 수정',
          },
          editor.header.domainRevision,
        ),
      );
      onSaved();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <Modal title={item ? '일정 수정' : '활동 추가'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (endTouched && endBeforeStart && !askNextDay) {
            setAskNextDay(true);
            return;
          }
          await save(endTouched && endBeforeStart);
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
        {item && item.dayId !== day && connectedLegs > 0 ? (
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
        <TimeFields
          value={time}
          onChange={setTime}
          defaultZone={confirmedZone(editor.header)}
          fixedDate={dayDate}
          emptyAs="unspecified"
          afterTime={
            <>
              <label>
                종료 시각 (선택)
                <input
                  type="time"
                  value={endClock}
                  disabled={!startClock}
                  onChange={(e) => {
                    setEndClock(e.target.value);
                    setEndTouched(true);
                    setAskNextDay(false);
                  }}
                />
              </label>
              {!startClock ? <p className="muted">종료 시각은 시각을 먼저 입력하면 정할 수 있습니다.</p> : null}
            </>
          }
        />
        {item ? (
          <label>
            변경 이유 (선택)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사용자 일정 수정" />
          </label>
        ) : null}
        {askNextDay ? (
          <div className="notice" role="group" aria-label="다음 날 확인">
            <p>
              종료 시각 {endClock}이 시작 시각 {startClock}보다 이릅니다. 다음 날 {endClock}에 끝나는 것으로 저장할까요?
            </p>
            <div className="button-row">
              <button type="button" className="primary" onClick={() => void save(true)}>
                다음 날로 저장
              </button>
              <button type="button" onClick={() => setAskNextDay(false)}>
                시각 다시 입력
              </button>
            </div>
          </div>
        ) : null}
        <ErrorText error={error} />
        <div className="form-actions">
          <button className="primary">계획 저장</button>
        </div>
      </form>
    </Modal>
  );
}
function clockOfEnd(time?: TimeSpec) {
  return time && (time.precision === 'local' || time.precision === 'instant') ? time.localTime.slice(0, 5) : '';
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

function endsNextDay(start: TimeSpec, end: TimeSpec) {
  return Boolean(start.date && end.date && end.date > start.date);
}
