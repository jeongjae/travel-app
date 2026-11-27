import { useState } from 'react';
import type { ContentRepository } from '../repository';
import type { TripDataset } from '../contracts/v2';
import { command, errorText, ErrorText, Modal } from './ui';

type TripHeader = TripDataset['header'];

/** 여행 이름만 바꾼다. 기간(startDate·endDate)은 지금 값을 그대로 보낸다. */
export function TripRenameDialog({
  repo,
  header,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripHeader;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(header.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmed = name.trim();
  const unchanged = trimmed === header.name;
  async function save() {
    if (!trimmed) {
      setError('여행 이름을 입력하세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await repo.execute(
        command(
          header.tripId,
          'UpdateTripMetadata',
          { name: trimmed, startDate: header.startDate, endDate: header.endDate },
          header.domainRevision,
        ),
      );
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="여행 이름 바꾸기" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          여행 이름
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="muted">기간은 바뀌지 않습니다.</p>
        <ErrorText error={error} />
        <div className="form-actions">
          <button className="primary" disabled={busy || !trimmed || unchanged}>
            이름 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
