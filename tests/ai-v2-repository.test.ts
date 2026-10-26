import { afterEach, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { digestBytes } from '../src/contracts/v2';
import { command } from '../src/content/ui';
import { currentMappings } from '../src/transfer/normalize';
import { materializeV2Proposal } from '../server/ai-v2';
import { fixtureAssets } from './fixtures/pilot';
import { aiV2Fixture } from './fixtures/ai-v2';

const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    await database.delete();
  }
});

async function setup() {
  const fixture = await aiV2Fixture();
  const database = new TravelDB(`ai-v2-atomic-${crypto.randomUUID()}`);
  databases.push(database);
  const repository = new ContentRepository(database);
  await repository.init();
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const provenance = {
    packageId: 'fictional-ai-v2',
    packageDigest: 'a'.repeat(64),
    lineageId: 'fictional-ai-v2',
    adapterVersion: '1',
    manifest: {},
    report: {},
    mappings: currentMappings(fixture.dataset),
  };
  await repository.prepareImport(fixture.dataset, assets, provenance);
  await repository.execute(
    command(fixture.dataset.header.tripId, 'ImportNewTrip', {
      packageId: provenance.packageId,
      packageDigest: provenance.packageDigest,
    }),
  );
  const result = materializeV2Proposal(fixture.input, fixture.output, fixture.research);
  const evidence = result.evidence.map(({ actor, recordedAt, commitSeq, ...content }) => content);
  const payload = { proposal: result.proposal, evidence };
  const stage = {
    ...command(fixture.dataset.header.tripId, 'StageAiProposal', payload, fixture.dataset.header.domainRevision, {
      requestId: fixture.input.id,
    }),
    payload,
  };
  return { ...fixture, database, repository, result, stage };
}

async function snapshot(database: TravelDB) {
  return Object.fromEntries(
    await Promise.all(database.tables.map(async (table) => [table.name, await table.toArray()])),
  );
}

it('조사 근거·초안을 원자 저장하고 같은 결과 재회수는 중복 저장하지 않는다', async () => {
  const { repository, database, dataset, stage, result } = await setup();
  const original = await repository.get(dataset.header.tripId);
  const receipt = await repository.execute(stage);
  const saved = await repository.get(dataset.header.tripId);
  expect(saved.header.domainRevision).toBe(1);
  expect(saved.plans).toEqual(original.plans);
  expect(saved.records).toEqual(original.records);
  expect(saved.contents.some((content) => content.entityId === result.evidence[0].entityId)).toBe(true);
  expect(saved.proposals.at(-1)?.status).toBe('pending');
  const beforeRetry = await snapshot(database);
  expect(await repository.execute(structuredClone(stage))).toEqual({ ...receipt, status: 'replayed' });
  expect(await snapshot(database)).toEqual(beforeRetry);
});

it('초안 자동 저장 후 사용자 확인을 거쳐야 새 계획을 만들고 예약·현장 필드를 보존한다', async () => {
  const { repository, dataset, stage, result } = await setup();
  await repository.execute(stage);
  const pending = await repository.get(dataset.header.tripId);
  expect(pending.header.currentPlanVersionId).toBe(dataset.header.currentPlanVersionId);
  await repository.execute(
    command(
      dataset.header.tripId,
      'DecideProposal',
      { proposalId: result.proposal.proposalId, decision: 'apply', confirmedByUser: true },
      undefined,
      { expectedProposalRevision: 1 },
    ),
  );
  const applied = await repository.get(dataset.header.tripId);
  const current = applied.plans.find((plan) => plan.planVersionId === applied.header.currentPlanVersionId)!;
  expect(applied.plans).toHaveLength(2);
  expect(applied.plans[0]).toEqual(dataset.plans[0]);
  expect(current.items.find((item) => item.activityId === 'activity-1')).toMatchObject({
    title: '가상 AI 변경 활동',
    reservationText: 'SYNTHETIC-PRIVATE-RESERVATION',
    executionNote: 'SYNTHETIC-PRIVATE-FIELD-NOTE',
  });
  const byId = (a: { recordId: string }, b: { recordId: string }) => a.recordId.localeCompare(b.recordId);
  expect(applied.records.toSorted(byId)).toEqual(dataset.records.toSorted(byId));
});

it('명시적 사용자 확인이 없는 적용은 거부하고 거절은 현재 계획을 유지한다', async () => {
  const { repository, dataset, stage, result } = await setup();
  await repository.execute(stage);
  const decide = command(
    dataset.header.tripId,
    'DecideProposal',
    { proposalId: result.proposal.proposalId, decision: 'apply', confirmedByUser: false },
    undefined,
    { expectedProposalRevision: 1 },
  );
  await expect(repository.execute(decide)).rejects.toThrow();
  await repository.execute({
    ...decide,
    requestId: crypto.randomUUID(),
    payload: { proposalId: result.proposal.proposalId, decision: 'reject', confirmedByUser: true },
  });
  const rejected = await repository.get(dataset.header.tripId);
  expect(rejected.plans).toEqual(dataset.plans);
  expect(rejected.header.domainRevision).toBe(1);
  expect(rejected.proposals.at(-1)?.status).toBe('rejected');
});

it('초안 도착 전 현지 revision이 바뀌면 근거·초안·영수증을 모두 남기지 않는다', async () => {
  const { repository, database, dataset, stage } = await setup();
  await repository.execute(
    command(
      dataset.header.tripId,
      'UpdateTripMetadata',
      { name: '가상 현지 변경', startDate: dataset.header.startDate, endDate: dataset.header.endDate },
      0,
    ),
  );
  const before = await snapshot(database);
  await expect(repository.execute(stage)).rejects.toThrow('CONFLICT');
  expect(await snapshot(database)).toEqual(before);
});

it('초안 저장 후 현장 기록이 생기면 오래된 계획 적용을 거부하고 기록을 유지한다', async () => {
  const { repository, database, dataset, stage, result } = await setup();
  await repository.execute(stage);
  const { commitSeq, recordedAt, ...record } = dataset.records.find((record) => record.kind === 'actual')!;
  await repository.execute(
    command(dataset.header.tripId, 'RecordActual', { record: { ...record, recordId: 'fictional-after-ai' } }, 1),
  );
  const before = await snapshot(database);
  await expect(
    repository.execute(
      command(
        dataset.header.tripId,
        'DecideProposal',
        { proposalId: result.proposal.proposalId, decision: 'apply', confirmedByUser: true },
        undefined,
        { expectedProposalRevision: 1 },
      ),
    ),
  ).rejects.toThrow('CONFLICT');
  expect(await snapshot(database)).toEqual(before);
});

it('저장소의 마지막 영수증 쓰기가 실패하면 새 근거·초안·revision을 전부 롤백한다', async () => {
  const { repository, database, stage } = await setup();
  const before = await snapshot(database);
  const fail = () => {
    throw new Error('가상 AI 원자 저장 실패');
  };
  database.table('command_receipts').hook('creating', fail);
  try {
    await expect(repository.execute(stage)).rejects.toThrow('가상 AI 원자 저장 실패');
  } finally {
    database.table('command_receipts').hook('creating').unsubscribe(fail);
  }
  expect(await snapshot(database)).toEqual(before);
  await repository.execute(stage);
  expect((await database.table('proposal_heads').toArray()).some((head) => head.proposalId.startsWith('ai-'))).toBe(
    true,
  );
});

it('두 번째 근거의 기존 ID 충돌은 먼저 처리한 새 근거까지 함께 취소한다', async () => {
  const { repository, database, stage } = await setup();
  const collision = { ...stage.payload.evidence[0], entityId: 'evidence-1' };
  stage.payload.evidence.push(collision);
  stage.payload.proposal.evidenceRefs.push({
    tripId: collision.tripId,
    targetKind: 'evidence',
    entityId: collision.entityId,
    revisionId: collision.revisionId,
  });
  const before = await snapshot(database);
  await expect(repository.execute(stage)).rejects.toThrow('CONFLICT');
  expect(await snapshot(database)).toEqual(before);
});
