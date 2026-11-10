import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { AiV2Job } from '../ai-v2-jobs-core.ts';
import { jobStatusLabel } from './ai-job-label.ts';
import {
  aiV2AckPath,
  aiV2RunningStatuses,
  consentFingerprint,
  type AiV2Payload,
  type AiV2Request,
  type AiV2RequestKind,
  type AiV2ServerStatus,
} from '../ai-v2-contract.ts';
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
import { RepositoryError } from '../storage/content-repository';
import type { TripDataset } from '../contracts/v2';
import { command, ErrorText, errorText } from './ui';
import { aiApiAvailable } from '../hosting';
import {
  AiApiError,
  aiFetch,
  needsLogin,
  nextPollStep,
  readAuthState,
  saveToken,
  type AuthState,
} from './ai-client.ts';
import AiAuthPanel from './AiAuthPanel.tsx';

const active = new Set<string>(aiV2RunningStatuses);
const labels: Record<string, string> = {
  queued: '대기',
  calling: 'OpenAI 호출 중',
  researching: '출처 조사',
  planning: '변경안 작성',
  validating: '날짜·참조 검사',
  'awaiting-decision': '초안 준비',
  failed: '실패',
  cancelled: '중단',
  interrupted: '서버 재시작으로 중단',
  acknowledged: '저장 완료',
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

/** 변경안 저장(Stage) 실패. stale이면 다시 저장해도 같은 결과이므로 새 요청을 안내한다. */
type StageFailure = { message: string; stale: boolean };

/** 저장 중 실제 기록·계획이 바뀌어 기준 revision이 맞지 않는 거부. */
function isStale(exception: unknown) {
  return exception instanceof RepositoryError && exception.code === 'CONFLICT';
}

/** 응답을 받지 못해 서버가 요청을 받았는지 모르는 실패. 같은 요청 ID로 다시 보내면 서버가 같은 작업을 돌려준다. */
function unconfirmed(exception: unknown) {
  return exception instanceof AiApiError && (exception.status === 0 || exception.status >= 500);
}

function usageText(usage: AiV2Job['usage']) {
  return `토큰 ${usage.totalTokens.toLocaleString('ko-KR')} (입력 ${usage.inputTokens.toLocaleString('ko-KR')} · 출력 ${usage.outputTokens.toLocaleString('ko-KR')}) · 호출 ${usage.calls}회 · 웹 검색 ${usage.webSearchCalls}회`;
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
  const [status, setStatus] = useState<AiV2ServerStatus | null>(null);
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [statusVersion, setStatusVersion] = useState(0);
  const [pollVersion, setPollVersion] = useState(0);
  const [connectionLost, setConnectionLost] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [stageFailure, setStageFailure] = useState<StageFailure | null>(null);
  /** 응답을 못 받은 전송(B1). 같은 미리보기로 다시 누르면 같은 요청 ID로 보낸다. */
  const pendingRequest = useRef<AiV2Request | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const dataset = useLiveQuery(() => repo.get(header.tripId), [repo, header.tripId, header.domainRevision]);
  const policy = status?.policy;
  // 인증 단계: Worker는 패스키 로그인 뒤에만 상태(정책·잔여 횟수)를 읽는다.
  useEffect(() => {
    if (!aiApiAvailable) {
      return;
    }
    let live = true;
    void readAuthState().then((value) => {
      if (live) {
        setAuthState(value);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  const canCallApi = authState === 'logged-in' || authState === 'none';
  // Node 개발 서버(인증 없음)에는 저장 확인 경로가 없다.
  const acknowledgeRef = useRef(authState !== 'none');
  acknowledgeRef.current = authState !== 'none';
  // 오프라인이면 폴링·전송을 멈추고, 연결되면 폴링을 다시 시작한다(B10).
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  /** 401이면 토큰을 버리고 재로그인 안내로 바꾼다. 만료는 따로 알린다. */
  const handleAuthError = (exception: unknown) => {
    if (!needsLogin(exception)) {
      return false;
    }
    saveToken(null);
    setAuthState(exception instanceof AiApiError && exception.code === 'token_expired' ? 'expired' : 'logged-out');
    return true;
  };
  const handleAuthErrorRef = useRef(handleAuthError);
  handleAuthErrorRef.current = handleAuthError;
  useEffect(() => {
    if (!canCallApi) {
      setStatus(null);
      return;
    }
    let live = true;
    void aiFetch<AiV2ServerStatus>('/api/ai/v2/status')
      .then((value) => {
        if (live) {
          setStatus(value);
        }
      })
      .catch((exception) => {
        if (live && !handleAuthErrorRef.current(exception)) {
          setStatus({ configured: false });
        }
      });
    return () => {
      live = false;
    };
  }, [canCallApi, statusVersion]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        let value: AiV2Job;
        try {
          value = await aiFetch<AiV2Job>(`/api/ai/v2/jobs/${jobId}`);
        } catch (exception) {
          if (!live) {
            return;
          }
          const step = nextPollStep(exception, failures);
          if (step.action === 'login') {
            handleAuthErrorRef.current(exception);
            return;
          }
          // 연결 오류·5xx는 지수 백오프로 다시 묻고, 한도를 넘으면 사용자에게 넘긴다.
          if (step.action === 'retry') {
            failures += 1;
            timer = setTimeout(() => void poll(), step.delay);
            return;
          }
          if (step.action === 'lost') {
            setConnectionLost(true);
            return;
          }
          throw exception;
        }
        if (!live) {
          return;
        }
        failures = 0;
        setConnectionLost(false);
        if (value.tripId !== header.tripId) {
          throw new Error('다른 여행의 AI 작업입니다.');
        }
        setJob(value);
        if (active.has(value.status)) {
          timer = setTimeout(() => void poll(), 2000);
          return;
        }
        // 끝난 작업의 사용량이 오늘 합계에 들어가도록 상태를 다시 읽는다.
        setStatusVersion((version) => version + 1);
        if (value.status === 'awaiting-decision' && value.result) {
          try {
            await stageResult(value, value.result);
          } catch (exception) {
            // 서버 결과는 그대로 둔다(ACK 없음). 자동 재요청도 하지 않는다(B3·B5).
            if (live) {
              setStageFailure({ message: errorText(exception), stale: isStale(exception) });
            }
            return;
          }
          if (!live) {
            return;
          }
          setSaved(true);
          setStageFailure(null);
          onSavedRef.current();
          if (acknowledgeRef.current) {
            // 저장 확인(B4): 서버가 출력을 지운다. 유실되면 24시간 보존 기한이 지우므로 실패는 무시한다.
            try {
              const acknowledged = await aiFetch<AiV2Job>(aiV2AckPath(value.id), {});
              if (live) {
                setJob(acknowledged);
              }
            } catch {
              /* ACK 유실 허용 */
            }
          }
        }
      } catch (exception) {
        if (live) {
          setError(errorText(exception));
        }
      }
    }
    /** 서버는 보내지 않은 필드를 모른다. 전체 활동을 아는 이곳에서 변경안을 완성해 저장한다. */
    async function stageResult(value: AiV2Job, jobResult: NonNullable<AiV2Job['result']>) {
      const current = await repo.get(value.tripId);
      const plan = current.plans.find((candidate) => candidate.planVersionId === value.basePlanVersionId);
      if (!plan) {
        throw new Error('AI 작업의 기준 계획을 찾지 못했습니다.');
      }
      const result = materializeV2Proposal(
        {
          id: value.id,
          tripId: value.tripId,
          baseDomainRevision: value.baseDomainRevision,
          plan,
          scope: jobResult.scope,
          collectedAt: value.updatedAt,
        },
        jobResult.output,
        { sources: jobResult.sources },
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
    }
    if (jobId && aiApiAvailable && canCallApi && online) {
      void poll();
    }
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [jobId, header.tripId, repo, canCallApi, pollVersion, online]);
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
    // 미리보기·정책이 바뀌면 다른 요청이다. 응답을 못 받은 이전 요청은 다시 쓰지 않는다.
    pendingRequest.current = null;
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
  if (!aiApiAvailable) {
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
      <AiAuthPanel
        state={authState}
        onChange={(next) => {
          setError('');
          setAuthState(next);
        }}
      />
      {status?.dailyJobLimit !== undefined ? (
        <p className="muted" aria-label="오늘 AI 사용량">
          오늘 남은 요청 {status.remainingToday}/{status.dailyJobLimit} · 오늘 사용 토큰{' '}
          {(status.usageToday?.totalTokens ?? 0).toLocaleString('ko-KR')} (금액은 표시하지 않습니다)
        </p>
      ) : null}
      {!online ? (
        <p className="notice" aria-label="AI 연결 상태">
          오프라인 — AI 작업 확인과 전송을 멈췄습니다. 저장된 변경안의 조회·적용·거절은 그대로 할 수 있습니다.
        </p>
      ) : null}
      {jobId && !job && !canCallApi && authState !== 'checking' ? (
        <p className="notice">이 여행의 최근 AI 작업이 있습니다. 로그인하면 같은 작업을 이어서 확인합니다.</p>
      ) : null}
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
          {!canCallApi ? <p className="muted">로그인한 뒤에 동의하고 전송할 수 있습니다.</p> : null}
          <button
            className="primary"
            disabled={!canCallApi || !consent || !policy || !status?.configured || busy || !online}
            onClick={async () => {
              if (!policy) {
                return;
              }
              setBusy(true);
              setError('');
              setSaved(false);
              setStageFailure(null);
              try {
                pendingRequest.current ??= await consentedRequest(preview, policy);
                const next = await aiFetch<AiV2Job>('/api/ai/v2/jobs', pendingRequest.current);
                pendingRequest.current = null;
                localStorage.setItem(scopeKey, next.id);
                setJob(next);
                setJobId(next.id);
                setPreview(null);
                setAgreedFingerprint('');
                setStatusVersion((version) => version + 1);
              } catch (exception) {
                if (unconfirmed(exception)) {
                  setError(
                    '전송 결과를 확인하지 못했습니다. 다시 누르면 같은 요청으로 확인합니다(중복 실행·추가 횟수 없음).',
                  );
                } else {
                  pendingRequest.current = null;
                  if (!handleAuthError(exception)) {
                    setError(errorText(exception));
                  }
                }
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
            {jobStatusLabel(job.status, labels, job.error)} · 작성 {job.attempt}회
            {saved || job.status === 'acknowledged' ? ' · 변경안에 저장됨' : ''}
          </p>
          {stageFailure?.stale ? (
            <div role="alert">
              <p>계획이 바뀌어 적용할 수 없음 — 새 요청을 만드세요.</p>
              <p className="muted">
                AI 작업 뒤 실제 기록·계획이 저장되었습니다. 서버 결과는 24시간 동안 다시 받을 수 있습니다. (
                {stageFailure.message})
              </p>
            </div>
          ) : null}
          {stageFailure && !stageFailure.stale ? (
            <div role="alert">
              <p>변경안을 기기에 저장하지 못했습니다: {stageFailure.message}</p>
              <p className="muted">서버 결과는 그대로 있습니다. 저장 공간을 확인한 뒤 다시 저장하세요.</p>
              <button
                onClick={() => {
                  setStageFailure(null);
                  setPollVersion((version) => version + 1);
                }}
              >
                다시 저장
              </button>
            </div>
          ) : null}
          {job.usage ? <p className="muted">이 작업 사용량: {usageText(job.usage)}</p> : null}
          {job.error ? <ErrorText error={job.error} /> : null}
          {connectionLost ? (
            <p>
              연결 끊김 — AI 서버에서 작업 상태를 받지 못했습니다.{' '}
              <button
                onClick={() => {
                  setConnectionLost(false);
                  setPollVersion((version) => version + 1);
                }}
              >
                다시 시도
              </button>
            </p>
          ) : null}
          {active.has(job.status) ? (
            <button
              onClick={() => {
                void aiFetch<AiV2Job>(`/api/ai/v2/jobs/${job.id}/cancel`, {})
                  .then(setJob)
                  .catch((exception) => {
                    if (!handleAuthError(exception)) {
                      setError(errorText(exception));
                    }
                  });
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
