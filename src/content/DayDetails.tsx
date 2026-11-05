import { useLiveQuery } from 'dexie-react-hooks';
import type { ContentRepository } from '../repository';
import type { ContentRevision, PlanVersion, RevisionRef } from '../contracts/v2';
import { AssetImage } from './Guide';
import { timeLabel } from './ui';
import { PhraseContext } from './PhraseContext';
import { planDayPhotos } from './day-photos';

export function DayDetails({
  repo,
  day,
  items,
  places,
  context,
  onNavigate,
}: {
  repo: ContentRepository;
  day: PlanVersion['days'][number];
  items: PlanVersion['items'];
  places: Extract<ContentRevision, { kind: 'place' }>[];
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
  // 날짜·도시·하루 유형·거리·피로도는 날짜 머리(DayLead)에 한 번만 쓴다. 여기서는 시각이 있을 때만 시각을 보인다.
  const photoPlan = planDayPhotos(day, items, places);
  // 캡션이 `장소 · 저작자 · 라이선스` 모양이면 장소 이름을 두 번 쓰지 않는다.
  const coverCredit = photoPlan.cover?.asset.caption?.replace(`${photoPlan.cover.label} · `, '');
  const hasClock = ['local', 'instant', 'text'].includes(day.time.start.precision);
  return (
    <div className="day-details">
      {hasClock ? (
        <p className="muted">
          {timeLabel(day.time.start)}
          {day.time.end ? ` ~ ${timeLabel(day.time.end)}` : ''}
        </p>
      ) : null}
      {photoPlan.cover ? (
        <>
          <figure className="day-cover">
            <AssetImage
              repo={repo}
              tripId={day.tripId}
              assetId={photoPlan.cover.asset.assetId}
              context={context}
              alt={photoPlan.cover.label}
            />
            <figcaption>
              <strong>{photoPlan.cover.label}</strong>
              {coverCredit ? ` · ${coverCredit}` : ''}
            </figcaption>
          </figure>
          {photoPlan.photos.length > 1 ? (
            <section className="day-photo-band" aria-label={`사진 ${photoPlan.photos.length}장`}>
              <h4>사진 {photoPlan.photos.length}장</h4>
              <ul>
                {photoPlan.photos.map((photo) => (
                  <li key={photo.asset.assetId}>
                    <AssetImage
                      repo={repo}
                      tripId={day.tripId}
                      assetId={photo.asset.assetId}
                      context={context}
                      alt={photo.label}
                      className="day-photo-thumb"
                      hideWhenMissing
                    />
                    <span>{photo.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <p className="muted day-photo-none">사진 없음</p>
      )}
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
      <PhraseContext repo={repo} tripId={day.tripId} dayId={day.dayId} context={context} />
    </div>
  );
}
