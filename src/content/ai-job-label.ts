import { outputExpiredMessage } from '../ai-v2-contract.ts';

export const expiredLabel = '만료';
export const unknownLabel = '결과 불명 — 다시 요청';

/**
 * 상태 줄 문구. Worker 경로는 `expired`·`unknown` 상태로 알린다.
 * Node 경로(`pnpm dev:node`)는 상태가 failed이고 error 문구로 만료를 알리므로 그 판별도 남긴다.
 */
export function jobStatusLabel(status: string, labels: Record<string, string>, error?: string) {
  if (status === 'expired' || error === outputExpiredMessage) {
    return expiredLabel;
  }
  if (status === 'unknown') {
    return unknownLabel;
  }
  return labels[status];
}
