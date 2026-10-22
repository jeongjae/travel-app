import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { date, instant, text, timeZone } from './primitives.ts';

const common = { rawText: z.string().optional(), interpretation: z.string().optional() };
const localTime = z
  .string()
  .regex(/^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/)
  .refine((value) => {
    try {
      Temporal.PlainTime.from(value, { overflow: 'reject' });
      return true;
    } catch {
      return false;
    }
  });
export const timeSpecSchema = z
  .discriminatedUnion('precision', [
    z.strictObject({ precision: z.literal('unspecified'), date: date.optional(), ...common }),
    z.strictObject({ precision: z.literal('date'), date, ...common }),
    z.strictObject({
      precision: z.literal('text'),
      date: date.optional(),
      ...common,
      rawText: text.refine((v) => v.trim().length > 0),
    }),
    z.strictObject({
      precision: z.literal('local'),
      date,
      localTime,
      timeZone: timeZone.optional(),
      timeZoneStatus: z.enum(['confirmed', 'unknown']),
      ...common,
    }),
    z.strictObject({
      precision: z.literal('instant'),
      date,
      localTime,
      timeZone,
      offset: z.string().regex(/^[+-]\d{2}:\d{2}$/),
      instant,
      ...common,
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.precision === 'local' && (value.timeZoneStatus === 'confirmed') !== Boolean(value.timeZone)) {
      ctx.addIssue({ code: 'custom', path: ['timeZoneStatus'], message: '시간대 값과 확인 상태가 일치해야 합니다.' });
    }
    if (value.precision === 'local' && value.timeZone) {
      try {
        const local = Temporal.PlainDateTime.from(`${value.date}T${value.localTime}`);
        const earlier = local.toZonedDateTime(value.timeZone, { disambiguation: 'earlier' }).toPlainDateTime();
        const later = local.toZonedDateTime(value.timeZone, { disambiguation: 'later' }).toPlainDateTime();
        if (!local.equals(earlier) && !local.equals(later)) {
          throw new Error();
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['localTime'],
          message: '확인된 시간대에 존재하지 않는 현지 시각입니다.',
        });
      }
    }
    if (value.precision !== 'instant') {
      return;
    }
    try {
      const zoned = Temporal.ZonedDateTime.from(`${value.date}T${value.localTime}${value.offset}[${value.timeZone}]`, {
        offset: 'reject',
        disambiguation: 'reject',
      });
      if (Temporal.Instant.compare(zoned.toInstant(), Temporal.Instant.from(value.instant)) !== 0) {
        throw new Error();
      }
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['instant'],
        message: '현지 시각·시간대·오프셋·instant 불일치 또는 존재하지 않는 시각입니다.',
      });
    }
  });
export type TimeSpec = z.infer<typeof timeSpecSchema>;
export const timeRangeSchema = z
  .strictObject({ start: timeSpecSchema, end: timeSpecSchema.optional() })
  .superRefine(({ start, end }, ctx) => {
    if (
      start.precision === 'instant' &&
      end?.precision === 'instant' &&
      Temporal.Instant.compare(start.instant, end.instant) > 0
    ) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: '종료가 시작보다 이릅니다.' });
    }
  });
