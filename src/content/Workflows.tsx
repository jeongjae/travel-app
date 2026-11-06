import { lazy, Suspense, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ContentRepository } from '../repository';
import type { PlanVersion, Proposal, TripDataset } from '../contracts/v2';
import type { Review, Choice, Slot } from '../transfer/reimport';
import { command, errorText, ErrorText, Modal } from './ui';
import { operationReasonsRef } from '../ai-v2-semantics';
import {
  confirmationsFor,
  operationsToApply,
  reviewProposal,
  withConfirmation,
  type ConfirmationState,
  type FactStatus,
  type OperationReview,
} from './proposal-review';
const AiPlanner = lazy(() => import('./AiPlanner'));
export function ProposalPanel({
  repo,
  header,
  plan,
  proposals,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripDataset['header'];
  plan: PlanVersion;
  proposals: Proposal[];
  onSaved: () => void;
}) {
  const [editor, setEditor] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const latest = new Map<string, Proposal>();
  proposals.forEach((p) => {
    if ((latest.get(p.proposalId)?.proposalRevision ?? 0) < p.proposalRevision) {
      latest.set(p.proposalId, p);
    }
  });
  async function decide(p: Proposal, decision: 'apply' | 'reject', keep?: Proposal['operations']) {
    setBusy(true);
    setError('');
    try {
      let expectedProposalRevision = p.proposalRevision;
      if (decision === 'apply' && keep && keep.length < p.operations.length) {
        // 확인하지 않은 항목은 뺀 새 revision을 먼저 저장한다. 전체 항목은 이전 revision으로 남는다.
        const { commitSeq: _, ...rest } = p;
        const activityIdOf = (operation: Proposal['operations'][number]) =>
          operation.type === 'remove-item' ? operation.activityId : operation.item.activityId;
        const keptIds = new Set(keep.map(activityIdOf));
        const narrowed = {
          ...rest,
          proposalRevision: p.proposalRevision + 1,
          proposalRevisionId: crypto.randomUUID(),
          previousProposalRevisionId: p.proposalRevisionId,
          operations: keep,
          impact: { ...p.impact, activityIds: p.impact.activityIds.filter((id) => keptIds.has(id)) },
        };
        await repo.execute(
          command(
            header.tripId,
            'SaveProposal',
            { proposal: narrowed, baseDomainRevision: narrowed.baseDomainRevision },
            undefined,
            { expectedProposalRevision },
          ),
        );
        expectedProposalRevision = narrowed.proposalRevision;
      }
      await repo.execute(
        command(
          header.tripId,
          'DecideProposal',
          { proposalId: p.proposalId, decision, confirmedByUser: true },
          undefined,
          { expectedProposalRevision },
        ),
      );
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <Suspense fallback={<p>AI 도구를 여는 중입니다.</p>}>
        <AiPlanner key={header.tripId} repo={repo} header={header} onSaved={onSaved} />
      </Suspense>
      <div className="section-heading">
        <h2>변경안 검토</h2>
        <button disabled={!plan.items.length} onClick={() => setEditor(true)}>
          모의 변경안 만들기
        </button>
      </div>
      <p className="muted">
        모의 변경안은 조사·유료 AI 호출 없이 저장 흐름을 확인합니다. 확인 후 적용하면 새 계획이 만들어집니다.
      </p>
      <ErrorText error={error} />
      {[...latest.values()].map((p) => (
        <article className="content-row" key={p.proposalId}>
          <h3>{p.reason}</h3>
          <p>
            {p.status === 'pending' ? '확인 대기' : p.status === 'applied' ? '적용됨' : '거절됨'} · 기준 revision{' '}
            {p.baseDomainRevision}
          </p>
          {p.baseDomainRevision !== header.domainRevision && p.status === 'pending' ? (
            <p className="notice">기준이 오래됐습니다. 적용할 수 없습니다. 최신 내용으로 다시 작성하세요.</p>
          ) : null}
          <p>예약 영향: {p.impact.reservationText}</p>
          <ProposalReview
            repo={repo}
            proposal={p}
            plan={plan}
            busy={busy}
            stale={p.baseDomainRevision !== header.domainRevision}
            onApply={(keep) => void decide(p, 'apply', keep)}
            onReject={() => void decide(p, 'reject')}
          />
          <details>
            <summary>변경안 이력</summary>
            {proposals
              .filter((r) => r.proposalId === p.proposalId)
              .map((r) => (
                <p key={r.proposalRevisionId}>
                  {r.proposalRevision} · {r.status} · {r.decision?.decidedAt ?? '미결정'}
                </p>
              ))}
          </details>
        </article>
      ))}
      {editor ? (
        <MockEditor
          repo={repo}
          header={header}
          plan={plan}
          onClose={() => setEditor(false)}
          onSaved={() => {
            setEditor(false);
            onSaved();
          }}
        />
      ) : null}
    </section>
  );
}
const factLabels: Record<Exclude<FactStatus, 'none'>, string> = {
  verified: '변하는 사실: 공식 출처 확인',
  unverified: '변하는 사실: 미확인',
};

function OperationCard({
  review,
  confirmed,
  onConfirm,
  pending,
}: {
  review: OperationReview;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
  pending: boolean;
}) {
  const { sources } = review;
  const total = sources.official + sources.press + sources.community;
  return (
    <li className="proposal-card">
      <h4>{review.removed ? `활동 제거: ${review.title}` : `${review.title} (이전: ${review.previousTitle})`}</h4>
      <p>사유: {review.reason}</p>
      <p className="muted">
        출처 {total}건 · 공식 {sources.official} · 언론 {sources.press} · 블로그·커뮤니티·기타 {sources.community}
        {review.checkedAt
          ? ` · 확인 ${review.checkedAt}`
          : review.collectedAt
            ? ` · 수집 ${review.collectedAt} (확인 시각 없음)`
            : ''}
      </p>
      {review.factStatus !== 'none' ? (
        <p className={`proposal-flag proposal-fact-${review.factStatus}`}>{factLabels[review.factStatus]}</p>
      ) : null}
      {review.droppedLegs.length ? (
        <div className="proposal-flag proposal-conflict">
          <strong>적용하면 사라지는 이동</strong>
          <ul>
            {review.droppedLegs.map((leg) => (
              <li key={leg}>{leg}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {review.conflicts.map((conflict) => (
        <p className="proposal-flag proposal-conflict" key={conflict}>
          충돌: {conflict}
        </p>
      ))}
      {review.warnings.map((warning) => (
        <p className="proposal-flag proposal-fact-unverified" key={warning}>
          주의: {warning}
        </p>
      ))}
      {review.needsConfirmation ? (
        <div className="proposal-flag proposal-conflict">
          <strong>확인 필요: 예약 활동의 시각 변경·제거입니다.</strong>
          {pending ? (
            <label>
              <input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} />
              예약을 직접 확인했고 이 항목도 적용
            </label>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ProposalReview({
  repo,
  proposal,
  plan,
  busy,
  stale,
  onApply,
  onReject,
}: {
  repo: ContentRepository;
  proposal: Proposal;
  plan: PlanVersion;
  busy: boolean;
  stale: boolean;
  onApply: (keep: Proposal['operations']) => void;
  onReject: () => void;
}) {
  const [confirmation, setConfirmation] = useState<ConfirmationState>({
    revisionId: proposal.proposalRevisionId,
    activityIds: new Set(),
  });
  const confirmed = confirmationsFor(confirmation, proposal.proposalRevisionId);
  const evidence = useLiveQuery(
    () =>
      Promise.all(
        proposal.evidenceRefs.map((ref) => repo.content(ref.tripId, 'evidence', ref.entityId, ref.revisionId)),
      ),
    [repo, proposal.proposalRevisionId],
    [],
  );
  const rows = evidence.flatMap((content) => (content?.kind === 'evidence' ? [content] : []));
  const pending = proposal.status === 'pending';
  const reviews = reviewProposal(proposal, plan, rows);
  const kept = operationsToApply(reviews, confirmed);
  const excluded = reviews.length - kept.length;
  return (
    <>
      <ul className="proposal-cards" aria-label="변경안 항목">
        {reviews.map((review) => (
          <OperationCard
            key={review.index}
            review={review}
            pending={pending}
            confirmed={confirmed.has(review.activityId)}
            onConfirm={(value) =>
              setConfirmation(withConfirmation(confirmation, proposal.proposalRevisionId, review.activityId, value))
            }
          />
        ))}
      </ul>
      <details>
        <summary>전체 근거</summary>
        <ul aria-label="변경안 조사 근거">
          {rows.map((content) =>
            content.payload.sourceUrlOrRef !== operationReasonsRef ? (
              <li key={content.entityId}>
                {content.payload.sourceType === 'web' ? (
                  <a href={content.payload.sourceUrlOrRef} target="_blank" rel="noreferrer">
                    {content.payload.label || content.payload.sourceUrlOrRef}
                  </a>
                ) : (
                  <span>{content.payload.label || content.payload.sourceUrlOrRef}</span>
                )}
                {content.payload.claim ? <p>{content.payload.claim}</p> : null}
              </li>
            ) : null,
          )}
        </ul>
      </details>
      {pending ? (
        <>
          {excluded > 0 ? <p className="notice">확인 필요 {excluded}건은 표시하지 않으면 적용에서 빠집니다.</p> : null}
          <div className="button-row">
            <button
              disabled={busy || stale || kept.length === 0}
              className="primary"
              onClick={() => onApply(kept.map((review) => proposal.operations[review.index]))}
            >
              확인 후 적용
            </button>
            <button disabled={busy} onClick={onReject}>
              변경안 거절
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
function MockEditor({
  repo,
  header,
  plan,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripDataset['header'];
  plan: PlanVersion;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(plan.items[0].title),
    [reason, setReason] = useState('가상 상황에 따른 변경'),
    [impact, setImpact] = useState('실제 예약 변경 없음'),
    [error, setError] = useState('');
  return (
    <Modal title="모의 변경안 작성" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const proposal = {
              tripId: header.tripId,
              proposalId: crypto.randomUUID(),
              proposalRevisionId: crypto.randomUUID(),
              proposalRevision: 1,
              baseDomainRevision: header.domainRevision,
              basePlanVersionId: plan.planVersionId,
              origin: 'ai',
              operations: [{ type: 'upsert-item', item: { ...plan.items[0], title } }],
              reason,
              evidenceRefs: plan.contextRefs.filter((r) => r.targetKind === 'evidence'),
              impact: { activityIds: [plan.items[0].activityId], reservationText: impact },
              status: 'pending',
            };
            await repo.execute(
              command(
                header.tripId,
                'SaveProposal',
                { proposal, baseDomainRevision: header.domainRevision },
                undefined,
                { expectedProposalRevision: 0 },
              ),
            );
            onSaved();
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <label>
          변경할 활동 이름
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          변경 이유
          <textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label>
          예약 영향
          <textarea required value={impact} onChange={(e) => setImpact(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <button className="primary">미적용 초안 저장</button>
      </form>
    </Modal>
  );
}
const slotText = (s: Slot) =>
  s.present ? (typeof s.value === 'string' ? s.value : JSON.stringify(s.value, null, 2)) : '원본에 없음';
export function ReimportReview({
  repo,
  review,
  onClose,
  onSaved,
}: {
  repo: ContentRepository;
  review: Review;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
      Object.fromEntries(review.units.map((u) => [u.key, u.recommendation])),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="재가져오기 차이 검토" onClose={onClose}>
      <p>
        {review.units.length}개 차이 · 기준 revision {review.baseDomainRevision}
      </p>
      <p>승인한 원본 값만 반영합니다. 앱 유지·보류한 항목은 이전 기준을 유지합니다.</p>
      {review.units.map((u) => (
        <section className="review-unit" key={u.key}>
          <h3>
            {u.targetKind} / {u.entityId} / {u.path.join('/') || '전체'}
          </h3>
          <p>
            {u.status === 'conflict'
              ? '양쪽 수정 충돌'
              : u.status === 'app-only'
                ? '앱에서만 수정'
                : u.status === 'deleted-source'
                  ? '원본에서 제거'
                  : u.status === 'same'
                    ? '양쪽 값이 같음'
                    : '원본 변경'}
          </p>
          <div className="comparison">
            <details>
              <summary>이전 기준 B</summary>
              <pre>{slotText(u.base)}</pre>
            </details>
            <details>
              <summary>앱 L</summary>
              <pre>{slotText(u.local)}</pre>
            </details>
            <details>
              <summary>새 원본 R</summary>
              <pre>{slotText(u.remote)}</pre>
            </details>
          </div>
          <label>
            반영 선택
            <select
              aria-label={`반영 선택 ${u.entityId} ${u.path.join('/') || '전체'}`}
              value={choices[u.key]}
              onChange={(e) => setChoices({ ...choices, [u.key]: e.target.value as Choice })}
            >
              <option value="remote">새 원본 반영</option>
              <option value="local">앱 내용 유지</option>
              <option value="defer">보류</option>
            </select>
          </label>
        </section>
      ))}
      <ErrorText error={error} />
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const reviewDigest = await repo.prepareReimportDecision(review, choices);
            await repo.execute(
              command(
                review.tripId,
                'ApplyReimport',
                {
                  packageId: review.packageId,
                  packageDigest: review.packageDigest,
                  lineageId: review.lineageId,
                  reviewDigest,
                },
                review.baseDomainRevision,
              ),
            );
            onSaved();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        검토한 선택 적용
      </button>
    </Modal>
  );
}
