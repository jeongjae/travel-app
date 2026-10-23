import { digestBytes, type ContentRevision, type PlanVersion } from '../contracts/v2/index.ts';
import {
  sourceObject as obj,
  sourceObjects as arr,
  sourceString as str,
  sourceText as text,
  sourceTable,
  section,
  tableText,
  type SourceExtract,
  type SourceCoverage,
} from './spfr-source.ts';

export type PilotMediaFile = { sourcePath: string; sha256: string; byteLength: number; bytes: Uint8Array };
type AddContent = (
  kind: ContentRevision['kind'],
  entityId: string,
  payload: unknown,
  path: string,
  locator?: string,
) => ContentRevision;

export async function mapSpfrMedia({
  extract,
  files,
  contents,
  plan,
  add,
  show,
  defer,
  warnings,
}: {
  extract: SourceExtract;
  coverage: SourceCoverage;
  files: PilotMediaFile[];
  contents: ContentRevision[];
  plan: PlanVersion;
  add: AddContent;
  show: (path: string, prefix: string, value: unknown, title: string, existingGuide?: string) => void;
  defer: (path: string, prefix: string) => void;
  warnings: string[];
}) {
  const tripId = plan.tripId;
  const path = 'data/images/image-manifest.json';
  const manifest = obj(extract.entries.find((entry) => entry.sourceKey === path)!.rawValue);
  const places = contents.filter((content) => content.kind === 'place').map((content) => content.entityId);
  const regions = contents.filter((content) => content.kind === 'region').map((content) => content.entityId);
  const uses = new Set(plan.days.map((day) => `daily/day-${day.dayId.slice(4).padStart(2, '0')}.html`));
  const byPath = new Map(files.map((file) => [file.sourcePath, file]));
  if (byPath.size !== files.length) {
    throw new Error('첨부 경로 중복');
  }
  const used = new Set<string>();
  const assetsByPath = new Map<string, string>();
  const mediaSections = [];
  let photoGroups = 0;
  const addFile = async (sourcePath: string, details: Record<string, unknown>, sourceFile: string, locator: string) => {
    const file = byPath.get(sourcePath);
    if (!file || file.byteLength !== file.bytes.length || (await digestBytes(file.bytes)) !== file.sha256) {
      throw new Error(`첨부 바이트 누락·크기·SHA-256 불일치: ${sourcePath}`);
    }
    if (used.has(sourcePath)) {
      return assetsByPath.get(sourcePath)!;
    }
    used.add(sourcePath);
    const id = `asset-${(await digestBytes(new TextEncoder().encode(sourcePath))).slice(0, 24)}`;
    const mimeType = sourcePath.endsWith('.webp')
      ? 'image/webp'
      : sourcePath.endsWith('.png')
        ? 'image/png'
        : sourcePath.endsWith('.jpg') || sourcePath.endsWith('.jpeg')
          ? 'image/jpeg'
          : sourcePath.endsWith('.pdf')
            ? 'application/pdf'
            : '';
    if (!mimeType) {
      throw new Error(`지원 첨부 MIME 판정 불가: ${sourcePath}`);
    }
    if (!text(details.license) || !text(details.sourceUrl)) {
      throw new Error(`첨부 권리·원본 주소 누락: ${sourcePath}`);
    }
    const evidenceId = `rights-${id}`;
    add(
      'evidence',
      evidenceId,
      {
        sourceType: 'web',
        sourceUrlOrRef: details.sourceUrl,
        label: '원천의 이미지 출처·권리 표기',
        claim: `${text(details.license)}; ${text(details.creator)}; ${text(details.changes)}`,
        relatedRefs: [{ tripId, targetKind: 'asset', entityId: id }],
      },
      sourceFile,
      locator,
    );
    add(
      'asset',
      id,
      {
        hash: file.sha256,
        mimeType,
        byteLength: file.byteLength,
        title: text(details.title) || sourcePath,
        assetKind: details.map ? 'map' : mimeType === 'application/pdf' ? 'pdf' : 'image',
        usage: text(details.usage),
        publisher: text(details.publisher),
        rightsHolder: text(details.creator),
        license: text(details.license),
        redistributionBasis: text(details.redistributionBasis),
        edition: text(details.edition),
        evidenceRefs: [{ tripId, targetKind: 'evidence', entityId: evidenceId, revisionId: 'source-1' }],
        originalPath: sourcePath,
      },
      sourceFile,
      locator,
    );
    assetsByPath.set(sourcePath, id);
    return id;
  };
  for (const [index, image] of arr(manifest.images).entries()) {
    const included =
      places.includes(text(image.placeId)) ||
      arrUsage(image.usage).some((use) => uses.has(use)) ||
      (regions.includes(text(image.region)) && image.regionHero === true);
    if (!included) {
      defer(path, `/images/${index}`);
      continue;
    }
    photoGroups++;
    show(
      path,
      `/images/${index}`,
      image,
      `${text(image.titleKo) || text(image.imageId)} · 이미지 권리·변형 정보`,
      'source-media-metadata',
    );
    const variants: (Record<string, unknown> & { role: string })[] = Object.entries(obj(image.variants)).flatMap(
      ([role, values]) => arr(values).map((variant) => ({ ...variant, role })),
    );
    const details = {
      title: image.titleKo || image.title,
      license: image.license,
      sourceUrl: image.sourcePage,
      creator: image.creator,
      changes: image.changes,
      usage: arrUsage(image.usage).join(' · '),
      redistributionBasis: '원천 라이선스·저작자·변형·원본 주소를 보존. 개인용 검증 사본; 공개 배포 판단은 별도.',
    };
    for (const variant of variants) {
      const sourcePath = str(variant.path);
      const file = byPath.get(sourcePath);
      if (!file || file.sha256 !== variant.sha256 || file.byteLength !== variant.bytes) {
        throw new Error(`이미지 manifest와 실파일 불일치: ${sourcePath}`);
      }
      await addFile(sourcePath, details, path, `${path}#/images/${index}`);
    }
    const selected =
      variants
        .filter((variant) => variant.role === 'content')
        .toSorted((a, b) => Number(b.width) - Number(a.width))[0] ??
      variants.filter((variant) => variant.role === 'hero').toSorted((a, b) => Number(b.width) - Number(a.width))[0] ??
      variants[0];
    if (!selected) {
      throw new Error('표시할 이미지 variant가 없습니다.');
    }
    const id = assetsByPath.get(str(selected.path))!;
    const title = text(image.titleKo) || text(image.title);
    const caption = [image.captionKo, image.creator, image.license, image.changes]
      .map(text)
      .filter(Boolean)
      .join(' · ');
    const imageSection = section(
      `photo-${photoGroups}`,
      title,
      `![${tableText(image.altKo || title)}](asset://${id})\n\n${tableText(caption)}\n\n[원본·권리 표기](${str(image.sourcePage)})`,
      mediaSections.length,
    );
    imageSection.assetRefs = [{ assetId: id, role: 'inline', caption }];
    mediaSections.push(imageSection);
    const place = contents.find((content) => content.kind === 'place' && content.entityId === image.placeId);
    if (place?.kind === 'place') {
      place.payload.assetRefs.push({ assetId: id, role: 'hero', caption });
      const guide = contents.find((content) => content.kind === 'guide' && content.entityId === place.payload.guideId);
      if (guide?.kind === 'guide') {
        guide.payload.sections.push({ ...imageSection, order: guide.payload.sections.length });
      }
    }
    for (const day of plan.days) {
      if (arrUsage(image.usage).includes(`daily/day-${day.dayId.slice(4).padStart(2, '0')}.html`)) {
        day.assetRefs.push({ assetId: id, role: 'hero', caption });
      }
    }
    const region = contents.find((content) => content.kind === 'region' && content.entityId === image.region);
    if (image.regionHero === true && region?.kind === 'region') {
      region.payload.assetRefs.push({ assetId: id, role: 'hero', caption });
    }
  }
  for (const [key, value] of Object.entries(manifest).filter(([key]) => key !== 'images')) {
    show(path, `/${key}`, value, `이미지 자료의 ${key}`, 'source-media-metadata');
  }
  const touristPath = 'data/tourist-maps.json';
  const tourist = obj(extract.entries.find((entry) => entry.sourceKey === touristPath)!.rawValue);
  let mapCount = 0;
  for (const region of regions) {
    for (const [index, map] of arr(obj(tourist.regions)[region]).entries()) {
      const sourcePath = 'source/ASSETS/' + str(map.localPath).replace(/^assets\//, '');
      const id = await addFile(
        sourcePath,
        {
          title: map.title,
          license: map.license,
          creator: map.rightsHolder,
          publisher: map.publisher,
          edition: map.edition,
          usage: map.usage,
          redistributionBasis: map.redistributionBasis,
          sourceUrl: map.sourceUrl,
          map: true,
        },
        touristPath,
        `${touristPath}#/regions/${region}/${index}`,
      );
      const mapSection = section(
        `map-${mapCount++}`,
        text(map.title),
        `![${tableText(map.title)}](asset://${id})\n\n` + sourceTable(map),
        mediaSections.length,
      );
      mapSection.assetRefs = [{ assetId: id, role: 'map-sheet', caption: text(map.publisher) }];
      mediaSections.push(mapSection);
      warnings.push(`MAP_SOURCE_RIGHTS_PERSONAL_REFERENCE_ONLY:${id}`);
    }
  }
  if (files.some((file) => !used.has(file.sourcePath))) {
    throw new Error('선택 범위에 대응하지 않는 첨부가 제공됐습니다.');
  }
  add(
    'guide',
    'source-media-gallery',
    {
      documentKind: 'preparation',
      ownerRef: { tripId, targetKind: 'trip', entityId: tripId },
      title: '사진·관광 지도 · 오프라인 자료',
      language: 'ko',
      sections: mediaSections,
      factBindings: [],
      assetRefs: [],
    },
    path,
  );
  return {
    files: used.size,
    photoGroups,
    touristMaps: mapCount,
    bytes: files.reduce((sum, file) => sum + file.byteLength, 0),
    rightsMetadataPreserved: true,
    publicDistributionPermissionVerified: false,
  };
}

function arrUsage(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('이미지 사용 위치는 문자열 목록이어야 합니다.');
  }
  return value as string[];
}
