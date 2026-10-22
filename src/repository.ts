import Dexie, { type EntityTable } from 'dexie';
import { storesV2, type Workspace } from './storage/schema';
import { backupSchema, canonical, currentPlan, effectiveActuals, newTrip, now, proposalInputSchema, uid, validateTrip, applyOperations, type ActualRecord, type Backup, type Operation, type ProposalInput, type Trip } from './domain';

export class TravelDB extends Dexie {
  trips!: EntityTable<Trip, 'id'>;
  constructor(name = 'travel-app') {
    super(name);
    this.version(1).stores({ trips: 'id, name, startDate' });
    this.version(2).stores(storesV2);
  }
}
export class TravelRepository {
  constructor(readonly db = new TravelDB()) {}
  private async legacyWrite() {
    const meta = await this.db.table<Workspace>('workspace_meta').get('workspace');
    if (meta?.mode === 'v2') throw new Error('새 콘텐츠 저장소로 전환되어 기존 일정은 읽기 전용입니다. 가이드·콘텐츠에서 수정하세요.');
  }
  async list() { return this.db.trips.orderBy('startDate').toArray(); }
  async get(id: string) { const trip = await this.db.trips.get(id); if (!trip) throw new Error('여행을 찾을 수 없습니다.'); return validateTrip(trip); }
  async create(input: Parameters<typeof newTrip>[0]) {
    const trip = newTrip(input);
    await this.db.transaction('rw', [this.db.trips, this.db.table('workspace_meta')], async () => { await this.legacyWrite(); await this.db.trips.add(trip); });
    return trip;
  }
  private async command(tripId: string, requestId: string, kind: string, payload: unknown, fn: (trip: Trip) => void) {
    if (!requestId || requestId.length > 120) throw new Error('유효한 요청 ID가 필요합니다.');
    const fingerprint = canonical({ kind, payload });
    return this.db.transaction('rw', [this.db.trips, this.db.table('workspace_meta')], async () => {
      await this.legacyWrite();
      const trip = await this.get(tripId);
      const receipt = trip.receipts.find(r => r.id === requestId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new Error('같은 요청 ID를 다른 내용에 재사용할 수 없습니다.');
        return trip;
      }
      fn(trip);
      trip.receipts.push({ id: requestId, fingerprint });
      const validated = validateTrip(trip);
      await this.db.trips.put(validated);
      return validated;
    });
  }
  private checkRevision(trip: Trip, expected: number) {
    if (trip.revision !== expected) throw new Error(`충돌: 현재 revision ${trip.revision}, 변경안 기준 ${expected}. 최신 상태에서 다시 작성하세요.`);
  }
  changePlan(tripId: string, expected: number, operations: Operation[], reason: string, requestId = uid()) {
    return this.command(tripId, requestId, 'change-plan', { expected, operations, reason }, trip => {
      this.checkRevision(trip, expected);
      if (!operations.length) throw new Error('변경 내용이 없습니다.');
      trip.versions.push({ number: trip.versions.length + 1, createdAt: now(), reason, activities: applyOperations(trip, operations), evidence: [] });
      trip.revision++;
    });
  }
  record(tripId: string, expected: number, input: Omit<ActualRecord, 'id' | 'createdAt'>, requestId = uid()) {
    return this.command(tripId, requestId, 'record', { expected, input }, trip => {
      this.checkRevision(trip, expected);
      if (input.supersedes && !effectiveActuals(trip).some(a => a.id === input.supersedes)) throw new Error('이미 정정되었거나 없는 기록입니다.');
      trip.actuals.push({ ...input, id: uid(), createdAt: now() });
      trip.revision++;
    });
  }
  async propose(input: ProposalInput, requestId: string = uid()) {
    const p = proposalInputSchema.parse(input);
    return this.command(p.tripId, requestId, 'propose', p, trip => {
      this.checkRevision(trip, p.baseRevision);
      if (trip.proposals.some(x => x.id === p.id)) throw new Error('이미 존재하는 변경안 ID입니다.');
      applyOperations(trip, p.operations);
      trip.proposals.push({ ...p, status: 'pending', createdAt: now(), basePlanNumber: currentPlan(trip).number });
    });
  }
  decide(tripId: string, proposalId: string, decision: 'apply' | 'reject', requestId = uid()) {
    return this.command(tripId, requestId, 'decide', { proposalId, decision }, trip => {
      const p = trip.proposals.find(x => x.id === proposalId);
      if (!p || p.status !== 'pending') throw new Error('결정 대기 중인 변경안이 아닙니다.');
      if (decision === 'apply') {
        this.checkRevision(trip, p.baseRevision);
        const activities = applyOperations(trip, p.operations);
        trip.versions.push({ number: trip.versions.length + 1, createdAt: now(), reason: p.reason, evidence: p.evidence, proposalId: p.id, activities });
        trip.revision++;
        p.status = 'applied';
      } else p.status = 'rejected';
      p.decidedAt = now(); p.decidedBy = 'user';
    });
  }
  rename(tripId: string, expected: number, name: string) {
    return this.command(tripId, uid(), 'rename', { expected, name }, trip => {
      this.checkRevision(trip, expected); trip.name = name; trip.revision++;
    });
  }
  async importTrip(input: unknown) {
    const trip = validateTrip(input);
    await this.db.transaction('rw', [this.db.trips, this.db.table('workspace_meta')], async () => {
      await this.legacyWrite();
      if (await this.db.trips.get(trip.id)) throw new Error('같은 ID의 여행이 있습니다. 덮어쓰지 않았습니다.');
      await this.db.trips.add(trip);
    });
    return trip;
  }
  async backup(): Promise<Backup> { return { format: 'travel-app-backup', schemaVersion: 1, exportedAt: now(), trips: await this.list() }; }
  async restore(input: unknown) {
    const backup = backupSchema.parse(input);
    const trips = backup.trips.map(validateTrip);
    if (new Set(trips.map(t => t.id)).size !== trips.length) throw new Error('백업에 중복 여행 ID가 있습니다.');
    await this.db.transaction('rw', [this.db.trips, this.db.table('workspace_meta')], async () => {
      await this.legacyWrite();
      if (await this.db.trips.count()) throw new Error('전체 복원은 빈 저장소에서만 가능합니다. 기존 여행을 덮어쓰지 않았습니다.');
      await this.db.trips.bulkAdd(trips);
    });
    return trips;
  }
}
export const repository = new TravelRepository();
export { ContentRepository } from './storage/content-repository';
