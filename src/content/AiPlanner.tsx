import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { AiV2Job } from '../../server/ai-v2-jobs.ts';
import { consentFingerprint, type AiV2Payload, type AiV2Policy, type AiV2RequestKind } from '../ai-v2-contract.ts';
import {
  buildAiV2Payload,
  consentedRequest,
  currentPlan,
  displayedDayTimes,
  selectableRecords,
  selectedDays,
  type AiV2DayTimes,
} from '../ai-v2-context.ts';
import { materializeV2Proposal } from '../ai-v2-semantics.ts';
import type { ContentRepository } from '../repository';
import type { TripDataset } from '../contracts/v2';
import { command, ErrorText, errorText } from './ui';
import { staticHosting } from '../hosting';

const active = new Set(['queued', 'researching', 'planning', 'validating']);
const labels: Record<string, string> = {
  queued: '대기',
  researching: '출처 조사',
  planning: '변경안 작성',
  validating: '날짜·참조 검사',
  'awaiting-decision': '초안 준비',
  failed: '실패',
  cancelled: '중단',
  interrupted: '서버 재시작으로 중단',
};
const excludedFromSend = [
  '예약 번호·예약 메모(예약 활동은 "고정"과 시간대만)',
  '현장 메모(executionNote·실행 표시)',
  '메뉴·대안·재확인 항목·출처 표시',
  '숙소 상세',
  '사진·사진 캡션·첨부',
  '가이드·원천 파일 경로',
  '여행 이름·계획 사유',
  '선택 날짜와 무관한 활동·장소',
  '고르지 않은 현장 기록과 정정 전 기록',
];

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Travel-App': '1' },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'AI 서버에 연결하지 못했습니다.');
  }
  return data as T;
}

export default function AiPlanner({
  repo,
  header,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripDataset['header'];
  onSaved: () => void;
}) {
  const scopeKey = `travel-app-ai-v2:${repo.db.name}:${header.tripId}`;
  const [prompt, setPrompt] = useState(''),
    [requestKind, setRequestKind] = useState<AiV2RequestKind>('edit'),
    [fromDate, setFromDate] = useState(header.startDate);
  const [count, setCount] = useState(3),
    [includeRecords, setIncludeRecords] = useState(false),
    [recordIds, setRecordIds] = useState<string[]>([]),
    [dayTimes, setDayTimes] = useState<AiV2DayTimes>({});
  const [preview, setPreview] = useState<AiV2Payload | null>(null),
    [fingerprint, setFingerprint] = useState(''),
    [agreedFingerprint, setAgreedFingerprint] = useState('');
  const [job, setJob] = useState<AiV2Job | null>(null),
    [jobId, setJobId] = useState(() => localStorage.getItem(scopeKey) || '');
  const [status, setStatus] = useState<{ configured: boolean; model?: string; policy?: AiV2Policy } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const dataset = useLiveQuery(() => repo.get(header.tripId), [repo, header.tripId, header.domainRevision]);
  const policy = status?.policy;
  useEffect(() => {
    if (staticHosting) {
      setStatus({ configured: false });
      return;
    }
    let live = true;
    void api<{ configured: boolean; model?: string; policy?: AiV2Policy }>('/api/ai/v2/status')
      .then((value) => {
        if (live) {
          setStatus(value);
        }
      })
      .catch(() => {
        if (live) {
          setStatus({ configured: false });
        }
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await api<AiV2Job>(`/api/ai/v2/jobs/${jobId}`);
        if (!live) {
          return;
        }
        if (value.tripId !== header.tripId) {
          throw new Error('다른 여행의 AI 작업입니다.');
        }
        setJob(value);
        if (active.has(value.status)) {
          timer = setTimeout(() => void poll(), 2000);
        } else if (value.status === 'awaiting-decision' && value.result?.scope) {
          const current = await repo.get(value.tripId);
          const plan = current.plans.find((candidate) => candidate.planVersionId === value.basePlanVersionId);
          if (!plan) {
            throw new Error('AI 작업의 기준 계획을 찾지 못했습니다.');
          }
          // 서버는 보내지 않은 필드를 모른다. 전체 활동을 아는 이곳에서 변경안을 완성한다.
          const result = materializeV2Proposal(
            {
              id: value.id,
              tripId: value.tripId,
              baseDomainRevision: value.baseDomainRevision,
              plan,
              scope: value.result.scope,
              collectedAt: value.updatedAt,
            },
            value.result.output,
            { sources: value.result.sources },
          );
          const evidence = result.evidence.map(({ commitSeq: _, recordedAt: __, actor: ___, ...content }) => content);
          const stage = command(
            value.tripId,
            'StageAiProposal',
            { proposal: result.proposal, evidence },
            value.baseDomainRevision,
          );
          // Stable command ID makes result recovery/reload safe after an ambiguous response.
          await repo.execute({ ...stage, requestId: value.id });
          if (live) {
            setSaved(true);
            onSavedRef.current();
          }
        }
      } catch (exception) {
        if (live) {
          setError(errorText(exception));
        }
      }
    }
    if (jobId && !staticHosting) {
      void poll();
    }
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [jobId, header.tripId, repo]);
  const selectionKey = JSON.stringify([
    prompt,
    requestKind,
    fromDate,
    count,
    includeRecords,
    recordIds,
    dayTimes,
    header.domainRevision,
  ]);
  useEffect(() => {
    setPreview(null);
  }, [selectionKey]);
  // 지문이 바뀌면 이전 동의와 달라지므로 동의는 자동으로 풀린다.
  useEffect(() => {
    let live = true;
    setFingerprint('');
    if (preview && policy) {
      void consentFingerprint(preview, policy).then((value) => {
        if (live) {
          setFingerprint(value);
        }
      });
    }
    return () => {
      live = false;
    };
  }, [preview, policy]);
  if (staticHosting) {
    return (
      <p className="notice">
        이 웹 버전에서는 AI 서버가 연결되지 않습니다. 저장된 변경안의 검토·적용과 기기 내 일정·기록·백업을 사용할 수
        있습니다.
      </p>
    );
  }
  const consent = Boolean(fingerprint) && fingerprint === agreedFingerprint;
  const days = dataset ? selectedDays(dataset, fromDate, count) : [];
  const records = dataset && includeRecords ? selectableRecords(dataset, fromDate, count) : [];
  const fixedCount = preview?.planning.items.filter((item) => item.fixed).length ?? 0;
  const setDayTime = (dayId: string, change: AiV2DayTimes[string]) => {
    setDayTimes((previous) => ({ ...previous, [dayId]: { ...previous[dayId], ...change } }));
  };
  return (
    <section className="content-row">
      <h3>AI 조사·변경안</h3>
      <p>선택한 일정에서 조사한 뒤 초안을 저장합니다. 현재 계획은 아래 ‘확인 후 적용’에서 결정합니다.</p>
      <p className="muted">
        {status?.configured ? `OpenAI · ${status.model}` : 'v2 AI 실행 설정 대기'} · 최대 7일 · 웹 조사 최대 2회 · 작성
        최대 2회
      </p>
      <ErrorText error={error} />
      <label>
        변경 요청
        <textarea value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <p className="muted">변경 요청 원문은 변경안 작성에만 쓰고 웹 검색에는 보내지 않습니다.</p>
      <div className="button-row">
        <label>
          요청 종류
          <select value={requestKind} onChange={(event) => setRequestKind(event.target.value as AiV2RequestKind)}>
            <option value="edit">수정</option>
            <option value="add">추가</option>
            <option value="remove">제거</option>
          </select>
        </label>
        <label>
          시작 날짜
          <input
            type="date"
            min={header.startDate}
            max={header.endDate}
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>
        <label>
          일수
          <input
            type="number"
            min={1}
            max={7}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
      </div>
      {dataset && days.length ? (
        <details>
          <summary>도착·출발 시각 (이 요청에만 사용)</summary>
          <p className="muted">여기 보이는 값 그대로 보냅니다. 지우면 보내지 않고 제약으로도 쓰지 않습니다.</p>
          {days.map((day) => {
            const shown = displayedDayTimes(currentPlan(dataset), day, dayTimes);
            return (
              <div key={day.dayId}>
                <div className="button-row">
                  <label>
                    {day.date} 도착{shown.arrival && shown.arrivalEstimated ? ' (이동에서 추정)' : ''}
                    <input
                      type="time"
                      value={shown.arrival}
                      onChange={(event) => setDayTime(day.dayId, { arrival: event.target.value })}
                    />
                  </label>
                  <label>
                    {day.date} 출발{shown.departure && shown.departureEstimated ? ' (이동에서 추정)' : ''}
                    <input
                      type="time"
                      value={shown.departure}
                      onChange={(event) => setDayTime(day.dayId, { departure: event.target.value })}
                    />
                  </label>
                </div>
                {shown.transit.length ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={shown.ignoreTransit}
                      onChange={(event) => setDayTime(day.dayId, { ignoreTransit: event.target.checked })}
                    />
                    {day.date} 이동 구간({shown.transit.map((gap) => `${gap.from}~${gap.to}`).join(', ')}) 제약 끄기
                  </label>
                ) : null}
              </div>
            );
          })}
        </details>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={includeRecords}
          onChange={(event) => {
            setIncludeRecords(event.target.checked);
            setRecordIds([]);
          }}
        />
        현장 기록·메모 골라서 포함
      </label>
      {includeRecords ? (
        records.length ? (
          <ul aria-label="보낼 현장 기록 선택">
            {records.map((record) => (
              <li key={record.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={recordIds.includes(record.id)}
                    onChange={(event) =>
                      setRecordIds((previous) =>
                        event.target.checked
                          ? [...previous, record.id]
                          : previous.filter((value) => value !== record.id),
                      )
                    }
                  />
                  {record.date} · {record.summary}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">선택한 날짜에 보낼 수 있는 기록이 없습니다.</p>
        )
      ) : null}
      <button
        disabled={busy || !prompt.trim() || Boolean(job && active.has(job.status))}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            setPreview(
              buildAiV2Payload(await repo.get(header.tripId), {
                prompt,
                requestKind,
                fromDate,
                count,
                recordIds: includeRecords ? recordIds : [],
                dayTimes,
              }),
            );
          } catch (exception) {
            setError(errorText(exception));
          } finally {
            setBusy(false);
          }
        }}
      >
        전송할 내용 미리보기
      </button>
      {preview ? (
        <div className="ai-preview">
          <label>
            조사 질문 (웹 검색에 보냄)
            <textarea
              value={preview.research.question}
              maxLength={500}
              onChange={(event) =>
                setPreview({ ...preview, research: { ...preview.research, question: event.target.value } })
              }
            />
          </label>
          <p>
            변경안 작성에 보내는 항목: 날짜 {preview.planning.days.length}일 · 활동 {preview.planning.items.length}
            개(고정 {fixedCount}개) · 장소 {preview.planning.places.length}곳 · 이동 {preview.planning.legs.length}건 ·
            기록 {preview.planning.records.length}건 · 변경 요청 원문
          </p>
          <details>
            <summary>보내지 않는 것</summary>
            <ul aria-label="전송 제외 항목">
              {excludedFromSend.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </details>
          <details>
            <summary>OpenAI에 보낼 일정·장소·선택 기록</summary>
            <pre>{JSON.stringify({ research: preview.research, planning: preview.planning }, null, 2)}</pre>
          </details>
          <p>활동 제목·요약, 날짜 제목·도시, 장소 이름·요약은 그대로 보냅니다. 개인 정보가 없는지 위에서 확인하세요.</p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={!fingerprint}
              onChange={(event) => setAgreedFingerprint(event.target.checked ? fingerprint : '')}
            />
            위 내용 전송과 OpenAI API 유료 실행에 동의
          </label>
          <button
            className="primary"
            disabled={!consent || !policy || !status?.configured || busy || !navigator.onLine}
            onClick={async () => {
              if (!policy) {
                return;
              }
              setBusy(true);
              setError('');
              setSaved(false);
              try {
                const next = await api<AiV2Job>('/api/ai/v2/jobs', await consentedRequest(preview, policy));
                localStorage.setItem(scopeKey, next.id);
                setJob(next);
                setJobId(next.id);
                setPreview(null);
                setAgreedFingerprint('');
              } catch (exception) {
                setError(errorText(exception));
              } finally {
                setBusy(false);
              }
            }}
          >
            조사하고 초안 만들기
          </button>
        </div>
      ) : null}
      {job ? (
        <div role="status">
          <p>
            {labels[job.status]} · 작성 {job.attempt}회{saved ? ' · 변경안에 저장됨' : ''}
          </p>
          {job.error ? <ErrorText error={job.error} /> : null}
          {active.has(job.status) ? (
            <button
              onClick={() => {
                void api<AiV2Job>(`/api/ai/v2/jobs/${job.id}/cancel`, {})
                  .then(setJob)
                  .catch((exception) => setError(errorText(exception)));
              }}
            >
              AI 작업 중단
            </button>
          ) : null}
          <ul>
            {job.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
