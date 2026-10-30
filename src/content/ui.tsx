import { useEffect, useRef, type ReactNode } from 'react';
import type { TimeSpec } from '../contracts/v2';
export function command(
  tripId: string,
  kind: string,
  payload: unknown,
  expectedDomainRevision?: number,
  extra: Record<string, unknown> = {},
) {
  return {
    format: 'travel-app-command',
    commandVersion: 2,
    normalizationVersion: 'neutral-v1',
    tripId,
    requestId: crypto.randomUUID(),
    kind,
    payload,
    ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
    ...extra,
  };
}
export function timeLabel(t: TimeSpec) {
  switch (t.precision) {
    case 'unspecified':
      return t.date ? `${t.date} · 시각 미정` : '시각 미정';
    case 'date':
      return `${t.date} · 날짜만 확인`;
    case 'text':
      return `${t.date ?? ''} ${t.rawText}`.trim();
    case 'local':
      return `${t.date} ${t.localTime} · ${t.timeZone ?? '시간대 미확인'}`;
    case 'instant':
      return `${t.date} ${t.localTime} ${t.timeZone} (${t.offset})`;
  }
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="error">
      {error}
    </p>
  ) : null;
}
export const errorText = (e: unknown) => (e instanceof Error ? e.message : '작업을 완료하지 못했습니다.');

type Request = ReturnType<typeof command>;
export type RequestAttempt = { key: string; request: Request } | undefined;
/**
 * 같은 입력의 재시도는 같은 요청 ID를 다시 보내 저장소가 replay로 처리하게 한다(중복 revision·가이드 방지).
 * 입력이 바뀌면 새 요청 ID를 만든다. 호출하는 쪽은 payload 안의 새 ID도 폼을 연 시점에 한 번만 만들어야 한다.
 */
export function reuseRequest(
  attempt: { current: RequestAttempt },
  tripId: string,
  kind: string,
  payload: unknown,
  expectedDomainRevision: number,
): Request {
  const key = JSON.stringify([kind, payload, expectedDomainRevision]);
  const existing = attempt.current;
  if (existing?.key === key) {
    return existing.request;
  }
  const request = command(tripId, kind, payload, expectedDomainRevision);
  attempt.current = { key, request };
  return request;
}
