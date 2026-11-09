import { outputExpiredMessage } from '../ai-v2-contract.ts';

/** 상태 줄 문구. 보존 기한이 지나 출력이 지워진 작업은 "실패"가 아니라 "만료"로 보인다. */
export function jobStatusLabel(status: string, labels: Record<string, string>, error?: string) {
  if (error === outputExpiredMessage) {
    return '만료';
  }
  return labels[status];
}
