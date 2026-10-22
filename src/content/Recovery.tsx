import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ContentRepository } from '../repository';
import { readArchive } from '../transfer/package';
import { readBackup } from '../transfer/backup';
import { ErrorText, Modal, errorText } from './ui';

export default function Recovery({
  repo,
  tripId,
  onClose,
}: {
  repo: ContentRepository;
  tripId?: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [url, setUrl] = useState(''),
    [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<{ blob: Blob; trips: number; cutSeq: number } | null>(null),
    [storage, setStorage] = useState<{ usage?: number; quota?: number; persistent?: boolean }>({});
  const controller = useRef<AbortController | null>(null),
    urlRef = useRef('');
  const assets = useLiveQuery(() => (tripId ? repo.assetStatus(tripId) : []), [repo, tripId], []),
    jobs = useLiveQuery(() => repo.pendingTransfers(), [repo], []),
    headers = useLiveQuery(() => repo.list(), [repo], []),
    meta = useLiveQuery(() => repo.meta(), [repo]);
  const snapshots = useLiveQuery(() => repo.pendingSnapshots(), [repo], []);
  useEffect(() => {
    void Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()])
      .then(([estimate, persistent]) => setStorage({ ...estimate, persistent }))
      .catch(() => {});
    return () => {
      controller.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);
  async function run(fn: (signal: AbortSignal) => Promise<void>) {
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError('');
    setStatus('처리 중입니다.');
    try {
      await fn(current.signal);
    } catch (e) {
      const message = errorText(e);
      setError(
        current.signal.aborted
          ? '작업을 취소했습니다. 기존 여행은 보존됩니다.'
          : /quota/i.test(`${e instanceof Error ? e.name : ''} ${message}`)
            ? '저장 공간이 부족해 완료하지 못했습니다. 기존 여행은 보존됩니다. 중단된 준비 작업을 정리하거나 공간을 확보한 뒤 다시 시도하세요.'
            : message,
      );
      setStatus('');
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  const close = () => {
    controller.current?.abort();
    onClose();
  };
  const bytes = (n?: number) => (n === undefined ? '확인할 수 없음' : `${(n / 1024 / 1024).toFixed(1)} MiB`);
  return (
    <Modal title="저장소·백업" onClose={close}>
      <p>이 브라우저의 여행·과거 이력·변경안·재가져오기 기준·영수증과 첨부를 보관합니다.</p>
      <p>
        사용량 {bytes(storage.usage)} / 브라우저 한도 {bytes(storage.quota)} · 영구 보관{' '}
        {storage.persistent === undefined ? '확인할 수 없음' : storage.persistent ? '허용됨' : '미허용'}
      </p>
      <p>
        브라우저가 데이터를 지울 수 있으므로 백업 파일을 별도 위치에 보관하세요. 외부 지도와 AI에는 통신이 필요합니다.
      </p>
      <button
        disabled={busy || !navigator.storage?.persist || storage.persistent}
        onClick={() =>
          void run(async () => {
            const persistent = await navigator.storage.persist();
            setStorage((s) => ({ ...s, persistent }));
            setStatus(
              persistent
                ? '브라우저 영구 보관이 허용되었습니다.'
                : '브라우저가 영구 보관을 허용하지 않았습니다. 백업 파일을 보관하세요.',
            );
          })
        }
      >
        브라우저 영구 보관 요청
      </button>
      <h3>전체 백업</h3>
      <button
        disabled={busy || meta?.mode !== 'v2'}
        onClick={() =>
          void run(async (signal) => {
            if (urlRef.current) {
              URL.revokeObjectURL(urlRef.current);
              urlRef.current = '';
              setUrl('');
            }
            const result = await repo.createBackup(signal, setStatus);
            signal.throwIfAborted();
            const next = URL.createObjectURL(result.blob);
            urlRef.current = next;
            setUrl(next);
            setFilename(`travel-app-backup-${result.manifest.snapshotId}.zip`);
            setStatus(
              `전체 백업 생성 완료 · ${result.manifest.tripIds.length}개 여행 · 기준 순번 ${result.manifest.cutSeq}. 파일 저장 후 별도 위치에서 보관을 확인하세요.`,
            );
          })
        }
      >
        전체 백업 만들기
      </button>
      {url ? (
        <p>
          <a href={url} download={filename}>
            검증한 전체 백업 파일 저장
          </a>
        </p>
      ) : null}
      <h3>빈 저장소 전체 복원</h3>
      <p>기존 여행이 있으면 복원하지 않습니다. 비공개 영역에서 검증하고 확인 후 여행 목록에 표시합니다.</p>
      <label className="file-picker">
        전체 백업 파일 선택
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={busy || headers.length > 0 || meta?.mode !== 'v2'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file)
              void run(async (signal) => {
                setPreview(null);
                const result = await readBackup(file, signal);
                setPreview({ blob: file, trips: result.manifest.tripIds.length, cutSeq: result.manifest.cutSeq });
                setStatus('백업 파일 검증 완료. 복원 내용을 확인하세요.');
              });
          }}
        />
      </label>
      {preview ? (
        <div className="notice">
          <p>
            복원 미리보기: {preview.trips}개 여행 · 기준 순번 {preview.cutSeq}
          </p>
          <button
            disabled={busy || headers.length > 0}
            onClick={() =>
              void run(async (signal) => {
                const jobId = await repo.prepareRestore(preview.blob, signal, setStatus);
                await repo.activateRestore(jobId, signal);
                setPreview(null);
                setStatus('전체 복원 완료. 여행 목록에서 확인하세요.');
              })
            }
          >
            확인 후 전체 복원
          </button>
          <button disabled={busy} onClick={() => setPreview(null)}>
            복원 보류
          </button>
        </div>
      ) : null}
      {tripId ? (
        <>
          <h3>선택 여행의 오프라인 첨부</h3>
          <p>
            현재와 과거 이력에서 필요한 바이트를 해시로 확인합니다. 준비 {assets.filter((a) => a.ready).length}/
            {assets.length}개
          </p>
          {assets.map((a) => (
            <p key={a.hash}>
              {a.title} · {bytes(a.byteLength)} · {a.ready ? '오프라인 준비됨' : '누락 또는 손상 · 복구 필요'}
            </p>
          ))}
          <label className="file-picker">
            첨부 복구용 패키지·백업 선택
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file)
                  void run(async (signal) => {
                    const archive = await readArchive(file, signal);
                    const count = await repo.repairAssets(tripId, archive.assets, signal);
                    setStatus(`${count}개 첨부를 복구했습니다. 계획·본문·기록은 보존됩니다.`);
                  });
              }}
            />
          </label>
        </>
      ) : null}
      <h3>중단된 준비 작업</h3>
      <p>정리는 미공개 복원 영역과 준비 작업만 제거합니다. 현재·과거 여행의 첨부는 유지합니다.</p>
      {snapshots.map((s) => (
        <div className="content-row" key={s.snapshotId}>
          <p>백업 준비 · 기준 순번 {s.cutSeq}</p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await repo.discardSnapshot(s.snapshotId);
                setStatus('백업 준비 작업을 정리했습니다.');
              })
            }
          >
            백업 준비 작업 정리
          </button>
        </div>
      ))}
      {jobs.map((j) => (
        <div className="content-row" key={j.jobId}>
          <p>
            {j.mode === 'restore' ? '전체 복원 준비' : '패키지 준비'} · {j.status}
          </p>
          {j.mode === 'restore' && j.status === 'ready' ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(async (signal) => {
                  await repo.activateRestore(j.jobId, signal);
                  setStatus('준비된 전체 복원을 완료했습니다.');
                })
              }
            >
              준비된 전체 복원 적용
            </button>
          ) : null}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await repo.discardTransfer(j.jobId);
                setStatus('미공개 준비 작업을 정리했습니다.');
              })
            }
          >
            준비 작업 정리
          </button>
        </div>
      ))}
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const count = await repo.collectOrphanAssets();
            setStatus(`참조 없는 임시 첨부 ${count}개를 정리했습니다.`);
          })
        }
      >
        참조 없는 임시 첨부 정리
      </button>
      {busy ? <button onClick={() => controller.current?.abort()}>진행 작업 취소</button> : null}
      <ErrorText error={error} />
      {status ? <p role="status">{status}</p> : null}
    </Modal>
  );
}
