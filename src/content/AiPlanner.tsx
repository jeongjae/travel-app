import { useEffect, useRef, useState } from 'react';
import type { AiV2Job } from '../../server/ai-v2-jobs.ts';
import type { AiV2Request } from '../ai-v2-contract.ts';
import { buildAiV2Request } from '../ai-v2-context.ts';
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
    [fromDate, setFromDate] = useState(header.startDate);
  const [count, setCount] = useState(3),
    [includeRecords, setIncludeRecords] = useState(false);
  const [preview, setPreview] = useState<AiV2Request | null>(null),
    [consent, setConsent] = useState(false);
  const [job, setJob] = useState<AiV2Job | null>(null),
    [jobId, setJobId] = useState(() => localStorage.getItem(scopeKey) || '');
  const [status, setStatus] = useState<{ configured: boolean; model?: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  useEffect(() => {
    if (staticHosting) {
      setStatus({ configured: false });
      return;
    }
    let live = true;
    void api<{ configured: boolean; model?: string }>('/api/ai/v2/status')
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
        } else if (value.status === 'awaiting-decision' && value.result) {
          const evidence = value.result.evidence.map(
            ({ commitSeq: _, recordedAt: __, actor: ___, ...content }) => content,
          );
          const stage = command(
            value.tripId,
            'StageAiProposal',
            { proposal: value.result.proposal, evidence },
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
  useEffect(() => {
    setPreview(null);
    setConsent(false);
  }, [prompt, fromDate, count, includeRecords]);
  if (staticHosting) {
    return (
      <p className="notice">
        이 웹 버전에서는 AI 서버가 연결되지 않습니다. 저장된 변경안의 검토·적용과 기기 내 일정·기록·백업을 사용할 수
        있습니다.
      </p>
    );
  }
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
      <div className="button-row">
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
      <label>
        <input type="checkbox" checked={includeRecords} onChange={(event) => setIncludeRecords(event.target.checked)} />
        현장 기록·메모도 컨텍스트에 포함
      </label>
      <button
        disabled={busy || !prompt.trim() || Boolean(job && active.has(job.status))}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            setPreview(buildAiV2Request(await repo.get(header.tripId), prompt, fromDate, count, includeRecords));
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
        <>
          <details open>
            <summary>OpenAI에 보낼 일정·장소·선택 기록</summary>
            <pre>{JSON.stringify(preview.context, null, 2)}</pre>
          </details>
          <p>
            사진·첨부 바이트, 숙소 상세, 예약의 비공개 필드는 보내지 않습니다. 입력한 요청·일정 요약에 포함된 정보는 위
            내용으로 확인하세요.
          </p>
          <label>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />위 내용
            전송과 OpenAI API 유료 실행에 동의
          </label>
          <button
            className="primary"
            disabled={!consent || !status?.configured || busy || !navigator.onLine}
            onClick={async () => {
              setBusy(true);
              setError('');
              setSaved(false);
              try {
                const next = await api<AiV2Job>('/api/ai/v2/jobs', preview);
                localStorage.setItem(scopeKey, next.id);
                setJob(next);
                setJobId(next.id);
                setPreview(null);
                setConsent(false);
              } catch (exception) {
                setError(errorText(exception));
              } finally {
                setBusy(false);
              }
            }}
          >
            조사하고 초안 만들기
          </button>
        </>
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
