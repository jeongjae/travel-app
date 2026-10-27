import type { FieldRecord } from '../contracts/v2';

export type NoteRecord = Extract<FieldRecord, { kind: 'note' }>;
type NoteTarget = Pick<NoteRecord['payload']['targetRef'], 'tripId' | 'targetKind' | 'entityId'>;

export function notesForTarget(records: FieldRecord[], target: NoteTarget): NoteRecord[] {
  const superseded = new Set(
    records.filter((record) => record.tripId === target.tripId).flatMap((record) => record.supersedes ?? []),
  );
  return records
    .filter(
      (record): record is NoteRecord =>
        record.kind === 'note' &&
        record.tripId === target.tripId &&
        record.payload.targetRef.tripId === target.tripId &&
        record.payload.targetRef.targetKind === target.targetKind &&
        record.payload.targetRef.entityId === target.entityId &&
        !superseded.has(record.recordId),
    )
    .toSorted(
      (a, b) =>
        b.commitSeq - a.commitSeq || b.recordedAt.localeCompare(a.recordedAt) || a.recordId.localeCompare(b.recordId),
    );
}

export function SavedNotes({ notes, emptyText }: { notes: NoteRecord[]; emptyText?: string }) {
  if (!notes.length) {
    return emptyText ? <p className="muted">{emptyText}</p> : null;
  }
  return (
    <section className="saved-notes" aria-label="저장된 메모">
      <h4>저장된 메모</h4>
      {notes.map((note) => (
        <article className="saved-note" key={note.recordId}>
          <p className="saved-note-body">{note.payload.body}</p>
          <p className="muted">
            저장 시각 <time dateTime={note.recordedAt}>{new Date(note.recordedAt).toLocaleString('ko-KR')}</time>
          </p>
        </article>
      ))}
    </section>
  );
}
