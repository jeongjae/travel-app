import { z } from 'zod';
import {
  activitySchema,
  addDate,
  backupSchema,
  dateSchema,
  fromLocal,
  newTrip,
  now,
  proposalInputSchema,
  tripFileSchema,
  uid,
  validateTrip,
  type Trip,
} from './domain';

const stopSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    summary: z.string().optional(),
    place_ref: z.string().nullable().optional(),
  })
  .passthrough();
const cardSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    day: z.number().int().positive(),
    date: dateSchema,
    city: z.string(),
    title: z.string(),
    timeZone: z.string().optional(),
    stops: z.array(stopSchema).max(500),
    sourceRefs: z.array(z.string()).optional(),
  })
  .passthrough();
export const legacySchema = z
  .object({
    format: z.literal('spfr-daily-cards'),
    name: z.string().trim().min(1),
    timeZone: z.string().min(1),
    days: z.array(cardSchema).min(1).max(367),
  })
  .strict();
export function convertLegacy(input: unknown): Trip {
  const source = legacySchema.parse(input);
  const days = [...source.days].sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(days.map((d) => d.date)).size !== days.length || new Set(days.map((d) => d.day)).size !== days.length)
    throw new Error('일일카드 날짜 또는 일차가 중복됩니다.');
  const trip = newTrip({
    name: source.name,
    startDate: days[0].date,
    endDate: days.at(-1)!.date,
    timeZone: source.timeZone,
  });
  const activities = days.flatMap((day) => {
    if (new Set(day.stops.map((s) => s.id)).size !== day.stops.length)
      throw new Error('일일카드에 중복 stop ID가 있습니다.');
    return day.stops.map((stop) => {
      const placeId = stop.place_ref || undefined;
      if (placeId && !trip.places.some((p) => p.id === placeId)) trip.places.push({ id: placeId, name: stop.name });
      const timeZone = day.timeZone ?? source.timeZone;
      const endDate = stop.end < stop.start ? addDate(day.date, 1) : day.date;
      return activitySchema.parse({
        id: `day-${day.day}/${stop.id}`,
        title: stop.name,
        placeId,
        start: fromLocal(`${day.date}T${stop.start}`, timeZone),
        end: fromLocal(`${endDate}T${stop.end}`, timeZone),
        timeZone,
        note: stop.summary ?? '',
        sourceRef: `SP-FR daily-cards/day-${String(day.day).padStart(2, '0')}.json#${stop.id}`,
      });
    });
  });
  trip.versions[0] = {
    number: 1,
    createdAt: now(),
    reason: 'SP-FR 일일카드 가져오기 (일정만, 실제 방문 추정 없음)',
    activities,
    evidence: days.flatMap((day) =>
      (day.sourceRefs ?? []).map((source, index) => ({
        id: `source-${day.day}-${index}`,
        source: `imported/sourceRefs/${day.day}/${index}`,
        claim: source,
        checkedAt: now(),
        appliesFrom: day.date,
        appliesTo: day.date,
        relatedActivityIds: activities.filter((a) => a.id.startsWith(`day-${day.day}/`)).map((a) => a.id),
        status: 'unverified' as const,
      })),
    ),
  };
  return validateTrip(trip);
}
export function parseFile(raw: string) {
  if (new TextEncoder().encode(raw).byteLength > 10 * 1024 * 1024)
    throw new Error('10 MiB 이하 JSON 파일만 지원합니다.');
  const data: unknown = JSON.parse(raw);
  const format = z.object({ format: z.string() }).parse(data).format;
  if (format === 'spfr-daily-cards') return { kind: 'trip' as const, trip: convertLegacy(data) };
  if (format === 'travel-app-trip')
    return { kind: 'trip' as const, trip: validateTrip(tripFileSchema.parse(data).trip) };
  if (format === 'travel-app-backup') {
    const backup = backupSchema.parse(data);
    backup.trips.forEach(validateTrip);
    if (new Set(backup.trips.map((t) => t.id)).size !== backup.trips.length)
      throw new Error('백업의 여행 ID가 중복됩니다.');
    return { kind: 'backup' as const, backup };
  }
  if (format === 'travel-app-proposal') {
    const file = z
      .object({ format: z.literal('travel-app-proposal'), schemaVersion: z.literal(1), proposal: proposalInputSchema })
      .strict()
      .parse(data);
    return { kind: 'proposal' as const, proposal: file.proposal };
  }
  throw new Error('지원하지 않는 JSON 형식입니다.');
}
export function aiContext(trip: Trip) {
  return {
    format: 'travel-app-context',
    schemaVersion: 1,
    exportedAt: now(),
    trip: {
      id: trip.id,
      revision: trip.revision,
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      timeZone: trip.timeZone,
      places: trip.places,
      currentPlan: trip.versions.at(-1),
      actuals: trip.actuals,
    },
    instructions:
      '현재 revision을 기준으로 변경안을 작성하세요. 실제 기록을 변경하지 마세요. 확인되지 않은 근거는 unverified로 표시하고 예약 영향과 사용자 결정 사항을 명시하세요.',
    proposalContract: {
      format: 'travel-app-proposal',
      schemaVersion: 1,
      proposal: {
        id: uid(),
        tripId: trip.id,
        baseRevision: trip.revision,
        reason: '변경 이유',
        reservationImpact: '영향받는 예약 또는 없음',
        evidence: [],
        operations: [],
      },
    },
  };
}
export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
