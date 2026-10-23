import { z } from 'zod';
import { canonicalJson, sourceExtractSchema, type ContentRevision } from '../contracts/v2/index.ts';
export type SourceExtract = z.infer<typeof sourceExtractSchema>;

export const sourceObject = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
export const sourceObjects = (value: unknown) => z.array(z.record(z.string(), z.unknown())).parse(value);
export const sourceString = (value: unknown) => z.string().parse(value);
export const sourceStrings = (value: unknown) => z.array(z.string()).parse(value);
export const sourceText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : canonicalJson(value);
};
export type Guide = Extract<ContentRevision, { kind: 'guide' }>;
export type Section = Guide['payload']['sections'][number];
type Disposition = 'displayed' | 'metadata' | 'deferred' | 'unmapped';
export type CoverageRow = { locator: string; disposition: Disposition; target: string; reason: string };
const pointer = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');

export function sourceLeaves(value: unknown, prefix = ''): { pointer: string; value: unknown }[] {
  if (value !== null && typeof value === 'object' && Object.keys(value).length) {
    return Object.entries(value).flatMap(([key, child]) => sourceLeaves(child, `${prefix}/${pointer(key)}`));
  }
  return [{ pointer: prefix, value }];
}

/** Every extracted leaf receives a visible destination, a metadata reason, or an explicit scope deferral. */
export class SourceCoverage {
  private readonly rows = new Map<string, CoverageRow>();
  constructor(extract: SourceExtract) {
    const seen = new Set<string>();
    for (const entry of extract.entries) {
      if (seen.has(entry.sourceKey)) {
        throw new Error(`중복 추출 원천: ${entry.sourceKey}`);
      }
      seen.add(entry.sourceKey);
      for (const leaf of sourceLeaves(entry.rawValue)) {
        const locator = `${entry.sourceKey}#${leaf.pointer}`;
        this.rows.set(locator, { locator, disposition: 'unmapped', target: '', reason: '' });
      }
    }
  }
  mark(
    sourceKey: string,
    prefix: string,
    disposition: Exclude<Disposition, 'unmapped'>,
    target: string,
    reason: string,
  ) {
    const start = `${sourceKey}#${prefix}`;
    let matched = 0;
    for (const [locator, row] of this.rows) {
      if (locator === start || locator.startsWith(start + '/')) {
        if (row.disposition !== 'unmapped') {
          throw new Error(`원천 필드의 중복 범위 판정: ${locator}`);
        }
        Object.assign(row, { disposition, target, reason });
        matched++;
      }
    }
    if (!matched) {
      throw new Error(`대응할 원천 필드가 없습니다: ${start}`);
    }
  }
  result() {
    return [...this.rows.values()];
  }
}

export function sourceRefFor(path: string, locator = path) {
  const sourcePath = path.includes('.py:') ? path.slice(0, path.indexOf('.py:') + 3) : path;
  return {
    sourceKind: path.endsWith('.md')
      ? 'markdown'
      : sourcePath.endsWith('.py')
        ? 'python'
        : path.endsWith('.xlsx')
          ? 'xlsx'
          : 'json',
    sourcePath,
    sourceKey: locator,
    locator,
  };
}

// Escape both Markdown syntax and binding schemes: source prose is data, never a generated binding.
export function tableText(value: unknown) {
  return sourceText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\')
    .replace(/([`*_{}[\]()!|])/g, '\\$1')
    .replace(/\r?\n/g, ' / ');
}

export function sourceTable(value: unknown) {
  return [
    '| 원천 항목 | 값 |',
    '|---|---|',
    ...sourceLeaves(value).map((leaf) => `| ${tableText(leaf.pointer || '(본문)')} | ${tableText(leaf.value)} |`),
  ].join('\n');
}

export function section(key: string, title: string, bodyMd: string, order = 0): Section {
  return { key, title, order, bodyMd, factRefs: [], assetRefs: [], linkRefs: [] };
}
