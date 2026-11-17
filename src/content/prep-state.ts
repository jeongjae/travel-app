import { useState } from 'react';
import { browserStorage, clearDraft, EMPTY_PREP, loadDraft, saveDraft, type PrepState } from '../guide-import/draft';

/**
 * 준비 초안(조건·취향 답, 가이드, 고른 상태)의 화면 상태. 바꿀 때마다 이 기기의 localStorage에 저장한다.
 * 저장이 막히면 `saveFailed`로 알리고 메모리 상태로 계속한다.
 */
export function usePrepState() {
  const [loaded] = useState(() => loadDraft(browserStorage()));
  const [prep, setPrepState] = useState<PrepState>(loaded.state);
  const [saveFailed, setSaveFailed] = useState(false);
  const [discardedNotice] = useState(loaded.discarded ?? '');

  function setPrep(next: PrepState) {
    setPrepState(next);
    setSaveFailed(!saveDraft(browserStorage(), next));
  }

  function discard() {
    clearDraft(browserStorage());
    setPrepState(EMPTY_PREP);
    setSaveFailed(false);
  }

  return { prep, setPrep, discard, saveFailed, discardedNotice };
}

/** 붙여넣기 화면용: 저장된 초안을 한 번 읽는다. */
export function readPrepDraft(): PrepState | undefined {
  const loaded = loadDraft(browserStorage());
  return loaded.found ? loaded.state : undefined;
}
