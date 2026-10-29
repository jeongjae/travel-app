import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';

export const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const text = z.string().min(1);
export const uint = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const positive = uint.min(1);
export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    try {
      return Temporal.PlainDate.from(value).toString() === value;
    } catch {
      return false;
    }
  }, '유효한 ISO 날짜가 필요합니다.');
export const instant = z.string().refine((value) => {
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}, '오프셋이 있는 ISO instant가 필요합니다.');
export const timeZone = z.string().refine((value) => {
  if (/^[+-]/.test(value)) {
    return false;
  }
  try {
    Temporal.Instant.from('2026-01-01T00:00:00Z').toZonedDateTimeISO(value);
    return true;
  } catch {
    return false;
  }
}, '확인된 IANA 시간대가 필요합니다.');
/** 새 입력과 화면이 공용 스키마와 같은 기준으로 시간대 이름을 판정한다. */
export const isKnownTimeZone = (value: string) => timeZone.safeParse(value).success;
export const webUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}, '자격증명 없는 HTTP(S) URL이 필요합니다.');
export const contentKind = z.enum([
  'region',
  'place',
  'guide',
  'fact',
  'evidence',
  'asset',
  'booking',
  'task',
  'phrase-book',
  'map-target',
]);
export const contentRef = z.strictObject({ tripId: id, targetKind: contentKind, entityId: id });
export const revisionRef = contentRef.extend({ revisionId: id, hash: sha256.optional() }).superRefine((r, ctx) => {
  if (r.targetKind === 'asset' ? !r.hash : r.hash !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['hash'], message: 'Asset만 해시를 필수로 고정합니다.' });
  }
});
export const targetRef = z.strictObject({
  tripId: id,
  targetKind: z.enum([...contentKind.options, 'trip', 'plan', 'day', 'activity']),
  entityId: id,
  planVersionId: id.optional(),
});
export const sourceRef = z.strictObject({
  sourceKind: text,
  sourceKey: text,
  locator: text,
  sourcePath: text,
  sha256: sha256.optional(),
});
export const assetRef = z.strictObject({
  assetId: id,
  role: z.enum(['hero', 'inline', 'daily-card', 'map-sheet', 'reference']),
  order: uint.optional(),
  caption: z.string().optional(),
});
export type ContentRef = z.infer<typeof contentRef>;
export type RevisionRef = z.infer<typeof revisionRef>;
export type TargetRef = z.infer<typeof targetRef>;

export class ContractError extends Error {
  readonly code: 'INVALID_INPUT' | 'BROKEN_REFERENCE' | 'DUPLICATE_ID' | 'UNSUPPORTED_VERSION' | 'LIMIT_EXCEEDED';
  readonly path: string;
  constructor(code: ContractError['code'], path: string, message: string) {
    super(`${code} ${path}: ${message}`);
    this.name = 'ContractError';
    this.code = code;
    this.path = path;
  }
}
export function ensure(
  condition: unknown,
  path: string,
  message: string,
  code: ContractError['code'] = 'INVALID_INPUT',
): asserts condition {
  if (!condition) {
    throw new ContractError(code, path, message);
  }
}
export function unique(values: string[], path: string) {
  ensure(new Set(values).size === values.length, path, '중복 키입니다.', 'DUPLICATE_ID');
}
export const key = (...parts: (string | number)[]) => JSON.stringify(parts);
