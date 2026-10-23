import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot.ts';
import { buildPackage, readPackage } from '../src/transfer/package.ts';
import { canonicalJson, parseStrictJson, digestBytes } from '../src/contracts/v2/index.ts';

const { values } = parseArgs({
  options: {
    extract: { type: 'string' },
    'media-dir': { type: 'string' },
    days: { type: 'string' },
    'trip-id': { type: 'string' },
    'output-dir': { type: 'string' },
    audit: { type: 'string' },
    'lineage-id': { type: 'string' },
    'trip-name': { type: 'string' },
  },
});
if (['extract', 'media-dir', 'days', 'trip-id', 'output-dir'].some((name) => !values[name])) {
  throw new Error('--extract --media-dir --days --trip-id --output-dir를 지정하세요.');
}
const privateRoot = await realpath('local-data');
const contained = (root, path) => {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('실제 이행 파일은 지정된 비공개 폴더의 하위 경로에만 허용합니다.');
  }
  return path;
};
const mediaRoot = contained(privateRoot, await realpath(values['media-dir']));
const extractFile = contained(privateRoot, await realpath(values.extract));
const extract = parseStrictJson(await readFile(extractFile, 'utf8'), 32 * 1024 ** 2);
const days = values.days.split(',').map(Number);
const audit = values.audit
  ? parseStrictJson(await readFile(contained(privateRoot, await realpath(values.audit)), 'utf8'), 32 * 1024 ** 2)
  : undefined;
if (audit && (audit.sourceCommit !== extract.sourceCommit || canonicalJson(audit.scope.days) !== canonicalJson(days))) {
  throw new Error('배치 범위·원천 감사가 추출 입력과 다릅니다.');
}
const mediaManifest = parseStrictJson(await readFile(resolve(mediaRoot, 'media-files.json'), 'utf8'));
if (mediaManifest.sourceCommit !== extract.sourceCommit || mediaManifest.allBytesVerified !== true) {
  throw new Error('미디어와 추출 원천 커밋·검증 상태가 다릅니다.');
}
const files = [];
const selectedPaths = audit ? new Set(audit.media.map((item) => item.sourcePath)) : undefined;
const selectedFiles = mediaManifest.files.filter((record) => !selectedPaths || selectedPaths.has(record.sourcePath));
if (selectedPaths && selectedFiles.length !== selectedPaths.size) {
  throw new Error('배치 감사의 필수 미디어가 공통 첨부 폴더에 없습니다.');
}
for (const record of selectedFiles) {
  const source = contained(mediaRoot, await realpath(contained(mediaRoot, resolve(mediaRoot, record.sourcePath))));
  const bytes = new Uint8Array(await readFile(source));
  if (bytes.length !== record.byteLength || (await digestBytes(bytes)) !== record.sha256) {
    throw new Error('로컬 미디어 manifest 해시·크기 불일치');
  }
  files.push({ ...record, bytes });
}
const output = contained(privateRoot, resolve(values['output-dir']));
contained(privateRoot, await realpath(resolve(output, '..')));
// A new run directory is mandatory. Never overwrite an earlier source-derived package or report.
await mkdir(output);
contained(privateRoot, await realpath(output));
const normalized = await normalizeSpfrPilot(extract, {
  days,
  tripId: values['trip-id'],
  createdAt: new Date().toISOString(),
  media: files,
  fullSourceScope: audit?.scope.includeCommonContent === true,
  ...(audit?.scope.includeRegionCatalog
    ? { additionalPlaceIds: audit.scope.places, bodylessPlaceIds: audit.scope.bodylessPlaces }
    : {}),
});
if (values['trip-name']) {
  normalized.dataset.header.name = values['trip-name'];
  // Keep the import baseline aligned with the visible header.
  const tripMapping = normalized.mappings.find((mapping) => mapping.targetKind === 'trip');
  if (tripMapping && tripMapping.baselineValue && typeof tripMapping.baselineValue === 'object') {
    tripMapping.baselineValue.name = values['trip-name'];
  }
  normalized.report.datasetDigest = await digestBytes(new TextEncoder().encode(JSON.stringify(normalized.dataset)));
}
for (const [name, value] of Object.entries(normalized)) {
  if (name === 'generatedAssets') {
    continue;
  }
  await writeFile(resolve(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
if (!normalized.report.packageReady) {
  console.log(
    JSON.stringify({ packageReady: false, blocking: normalized.report.blocking, coverage: normalized.report.coverage }),
  );
  process.exitCode = 1;
} else {
  const packaged = await buildPackage(
    normalized.dataset,
    new Map([...files.map((file) => [file.sha256, file.bytes]), ...normalized.generatedAssets]),
    {
      sourceRepository: extract.sourceRepository,
      sourceCommit: extract.sourceCommit,
      lineageId: values['lineage-id'] ?? 'spfr-pilot-28-30',
      adapterVersion: 'spfr-pilot-v2',
      normalizationVersion: '2',
    },
    normalized.report,
    normalized.mappings,
  );
  const bytes = new Uint8Array(await packaged.blob.arrayBuffer());
  await writeFile(resolve(output, 'pilot.zip'), bytes, { flag: 'wx' });
  // Read from the saved ZIP, not the builder's in-memory object.
  const restored = await readPackage(new Blob([await readFile(resolve(output, 'pilot.zip'))]));
  if (
    canonicalJson(restored.dataset) !== canonicalJson(normalized.dataset) ||
    restored.assets.size !== new Set([...files.map((file) => file.sha256), ...normalized.generatedAssets.keys()]).size
  ) {
    throw new Error('디스크 ZIP 재검증 결과가 변환 결과와 다릅니다.');
  }
  const verification = {
    packageReady: true,
    zipBytes: bytes.length,
    zipSha256: await digestBytes(bytes),
    days: restored.dataset.plans[0].days.length,
    activities: restored.dataset.plans[0].items.length,
    contents: restored.dataset.contents.length,
    assets: restored.assets.size,
    coverage: normalized.report.coverage,
    packageDigest: packaged.packageDigest,
    reloadedDatasetIdentical: true,
  };
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(verification, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(verification));
}
