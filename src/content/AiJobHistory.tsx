import { useEffect, useRef, useState } from 'react';
import type { AiV2JobSummary } from '../ai-v2-jobs-core.ts';
import { jobStatusLabel } from './ai-job-label.ts';
import { aiFetch } from './ai-client.ts';
import { errorText } from './ui';

/**
 * 이 여행의 최근 AI 작업 기록(CL-38). 상태·시각·토큰·웹 검색 수만 보이고 요청·결과 내용은 없다.
 * `version`이 바뀌면(작업 생성·종료) 다시 읽는다.
 */
export default function AiJobHistory({
  tripId,
  labels,
  version,
  onAuthError,
}: {
  tripId: string;
  labels: Record<string, string>;
  version: number;
  onAuthError: (exception: unknown) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<AiV2JobSummary[] | null>(null);
  const [error, setError] = useState('');
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;
  useEffect(() => {
    // 펼쳤을 때만 읽는다. 접힌 동안에는 서버 요청도, 상태 문구 중복도 없다.
    if (!open) {
      return;
    }
    let live = true;
    aiFetch<{ jobs: AiV2JobSummary[] }>(`/api/ai/v2/jobs?tripId=${encodeURIComponent(tripId)}`)
      .then((value) => {
        if (live) {
          setJobs(value.jobs);
          setError('');
        }
      })
      .catch((exception) => {
        if (live && !onAuthErrorRef.current(exception)) {
          setError(errorText(exception));
        }
      });
    return () => {
      live = false;
    };
    // 콜백은 매 렌더 새로 만들어지므로 여행·버전이 바뀔 때만 읽는다.
  }, [tripId, version, open]);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>AI 작업 기록{jobs ? ` (${jobs.length}건)` : ''}</summary>
      {open && error ? <p className="muted">작업 기록을 읽지 못했습니다: {error}</p> : null}
      {open && jobs && !jobs.length ? <p className="muted">이 여행의 AI 작업이 없습니다.</p> : null}
      {open && jobs?.length ? (
        <ul aria-label="AI 작업 기록">
          {jobs.map((job) => (
            <li key={job.id}>
              {new Date(job.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
              {jobStatusLabel(job.status, labels) ?? job.status} · 토큰 {job.usage.totalTokens.toLocaleString('ko-KR')}{' '}
              · 웹 검색 {job.usage.webSearchCalls}
              {job.usage.toolCallItems !== undefined ? ` (도구 항목 ${job.usage.toolCallItems})` : ''} · 출처{' '}
              {job.sourceCount}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="muted">최근 50건. 서버 보관 기한이 지난 작업은 ‘만료’로 보입니다.</p>
    </details>
  );
}
