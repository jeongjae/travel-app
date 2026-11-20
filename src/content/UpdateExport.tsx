import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TripDataset } from '../contracts/v2';
import type { ContentRepository } from '../repository';
import {
  buildUpdateRequest,
  exportPlan,
  LARGE_EXPORT_LIMIT,
  REQUEST_KIND_LABEL,
  requestTextOf,
  type CatalogPlace,
  type CatalogRegion,
  type ExportResult,
  type ExportWarning,
  type RequestKind,
} from '../plan-update';
import { Modal } from './ui';

type Props = {
  repo: ContentRepository;
  header: TripDataset['header'];
  /** 활동에 연결된 장소의 이름을 장소 칸에 적는 데 쓴다. */
  places: CatalogPlace[];
  regions: CatalogRegion[];
  /** 날짜 화면에서 열면 그 날짜 하루로 범위를 채운다. 창에서 넓힐 수 있다. */
  initialDate?: string;
  onClose: () => void;
};

type Scope = 'all' | 'range';

const WARNING_TEXT: Record<ExportWarning['code'], (count: number) => string> = {
  'time-unrepresentable': (count) =>
    `${count}줄은 표에 적을 수 없는 시간이 있어 시간 칸을 비우고 메모 끝에 원래 시간을 적었습니다. 그대로 다시 가져오면 바뀌지 않고, 시간을 바꾸려면 시간 칸에 새로 적어야 합니다.`,
  'newline-flattened': (count) =>
    `${count}줄은 칸 안의 줄바꿈을 공백으로 바꿨습니다. 그대로 다시 가져오면 바뀌지 않지만, 그 칸을 고치면 줄바꿈이 사라집니다.`,
  'id-format': (count) => `${count}줄은 ID 형식이 양식과 달라 다시 가져올 때 오류가 됩니다.`,
  'stay-incomplete': (count) => `숙소 ${count}곳은 체크인 또는 체크아웃 날짜가 없어 그 칸을 비웠습니다.`,
};

function WarningList({ warnings }: { warnings: ExportWarning[] }) {
  const codes = [...new Set(warnings.map((warning) => warning.code))];
  if (codes.length === 0) {
    return null;
  }
  return (
    <section aria-label="내보내기 경고">
      <h3>확인할 것</h3>
      <ul>
        {codes.map((code) => {
          const rows = warnings.filter((warning) => warning.code === code);
          return (
            <li key={code}>
              {WARNING_TEXT[code](rows.length)}
              <details>
                <summary>해당 줄 보기</summary>
                <ul>
                  {rows.map((row, index) => (
                    <li key={index}>{row.where}</li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** "AI로 수정하기": 저장된 계획을 양식 글로 내보내 요청 틀과 함께 복사한다. 서버 호출이 없다. */
export function UpdateExportDialog({ repo, header, places, regions, initialDate, onClose }: Props) {
  const plan = useLiveQuery(
    () => repo.plan(header.tripId, header.currentPlanVersionId),
    [header.tripId, header.currentPlanVersionId],
  );
  const [scope, setScope] = useState<Scope>(initialDate ? 'range' : 'all');
  const [rangeStart, setRangeStart] = useState(initialDate ?? '');
  const [rangeEnd, setRangeEnd] = useState(initialDate ?? '');
  const [requestKind, setRequestKind] = useState<RequestKind>('free');
  const [request, setRequest] = useState('');
  const [includeReservation, setIncludeReservation] = useState(false);
  const [status, setStatus] = useState('');
  const [showText, setShowText] = useState(false);
  const dates = useMemo(() => (plan?.days ?? []).map((day) => day.date).sort(), [plan]);
  const start = rangeStart || dates[0] || '';
  const end = rangeEnd || dates.at(-1) || '';
  const rangeInvalid = scope === 'range' && start > end;
  const exported: ExportResult | undefined = useMemo(() => {
    if (!plan || rangeInvalid) {
      return undefined;
    }
    const placeNames = new Map(places.map((place) => [place.entityId, place.name]));
    return exportPlan(
      { header, plan, placeNames, places, regions },
      { includeReservation, ...(scope === 'range' ? { range: { start, end } } : {}) },
    );
  }, [plan, header, places, regions, scope, start, end, includeReservation, rangeInvalid]);
  const fullText = exported ? buildUpdateRequest(exported.text, request) : '';
  const tooLarge = fullText.length > LARGE_EXPORT_LIMIT;

  async function copy() {
    setStatus('');
    try {
      await navigator.clipboard.writeText(fullText);
      const where =
        request.trim() === '' ? ' 챗봇에 붙여 넣고 [요청] 자리에 고칠 내용을 적으세요.' : ' 챗봇에 붙여 넣으세요.';
      setStatus(`복사했습니다.${where} 돌아온 글은 "AI 결과 붙여넣기"로 가져오세요.`);
    } catch {
      setShowText(true);
      setStatus('복사하지 못했습니다. 아래 글을 길게 눌러 전체 선택한 뒤 복사하세요.');
    }
  }

  return (
    <Modal title="AI로 수정하기" onClose={onClose}>
      <p className="muted">
        저장된 계획을 양식 글로 만들어 복사합니다. 챗봇에게 고칠 내용을 요청한 뒤, 돌아온 코드 블록을 &quot;AI 결과
        붙여넣기&quot;에 붙여 넣으세요. 이 화면은 서버에 아무것도 보내지 않습니다.
      </p>
      <fieldset>
        <legend>범위</legend>
        <label>
          <input type="radio" name="export-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
          전체
        </label>
        <label>
          <input type="radio" name="export-scope" checked={scope === 'range'} onChange={() => setScope('range')} />
          날짜 범위
        </label>
        {scope === 'range' ? (
          <div className="date-row">
            <label>
              시작
              <select value={start} onChange={(event) => setRangeStart(event.target.value)}>
                {dates.map((date) => (
                  <option key={date}>{date}</option>
                ))}
              </select>
            </label>
            <label>
              끝
              <select value={end} onChange={(event) => setRangeEnd(event.target.value)}>
                {dates.map((date) => (
                  <option key={date}>{date}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {rangeInvalid ? (
          <p role="alert" className="error">
            시작 날짜가 끝 날짜보다 늦습니다.
          </p>
        ) : null}
      </fieldset>
      <label>
        <input
          type="checkbox"
          checked={includeReservation}
          onChange={(event) => setIncludeReservation(event.target.checked)}
        />
        예약 메모도 넣기
      </label>
      {includeReservation ? (
        <p className="muted">예약 메모는 챗봇 서비스에 그대로 전달됩니다. 필요할 때만 넣으세요.</p>
      ) : null}
      <label>
        요청 종류
        <select
          value={requestKind}
          onChange={(event) => {
            const kind = event.target.value as RequestKind;
            setRequestKind(kind);
            setRequest(requestTextOf(kind));
          }}
        >
          {(Object.keys(REQUEST_KIND_LABEL) as RequestKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {REQUEST_KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </label>
      <label>
        요청 내용
        <textarea
          rows={4}
          value={request}
          placeholder="고칠 내용을 적으세요. 비워 두면 챗봇에 붙여 넣은 뒤 [요청] 자리에 직접 적습니다."
          onChange={(event) => setRequest(event.target.value)}
        />
      </label>
      {exported ? (
        <>
          <p data-testid="export-counts">
            날짜 {exported.counts.days}일 · 활동 {exported.counts.activities}개 · 숙소 {exported.counts.stays}곳 ·{' '}
            {exported.counts.places > 0 ? `장소 ${exported.counts.places}곳 · ` : ''}
            <span data-testid="export-chars">{fullText.length.toLocaleString()}</span>자
          </p>
          {tooLarge ? (
            <p role="status" className="notice">
              글이 {LARGE_EXPORT_LIMIT.toLocaleString()}자를 넘어 챗봇이 다루기 어렵습니다. 날짜 범위를 골라 나눠
              요청하세요.
            </p>
          ) : null}
          <WarningList warnings={exported.warnings} />
          <div className="button-row prep-actions">
            <button type="button" className="primary" onClick={() => void copy()}>
              복사
            </button>
            <button type="button" onClick={() => downloadText(`travel-plan-${header.tripId.slice(0, 8)}.md`, fullText)}>
              파일로 저장
            </button>
          </div>
          {status ? <p role="status">{status}</p> : null}
          <details open={showText} onToggle={(event) => setShowText(event.currentTarget.open)}>
            <summary>나가는 글 전체 보기</summary>
            <textarea readOnly rows={12} value={fullText} aria-label="나가는 글" />
          </details>
        </>
      ) : null}
    </Modal>
  );
}
