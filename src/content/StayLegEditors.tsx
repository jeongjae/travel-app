import { useMemo, useState } from 'react';
import type { ContentRevision, PlanVersion, TimeSpec, TripDataset } from '../contracts/v2';
import type { ContentRepository } from '../repository';
import { dayRegionsFromStays, isProblem, stayRange } from '../plan/manual-stays';
import { command, ErrorText, Modal, errorText } from './ui';

type Region = Extract<ContentRevision, { kind: 'region' }>;
type Stay = PlanVersion['stays'][number];
type Leg = PlanVersion['legs'][number];

export type StayEditorState = { header: TripDataset['header']; plan: PlanVersion; stay?: Stay; date?: string };
export type LegEditorState = { header: TripDataset['header']; plan: PlanVersion; dayId: string; leg?: Leg };

function dayLabel(plan: PlanVersion, date: string) {
  const day = plan.days.find((d) => d.date === date);
  return day ? `${date} (${day.ordinal}일차)` : date;
}

function buildTime(date: string, clock: string, zone: string): TimeSpec {
  if (!clock) {
    return { precision: 'date', date };
  }
  return zone.trim()
    ? { precision: 'local', date, localTime: clock, timeZone: zone.trim(), timeZoneStatus: 'confirmed' }
    : { precision: 'local', date, localTime: clock, timeZoneStatus: 'unknown' };
}

function clockOf(spec?: TimeSpec) {
  return spec && (spec.precision === 'local' || spec.precision === 'instant') ? spec.localTime.slice(0, 5) : '';
}

function zoneOf(spec?: TimeSpec) {
  return spec && (spec.precision === 'local' || spec.precision === 'instant') ? (spec.timeZone ?? '') : '';
}

/** 저장 전에 어느 날짜의 지역 표시가 어떻게 바뀌는지 같은 계산으로 미리 보여준다. */
function previewDays(plan: PlanVersion, next: Stay | undefined, removing?: Stay) {
  const stays = plan.stays.filter((s) => s.stayId !== (next?.stayId ?? removing?.stayId));
  if (next) {
    stays.push(next);
  }
  const ranges = [next, removing ?? plan.stays.find((s) => s.stayId === next?.stayId)]
    .map((s) => (s ? stayRange(s) : undefined))
    .filter(
      (range): range is Exclude<ReturnType<typeof stayRange>, { problem: string }> => !!range && !isProblem(range),
    );
  return plan.days
    .filter((day) => ranges.some((range) => range.checkin <= day.date && day.date <= range.checkout))
    .map((day) => ({ day, result: dayRegionsFromStays(stays, day.date) }));
}

export function StayEditor({
  repo,
  editor,
  regions,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  editor: StayEditorState;
  regions: Region[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { plan, header, stay } = editor;
  const firstDate = plan.days[0]?.date ?? '';
  const [baseText, setBaseText] = useState(stay?.baseText ?? ''),
    [regionId, setRegionId] = useState(stay?.regionId ?? ''),
    [checkin, setCheckin] = useState(stay?.time.start.date ?? editor.date ?? firstDate),
    [checkout, setCheckout] = useState(stay?.time.end?.date ?? editor.date ?? firstDate),
    [checkinClock, setCheckinClock] = useState(clockOf(stay?.time.start)),
    [checkoutClock, setCheckoutClock] = useState(clockOf(stay?.time.end)),
    [zone, setZone] = useState(zoneOf(stay?.time.start)),
    [reason, setReason] = useState(stay ? '사용자 숙박 수정' : '사용자 숙박 추가'),
    [removing, setRemoving] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [expected] = useState(header.domainRevision);
  const candidate = useMemo<Stay>(
    () => ({
      tripId: header.tripId,
      planVersionId: plan.planVersionId,
      stayId: stay?.stayId ?? 'draft-stay',
      ...(regionId ? { regionId } : {}),
      baseText: baseText.trim() || '숙박',
      time: { start: buildTime(checkin, checkinClock, zone), end: buildTime(checkout, checkoutClock, zone) },
      ...(checkin && checkout && checkout >= checkin
        ? { plannedNights: Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86400000) }
        : {}),
      ...(stay?.bookingId ? { bookingId: stay.bookingId } : {}),
      locationStatus: stay?.locationStatus ?? 'user-entered',
    }),
    [header.tripId, plan.planVersionId, stay, regionId, baseText, checkin, checkout, checkinClock, checkoutClock, zone],
  );
  const preview = useMemo(
    () => (removing ? previewDays(plan, undefined, stay) : previewDays(plan, candidate)),
    [plan, candidate, removing, stay],
  );
  const problem = (() => {
    const range = stayRange(candidate);
    if (isProblem(range)) {
      return range.problem;
    }
    return preview.map((entry) => entry.result).find(isProblem)?.problem;
  })();

  async function save(operation: unknown, message: string) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await repo.execute(
        command(
          header.tripId,
          'ChangePlan',
          { currentPlanVersionId: plan.planVersionId, operations: [operation], reason: reason.trim() || message },
          expected,
        ),
      );
      onSaved(message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={stay ? '숙박 수정' : '숙박 추가'} onClose={onClose}>
      <form
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          if (removing) {
            void save({ type: 'remove-stay', stayId: stay!.stayId }, '숙박을 제거해 새 계획 버전을 저장했습니다.');
            return;
          }
          if (!baseText.trim()) {
            setError('숙박 이름을 입력하세요.');
            return;
          }
          void save(
            { type: 'upsert-stay', stay: { ...candidate, stayId: stay?.stayId ?? crypto.randomUUID() } },
            '숙박을 저장해 새 계획 버전을 만들었습니다.',
          );
        }}
      >
        {removing ? (
          <p className="notice">이 숙박({stay?.baseText})을 계획에서 제거합니다. 아래 날짜의 지역 표시가 바뀝니다.</p>
        ) : (
          <>
            <label>
              숙박 이름·거점
              <input required value={baseText} onChange={(e) => setBaseText(e.target.value)} />
            </label>
            <label>
              지역 (선택)
              <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
                <option value="">지역 없음·미정</option>
                {regions.map((region) => (
                  <option key={region.entityId} value={region.entityId}>
                    {region.payload.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              입실 날짜
              <input type="date" required value={checkin} onChange={(e) => setCheckin(e.target.value)} />
            </label>
            <label>
              퇴실 날짜
              <input type="date" required value={checkout} onChange={(e) => setCheckout(e.target.value)} />
            </label>
            <label>
              입실 시각 (선택)
              <input type="time" value={checkinClock} onChange={(e) => setCheckinClock(e.target.value)} />
            </label>
            <label>
              퇴실 시각 (선택)
              <input type="time" value={checkoutClock} onChange={(e) => setCheckoutClock(e.target.value)} />
            </label>
            <label>
              시간대 (확인한 경우만)
              <input value={zone} placeholder="예: Europe/Paris" onChange={(e) => setZone(e.target.value)} />
            </label>
          </>
        )}
        <section aria-label="변경 요약">
          <h3>변경 요약</h3>
          {problem ? (
            <p role="alert" className="error">
              {problem}
            </p>
          ) : null}
          {preview.length ? (
            <ul>
              {preview.map(({ day, result }) => (
                <li key={day.dayId}>
                  {dayLabel(plan, day.date)} →{' '}
                  {isProblem(result)
                    ? '계산 불가'
                    : `하루 지역 ${result.regionIds.map((id) => regions.find((r) => r.entityId === id)?.payload.name ?? id).join(', ') || '없음'} · 숙박 지역 ${
                        result.overnightRegionId
                          ? (regions.find((r) => r.entityId === result.overnightRegionId)?.payload.name ??
                            result.overnightRegionId)
                          : '없음'
                      }`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">이 입력이 닿는 여행 날짜가 없습니다.</p>
          )}
        </section>
        <label>
          변경 이유
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <div className="button-row">
          <button className="primary" disabled={busy || (!removing && Boolean(problem))}>
            {removing ? '제거 확인' : '숙박 저장'}
          </button>
          {stay ? (
            <button type="button" onClick={() => setRemoving(!removing)}>
              {removing ? '제거 취소' : '이 숙박 제거'}
            </button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

export function LegEditor({
  repo,
  editor,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  editor: LegEditorState;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { plan, header, leg, dayId } = editor;
  const items = plan.items.filter((item) => item.dayId === dayId).toSorted((a, b) => a.order - b.order);
  const [from, setFrom] = useState(leg?.fromActivityId ?? items[0]?.activityId ?? ''),
    [to, setTo] = useState(leg?.toActivityId ?? items[1]?.activityId ?? ''),
    [mode, setMode] = useState(leg?.mode ?? ''),
    [duration, setDuration] = useState(leg?.durationText ?? ''),
    [distance, setDistance] = useState(leg?.distanceText ?? ''),
    [reason, setReason] = useState(leg ? '사용자 이동 수정' : '사용자 이동 추가'),
    [removing, setRemoving] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [expected] = useState(header.domainRevision);
  const title = (activityId: string) => items.find((item) => item.activityId === activityId)?.title ?? activityId;

  async function save(operation: unknown, message: string) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await repo.execute(
        command(
          header.tripId,
          'ChangePlan',
          { currentPlanVersionId: plan.planVersionId, operations: [operation], reason: reason.trim() || message },
          expected,
        ),
      );
      onSaved(message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={leg ? '이동 수정' : '이동 추가'} onClose={onClose}>
      <form
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          if (removing) {
            void save({ type: 'remove-leg', legId: leg!.legId }, '이동을 제거해 새 계획 버전을 저장했습니다.');
            return;
          }
          if (!from || !to || from === to) {
            setError('출발과 도착에 서로 다른 활동을 고르세요.');
            return;
          }
          if (!mode.trim()) {
            setError('이동 수단을 입력하세요.');
            return;
          }
          void save(
            {
              type: 'upsert-leg',
              leg: {
                tripId: header.tripId,
                planVersionId: plan.planVersionId,
                legId: leg?.legId ?? crypto.randomUUID(),
                dayId,
                fromActivityId: from,
                toActivityId: to,
                mode: mode.trim(),
                ...(duration.trim() ? { durationText: duration.trim() } : {}),
                ...(distance.trim() ? { distanceText: distance.trim() } : {}),
                ...(leg?.lineText ? { lineText: leg.lineText } : {}),
                ...(leg?.geometryStatus ? { geometryStatus: leg.geometryStatus } : {}),
                ...(leg?.geometryAssetId ? { geometryAssetId: leg.geometryAssetId } : {}),
                ...(leg?.mapTargetId ? { mapTargetId: leg.mapTargetId } : {}),
              },
            },
            '이동을 저장해 새 계획 버전을 만들었습니다.',
          );
        }}
      >
        {items.length < 2 && !leg ? (
          <p className="notice">이동은 같은 날의 활동이 둘 이상 있어야 추가할 수 있습니다.</p>
        ) : null}
        {removing ? (
          <p className="notice">
            {title(leg!.fromActivityId)} → {title(leg!.toActivityId)} 이동을 계획에서 제거합니다. 활동은 그대로
            남습니다.
          </p>
        ) : (
          <>
            <label>
              출발 활동
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {items.map((item) => (
                  <option key={item.activityId} value={item.activityId}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              도착 활동
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {items.map((item) => (
                  <option key={item.activityId} value={item.activityId}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              이동 수단
              <input required value={mode} onChange={(e) => setMode(e.target.value)} />
            </label>
            <label>
              소요 시간 (선택)
              <input value={duration} onChange={(e) => setDuration(e.target.value)} />
            </label>
            <label>
              거리 (선택)
              <input value={distance} onChange={(e) => setDistance(e.target.value)} />
            </label>
          </>
        )}
        <label>
          변경 이유
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <div className="button-row">
          <button className="primary" disabled={busy}>
            {removing ? '제거 확인' : '이동 저장'}
          </button>
          {leg ? (
            <button type="button" onClick={() => setRemoving(!removing)}>
              {removing ? '제거 취소' : '이 이동 제거'}
            </button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
