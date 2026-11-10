import { useState } from 'react';
import { AiApiError, loadToken, loginWithPasskey, logout, registerPasskey, type AuthState } from './ai-client.ts';
import { ErrorText, errorText } from './ui';

/** AI 서버 본인 인증 상태 줄. 패스키 등록(1회 코드)·로그인·만료 후 재로그인·로그아웃. */
export default function AiAuthPanel({ state, onChange }: { state: AuthState; onChange: (next: AuthState) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>, next: AuthState) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onChange(next);
    } catch (exception) {
      if (exception instanceof AiApiError && exception.code === 'registration_locked') {
        onChange('locked');
        return;
      }
      setError(errorText(exception));
    } finally {
      setBusy(false);
    }
  };
  if (state === 'none') {
    return null;
  }
  if (state === 'checking') {
    return <p className="muted">AI 서버 확인 중…</p>;
  }
  if (state === 'offline') {
    return <p className="muted">AI 서버에 연결하지 못했습니다. 일정·기록·백업은 그대로 쓸 수 있습니다.</p>;
  }
  const expiresAt = loadToken()?.expiresAt;
  return (
    <div className="ai-auth" aria-label="AI 서버 로그인">
      {state === 'unregistered' ? (
        <>
          <p>이 기기에서 처음 쓰는 AI 서버입니다. 받은 1회 등록 코드로 패스키를 등록하세요.</p>
          <div className="button-row">
            <label>
              1회 등록 코드
              <input
                type="password"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !code}
              onClick={() => void run(() => registerPasskey(code), 'logged-in')}
            >
              패스키 등록
            </button>
          </div>
        </>
      ) : null}
      {state === 'locked' ? (
        <p role="alert">
          등록 코드가 5회 틀려 패스키 등록이 잠겼습니다. 서버의 등록 코드를 바꾸고 잠금을 푼 뒤 다시 등록하세요.
        </p>
      ) : null}
      {state === 'logged-out' ? (
        <div className="button-row">
          <p>AI 요청을 보내려면 패스키로 로그인하세요. 로그인 전에는 전송 미리보기만 볼 수 있습니다.</p>
          <button className="primary" disabled={busy} onClick={() => void run(loginWithPasskey, 'logged-in')}>
            패스키로 로그인
          </button>
        </div>
      ) : null}
      {state === 'expired' ? (
        <div className="button-row">
          <p role="alert">토큰 만료 — 다시 로그인하세요.</p>
          <button className="primary" disabled={busy} onClick={() => void run(loginWithPasskey, 'logged-in')}>
            패스키로 다시 로그인
          </button>
        </div>
      ) : null}
      {state === 'logged-in' ? (
        <div className="button-row">
          <p className="muted">
            패스키 로그인됨
            {expiresAt
              ? ` · ${new Date(expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}까지`
              : ''}
          </p>
          <button disabled={busy} onClick={() => void run(logout, 'logged-out')}>
            로그아웃
          </button>
        </div>
      ) : null}
      <ErrorText error={error} />
    </div>
  );
}
