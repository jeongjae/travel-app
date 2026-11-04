import type { ActualChainEntry, ActualRecord } from './field-rules';
import { clockLabel } from './Journey';

const outcomeText = { visited: '방문', skipped: '건너뜀', unplanned: '예정 외' } as const;

/** 계획 항목 카드 안의 한 줄 배지: 그 활동의 최신 기록 결과와 시각(`방문 14:20` / `건너뜀`). */
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export function RecordBadge({ record, planDate }: { record: ActualRecord | undefined; planDate?: string }) {
  if (!record) {
    return null;
  }
  const start = record.payload.time.start;
  const clock = start.precision === 'local' || start.precision === 'instant' ? ` ${clockLabel(start)}` : '';
  // 계획 날짜와 다른 날로 정정된 기록은 발생일을 붙인다(`방문 1/1 00:30`).
  const moved = planDate && start.date && start.date !== planDate ? ` ${shortDate(start.date)}` : '';
  return (
    <p className="record-badge" aria-label="이 활동의 실제 기록">
      <span className={`record-badge-pill record-badge-${record.payload.outcome}`}>
        {outcomeText[record.payload.outcome]}
        {record.payload.outcome === 'skipped' ? moved : `${moved}${clock}`}
      </span>
    </p>
  );
}

/**
 * 계획에 없는 실제 기록을 타임라인 사이에 보이는 기록 전용 카드. 계획 항목이 아니므로
 * 계획 편집 메뉴는 없고 `정정`과 `기록 탭에서 보기`만 둔다.
 */
export function TimelineRecordCard({
  entry,
  plannedOn,
  onCorrect,
  onShow,
}: {
  entry: ActualChainEntry;
  /** 다른 날 계획 항목의 기록이면 그 계획 날짜. */
  plannedOn?: string;
  onCorrect: (record: ActualRecord) => void;
  onShow: () => void;
}) {
  const { latest } = entry;
  const start = latest.payload.time.start;
  const hasClock = start.precision === 'local' || start.precision === 'instant';
  return (
    <article className="content-row timeline-record" aria-label={`실제 기록 ${latest.payload.title}`}>
      <p className="timeline-time">
        <span className="record-badge-pill record-badge-unplanned">{outcomeText[latest.payload.outcome]}</span>{' '}
        {hasClock ? clockLabel(start) : '시각 없음'}
      </p>
      <h3>{latest.payload.title}</h3>
      {plannedOn ? <p className="timeline-record-note">{shortDate(plannedOn)} 계획 항목의 기록</p> : null}
      {latest.payload.note ? <p className="timeline-record-note">{latest.payload.note}</p> : null}
      <div className="button-row">
        <button type="button" onClick={() => onCorrect(latest)}>
          정정
        </button>
        <button type="button" onClick={onShow}>
          기록 탭에서 보기
        </button>
      </div>
    </article>
  );
}
