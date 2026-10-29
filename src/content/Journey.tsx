import { useEffect, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { ContentRevision, PlanVersion, RevisionRef, TimeSpec } from '../contracts/v2';
import type { ContentRepository } from '../repository';
import { AssetImage } from './Guide';
import { timeLabel } from './ui';

export const journeyTabs = [
  { label: '오늘', tab: '일정', icon: 'today' },
  { label: '전체 일정', tab: '전체 일정', icon: 'list' },
  { label: '가이드', tab: '장소·지역', icon: 'guide' },
  { label: '지도', tab: '지도', icon: 'map' },
  { label: '준비', tab: '준비·회화', icon: 'check' },
] as const;

export function JourneyIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    today: 'M12 3a9 9 0 1 0 9 9M12 3v3m0 6 4-4M3 12h3m6 6v3m6-9h3',
    list: 'M4 6h16M4 12h16M4 18h16',
    guide: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3 4-2 6-4 4 2-6 4-4Z',
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
    check: 'M5 3h14v18H5V3Zm3 8 3 3 5-6',
  };
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d={paths[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function clockLabel(time: TimeSpec) {
  return time.precision === 'local' || time.precision === 'instant' ? time.localTime.slice(0, 5) : timeLabel(time);
}

export function dateLabel(date: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function MapLink({ target }: { target?: ContentRevision }) {
  if (target?.kind !== 'map-target') {
    return null;
  }
  const payload = target.payload;
  const href =
    payload.mapKind === 'place'
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(payload.query)}`
      : payload.mapKind === 'route'
        ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(payload.routeOrigin)}&destination=${encodeURIComponent(payload.routeDestination)}`
        : undefined;
  return href ? (
    <a className="journey-map-link" href={href} target="_blank" rel="noreferrer">
      외부 지도 열기
    </a>
  ) : null;
}

export function DayLead({
  day,
  items,
  catalog,
  onNavigate,
}: {
  day: PlanVersion['days'][number];
  items: PlanVersion['items'];
  catalog: ContentRevision[];
  onNavigate: (kind: ContentRevision['kind'], id: string) => void;
}) {
  const [now, setNow] = useState(() => Temporal.Now.instant());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Temporal.Now.instant()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const timed = items.filter(
    (item) => item.category !== 'hotel' && ['local', 'instant'].includes(item.time.start.precision),
  );
  const firstTime = timed[0]?.time.start;
  const zone = firstTime && 'timeZone' in firstTime ? firstTime.timeZone : undefined;
  const sameZone = timed.every((item) => 'timeZone' in item.time.start && item.time.start.timeZone === zone);
  const local = zone && sameZone ? now.toZonedDateTimeISO(zone) : undefined;
  const isToday = local?.toPlainDate().toString() === day.date;
  const next = isToday
    ? timed.find((item) => {
        const end = item.time.end;
        const boundary = end && (end.precision === 'local' || end.precision === 'instant') ? end : item.time.start;
        return (
          (boundary.precision === 'local' || boundary.precision === 'instant') &&
          Temporal.PlainDateTime.compare(`${boundary.date}T${boundary.localTime}`, local.toPlainDateTime()) >= 0
        );
      })
    : (timed[0] ?? items[0]);
  const reservations = items.filter((item) => item.reservationText || item.bookingIds.length);
  const dayTypes: Record<string, string> = {
    city: 'CITY DAY',
    transfer: 'TRANSFER DAY',
    driving: 'DRIVING DAY',
    living: 'LIVING DAY',
  };
  return (
    <>
      <header className="day-intro">
        <p className="day-meta">
          <span>{dateLabel(day.date)}</span>
        </p>
        <h2>{day.cityText || day.title}</h2>
        <p className="day-summary">{day.title}</p>
        <p className="muted">
          {[
            day.dayType ? (dayTypes[day.dayType] ?? day.dayType) : '',
            day.fatigueText ? `피로도 ${day.fatigueText}` : '',
            day.distanceText,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>
      {next ? (
        <section className="next-action" aria-label="다음 일정">
          <span className="journey-label">{isToday ? 'NEXT · 다음 일정' : 'FIRST · 첫 일정'}</span>
          <p className="action-time">{clockLabel(next.time.start)}</p>
          <p className="action-title">{next.title}</p>
          <p>{next.summary}</p>
          <div className="button-row">
            <MapLink
              target={catalog.find((content) => content.kind === 'map-target' && content.entityId === next.mapTargetId)}
            />
            {next.placeLinks.slice(0, 1).map((link) => (
              <button key={link.placeId} onClick={() => onNavigate('place', link.placeId)}>
                장소 안내
              </button>
            ))}
            {next.officialUrl ? (
              <a href={next.officialUrl} target="_blank" rel="noreferrer">
                티켓·공식
              </a>
            ) : null}
          </div>
        </section>
      ) : items.length === 0 ? (
        <p className="notice">이 날에는 아직 일정이 없습니다. 아래 '활동 추가'로 장소나 활동을 넣어 보세요.</p>
      ) : (
        <p className="notice">오늘 계획된 시간표의 마지막 시각이 지났습니다. 아래에서 전체 일정을 확인하세요.</p>
      )}
      {reservations.length ? (
        <section className="day-bookings" aria-label="오늘 예약">
          <h3>오늘 예약</h3>
          {reservations.map((item) => (
            <p key={item.activityId}>
              <strong>
                {clockLabel(item.time.start)} · {item.title}
              </strong>
              <br />
              {item.reservationText || '예약·할 일에서 상세 내용을 확인하세요.'}
            </p>
          ))}
        </section>
      ) : null}
      <h3 className="editorial-heading">오늘 일정</h3>
    </>
  );
}

export function DayStrip({
  plan,
  dayId,
  onSelect,
}: {
  plan: PlanVersion;
  dayId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="day-strip" aria-label="날짜별 일정">
      {plan.days
        .toSorted((a, b) => a.ordinal - b.ordinal)
        .map((day) => (
          <button
            key={day.dayId}
            aria-current={dayId === day.dayId ? 'date' : undefined}
            onClick={() => onSelect(day.dayId)}
          >
            <span>{dateLabel(day.date)}</span>
          </button>
        ))}
    </nav>
  );
}

export function ScheduleOverview({ plan, onSelect }: { plan: PlanVersion; onSelect: (id: string) => void }) {
  return (
    <section className="schedule-overview">
      <h2>전체 일정</h2>
      <p className="muted">날짜를 선택해 하루의 일정과 가이드를 펼쳐 보세요.</p>
      <div className="journey-grid">
        {plan.days
          .toSorted((a, b) => a.ordinal - b.ordinal)
          .map((day) => (
            <article className="journey-card" key={day.dayId}>
              <div className="day-meta">
                <span>{dateLabel(day.date)}</span>
              </div>
              <h3>
                <button onClick={() => onSelect(day.dayId)}>{day.cityText || day.title}</button>
              </h3>
              <p>{day.title}</p>
              <p className="muted">
                {[day.durationText, day.distanceText, day.fatigueText ? `피로도 ${day.fatigueText}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </article>
          ))}
      </div>
    </section>
  );
}

export function GuideCard({
  repo,
  content,
  context,
  onOpen,
}: {
  repo: ContentRepository;
  content: Extract<ContentRevision, { kind: 'place' | 'region' }>;
  context?: RevisionRef[];
  onOpen: () => void;
}) {
  const photo = content.payload.assetRefs.find((asset) => asset.role === 'hero') ?? content.payload.assetRefs[0];
  return (
    <article className="journey-card guide-card">
      {photo ? (
        <AssetImage
          repo={repo}
          tripId={content.tripId}
          assetId={photo.assetId}
          context={context}
          alt={photo.caption ?? content.payload.name}
        />
      ) : null}
      <div className="guide-card-body">
        <h3>
          <button onClick={onOpen}>{content.payload.name}</button>
        </h3>
        <p>{content.kind === 'place' ? content.payload.summary : content.payload.tagline}</p>
        {content.kind === 'place' && content.payload.gradeLabel ? (
          <span className="journey-label">{content.payload.gradeLabel}</span>
        ) : null}
      </div>
    </article>
  );
}
