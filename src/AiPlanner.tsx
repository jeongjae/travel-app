import { useEffect, useState, type FormEvent } from 'react';
import { repository } from './repository';
import { dateRange, uid, type Trip } from './domain';
import type { AiJob, AiRequest } from './ai-contract';
import { staticHosting } from './hosting';

const labels = {
  queued: '실행 준비',
  researching: '웹 조사 중',
  planning: '변경안 작성 중',
  validating: '변경안 검증 중',
  'awaiting-decision': '변경안 작성 완료',
  failed: '실패',
  cancelled: '중단됨',
  interrupted: '서버 재시작으로 중단됨',
};
const terminal = new Set(['awaiting-decision', 'failed', 'cancelled', 'interrupted']);
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    path,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Travel-App': '1' },
          body: JSON.stringify(body),
        },
  );
  const value = await res.json().catch(() => ({ error: 'AI 서버에 연결할 수 없습니다.' }));
  if (!res.ok) {
    throw new Error(value.error || 'AI 요청을 완료할 수 없습니다.');
  }
  return value as T;
}
export function AiPlanner({ trip }: { trip: Trip }) {
  const storageKey = `travel-app-ai-job:${trip.id}`;
  const [jobId, setJobId] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [job, setJob] = useState<AiJob | null>(null);
  const [prompt, setPrompt] = useState('');
  const [fromDate, setFromDate] = useState(trip.startDate);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const saved = job?.proposal ? trip.proposals.find((p) => p.id === job.proposal!.id) : undefined;
  const active = starting || (!!job && !terminal.has(job.status));
  useEffect(() => {
    if (staticHosting) {
      setConfigured(false);
      return;
    }
    let cancelled = false;
    void api<{ configured: boolean; model: string }>('/api/ai/status')
      .then((s) => {
        if (!cancelled) {
          setConfigured(s.configured);
          setModel(s.model);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfigured(false);
        }
      });
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      cancelled = true;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [nonce]);
  useEffect(() => {
    if (!jobId || !online || staticHosting) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const value = await api<AiJob>(`/api/ai/jobs/${jobId}`);
        if (stopped) {
          return;
        }
        if (value.tripId !== trip.id) {
          throw new Error('다른 여행의 AI 작업입니다.');
        }
        setJob(value);
        setError('');
        if (
          value.status === 'awaiting-decision' &&
          value.proposal &&
          !trip.proposals.some((p) => p.id === value.proposal!.id)
        ) {
          try {
            await repository.propose(value.proposal, `ai-save-${value.id}`);
          } catch (e) {
            if (!stopped) {
              setError(e instanceof Error ? e.message : '변경안 저장에 실패했습니다.');
            }
          }
        }
        if (!terminal.has(value.status) && !stopped) {
          timer = setTimeout(poll, 1200);
        }
      } catch (e) {
        if (!stopped) {
          setError(e instanceof Error ? e.message : '연결이 끊겼습니다. 상태를 다시 확인하세요.');
        }
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, trip.id, trip.revision, trip.proposals.length, online, nonce]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (starting) {
      return;
    }
    setStarting(true);
    setError('');
    const input: AiRequest = { id: uid(), trip: structuredClone(trip), fromDate, prompt };
    try {
      // Keep the id even when the HTTP acknowledgement is lost; polling never creates a paid request.
      localStorage.setItem(storageKey, input.id);
      setJobId(input.id);
      setJob(null);
      const created = await api<AiJob>('/api/ai/jobs', input);
      setJob(created);
      setNonce((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 요청을 시작할 수 없습니다.');
    } finally {
      setStarting(false);
    }
  }
  async function cancel() {
    if (!jobId) {
      return;
    }
    try {
      setJob(await api<AiJob>(`/api/ai/jobs/${jobId}/cancel`, {}));
      setError('');
      setNonce((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '중단 요청 실패');
    }
  }
  return (
    <section className="ai-boundary" aria-label="AI로 일정 다시 계획하기">
      <h3>AI로 일정 다시 계획하기</h3>
      <p>
        현재 계획·장소·실제 기록·요청을 OpenAI API로 보내 조사합니다. 과거 정정 이력은 제외하며 API 키는 서버에서만
        관리합니다. API 사용 요금이 발생하고, 모든 변경안은 확인 후 적용합니다.
      </p>
      {configured === false ? (
        <p role="status" className="notice">
          AI 서버가 연결되지 않았거나 키가 설정되지 않았습니다. 로컬 앱 서버를 확인하세요.
        </p>
      ) : null}
      {!online ? (
        <p className="notice">오프라인에서는 일정 조회·현장 기록을 사용할 수 있습니다. AI는 온라인에서 실행하세요.</p>
      ) : null}
      <form onSubmit={submit}>
        <label>
          변경 시작 날짜
          <select
            aria-label="변경 시작 날짜"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            disabled={active}
          >
            {dateRange(trip.startDate, trip.endDate).map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          AI에게 요청할 내용
          <textarea
            aria-label="AI에게 요청할 내용"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            required
            maxLength={1500}
            rows={3}
            placeholder="예: 산책을 건너뛰었어요. 내일 이후 일정을 공식 자료로 조사해 실내 위주로 조정해 주세요."
            disabled={active}
          />
        </label>
        <div className="button-row">
          <button
            type="submit"
            className="primary"
            disabled={active || !online || configured !== true || !prompt.trim()}
          >
            조사하고 변경안 만들기
          </button>
          {active ? (
            <button type="button" onClick={cancel}>
              AI 작업 중단
            </button>
          ) : null}
          <button type="button" onClick={() => setNonce((v) => v + 1)} disabled={starting || !online}>
            상태 다시 확인
          </button>
        </div>
        <p className="muted">
          {model ? `${model} · ` : ''}작업당 조사 1회·작성 최대 2회, 동시 2개·하루 20개 작업으로 제한합니다. 실패 후 새
          실행은 새 요청으로 처리합니다.
        </p>
      </form>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {job ? (
        <div aria-live="polite" className="ai-job">
          <strong>
            {saved?.status === 'applied'
              ? '사용자 확인 후 적용됨'
              : saved?.status === 'rejected'
                ? '사용자가 거절함'
                : saved
                  ? '변경안 저장됨 · 사용자 확인 대기'
                  : labels[job.status]}
          </strong>
          <p>
            기준 revision {job.baseRevision} · 작성 시도 {job.attempt}/2
          </p>
          {job.error ? (
            <p role="alert" className="error">
              {job.error}
            </p>
          ) : null}
          {job.sources.length ? (
            <details>
              <summary>AI가 참고한 웹 출처 ({job.sources.length}개)</summary>
              <ul>
                {job.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {saved ? <p>아래에서 변경 내용과 근거를 확인하세요. AI 조사 근거도 검토가 필요합니다.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
