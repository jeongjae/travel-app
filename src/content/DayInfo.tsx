import { useState } from 'react';
import type { ContentRepository } from '../repository';
import type { PlanVersion, TripDataset } from '../contracts/v2';
import { command, errorText, ErrorText, Modal } from './ui';

type PlanDay = PlanVersion['days'][number];

/** 날짜 제목·도시만 고친다(`update-day`). 새 계획 버전 하나로 저장하며 다른 칸은 그대로다. */
export function DayInfoDialog({
  repo,
  header,
  plan,
  day,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripDataset['header'];
  plan: PlanVersion;
  day: PlanDay;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(day.title);
  const [cityText, setCityText] = useState(day.cityText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmedTitle = title.trim();
  const unchanged = trimmedTitle === day.title && cityText.trim() === day.cityText;
  async function save() {
    if (!trimmedTitle) {
      setError('날짜 제목을 입력하세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await repo.execute(
        command(
          header.tripId,
          'ChangePlan',
          {
            currentPlanVersionId: plan.planVersionId,
            operations: [{ type: 'update-day', dayId: day.dayId, title: trimmedTitle, cityText: cityText.trim() }],
            reason: '사용자 날짜 정보 수정',
          },
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
    <Modal title="날짜 정보 수정" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="muted">{day.date}</p>
        <label>
          날짜 제목
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          도시 (선택)
          <input value={cityText} onChange={(event) => setCityText(event.target.value)} />
        </label>
        <ErrorText error={error} />
        <div className="form-actions">
          <button className="primary" disabled={busy || !trimmedTitle || unchanged}>
            날짜 정보 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
