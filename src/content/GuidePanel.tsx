import { useState } from 'react';
import { guideOf, type PrepState } from '../guide-import/draft';
import { buildGuideRequest } from '../guide-import/guide-request';
import { parseGuide } from '../guide-import/parse';
import {
  CHOICE_LABEL,
  CHOICES,
  countByChoice,
  countChanges,
  setChoices,
  similarRemaining,
  toggleChoice,
  type Choice,
} from '../guide-import/selection';
import { GUIDE_KINDS, type GuideIssue, type GuideItem, type GuideKind, type GuideResult } from '../guide-import/types';

type Props = {
  prep: PrepState;
  onChange: (next: PrepState) => void;
  copy: (text: string, doneMessage: string) => Promise<void>;
};

const RETRY_GUIDE_HINT = '챗봇에게 "가이드 양식의 코드 블록 하나로 다시 정리해 줘"라고 요청하세요.';

function whereOf(issue: GuideIssue) {
  return issue.line <= 1 ? '머리 줄' : `${issue.line}줄`;
}

function GuideProblems({ result }: { result: GuideResult }) {
  const errors = result.issues.filter((issue) => issue.severity === 'error');
  const warnings = result.issues.filter((issue) => issue.severity === 'warning');
  return (
    <section aria-label="가이드 해석 결과">
      {result.rejection ? (
        <p role="alert" className="error">
          {result.rejection.message}
        </p>
      ) : null}
      {errors.length > 0 ? (
        <>
          <p role="alert" className="error">
            오류가 {errors.length}건 있어 가이드를 받지 않았습니다. {RETRY_GUIDE_HINT}
          </p>
          <ul aria-label="가이드 오류">
            {errors.map((issue, index) => (
              <li key={index}>
                {whereOf(issue)} · {issue.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {warnings.length > 0 ? (
        <ul aria-label="가이드 경고">
          {warnings.map((issue, index) => (
            <li key={index}>
              경고 · {whereOf(issue)} · {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      {result.notImported.length > 0 ? (
        <ul aria-label="가이드에서 가져오지 않은 것">
          {result.notImported.map((entry, index) => (
            <li key={index}>
              가져오지 않음 · {entry.line}줄 · {entry.what}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type CardProps = {
  item: GuideItem;
  items: GuideItem[];
  prep: PrepState;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (next: PrepState) => void;
};

const SHORT_LABEL: Record<Choice, string> = { must: '꼭', interest: '관심', exclude: '제외' };

/** 접힌 한 줄(종류·이름·지역 + 고르기)이 기본이고, 누르면 설명·예상 소요·확인 필요가 펼쳐진다. */
function GuideCard({ item, items, prep, open, onToggleOpen, onChange }: CardProps) {
  const current = prep.selections[item.key];
  const similar = similarRemaining(item, items, prep.selections);
  const hasDetail = Boolean(item.description || item.durationText || item.needsCheck);
  const detailId = `guide-detail-${item.key}`;
  return (
    <li className="guide-card">
      <div className="guide-card-line">
        <button
          type="button"
          className="guide-card-title"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={onToggleOpen}
        >
          <span className="guide-card-kind">{item.kind}</span>
          <strong>{item.name}</strong>
          {item.area ? <span className="muted">{item.area}</span> : null}
        </button>
        <div className="chip-group guide-card-choices" role="group" aria-label={`${item.name} 고르기`}>
          {CHOICES.map((choice) => (
            <button
              type="button"
              key={choice}
              aria-label={CHOICE_LABEL[choice]}
              aria-pressed={current === choice}
              className={current === choice ? 'primary' : undefined}
              onClick={() => onChange({ ...prep, selections: toggleChoice(prep.selections, item.key, choice) })}
            >
              {SHORT_LABEL[choice]}
            </button>
          ))}
        </div>
      </div>
      <div id={detailId} hidden={!open} className="guide-card-detail">
        {hasDetail ? null : <p className="muted">더 적힌 내용이 없습니다.</p>}
        {item.description ? <p>{item.description}</p> : null}
        {item.durationText ? <p className="muted">예상 소요: {item.durationText}</p> : null}
        {item.needsCheck ? <p className="muted">확인 필요: {item.needsCheck}</p> : null}
      </div>
      {similar.length > 0 ? (
        <p role="note" className="notice">
          비슷한 항목이 더 있습니다: {similar.map((other) => other.name).join(', ')}
        </p>
      ) : null}
    </li>
  );
}

function downloadGuide(text: string, destination: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `가이드-${destination}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

type BrowserProps = { prep: PrepState; onChange: (next: PrepState) => void };

function goToBrief() {
  const heading = document.getElementById('brief-preview-heading');
  heading?.scrollIntoView({ block: 'start' });
  heading?.focus();
}

/** 붙여 넣은 가이드의 카드 목록·거르기·고르기·현황. */
function GuideBrowser({ prep, onChange }: BrowserProps) {
  const [kind, setKind] = useState<GuideKind | 'all'>('all');
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const guide = prep.guide!;
  const filtered = kind !== 'all' || onlyChosen;
  const visible = guide.items.filter(
    (item) => (kind === 'all' || item.kind === kind) && (!onlyChosen || prep.selections[item.key] !== undefined),
  );
  const visibleKeys = visible.map((item) => item.key);
  const counts = countByChoice(prep.selections, guide.items);
  const visibleCounts = countByChoice(prep.selections, visible);
  const allOpen = visible.length > 0 && visible.every((item) => openKeys.has(item.key));
  const bulkChoices: (Choice | undefined)[] = [...CHOICES, undefined];

  function toggleOpen(key: string) {
    const next = new Set(openKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setOpenKeys(next);
  }

  function toggleAll() {
    const next = new Set(openKeys);
    for (const key of visibleKeys) {
      if (allOpen) {
        next.delete(key);
      } else {
        next.add(key);
      }
    }
    setOpenKeys(next);
  }

  return (
    <>
      <div className="guide-sticky">
        <p role="status" data-testid="guide-total">
          고른 항목 — 꼭 포함 {counts.must} · 관심 {counts.interest} · 제외 {counts.exclude} (전체 {guide.items.length}
          개 중)
        </p>
        {filtered ? (
          <p className="muted" data-testid="guide-visible">
            지금 보이는 {visible.length}개 중 — 꼭 포함 {visibleCounts.must} · 관심 {visibleCounts.interest} · 제외{' '}
            {visibleCounts.exclude}
          </p>
        ) : null}
        <div className="chip-group" role="group" aria-label="종류로 거르기">
          {(['all', ...GUIDE_KINDS] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={kind === value}
              className={kind === value ? 'primary' : undefined}
              onClick={() => setKind(value)}
            >
              {value === 'all' ? '전체' : value}
            </button>
          ))}
        </div>
      </div>
      <div className="button-row guide-tools">
        <label className="check-line">
          <input type="checkbox" checked={onlyChosen} onChange={(event) => setOnlyChosen(event.target.checked)} />
          고른 것만 보기
        </label>
        <button type="button" onClick={toggleAll} disabled={visible.length === 0}>
          {allOpen ? '모두 접기' : '모두 펼치기'}
        </button>
      </div>
      <details className="guide-bulk">
        <summary>한 번에 고르기 (보이는 항목 {visible.length}개)</summary>
        <div className="guide-bulk-list">
          {bulkChoices.map((choice) => {
            const label = choice ? `모두 ${CHOICE_LABEL[choice]}` : '모두 고르지 않음';
            const changes = countChanges(prep.selections, visibleKeys, choice);
            return (
              <div key={label} className="guide-bulk-item">
                <button
                  type="button"
                  disabled={changes === 0}
                  onClick={() => onChange({ ...prep, selections: setChoices(prep.selections, visibleKeys, choice) })}
                >
                  {label}
                </button>
                <small className="muted">{changes}개가 바뀝니다</small>
              </div>
            );
          })}
        </div>
      </details>
      <ul className="guide-cards" aria-label="가이드 항목">
        {visible.map((item) => (
          <GuideCard
            key={item.key}
            item={item}
            items={guide.items}
            prep={prep}
            open={openKeys.has(item.key)}
            onToggleOpen={() => toggleOpen(item.key)}
            onChange={onChange}
          />
        ))}
      </ul>
      <div className="button-row prep-actions">
        <button type="button" className="primary" onClick={goToBrief}>
          요청서 만들기로
        </button>
      </div>
    </>
  );
}

export function GuidePanel({ prep, onChange, copy }: Props) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<GuideResult | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const { guide, answers } = prep;
  const hasSelections = Object.keys(prep.selections).length > 0;
  const destinationMissing = (answers.destination ?? '').trim() === '';

  function install(source: string) {
    onChange({ ...prep, guideText: source, guide: guideOf(source), selections: {} });
    setText('');
    setResult(null);
    setPending(null);
    setReplacing(false);
  }

  /** 읽기에 실패하면 기존 가이드와 고른 상태는 그대로 둔다. */
  function read(source: string) {
    setHint('');
    setClearing(false);
    const parsed = parseGuide(source);
    setResult(parsed);
    if (!parsed.accepted) {
      return;
    }
    if (guide && hasSelections) {
      setPending(source);
      return;
    }
    install(source);
  }

  async function readClipboard() {
    try {
      const clipboardText = await navigator.clipboard.readText();
      setText(clipboardText);
      read(clipboardText);
    } catch {
      setHint('클립보드를 읽을 수 없습니다. 아래 입력 칸에 길게 눌러 직접 붙여 넣으세요.');
    }
  }

  async function readFile(file: File) {
    try {
      const fileText = await file.text();
      setText(fileText);
      read(fileText);
    } catch {
      setHint('파일을 읽을 수 없습니다. 내용을 복사해 입력 칸에 붙여 넣어 보세요.');
    }
  }

  function clearGuide() {
    onChange({ ...prep, guideText: '', guide: undefined, selections: {} });
    setClearing(false);
    setResult(null);
  }

  const pasteArea = (
    <div>
      <div className="button-row prep-actions">
        <button type="button" onClick={() => void readClipboard()}>
          가이드 클립보드에서 붙여넣기
        </button>
        <label className="file-picker">
          가이드 파일 선택 (.md·.txt)
          <input
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) {
                void readFile(file);
              }
            }}
          />
        </label>
      </div>
      {hint ? <p role="status">{hint}</p> : null}
      <label>
        붙여 넣은 가이드
        <textarea
          rows={6}
          value={text}
          placeholder="여기에 길게 눌러 붙여 넣기"
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
            setPending(null);
          }}
        />
      </label>
      <div className="button-row prep-actions">
        <button type="button" className="primary" disabled={text.trim() === ''} onClick={() => read(text)}>
          가이드 읽기
        </button>
      </div>
      {result ? <GuideProblems result={result} /> : null}
      {pending !== null ? (
        <div role="alert" className="notice">
          <p>고른 것이 모두 지워집니다. 다른 가이드로 바꿀까요?</p>
          <button type="button" className="danger" onClick={() => install(pending)}>
            바꾸기
          </button>
          <button type="button" onClick={() => setPending(null)}>
            취소
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <details open={!skipped} className="guide-panel">
      <summary>목적지 가이드 (선택)</summary>
      <p className="notice">AI가 만든 가이드 · 내용은 확인되지 않았습니다</p>
      {guide ? (
        <>
          <h3>
            {guide.destination} 가이드 · 항목 {guide.items.length}개
          </h3>
          {guide.referenceDate ? <p className="muted">기준일 {guide.referenceDate} (챗봇이 글을 쓴 날)</p> : null}
          <GuideBrowser prep={prep} onChange={onChange} />
          <div className="button-row prep-actions">
            <button type="button" onClick={() => setReplacing(!replacing)}>
              가이드 바꾸기
            </button>
            <button type="button" onClick={() => downloadGuide(prep.guideText, guide.destination)}>
              가이드를 파일로 저장
            </button>
            <button type="button" onClick={() => (hasSelections ? setClearing(true) : clearGuide())}>
              가이드 지우기
            </button>
          </div>
          {clearing ? (
            <div role="alert" className="notice">
              <p>가이드와 고른 것이 모두 지워집니다.</p>
              <button type="button" className="danger" onClick={clearGuide}>
                지우기
              </button>
              <button type="button" onClick={() => setClearing(false)}>
                취소
              </button>
            </div>
          ) : null}
          {replacing ? pasteArea : null}
        </>
      ) : (
        <>
          <p className="muted">
            가이드 요청문을 챗봇에 붙여 넣어 목적지 가이드를 받고, 아래에 붙여 넣어 골라 보세요. 건너뛰어도 됩니다.
          </p>
          <div className="button-row prep-actions">
            <button
              type="button"
              disabled={destinationMissing}
              onClick={() =>
                void copy(buildGuideRequest(answers), '가이드 요청문을 복사했습니다. 챗봇에 붙여 넣으세요.')
              }
            >
              가이드 요청문 복사
            </button>
            <button type="button" onClick={() => setSkipped(true)}>
              가이드 없이 계속
            </button>
          </div>
          {destinationMissing ? <p className="muted">여행지를 먼저 적어 주세요</p> : null}
          {pasteArea}
        </>
      )}
    </details>
  );
}
