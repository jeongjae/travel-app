import { useState } from 'react';
import { buildGuideSection } from '../guide-import/guide-request';
import { PLAN_FORMAT_PROMPT } from '../plan-import/format-prompt';
import {
  buildTravelBrief,
  COMPANION_OPTIONS,
  INTEREST_OPTIONS,
  PACE_OPTIONS,
  STAY_PRIORITY_OPTIONS,
  STAY_TYPE_OPTIONS,
  TRANSPORT_OPTIONS,
  travelBriefProblem,
  VISIT_OPTIONS,
  type TravelAnswers,
} from '../plan-import/travel-brief';
import { GuidePanel } from './GuidePanel';
import { usePrepState } from './prep-state';
import { Modal } from './ui';

type SingleProps = {
  label: string;
  options: readonly string[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

/** 단일 선택 칩. 기본으로 골라진 값은 없고, 다시 누르면 선택이 풀린다. */
function SingleChips({ label, options, value, onChange }: SingleProps) {
  return (
    <fieldset className="chip-group">
      <legend>{label}</legend>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          aria-pressed={value === option}
          className={value === option ? 'primary' : undefined}
          onClick={() => onChange(value === option ? undefined : option)}
        >
          {option}
        </button>
      ))}
    </fieldset>
  );
}

type MultiProps = {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
};

function MultiChips({ label, options, value, onChange }: MultiProps) {
  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option]);
  }
  return (
    <fieldset className="chip-group">
      <legend>{label}</legend>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          aria-pressed={value.includes(option)}
          className={value.includes(option) ? 'primary' : undefined}
          onClick={() => toggle(option)}
        >
          {option}
        </button>
      ))}
    </fieldset>
  );
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function PlanBriefDialog({ onClose }: { onClose: () => void }) {
  const { prep, setPrep, discard, saveFailed, discardedNotice } = usePrepState();
  const answers = prep.answers;
  const [status, setStatus] = useState('');
  const [fallbackText, setFallbackText] = useState('');
  const problem = travelBriefProblem(answers);
  const guideSection = prep.guide ? buildGuideSection(prep.guide.items, prep.selections) : '';
  const brief = buildTravelBrief(answers, { guideSection });

  function update(patch: Partial<TravelAnswers>) {
    setPrep({ ...prep, answers: { ...answers, ...patch } });
    setStatus('');
    setFallbackText('');
  }

  async function copy(text: string, doneMessage: string) {
    try {
      await copyText(text);
      setFallbackText('');
      setStatus(doneMessage);
    } catch {
      setFallbackText(text);
      setStatus('자동 복사가 막혀 있습니다. 아래 글을 길게 눌러 직접 복사하세요.');
    }
  }

  return (
    <Modal title="AI로 계획 만들기" onClose={onClose}>
      <p className="muted">
        모두 선택 사항입니다. 답하지 않은 것은 요청서에 넣지 않습니다. 요청서를 복사해 챗봇에 붙여 넣고 대화하세요. 이
        화면은 서버에 아무것도 보내지 않습니다.
      </p>
      <p className="muted" data-testid="draft-notice">
        준비 초안(답·가이드·고른 것)은 이 기기에만 저장됩니다. 백업에 들어가지 않고 다른 기기로 옮겨지지 않습니다.
      </p>
      {discardedNotice ? <p role="status">{discardedNotice}</p> : null}
      {saveFailed ? (
        <p role="alert" className="error">
          이 기기에 저장하지 못했습니다(용량 또는 차단). 이 화면을 닫으면 사라집니다.
        </p>
      ) : null}
      <h3>빠른 설정</h3>
      <label>
        여행지 (여러 곳은 쉼표로)
        <input value={answers.destination ?? ''} onChange={(event) => update({ destination: event.target.value })} />
      </label>
      <div className="date-row">
        <label>
          시작 날짜
          <input
            type="date"
            value={answers.startDate ?? ''}
            onChange={(event) => update({ startDate: event.target.value })}
          />
        </label>
        <label>
          종료 날짜
          <input
            type="date"
            value={answers.endDate ?? ''}
            onChange={(event) => update({ endDate: event.target.value })}
          />
        </label>
      </div>
      {problem ? (
        <p role="alert" className="error">
          {problem}
        </p>
      ) : null}
      <MultiChips
        label="중요한 것"
        options={INTEREST_OPTIONS}
        value={answers.interests ?? []}
        onChange={(interests) => update({ interests })}
      />
      <SingleChips label="속도" options={PACE_OPTIONS} value={answers.pace} onChange={(pace) => update({ pace })} />
      <label>
        예산
        <input value={answers.budget ?? ''} onChange={(event) => update({ budget: event.target.value })} />
      </label>
      <details>
        <summary>상세 설정</summary>
        <SingleChips
          label="동행"
          options={COMPANION_OPTIONS}
          value={answers.companion}
          onChange={(companion) => update({ companion })}
        />
        <label>
          인원
          <input
            type="number"
            min={1}
            value={answers.headcount ?? ''}
            onChange={(event) => update({ headcount: event.target.value ? Number(event.target.value) : undefined })}
          />
        </label>
        <SingleChips
          label="방문 경험"
          options={VISIT_OPTIONS}
          value={answers.visit}
          onChange={(visit) => update({ visit })}
        />
        <SingleChips
          label="이동"
          options={TRANSPORT_OPTIONS}
          value={answers.transport}
          onChange={(transport) => update({ transport })}
        />
        <MultiChips
          label="숙소 유형"
          options={STAY_TYPE_OPTIONS}
          value={answers.stayTypes ?? []}
          onChange={(stayTypes) => update({ stayTypes })}
        />
        <MultiChips
          label="숙소에서 중요한 것"
          options={STAY_PRIORITY_OPTIONS}
          value={answers.stayPriorities ?? []}
          onChange={(stayPriorities) => update({ stayPriorities })}
        />
        <label>
          꼭 고려할 것·바라는 점
          <textarea rows={3} value={answers.notes ?? ''} onChange={(event) => update({ notes: event.target.value })} />
        </label>
      </details>
      <GuidePanel prep={prep} onChange={setPrep} copy={copy} />
      <h3 id="brief-preview-heading" tabIndex={-1}>
        요청서 미리보기
      </h3>
      <textarea readOnly rows={10} aria-label="요청서 미리보기" value={brief} />
      <div className="button-row prep-actions">
        <button type="button" onClick={() => void copy(PLAN_FORMAT_PROMPT, '양식 안내문만 복사했습니다.')}>
          양식 안내문만 복사
        </button>
        <button
          type="button"
          className="primary"
          disabled={Boolean(problem)}
          onClick={() => void copy(brief, '요청서를 복사했습니다. 챗봇에 붙여 넣으세요.')}
        >
          요청서 복사
        </button>
      </div>
      <div className="button-row prep-actions">
        <button
          type="button"
          onClick={() => {
            discard();
            setStatus('준비 초안을 지웠습니다.');
          }}
        >
          준비 초안 지우기
        </button>
      </div>
      {status ? <p role="status">{status}</p> : null}
      {fallbackText ? <textarea readOnly rows={8} aria-label="복사할 글" value={fallbackText} /> : null}
    </Modal>
  );
}
