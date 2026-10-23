import { useLiveQuery } from 'dexie-react-hooks';
import type { ContentRepository } from '../repository';
import type { RevisionRef } from '../contracts/v2';

export function PhraseContext({
  repo,
  tripId,
  dayId,
  placeType,
  context,
}: {
  repo: ContentRepository;
  tripId: string;
  dayId?: string;
  placeType?: string;
  context?: RevisionRef[];
}) {
  const books = useLiveQuery(
    async () =>
      context
        ? await Promise.all(
            context
              .filter((ref) => ref.targetKind === 'phrase-book')
              .map((ref) => repo.content(tripId, 'phrase-book', ref.entityId, ref.revisionId)),
          )
        : await repo.catalog(tripId, 'phrase-book'),
    [repo, tripId, context],
    [],
  );
  const phrases = books.flatMap((book) => {
    if (book?.kind !== 'phrase-book') {
      return [];
    }
    const selected = new Set(
      book.payload.contextRecommendations
        .filter(
          (recommendation) =>
            (dayId && recommendation.dayIds.includes(dayId)) || (placeType && recommendation.placeType === placeType),
        )
        .flatMap((recommendation) => recommendation.phraseIds),
    );
    return book.payload.phrases.filter((phrase) => selected.has(phrase.id));
  });
  return phrases.length ? (
    <details>
      <summary>{dayId ? '오늘 쓸 회화' : '이 장소에서 쓸 회화'}</summary>
      {phrases.map((phrase) => (
        <p key={phrase.id}>
          <strong>{phrase.text}</strong>
          <br />
          {phrase.translation} · {phrase.pronunciationHint}
        </p>
      ))}
    </details>
  ) : null;
}
