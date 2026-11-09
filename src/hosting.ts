export const staticHosting = import.meta.env.VITE_STATIC_HOSTING === 'true';

/**
 * AI 서버 기준 주소(origin). 값이 있으면 그 주소로, 없으면 지금처럼 같은 출처의 상대 경로로 부른다.
 * 정적 호스팅(Pages)은 기준 주소가 있을 때만 AI를 쓴다. Pages 빌드에 값을 넣는 것은 배포 승인 뒤(T-D4)다.
 */
export const aiApiBase = String(import.meta.env.VITE_AI_API_BASE ?? '').replace(/\/+$/, '');
export const aiApiAvailable = Boolean(aiApiBase) || !staticHosting;

export function appAssetUrl(path: string) {
  return import.meta.env.BASE_URL + path.replace(/^\/+/, '');
}
