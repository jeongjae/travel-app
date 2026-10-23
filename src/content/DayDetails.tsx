import { useLiveQuery } from 'dexie-react-hooks';
import type { ContentRepository } from '../repository';
import type { ContentRevision, PlanVersion, RevisionRef } from '../contracts/v2';
import { AssetImage } from './Guide';
import { timeLabel } from './ui';

export function DayDetails({
  repo,
  day,
  context,
  onNavigate,
}: {
  repo: ContentRepository;
  day: PlanVersion['days'][number];
  context?: RevisionRef[];
  onNavigate: (kind: ContentRevision['kind'], id: string) => void;
}) {
  const guides = useLiveQuery(
    async () => {
      const candidates = context
        ? await Promise.all(
            context
              .filter((ref) => ref.targetKind === 'guide')
              .map((ref) => repo.content(day.tripId, 'guide', ref.entityId, ref.revisionId)),
          )
        : await repo.catalog(day.tripId, 'guide');
      return candidates.filter(
        (content): content is Extract<ContentRevision, { kind: 'guide' }> =>
          content?.kind === 'guide' &&
          content.payload.ownerRef.targetKind === 'day' &&
          content.payload.ownerRef.entityId === day.dayId &&
          content.payload.ownerRef.planVersionId === day.planVersionId,
      );
    },
    [repo, day.tripId, day.planVersionId, day.dayId, context],
    [],
  );
  return (
    <div className="day-details">
      <p className="muted">
        {day.cityText} · {timeLabel(day.time.start)}
        {day.time.end ? ` ~ ${timeLabel(day.time.end)}` : ''}
      </p>
      {day.assetRefs.slice(0, 1).map((asset) => (
        <figure key={asset.assetId}>
          <AssetImage repo={repo} tripId={day.tripId} assetId={asset.assetId} context={context} alt={asset.caption} />
          <figcaption>{asset.caption}</figcaption>
        </figure>
      ))}
      <p>
        {[day.dayType, day.durationText, day.distanceText, day.fatigueText ? `피로도 ${day.fatigueText}` : '']
          .filter(Boolean)
          .join(' · ')}
      </p>
      {day.highlights.length ? (
        <p>
          <strong>오늘의 핵심</strong> · {day.highlights.join(' · ')}
        </p>
      ) : null}
      {day.food.length ? (
        <p>
          <strong>식사</strong> · {day.food.join(' · ')}
        </p>
      ) : null}
      {day.transport.length ? (
        <p>
          <strong>교통</strong> · {day.transport.join(' · ')}
        </p>
      ) : null}
      {day.backupText ? (
        <p>
          <strong>대안</strong> · {day.backupText}
        </p>
      ) : null}
      {day.needsReview.length ? (
        <div className="notice">
          <strong>원천의 재확인 항목</strong>
          <ul>
            {day.needsReview.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="button-row">
        {guides.map((guide) => (
          <button key={guide.entityId} onClick={() => onNavigate('guide', guide.entityId)}>
            {guide.payload.title}
          </button>
        ))}
      </div>
    </div>
  );
}
