/**
 * Day-level region semantics of the SP-FR source (build/model.py::load_days), kept apart from the adapters.
 *
 * regionIds         stays with checkin <= date <= checkout: a move day keeps departure and arrival, and the
 *                   checkout day of the last stay keeps the region that ends there.
 * overnightRegionId the last stay with checkin <= date < checkout (where the night is spent), otherwise unset.
 *
 * Not adopted from the source: the `return` sentinel and the fallback that names the ending stay the day's own
 * region. A day no stay touches has no region and no overnight region. Activity-place regions are never merged in.
 * Repeated regions keep the order of the first stay; the overnight region follows itinerary order (last wins).
 */
export type SourceStay = { key: string; checkin: string; checkout: string };

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function validateSourceStays(stays: SourceStay[]) {
  for (const stay of stays) {
    if (!stay.key || !isoDate.test(stay.checkin) || !isoDate.test(stay.checkout) || stay.checkout < stay.checkin) {
      throw new Error('숙박 원천 값이 올바르지 않습니다.');
    }
  }
}

export function stayRegionsForDay(stays: SourceStay[], date: string) {
  validateSourceStays(stays);
  const touching = stays.filter((stay) => stay.checkin <= date && date <= stay.checkout);
  const sleeping = stays.filter((stay) => stay.checkin <= date && date < stay.checkout);
  const overnightRegionId = sleeping.at(-1)?.key;
  return {
    regionIds: [...new Set(touching.map((stay) => stay.key))],
    ...(overnightRegionId === undefined ? {} : { overnightRegionId }),
  };
}

export const spfrPilotAdapterVersion = 'spfr-pilot-v3';
export const spfrPilotNormalizationVersion = '3';
