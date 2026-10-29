import { canonicalJson, type TripDataset, type ContentRevision } from '../contracts/v2/index.ts';
import type { ImportMapping } from '../storage/content-repository.ts';
import { canonicalPlanValue, comparablePlan, comparableTrip } from './comparable.ts';
export type Choice = 'remote' | 'local' | 'defer';
export type Slot = { present: false } | { present: true; value: unknown };
export type ReviewUnit = {
  key: string;
  mappingKey: string;
  targetKind: ImportMapping['targetKind'];
  entityId: string;
  path: string[];
  base: Slot;
  local: Slot;
  remote: Slot;
  status: 'source-only' | 'app-only' | 'same' | 'conflict' | 'new-source' | 'deleted-source';
  recommendation: Choice;
};
export type Review = {
  tripId: string;
  jobId: string;
  baseDomainRevision: number;
  lineageId: string;
  packageId: string;
  packageDigest: string;
  units: ReviewUnit[];
};
export const mappingKey = (m: Pick<ImportMapping, 'sourceKind' | 'sourceKey'>) =>
  canonicalJson([m.sourceKind, m.sourceKey]);
const slot = (v: unknown): Slot => (v === undefined ? { present: false } : { present: true, value: v });
const equal = (a: Slot, b: Slot) => canonicalJson(a) === canonicalJson(b);
function current(t: TripDataset, m: ImportMapping): unknown {
  if (m.targetKind === 'plan') {
    return comparablePlan(t.plans.find((p) => p.planVersionId === t.header.currentPlanVersionId)!);
  }
  if (m.targetKind === 'trip') {
    return comparableTrip(t.header);
  }
  const h = t.heads.find((h) => h.targetKind === m.targetKind && h.entityId === m.entityId);
  return h?.status === 'active'
    ? t.contents.find((c) => c.kind === h.targetKind && c.entityId === h.entityId && c.revisionId === h.revisionId)
        ?.payload
    : undefined;
}
function fields(value: unknown, kind: ImportMapping['targetKind']): Map<string, Slot> {
  const result = new Map<string, Slot>();
  if (!value || typeof value !== 'object' || kind === 'plan') {
    result.set('[]', slot(value));
    return result;
  }
  for (const [k, v] of Object.entries(value)) {
    if (kind === 'guide' && k === 'sections' && Array.isArray(v)) {
      for (const section of v) {
        result.set(canonicalJson(['sections', section.key]), slot(section));
      }
    } else {
      result.set(canonicalJson([k]), slot(v));
    }
  }
  return result;
}
export function compareReimport(
  local: TripDataset,
  remote: ImportMapping[],
  baseline: ImportMapping[],
  meta: Omit<Review, 'tripId' | 'baseDomainRevision' | 'units'>,
): Review {
  const b = new Map(baseline.map((m) => [mappingKey(m), m])),
    r = new Map(remote.map((m) => [mappingKey(m), m])),
    units: ReviewUnit[] = [];
  for (const k of new Set([...b.keys(), ...r.keys()])) {
    const bm = b.get(k),
      rm = r.get(k),
      m = rm ?? bm!;
    if (bm && rm && (bm.targetKind !== rm.targetKind || bm.entityId !== rm.entityId)) {
      throw new Error('원천 대응 대상이 바뀌었습니다. 자동 병합하지 않았습니다.');
    }
    const normalize = (value: unknown) => (m.targetKind === 'plan' ? canonicalPlanValue(value) : value);
    const base = slot(bm?.baselineValue === null ? undefined : normalize(bm?.baselineValue)),
      l = slot(current(local, m)),
      rr = slot(normalize(rm?.baselineValue));
    const atomic = !base.present || !l.present || !rr.present || m.targetKind === 'plan';
    const bf = atomic ? new Map([['[]', base]]) : fields(base.value, m.targetKind),
      lf = atomic ? new Map([['[]', l]]) : fields(l.value, m.targetKind),
      rf = atomic ? new Map([['[]', rr]]) : fields(rr.value, m.targetKind);
    for (const pathKey of new Set([...bf.keys(), ...lf.keys(), ...rf.keys()])) {
      const bv = bf.get(pathKey) ?? slot(undefined),
        lv = lf.get(pathKey) ?? slot(undefined),
        rv = rf.get(pathKey) ?? slot(undefined);
      if (equal(bv, lv) && equal(bv, rv)) {
        continue;
      }
      let status: ReviewUnit['status'] = equal(lv, rv)
        ? 'same'
        : equal(bv, lv)
          ? rv.present
            ? base.present
              ? 'source-only'
              : 'new-source'
            : 'deleted-source'
          : equal(bv, rv)
            ? 'app-only'
            : 'conflict';
      const recommendation: Choice = status === 'app-only' ? 'local' : status === 'conflict' ? 'defer' : 'remote';
      units.push({
        key: canonicalJson([k, pathKey]),
        mappingKey: k,
        targetKind: m.targetKind,
        entityId: m.entityId,
        path: JSON.parse(pathKey),
        base: bv,
        local: lv,
        remote: rv,
        status,
        recommendation,
      });
    }
  }
  return { ...meta, tripId: local.header.tripId, baseDomainRevision: local.header.domainRevision, units };
}
export function patchValue(value: unknown, path: string[], remote: Slot): unknown {
  if (!path.length) {
    return remote.present ? structuredClone(remote.value) : undefined;
  }
  const next = structuredClone((value ?? {}) as Record<string, unknown>);
  if (path[0] === 'sections' && path.length === 2) {
    const sections = Array.isArray(next.sections) ? (next.sections as { key: string }[]) : [];
    const rest = sections.filter((s) => s.key !== path[1]);
    if (remote.present) {
      rest.push(structuredClone(remote.value) as { key: string });
    }
    next.sections = rest.sort(
      (a, b) => Number((a as { order?: number }).order ?? 0) - Number((b as { order?: number }).order ?? 0),
    );
  } else if (remote.present) {
    next[path[0]] = structuredClone(remote.value);
  } else {
    delete next[path[0]];
  }
  return next;
}
export function localPayload(t: TripDataset, m: ImportMapping) {
  return current(t, m);
}
export function retarget(value: unknown, t: TripDataset, sourcePlanId?: string, newPlanId?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => retarget(v, t, sourcePlanId, newPlanId));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, retarget(v, t, sourcePlanId, newPlanId)]));
  if (out.planVersionId === sourcePlanId && newPlanId) {
    out.planVersionId = newPlanId;
  }
  if (
    typeof out.tripId === 'string' &&
    typeof out.targetKind === 'string' &&
    typeof out.entityId === 'string' &&
    typeof out.revisionId === 'string'
  ) {
    const h = t.heads.find((h) => h.targetKind === out.targetKind && h.entityId === out.entityId);
    if (h) {
      out.revisionId = h.revisionId;
      if (out.targetKind === 'asset') {
        const c = t.contents.find(
          (c) => c.kind === 'asset' && c.entityId === h.entityId && c.revisionId === h.revisionId,
        );
        if (c?.kind === 'asset') {
          out.hash = c.payload.hash;
        }
      }
    }
  }
  return out;
}
