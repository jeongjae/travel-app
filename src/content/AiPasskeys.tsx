import { useEffect, useState } from 'react';
import { addPasskey, apiErrorDetail, deletePasskey, listPasskeys, type PasskeyList } from './ai-client.ts';
import { ErrorText, errorText } from './ui';

function when(value: string | null) {
  if (!value) {
    return '없음';
  }
  return new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * 로그인한 상태의 패스키 관리(T-D5 C1 A). 추가는 브라우저의 "다른 기기(휴대폰)" QR 경로로 iPhone에 만든다.
 * 서버는 등록·마지막 사용 시각·라벨만 돌려준다. 마지막 1개는 지울 수 없다.
 */
export default function AiPasskeys({ onAuthError }: { onAuthError: (exception: unknown) => boolean }) {
  const [list, setList] = useState<PasskeyList | null>(null);
  const [label, setLabel] = useState('iPhone');
  const [confirmRef, setConfirmRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');
  const fail = (exception: unknown) => {
    if (onAuthError(exception)) {
      return;
    }
    setError(errorText(exception));
    setDetail(apiErrorDetail(exception));
  };
  const run = async (action: () => Promise<PasskeyList>) => {
    setBusy(true);
    setError('');
    setDetail('');
    try {
      setList(await action());
      setConfirmRef('');
    } catch (exception) {
      fail(exception);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let live = true;
    listPasskeys()
      .then((value) => {
        if (live) {
          setList(value);
        }
      })
      .catch((exception) => {
        if (live) {
          fail(exception);
        }
      });
    return () => {
      live = false;
    };
    // 처음 열 때 한 번만 읽는다. 이후에는 추가·삭제 응답이 목록을 바꾼다.
  }, []);
  const full = Boolean(list && list.credentials.length >= list.max);
  return (
    <details className="ai-passkeys">
      <summary>패스키 관리{list ? ` (${list.credentials.length}/${list.max})` : ''}</summary>
      {list ? (
        <ul aria-label="등록된 패스키">
          {list.credentials.map((credential) => (
            <li key={credential.ref}>
              <span>
                {credential.label || '이름 없음'} · 등록 {when(credential.createdAt)} · 마지막 사용{' '}
                {when(credential.lastUsedAt)}
              </span>{' '}
              {confirmRef === credential.ref ? (
                <>
                  <button disabled={busy} onClick={() => void run(() => deletePasskey(credential.ref))}>
                    삭제 확인
                  </button>
                  <button disabled={busy} onClick={() => setConfirmRef('')}>
                    취소
                  </button>
                </>
              ) : (
                <button
                  disabled={busy || list.credentials.length <= 1}
                  title={list.credentials.length <= 1 ? '마지막 패스키는 지울 수 없습니다.' : undefined}
                  onClick={() => setConfirmRef(credential.ref)}
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">패스키 목록을 읽는 중…</p>
      )}
      <p className="muted">
        iPhone에 추가: 이 PC에서 [패스키 추가]를 누른 뒤 브라우저 창의 &quot;다른 기기(휴대폰·태블릿)&quot;를 고르고,
        QR을 iPhone 카메라로 읽어 Face ID로 저장합니다.
      </p>
      <div className="button-row">
        <label>
          라벨
          <input value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <button className="primary" disabled={busy || full} onClick={() => void run(() => addPasskey(label))}>
          패스키 추가
        </button>
      </div>
      {full ? <p className="muted">패스키는 최대 {list?.max}개입니다. 하나를 지운 뒤 추가하세요.</p> : null}
      <ErrorText error={error} />
      {error && detail ? (
        <details>
          <summary>오류 상세</summary>
          <p className="muted">{detail}</p>
        </details>
      ) : null}
    </details>
  );
}
