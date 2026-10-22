import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ContentRepository } from '../repository';
import type { ContentRevision, RevisionRef, TripDataset } from '../contracts/v2';
import { command, ErrorText, Modal, errorText } from './ui';

function AssetImage({
  repo,
  tripId,
  assetId,
  context,
  alt,
}: {
  repo: ContentRepository;
  tripId: string;
  assetId: string;
  context?: RevisionRef[];
  alt?: string;
}) {
  const data = useLiveQuery(() => repo.asset(tripId, assetId, context), [repo, tripId, assetId, context]);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!data) {
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(data.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [data]);
  return url ? (
    <img src={url} alt={alt ?? data?.content.payload.title ?? '첨부'} style={{ maxWidth: '100%', height: 'auto' }} />
  ) : (
    <span>첨부가 준비되지 않았습니다: {alt ?? assetId}</span>
  );
}
export function GuideMarkdown({
  repo,
  tripId,
  guide,
  body,
  context,
  onNavigate,
}: {
  repo: ContentRepository;
  tripId: string;
  guide: Extract<ContentRevision, { kind: 'guide' }>;
  body: string;
  context?: RevisionRef[];
  onNavigate: (kind: ContentRevision['kind'], id: string) => void;
}) {
  const facts = useLiveQuery(
    () =>
      Promise.all(
        guide.payload.factBindings.map(
          async (binding) =>
            [
              binding.token,
              await repo.content(
                tripId,
                'fact',
                binding.ref.entityId,
                context?.find((r) => r.targetKind === 'fact' && r.entityId === binding.ref.entityId)?.revisionId,
              ),
            ] as const,
        ),
      ),
    [repo, tripId, guide.revisionId, context],
  );
  const rendered = body.replace(/\{\{fact:([^{}]+)\}\}/g, (_, token: string) => {
    const fact = facts?.find(([t]) => t === token)?.[1];
    return fact?.kind === 'fact'
      ? fact.payload.valueText.replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&')
      : '[사실 정보 확인 중]';
  });
  return (
    <div>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) =>
          url.startsWith('travel://') || url.startsWith('asset://') ? url : defaultUrlTransform(url)
        }
        components={{
          a({ href, children }) {
            if (href?.startsWith('travel://')) {
              const [, kind, entityId] = /^travel:\/\/([^/]+)\/(.+)$/.exec(href) ?? [];
              return (
                <a
                  href={`#${entityId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(kind as ContentRevision['kind'], entityId);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img({ src, alt }) {
            return typeof src === 'string' && src.startsWith('asset://') ? (
              <AssetImage repo={repo} tripId={tripId} assetId={src.slice(8)} context={context} alt={alt} />
            ) : (
              <span>{alt ?? '외부 이미지'}</span>
            );
          },
        }}
      >
        {rendered}
      </Markdown>
      {facts
        ?.filter(
          (entry): entry is readonly [string, Extract<ContentRevision, { kind: 'fact' }>] => entry[1]?.kind === 'fact',
        )
        .map(([token, fact]) =>
          body.includes(`{{fact:${token}}}`) ? (
            <small className="fact-status" key={token}>
              사실 확인 상태:{' '}
              {{ unverified: '미확인', verified: '확인됨', 'needs-review': '검토 필요' }[fact.payload.appReviewStatus]}{' '}
              · 원천 신뢰 표기: {fact.payload.sourceConfidence} · 원천 확인일:{' '}
              {fact.payload.verifiedAt?.date ?? '미확인'}
              {fact.payload.blockedReason ? ` · ${fact.payload.blockedReason}` : ''}
            </small>
          ) : null,
        )}
    </div>
  );
}
export function GuideDetail({
  repo,
  header,
  target,
  context,
  onNavigate,
  onSaved,
}: {
  repo: ContentRepository;
  header: TripDataset['header'];
  target: { kind: ContentRevision['kind']; id: string };
  context?: RevisionRef[];
  onNavigate: (kind: ContentRevision['kind'], id: string) => void;
  onSaved: () => void;
}) {
  const owner = useLiveQuery(
    () =>
      repo.content(
        header.tripId,
        target.kind,
        target.id,
        context?.find((r) => r.targetKind === target.kind && r.entityId === target.id)?.revisionId,
      ),
    [repo, header.tripId, target.kind, target.id, context],
  );
  const guideId =
    owner?.kind === 'place'
      ? owner.payload.guideId
      : owner?.kind === 'region'
        ? owner.payload.guideIds[0]
        : owner?.kind === 'guide'
          ? owner.entityId
          : undefined;
  const guide = useLiveQuery(
    () =>
      guideId
        ? repo.content(
            header.tripId,
            'guide',
            guideId,
            context?.find((r) => r.targetKind === 'guide' && r.entityId === guideId)?.revisionId,
          )
        : undefined,
    [repo, header.tripId, guideId, context],
  );
  const [editor, setEditor] = useState<{
    guide: Extract<ContentRevision, { kind: 'guide' }>;
    section: Extract<ContentRevision, { kind: 'guide' }>['payload']['sections'][number];
    expected: number;
  } | null>(null);
  if (!owner) {
    return <p>자료를 찾는 중입니다.</p>;
  }
  return (
    <article className="guide-detail">
      <h2>
        {owner.kind === 'place' || owner.kind === 'region'
          ? owner.payload.name
          : owner.kind === 'guide'
            ? owner.payload.title
            : owner.entityId}
      </h2>
      <p className="muted">
        {context ? '당시 고정 내용' : '현재 내용'} · {owner.revisionId}
      </p>
      {owner.kind === 'place' ? (
        <>
          <p>{owner.payload.summary}</p>
          {owner.payload.wikiRef ? (
            <a href={owner.payload.wikiRef} target="_blank" rel="noreferrer">
              위키 자료
            </a>
          ) : null}
        </>
      ) : null}
      {owner.kind === 'region' ? (
        <>
          <p>{owner.payload.introduction}</p>
          <p>{owner.payload.rainPlan}</p>
        </>
      ) : null}
      {owner.kind === 'fact' ? (
        <>
          <p>{owner.payload.valueText}</p>
          <p>
            확인 상태: {owner.payload.appReviewStatus} · {owner.payload.sourceConfidence}
          </p>
        </>
      ) : null}
      {owner.kind === 'evidence' ? (
        <>
          <p>{owner.payload.label}</p>
          <p>{owner.payload.claim}</p>
          {owner.payload.sourceType === 'web' ? (
            <a href={owner.payload.sourceUrlOrRef} target="_blank" rel="noreferrer">
              근거 페이지 열기
            </a>
          ) : (
            <p>{owner.payload.sourceUrlOrRef}</p>
          )}
        </>
      ) : null}
      {guide?.kind === 'guide' ? (
        <>
          {guide.payload.sections
            .toSorted((a, b) => a.order - b.order)
            .map((s) => (
              <section key={s.key}>
                <div className="section-heading">
                  <h3>{s.title}</h3>
                  {!context && guide.payload.documentKind === 'place-guide' ? (
                    <button onClick={() => setEditor({ guide, section: s, expected: header.domainRevision })}>
                      {s.title} 편집
                    </button>
                  ) : null}
                </div>
                <GuideMarkdown
                  repo={repo}
                  tripId={header.tripId}
                  guide={guide}
                  body={s.bodyMd}
                  context={context}
                  onNavigate={onNavigate}
                />
              </section>
            ))}
          {'structuredData' in guide.payload ? <StructuredGuide guide={guide} /> : null}
          {guide.payload.assetRefs.length ? (
            <p>
              참고 첨부:{' '}
              {guide.payload.assetRefs.map((a) => (
                <AssetLink key={a.assetId} repo={repo} tripId={header.tripId} assetId={a.assetId} context={context} />
              ))}
            </p>
          ) : null}
          <details>
            <summary>본문 출처·저장 정보</summary>
            {guide.sourceRefs.map((s, n) => (
              <p key={n}>
                {s.sourcePath} · {s.locator}
              </p>
            ))}
          </details>
        </>
      ) : (
        <p>연결된 본문이 없습니다.</p>
      )}
      {editor ? (
        <SectionEditor
          repo={repo}
          tripId={header.tripId}
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            onSaved();
          }}
          onNavigate={onNavigate}
        />
      ) : null}
    </article>
  );
}
function StructuredGuide({ guide }: { guide: Extract<ContentRevision, { kind: 'guide' }> }) {
  const p = guide.payload;
  if (p.documentKind === 'region-essentials') {
    return (
      <div>
        <h3>현장 생활 정보</h3>
        <p>{p.structuredData.staySummary}</p>
        {p.structuredData.lifeEssentials.map((x, i) => (
          <p key={i}>{x}</p>
        ))}
        <p>{p.structuredData.arrivalStrategy}</p>
        <p>{p.structuredData.departureStrategy}</p>
        <p>{p.structuredData.lateReturnRule}</p>
      </div>
    );
  }
  if (p.documentKind === 'transit') {
    return (
      <div>
        <h3>교통 정보</h3>
        <p>{p.structuredData.recommendation}</p>
        {p.structuredData.products.map((x) => (
          <section key={x.id}>
            <h4>{x.title}</h4>
            <p>
              {x.priceText} · {x.sharingText}
            </p>
            <p>{x.suitability}</p>
            <p>{x.accessConditions.join(' · ')}</p>
          </section>
        ))}
        {[...p.structuredData.howToUse, ...p.structuredData.exceptions].map((x, i) => (
          <p key={i}>{x}</p>
        ))}
      </div>
    );
  }
  if (p.documentKind === 'language-guide') {
    return (
      <div>
        <h3>발음·표지판</h3>
        {p.structuredData.pronunciationRules.map((x, i) => (
          <p key={i}>
            {x.pattern} · {x.sound} · {x.example} · {x.note}
          </p>
        ))}
        {p.structuredData.signsAndMenu.map((x, i) => (
          <p key={i}>
            {x.text} · {x.translation} · {x.pronunciation}
          </p>
        ))}
      </div>
    );
  }
  return null;
}
function AssetLink({
  repo,
  tripId,
  assetId,
  context,
}: {
  repo: ContentRepository;
  tripId: string;
  assetId: string;
  context?: RevisionRef[];
}) {
  const data = useLiveQuery(() => repo.asset(tripId, assetId, context), [repo, tripId, assetId, context]);
  return (
    <button
      disabled={!data}
      onClick={() => {
        if (!data) {
          return;
        }
        const url = URL.createObjectURL(data.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.content.payload.title + (data.content.payload.mimeType === 'application/pdf' ? '.pdf' : '');
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      {data?.content.payload.title ?? assetId} 열기
    </button>
  );
}
function SectionEditor({
  repo,
  tripId,
  editor,
  onClose,
  onSaved,
  onNavigate,
}: {
  repo: ContentRepository;
  tripId: string;
  editor: {
    guide: Extract<ContentRevision, { kind: 'guide' }>;
    section: Extract<ContentRevision, { kind: 'guide' }>['payload']['sections'][number];
    expected: number;
  };
  onClose: () => void;
  onSaved: () => void;
  onNavigate: (kind: ContentRevision['kind'], id: string) => void;
}) {
  const [body, setBody] = useState(editor.section.bodyMd),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={`${editor.section.title} 본문 편집`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await repo.execute(
              command(
                tripId,
                'EditContentSection',
                {
                  target: { targetKind: 'guide', entityId: editor.guide.entityId, revisionId: editor.guide.revisionId },
                  section: { ...editor.section, bodyMd: body },
                },
                editor.expected,
              ),
            );
            onSaved();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          본문 Markdown
          <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>
          본문 저장
        </button>
        <h3>미리보기</h3>
        <GuideMarkdown repo={repo} tripId={tripId} guide={editor.guide} body={body} onNavigate={onNavigate} />
      </form>
    </Modal>
  );
}
