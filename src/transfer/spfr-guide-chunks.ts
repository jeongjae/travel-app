import { canonicalJson, LIMITS, type ContentRevision } from '../contracts/v2/index.ts';

/** Keep the normal record budget; split long reference guides at section boundaries. */
export function splitSpfrGuides(contents: ContentRevision[]) {
  const byteLength = (value: unknown) => new TextEncoder().encode(canonicalJson(value)).length;
  const budget = LIMITS.recordBytes - 16 * 1024;
  for (const content of [...contents]) {
    if (content.kind !== 'guide' || byteLength(content) <= budget) {
      continue;
    }
    const chunks: (typeof content.payload.sections)[] = [];
    let current: typeof content.payload.sections = [];
    for (const section of content.payload.sections) {
      const proposed = { ...content, payload: { ...content.payload, sections: [...current, section] } };
      if (current.length && byteLength(proposed) > budget) {
        chunks.push(current);
        current = [];
      }
      current.push(section);
      if (byteLength({ ...content, payload: { ...content.payload, sections: current } }) > budget) {
        throw new Error(`단일 본문 절이 행 한도를 초과합니다: ${content.entityId}/${section.key}`);
      }
    }
    chunks.push(current);
    const partIds = chunks.map((_, index) => (index ? `${content.entityId}-part-${index + 1}` : content.entityId));
    for (const [index, sections] of chunks.entries()) {
      const part = structuredClone(content);
      part.entityId = partIds[index];
      part.payload.title = index ? `${content.payload.title} · 계속 ${index + 1}` : content.payload.title;
      part.payload.sections = sections.map((section, order) => ({ ...section, order }));
      part.payload.sections.push({
        key: 'source-guide-parts',
        title: '나누어 보관한 본문',
        order: sections.length,
        bodyMd: partIds.map((id, number) => `[${number + 1}부](travel://guide/${id})`).join(' · '),
        factRefs: [],
        assetRefs: [],
        linkRefs: partIds.map((entityId) => ({ tripId: content.tripId, targetKind: 'guide', entityId })),
      });
      if (byteLength(part) > LIMITS.recordBytes) {
        throw new Error('분할한 원천 본문이 행 한도를 초과합니다.');
      }
      if (index === 0) {
        content.payload = part.payload;
      } else {
        contents.push(part);
      }
    }
  }
}
