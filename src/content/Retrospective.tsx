import { useLiveQuery } from 'dexie-react-hooks';
import type { ContentRepository } from '../repository';
import type { PlanVersion, RevisionRef, TripDataset } from '../contracts/v2';
import {
  UNKNOWN_DATE,
  buildRetrospective,
  retrospectiveDates,
  type ActualEntry,
  type PlanColumn,
  type ReasonView,
} from './retro-rules';
import { timeLabel } from './ui';

const outcomeLabel = { visited: '방문', skipped: '건너뜀', unplanned: '예정 외 활동' } as const;

/**
 * 날짜별 회고(읽기 전용). 날짜와 비교할 계획 버전만 고르며 어떤 것도 저장하지 않는다.
 * 선택은 부모가 들고 있어 당시 내용을 열었다 돌아와도 같은 날짜·버전으로 복귀한다.
 */
export function Retrospective({
  repo,
  trip,
  date,
  planVersionId,
  onDate,
  onPlanVersion,
  onOpenPlace,
  onOpenPlanPlace,
  onOpenEvidence,
}: {
  repo: ContentRepository;
  trip: TripDataset;
  date: string;
  planVersionId: string;
  onDate: (date: string) => void;
  onPlanVersion: (planVersionId: string) => void;
  onOpenPlace: (record: ActualEntry['latest']) => void;
  onOpenPlanPlace: (placeId: string, contextRefs: RevisionRef[]) => void;
  onOpenEvidence: (ref: RevisionRef) => void;
}) {
  const { dates, hasUnknown } = retrospectiveDates(trip);
  const view = buildRetrospective(trip, date, planVersionId || undefined);
  const selected = view.columns.find((c) => c.planVersionId === view.selectedPlanVersionId);
  return (
    <section aria-label="날짜별 회고" className="retro">
      <h2>날짜별 회고</h2>
      <p className="muted">
        읽기 전용입니다. 날짜와 계획 버전을 바꿔도 아무것도 저장하거나 바꾸지 않으며, 기록은 당시 계획과 고정한 본문으로
        읽습니다.
      </p>
      <div className="version-controls">
        <label>
          회고 날짜
          <select aria-label="회고 날짜" value={date} onChange={(e) => onDate(e.target.value)}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {hasUnknown || date === UNKNOWN_DATE ? <option value={UNKNOWN_DATE}>날짜 미상 기록</option> : null}
          </select>
        </label>
        {view.unknownDate ? null : (
          <label>
            비교할 계획 버전
            <select
              aria-label="회고 계획 버전"
              value={view.selectedPlanVersionId === view.currentPlanVersionId ? '' : view.selectedPlanVersionId}
              onChange={(e) => onPlanVersion(e.target.value)}
            >
              <option value="">현재 계획</option>
              {trip.plans
                .toSorted((a, b) => b.number - a.number)
                .filter((p) => p.planVersionId !== view.currentPlanVersionId)
                .map((p) => (
                  <option key={p.planVersionId} value={p.planVersionId}>
                    과거 계획 {p.number} · {p.reason}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      {view.unknownDate ? (
        <p className="notice">
          날짜를 알 수 없는 기록입니다. 계획일이나 저장 시각으로 날짜를 정하지 않고 따로 모았습니다.
        </p>
      ) : (
        <div className="retro-columns">
          {view.columns.map((column) => (
            <PlanColumnView key={column.planVersionId} column={column} onOpenPlanPlace={onOpenPlanPlace} />
          ))}
        </div>
      )}
      <ActualSection view={view} onOpenPlace={onOpenPlace} />
      {view.unknownDate ? null : (
        <ReasonSection
          repo={repo}
          tripId={trip.header.tripId}
          reasons={view.reasons}
          selectedNumber={selected?.number}
          onOpenEvidence={onOpenEvidence}
        />
      )}
    </section>
  );
}

function PlanColumnView({
  column,
  onOpenPlanPlace,
}: {
  column: PlanColumn;
  onOpenPlanPlace: (placeId: string, contextRefs: RevisionRef[]) => void;
}) {
  return (
    <article className="content-row" aria-label={`${column.isCurrent ? '현재 계획' : '과거 계획'} ${column.number}`}>
      <h3>
        {column.isCurrent ? '현재 계획' : '과거 계획'} {column.number}
      </h3>
      <p className="muted">변경 이유(계획 전체): {column.reason}</p>
      {!column.days.length ? <p>이 계획 버전에는 이 날짜가 없습니다.</p> : null}
      {column.days.map(({ day, items, legs, stays }) => (
        <div key={day.dayId}>
          <h4>
            {day.date} · {day.title}
          </h4>
          {!items.length ? <p>이 날짜에 계획된 활동이 없습니다.</p> : null}
          <ol>
            {items.map((item: PlanVersion['items'][number]) => (
              <li key={item.activityId}>
                {item.title} · {timeLabel(item.time.start)}
                {item.placeLinks[0] ? (
                  <button
                    type="button"
                    onClick={() => onOpenPlanPlace(item.placeLinks[0].placeId, column.contextRefs)}
                    aria-label={`${item.title} 당시 장소 본문`}
                  >
                    당시 장소 본문
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {legs.map((leg) => (
            <p key={leg.legId}>
              이동 · {leg.fromTitle} → {leg.toTitle} · {leg.mode}
            </p>
          ))}
          {stays.map((stay) => (
            <p key={stay.stayId}>숙박 · {stay.baseText}</p>
          ))}
        </div>
      ))}
    </article>
  );
}

function ActualSection({
  view,
  onOpenPlace,
}: {
  view: ReturnType<typeof buildRetrospective>;
  onOpenPlace: (record: ActualEntry['latest']) => void;
}) {
  const { entries, movedAway, summary } = view;
  return (
    <div className="retro-actual">
      <h3>{view.unknownDate ? '날짜 미상 실제 기록' : '실제 기록'}</h3>
      {entries.length ? (
        <p className="muted">
          대표 기록 {entries.length}건(정정본은 한 건으로 집계) · 방문 {summary.visited} · 건너뜀 {summary.skipped} ·
          예정 외 {summary.unplanned} · 정정됨 {summary.corrected}
        </p>
      ) : (
        <p>{view.unknownDate ? '날짜 미상 기록이 없습니다.' : '이 날짜의 실제 기록이 없습니다.'}</p>
      )}
      {entries.map((entry) => (
        <ActualEntryView key={entry.latest.recordId} entry={entry} date={view.date} onOpenPlace={onOpenPlace} />
      ))}
      {movedAway.map(({ entry, movedTo }) => (
        <article className="content-row" key={entry.latest.recordId}>
          <h4>{entry.latest.payload.title}</h4>
          <p>
            이 날짜로 기록했다가 정정으로 {movedTo === UNKNOWN_DATE ? '날짜 미상' : movedTo}(으)로 옮긴 기록입니다. 이
            날짜의 원문은 보존되어 있습니다.
          </p>
          <ol>
            {entry.chain.map((record, index) => (
              <li key={record.recordId}>
                {index + 1}단계 · {record.payload.title} · {timeLabel(record.payload.time.start)}
              </li>
            ))}
          </ol>
        </article>
      ))}
    </div>
  );
}

function ActualEntryView({
  entry,
  date,
  onOpenPlace,
}: {
  entry: ActualEntry;
  date: string;
  onOpenPlace: (record: ActualEntry['latest']) => void;
}) {
  const { latest, chain, planLink, earlierDates } = entry;
  return (
    <article className="content-row">
      <h4>{latest.payload.title}</h4>
      <p>
        {outcomeLabel[latest.payload.outcome]} · {timeLabel(latest.payload.time.start)}
      </p>
      {latest.payload.note ? <p>{latest.payload.note}</p> : null}
      {planLink.kind === 'none' ? (
        <p className="muted">계획 연결 없음 · 당시 계획을 추정하지 않습니다.</p>
      ) : (
        <p className="muted">
          기록 당시 계획: {planLink.planNumber ? `계획 ${planLink.planNumber}` : '저장소에 없는 계획 버전'}
          {planLink.itemTitle
            ? ` · ${planLink.itemTitle}`
            : planLink.activityId
              ? ' · 해당 항목을 그 계획에서 찾을 수 없음'
              : ''}
          {planLink.plannedDate ? ` · 계획일 ${planLink.plannedDate}` : ''}
          {planLink.dateDiffers && date !== UNKNOWN_DATE ? ` · 실제 날짜 ${date}와 다름` : ''}
          {planLink.inCurrentPlan === false ? ' · 현재 계획에서는 제거됨' : ''}
        </p>
      )}
      {earlierDates.length ? (
        <p className="muted">
          정정으로 날짜가 바뀐 기록 · 앞선 단계의 날짜:{' '}
          {earlierDates.map((d) => (d === UNKNOWN_DATE ? '날짜 미상' : d)).join(', ')}
        </p>
      ) : null}
      {chain.length > 1 ? (
        <details>
          <summary>정정 {chain.length}단계 원문 보기</summary>
          <ol>
            {chain.map((record, index) => (
              <li key={record.recordId}>
                {index === 0 ? '원본' : index === chain.length - 1 ? '최신 정정본' : '중간 정정본'} ·{' '}
                {record.payload.title} · {timeLabel(record.payload.time.start)}
                {record.payload.note ? ` · ${record.payload.note}` : ''}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <button type="button" onClick={() => onOpenPlace(latest)}>
        기록 당시 내용
      </button>
    </article>
  );
}

const dayChangeText: Record<ReasonView['dayChange'], string> = {
  initial: '첫 계획이라 비교할 이전 버전이 없습니다.',
  unchanged: '이 날짜는 직전 버전과 같습니다. 아래 이유는 계획 전체에 대한 것이며 이 날짜의 원인으로 보지 않습니다.',
  changed: '이 날짜의 활동이 직전 버전과 달라졌습니다.',
  'added-day': '이 날짜가 이 버전에서 새로 생겼습니다.',
  'removed-day': '이 날짜가 이 버전에서 사라졌습니다.',
  'no-day': '이 날짜는 이 버전과 직전 버전에 모두 없습니다.',
};
const roleText = { selected: '선택한 계획', current: '현재 계획', 'linked-by-record': '기록이 연결한 계획' } as const;

function ReasonSection({
  repo,
  tripId,
  reasons,
  onOpenEvidence,
}: {
  repo: ContentRepository;
  tripId: string;
  reasons: ReasonView[];
  selectedNumber: number | undefined;
  onOpenEvidence: (ref: RevisionRef) => void;
}) {
  return (
    <div className="retro-reasons">
      <h3>변경 이유·근거</h3>
      {reasons.map((reason) => (
        <article className="content-row" key={reason.planVersionId} aria-label={`계획 ${reason.number} 변경 이유`}>
          <h4>
            계획 {reason.number} · {reason.roles.map((role) => roleText[role]).join(' · ')}
          </h4>
          <p>저장된 이유(계획 전체): {reason.reason}</p>
          <p className="muted">{dayChangeText[reason.dayChange]}</p>
          {reason.parent ? <p className="muted">직전 버전: 계획 {reason.parent.number}</p> : null}
          {reason.source === 'applied-proposal' && reason.proposal ? (
            <>
              <p>
                적용한 변경안(
                {reason.proposal.origin === 'ai'
                  ? 'AI 초안'
                  : reason.proposal.origin === 'user'
                    ? '직접 작성'
                    : '가져오기'}
                ): {reason.proposal.reason}
              </p>
              <p className="muted">예약 영향: {reason.proposal.reservationText}</p>
              {reason.impactOnDate.length ? (
                <p className="muted">변경안이 영향 대상으로 밝힌 활동이 이 날짜에 있습니다.</p>
              ) : null}
              {reason.proposal.evidenceRefs.length ? (
                <ul>
                  {reason.proposal.evidenceRefs.map((ref) => (
                    <EvidenceItem key={ref.entityId} repo={repo} tripId={tripId} refRev={ref} onOpen={onOpenEvidence} />
                  ))}
                </ul>
              ) : (
                <p className="muted">근거 없음 · 이 변경안에 연결된 근거가 없습니다.</p>
              )}
            </>
          ) : reason.source === 'proposal-missing' ? (
            <p className="muted">변경안 연결 없음 · 이 계획을 만든 적용 변경안의 기록을 찾을 수 없습니다.</p>
          ) : (
            <p className="muted">변경안 없음 · 직접 변경 등으로 저장된 이유만 있습니다. 근거 없음.</p>
          )}
        </article>
      ))}
    </div>
  );
}

function EvidenceItem({
  repo,
  tripId,
  refRev,
  onOpen,
}: {
  repo: ContentRepository;
  tripId: string;
  refRev: RevisionRef;
  onOpen: (ref: RevisionRef) => void;
}) {
  const content = useLiveQuery(
    () => repo.content(tripId, 'evidence', refRev.entityId, refRev.revisionId),
    [repo, tripId, refRev.entityId, refRev.revisionId],
  );
  const label = content?.kind === 'evidence' ? (content.payload.label ?? content.payload.claim ?? '근거') : '근거';
  return (
    <li>
      <button type="button" onClick={() => onOpen(refRev)}>
        근거 · {label} (당시 내용)
      </button>
    </li>
  );
}
