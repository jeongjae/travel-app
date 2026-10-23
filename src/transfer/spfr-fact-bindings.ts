import type { ContentRevision } from '../contracts/v2/index.ts';

/** Bind tokens after all place facts and supplemental source documents exist. */
export function bindSpfrFacts(contents: ContentRevision[]) {
  for (const content of contents) {
    if (content.kind !== 'guide') {
      continue;
    }
    for (const section of content.payload.sections) {
      section.bodyMd = section.bodyMd
        .replace(/\{\{badge:[^|}]*\|([^}]*)\}\}/g, '($1)')
        .replace(/\{\{badge:([^}]*)\}\}/g, '($1)')
        .replace(/\{\{grade:[^}]*\}\}/g, '')
        .replace(
          /\{\{fact:([^{}|]+)\|([^{}]+)\}\}/g,
          (_, token: string, modifier: string) => `{{fact:${token}}} (원천 수식 ${modifier} · 자동 계산 미적용)`,
        );
      for (const [, token] of section.bodyMd.matchAll(/\{\{fact:([^{}]+)\}\}/g)) {
        let binding = content.payload.factBindings.find((value) => value.token === token);
        if (!binding) {
          const split = token.lastIndexOf('.');
          const fact = contents.find(
            (value) =>
              value.kind === 'fact' &&
              value.payload.targetRef.entityId === token.slice(0, split) &&
              value.payload.key === token.slice(split + 1),
          );
          if (!fact) {
            throw new Error(`원천 Fact 토큰의 대상이 없습니다: ${content.entityId}/${token}`);
          }
          binding = {
            token,
            ref: { tripId: content.tripId, targetKind: 'fact', entityId: fact.entityId, revisionId: fact.revisionId },
          };
          content.payload.factBindings.push(binding);
        }
        if (!section.factRefs.includes(binding.ref.entityId)) {
          section.factRefs.push(binding.ref.entityId);
        }
      }
    }
  }
}
