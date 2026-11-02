import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { ContentRevision, PlanVersion, RevisionRef, TimeSpec } from '../contracts/v2';
import type { ContentRepository } from '../repository';
import { AssetImage } from './Guide';
import { timeLabel } from './ui';

/** 하단 탭: 사용 단계 순서(지금 → 훑기 → 찾기 → 남기기 → 나머지). 나머지 기능은 모두 더보기 아래에 있다. */
export const journeyTabs = [
  { label: '오늘', tab: '일정', icon: 'today' },
  { label: '일정', tab: '전체 일정', icon: 'list' },
  { label: '가이드', tab: '장소·지역', icon: 'guide' },
  { label: '기록', tab: '실제 기록', icon: 'record' },
  { label: '더보기', tab: '더보기', icon: 'more' },
] as const;

export function JourneyIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    today: 'M12 3a9 9 0 1 0 9 9M12 3v3m0 6 4-4M3 12h3m6 6v3m6-9h3',
    list: 'M4 6h16M4 12h16M4 18h16',
    guide: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3 4-2 6-4 4 2-6 4-4Z',
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
    check: 'M5 3h14v18H5V3Zm3 8 3 3 5-6',
    record: 'M5 3h14v18H5V3Zm3 5h8M8 12h8M8 16h5',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
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

/** 하루 머리의 날짜는 한 번만 쓴다. 예) 12월 31일 (목) · 1일차 */
export function dayHeading(date: string, dayNumber: number) {
  const label = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  return `${label} · ${dayNumber}일차`;
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

const dayTypeLabels: Record<string, string> = {
  city: '도시 일정',
  transfer: '이동일',
  driving: '운전일',
  living: '생활일',
};

/**
 * 하루 머리: 날짜는 한 번(제목), 지역·숙박은 그 아래 한 줄. 지금/다음 카드는 여행 중 오늘일 때만 보인다.
 * 예약 목록은 타임라인 아래({@link DayBookings})에 둔다.
 */
export function DayLead({
  day,
  dayNumber,
  items,
  catalog,
  regionText,
  stays,
  onNavigate,
}: {
  day: PlanVersion['days'][number];
  dayNumber: number;
  items: PlanVersion['items'];
  catalog: ContentRevision[];
  regionText: string;
  stays: ReactNode;
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
    : undefined;
  const city = day.cityText && day.cityText !== day.title ? day.cityText : '';
  const title = day.title && day.title !== day.date ? day.title : '';
  const detail = [
    day.dayType ? (dayTypeLabels[day.dayType] ?? day.dayType) : '',
    day.durationText,
    day.distanceText,
    day.fatigueText ? `피로도 ${day.fatigueText}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <header className="day-intro">
        <h2>{dayHeading(day.date, dayNumber)}</h2>
        {city ? <p className="day-city">{city}</p> : null}
        {title ? <p className="day-summary">{title}</p> : null}
        {detail ? <p className="muted">{detail}</p> : null}
        <p className="day-regions muted">{regionText}</p>
        {stays}
      </header>
      {next ? (
        <section className="next-action" aria-label="지금·다음 일정">
          <span className="journey-label">지금·다음</span>
          <p className="action-line">
            <span className="action-time">{clockLabel(next.time.start)}</span>
            <span className="action-title">{next.title}</span>
          </p>
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
      ) : isToday && items.length > 0 ? (
        <p className="notice">오늘 계획된 시간표의 마지막 시각이 지났습니다. 아래에서 전체 일정을 확인하세요.</p>
      ) : null}
      {items.length === 0 ? (
        <p className="notice">이 날에는 아직 일정이 없습니다. '활동 추가'로 장소나 활동을 넣어 보세요.</p>
      ) : null}
      <h3 className="sr-only">하루 일정</h3>
    </>
  );
}

export function DayBookings({ items }: { items: PlanVersion['items'] }) {
  const reservations = items.filter((item) => item.reservationText || item.bookingIds.length);
  if (!reservations.length) {
    return null;
  }
  return (
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
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [dayId]);
  return (
    <nav className="day-strip" aria-label="날짜별 일정">
      {plan.days
        .toSorted((a, b) => a.ordinal - b.ordinal)
        .map((day) => (
          <button
            key={day.dayId}
            ref={dayId === day.dayId ? activeRef : undefined}
            data-date={day.date}
            aria-current={dayId === day.dayId ? 'date' : undefined}
            onClick={() => onSelect(day.dayId)}
          >
            <span>{dateLabel(day.date)}</span>
          </button>
        ))}
    </nav>
  );
}

export function ScheduleOverview({
  plan,
  onSelect,
  regionName,
}: {
  plan: PlanVersion;
  onSelect: (id: string) => void;
  regionName?: (regionId: string) => string;
}) {
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
              {regionName && (day.regionIds.length || plan.legs.some((leg) => leg.dayId === day.dayId)) ? (
                <p className="muted">
                  {[
                    day.regionIds.length ? `지역 ${day.regionIds.map(regionName).join(', ')}` : '',
                    day.overnightRegionId ? `숙박 지역 ${regionName(day.overnightRegionId)}` : '',
                    plan.legs.some((leg) => leg.dayId === day.dayId)
                      ? `이동 ${plan.legs.filter((leg) => leg.dayId === day.dayId).length}개`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
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
