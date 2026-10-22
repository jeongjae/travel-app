import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeExtract } from '../src/transfer/normalize.ts';
import { buildPackage } from '../src/transfer/package.ts';
import { parseStrictJson, digestBytes } from '../src/contracts/v2/index.ts';
const { values } = parseArgs({
  options: {
    extract: { type: 'string' },
    'dataset-key': { type: 'string' },
    root: { type: 'string' },
    rules: { type: 'string' },
    output: { type: 'string' },
  },
});
if (!values.extract || !values['dataset-key'] || !values.root || !values.output)
  throw new Error('--extract --dataset-key --root --output을 지정하세요. 실제 자료 출력은 local-data/를 권장합니다.');
const normalized = normalizeExtract(
  parseStrictJson(await readFile(values.extract, 'utf8'), 32 * 1024 ** 2),
  values['dataset-key'],
  values.rules ? JSON.parse(await readFile(values.rules, 'utf8')) : [],
);
if (normalized.report.blocking.length)
  throw new Error(
    `차단 미해결 ${normalized.report.blocking.length}건. 원천을 수정하거나 명시적 어댑터 규칙을 보완하세요.`,
  );
const root = await realpath(values.root),
  assets = new Map();
for (const entry of normalized.extract.entries.filter((e) => e.sourceKind === 'asset')) {
  const file = await realpath(resolve(root, entry.sourceKey)),
    rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('원천 밖 첨부 경로');
  const bytes = new Uint8Array(await readFile(file));
  assets.set(await digestBytes(bytes), bytes);
}
const result = await buildPackage(
  normalized.dataset,
  assets,
  {
    sourceRepository: normalized.extract.sourceRepository,
    sourceCommit: normalized.extract.sourceCommit,
    lineageId: normalized.extract.sourceRepository.replace(/[^A-Za-z0-9._:-]/g, '-'),
    adapterVersion: 'neutral-v1',
    normalizationVersion: 'neutral-v1',
  },
  normalized.report,
  normalized.mappings,
);
await mkdir(dirname(resolve(values.output)), { recursive: true });
await writeFile(values.output, new Uint8Array(await result.blob.arrayBuffer()));
console.log(`package=${result.manifest.packageId} bytes=${result.blob.size} digest=${result.packageDigest}`);
