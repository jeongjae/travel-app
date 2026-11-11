// AI 서버 호출. 기준 주소(VITE_AI_API_BASE)·Bearer 토큰·오류 코드·폴링 백오프를 한 곳에 둔다.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { aiApiBase } from '../hosting';

/** 서버가 돌려준 실패. `code`로 재로그인·일일 한도 안내를 고른다. 상태 0은 연결 실패다. */
export class AiApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type AiToken = { token: string; expiresAt: string };

const tokenKey = 'travel-app-ai-token';
let memoryToken: AiToken | null = null;

/** 토큰은 메모리와 sessionStorage에만 둔다. 탭을 닫으면 사라진다. */
export function loadToken(): AiToken | null {
  if (memoryToken) {
    return memoryToken;
  }
  try {
    const stored = sessionStorage.getItem(tokenKey);
    memoryToken = stored ? (JSON.parse(stored) as AiToken) : null;
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export function saveToken(token: AiToken | null) {
  memoryToken = token;
  try {
    if (token) {
      sessionStorage.setItem(tokenKey, JSON.stringify(token));
    } else {
      sessionStorage.removeItem(tokenKey);
    }
  } catch {
    /* sessionStorage를 못 쓰면 메모리 토큰만 쓴다. */
  }
}

export function tokenExpired(token: AiToken | null, now = Date.now()) {
  return Boolean(token && Date.parse(token.expiresAt) <= now);
}

export function aiUrl(path: string) {
  return `${aiApiBase}${path}`;
}

export async function aiFetch<T>(path: string, body?: unknown): Promise<T> {
  const token = loadToken();
  const headers: Record<string, string> = { 'X-Travel-App': '1' };
  if (token) {
    headers.Authorization = `Bearer ${token.token}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(aiUrl(path), {
      cache: 'no-store',
      headers,
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
  } catch {
    throw new AiApiError(0, 'network', 'AI 서버에 연결하지 못했습니다.');
  }
  let data: { error?: string; code?: string } & Record<string, unknown> = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new AiApiError(response.status, data.code ?? '', data.error || 'AI 서버에 연결하지 못했습니다.');
  }
  return data as T;
}

/** 인증 방식. Worker는 패스키, Node 개발 서버(`pnpm dev:node`)는 인증 경로가 없다. */
export type AuthState =
  'checking' | 'none' | 'unregistered' | 'locked' | 'logged-out' | 'expired' | 'logged-in' | 'offline';

export async function readAuthState(): Promise<AuthState> {
  try {
    const { registered, locked } = await aiFetch<{ registered: boolean; locked?: boolean }>('/auth/state');
    if (!registered) {
      return locked ? 'locked' : 'unregistered';
    }
    const token = loadToken();
    if (!token) {
      return 'logged-out';
    }
    return tokenExpired(token) ? 'expired' : 'logged-in';
  } catch (error) {
    // Node 개발 서버에는 인증 경로가 없다(404, 키가 없으면 503). 그때는 상태 API가 실행 가능 여부를 정한다.
    if (error instanceof AiApiError && (error.status === 404 || error.status === 503)) {
      return 'none';
    }
    return 'offline';
  }
}

export async function registerPasskey(code: string) {
  const optionsJSON = await aiFetch<Parameters<typeof startRegistration>[0]['optionsJSON']>('/auth/register/options', {
    code,
  });
  const response = await startRegistration({ optionsJSON });
  const token = await aiFetch<AiToken>('/auth/register', { code, response });
  saveToken(token);
}

export async function loginWithPasskey() {
  const optionsJSON = await aiFetch<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
    '/auth/login/options',
    {},
  );
  const response = await startAuthentication({ optionsJSON });
  const token = await aiFetch<AiToken>('/auth/login', { response });
  saveToken(token);
}

/** 서버 패스키 목록 항목. 공개키·자격 ID는 오지 않는다. */
export type PasskeySummary = { ref: string; label: string; createdAt: string; lastUsedAt: string | null };
export type PasskeyList = { credentials: PasskeySummary[]; max: number };

export function listPasskeys() {
  return aiFetch<PasskeyList>('/auth/credentials');
}

/**
 * 로그인한 상태에서 패스키를 하나 더 만든다. 서버가 "다른 기기" 경로를 권하므로
 * PC 브라우저에서 QR을 띄우고 iPhone Face ID로 만든다. 토큰은 바꾸지 않는다.
 */
export async function addPasskey(label: string) {
  const optionsJSON = await aiFetch<Parameters<typeof startRegistration>[0]['optionsJSON']>(
    '/auth/credentials/options',
    {},
  );
  const response = await startRegistration({ optionsJSON });
  return aiFetch<PasskeyList>('/auth/credentials', { response, label });
}

export function deletePasskey(ref: string) {
  return aiFetch<PasskeyList>('/auth/credentials/delete', { ref });
}

/** 화면 오류 상세(접힘)에 보일 HTTP·오류 코드. 연결 실패(0)는 코드만. 429 직접 관측용(T-D5 C1 D). */
export function apiErrorDetail(error: unknown) {
  if (!(error instanceof AiApiError)) {
    return '';
  }
  const status = error.status ? `HTTP ${error.status}` : '연결 실패';
  return error.code ? `${status} · ${error.code}` : status;
}

export async function logout() {
  try {
    await aiFetch('/auth/revoke', {});
  } finally {
    saveToken(null);
  }
}

/** 폴링 재시도 간격. 네트워크 오류·5xx마다 두 배, 최대 30초. 5회 넘게 실패하면 사용자에게 넘긴다. */
export const pollRetryLimit = 5;
export function pollRetryDelay(failures: number) {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
}

export function retryable(error: unknown) {
  return error instanceof AiApiError && (error.status === 0 || error.status >= 500);
}

export function needsLogin(error: unknown) {
  return error instanceof AiApiError && error.status === 401;
}

export type PollStep =
  { action: 'retry'; delay: number } | { action: 'lost' } | { action: 'login' } | { action: 'fail' };

/** 폴링 조회가 실패했을 때 다음 동작. failures는 이번 실패를 포함하지 않은 연속 실패 횟수다. */
export function nextPollStep(error: unknown, failures: number): PollStep {
  if (needsLogin(error)) {
    return { action: 'login' };
  }
  if (!retryable(error)) {
    return { action: 'fail' };
  }
  if (failures >= pollRetryLimit) {
    return { action: 'lost' };
  }
  return { action: 'retry', delay: pollRetryDelay(failures + 1) };
}
