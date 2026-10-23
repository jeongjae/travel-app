import type { ContentRevision } from '../contracts/v2/index.ts';

/** Resolve only source paths with an explicit imported destination; keep unknown paths visible. */
export function bindSpfrLinks(contents: ContentRevision[], warnings: string[]) {
  const destination = (path: string) => {
    const withoutAnchor = path.split('#')[0].split('?')[0];
    const basename = withoutAnchor.split('/').at(-1) ?? '';
    const slug = basename.replace(/\.(md|html)$/, '');
    const asset = contents.find(
      (content) => content.kind === 'asset' && content.payload.originalPath?.split('/').at(-1) === basename,
    );
    if (asset) {
      return asset;
    }
    const place = contents.find((content) => content.kind === 'place' && content.entityId === slug);
    if (place) {
      return place;
    }
    const region = contents.find((content) => content.kind === 'region' && content.entityId === slug);
    if (region) {
      return region;
    }
    return contents.find(
      (content) =>
        content.kind === 'guide' && content.sourceRefs.some((ref) => ref.sourcePath.split('/').at(-1) === basename),
    );
  };
  for (const content of contents) {
    if (content.kind !== 'guide') {
      continue;
    }
    for (const section of content.payload.sections) {
      section.bodyMd = section.bodyMd.replace(
        /(?<!!)\[([^\]\n]+)\]\(([^\s)]+)\)/g,
        (original, label: string, path: string) => {
          if (/^(?:https?:|travel:|asset:|mailto:|tel:|#)/.test(path)) {
            return original;
          }
          const target = destination(path);
          if (!target) {
            warnings.push(`SOURCE_LINK_UNRESOLVED:${content.entityId}:${path}`);
            return `${label} (원천 경로: \`${path.replaceAll('`', '')}\` · 연결 대기)`;
          }
          if (target.kind === 'asset') {
            if (!section.assetRefs.some((ref) => ref.assetId === target.entityId)) {
              section.assetRefs.push({ assetId: target.entityId, role: 'reference' });
            }
            return `[${label}](asset://${target.entityId})`;
          }
          if (!section.linkRefs.some((ref) => ref.targetKind === target.kind && ref.entityId === target.entityId)) {
            section.linkRefs.push({ tripId: content.tripId, targetKind: target.kind, entityId: target.entityId });
          }
          return `[${label}](travel://${target.kind}/${target.entityId})`;
        },
      );
    }
  }
}
