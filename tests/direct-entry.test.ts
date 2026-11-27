import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { buildNewTrip } from '../src/content/trip-factory';
import { activityCategoryOptions, applyActivityDetails } from '../src/content/activity-details';
import { planEditOperationSchema, planOperationSchema } from '../src/contracts/v2/index';
import type { PlanVersion } from '../src/contracts/v2/index';

/** T-E3-2b: 날짜 제목·도시(update-day)와 활동 칸. 가상 여행만 사용한다. */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

const uuid = () => crypto.randomUUID();
const envelope = (tripId: string, kind: string, payload: unknown, expectedDomainRevision?: number) => ({
  format: 'travel-app-command',
  commandVersion: 2,
  normalizationVersion: 'c02',
  tripId,
  requestId: uuid(),
  kind,
  payload,
  ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
});

async function fixture() {
  const db = new TravelDB(`direct-entry-${uuid()}`);
  databases.push(db);
  const repo = new ContentRepository(db);
  await repo.init();
  const trip = buildNewTrip({ name: '가상 직접 입력 여행', start: '2033-06-01', end: '2033-06-03' });
  await repo.execute(envelope(trip.tripId, 'CreateTrip', { header: trip.header, initialPlan: trip.initialPlan }));
  return { repo, tripId: trip.tripId };
}

async function current(repo: ContentRepository, tripId: string) {
  const trip = await repo.get(tripId);
  return { trip, plan: trip.plans.find((p) => p.planVersionId === trip.header.currentPlanVersionId)! };
}

async function updateDay(repo: ContentRepository, tripId: string, dayId: string, title: string, cityText: string) {
  const { trip, plan } = await current(repo, tripId);
  return repo.execute(
    envelope(
      tripId,
      'ChangePlan',
      {
        currentPlanVersionId: plan.planVersionId,
        operations: [{ type: 'update-day', dayId, title, cityText }],
        reason: '날짜 정보 수정',
      },
      trip.header.domainRevision,
    ),
  );
}

describe('update-day', () => {
  it('그 날짜의 제목·도시만 새 계획 버전에서 바꾸고 다른 칸·다른 날·이전 버전은 그대로 둔다', async () => {
    const { repo, tripId } = await fixture();
    const before = await current(repo, tripId);
    const target = before.plan.days[1];
    await updateDay(repo, tripId, target.dayId, '  가상 항구의 날 ', ' 가상 항구시 ');
    const after = await current(repo, tripId);
    expect(after.plan.planVersionId).not.toBe(before.plan.planVersionId);
    const changed = after.plan.days.find((d) => d.dayId === target.dayId)!;
    expect(changed.title).toBe('가상 항구의 날');
    expect(changed.cityText).toBe('가상 항구시');
    const strip = (day: PlanVersion['days'][number]) => {
      const { title: _title, cityText: _city, planVersionId: _plan, ...rest } = day;
      return rest;
    };
    expect(strip(changed)).toEqual(strip(target));
    for (const day of after.plan.days.filter((d) => d.dayId !== target.dayId)) {
      const original = before.plan.days.find((d) => d.dayId === day.dayId)!;
      expect({ ...day, planVersionId: original.planVersionId }).toEqual(original);
    }
    expect(after.plan.items).toEqual(before.plan.items);
    const old = after.trip.plans.find((p) => p.planVersionId === before.plan.planVersionId)!;
    expect(old.days).toEqual(before.plan.days);
  });

  it('도시는 비울 수 있다', async () => {
    const { repo, tripId } = await fixture();
    const { plan } = await current(repo, tripId);
    await updateDay(repo, tripId, plan.days[0].dayId, '첫날', '');
    const after = await current(repo, tripId);
    expect(after.plan.days.find((d) => d.dayId === plan.days[0].dayId)!.cityText).toBe('');
  });

  it('빈 제목·없는 날짜는 거부하고 저장하지 않는다', async () => {
    const { repo, tripId } = await fixture();
    const { trip, plan } = await current(repo, tripId);
    await expect(updateDay(repo, tripId, plan.days[0].dayId, '   ', '도시')).rejects.toThrow();
    await expect(updateDay(repo, tripId, uuid(), '제목', '도시')).rejects.toThrow();
    const after = await current(repo, tripId);
    expect(after.trip.header.domainRevision).toBe(trip.header.domainRevision);
    expect(after.plan.planVersionId).toBe(plan.planVersionId);
  });

  it('계획 편집 연산에만 있고 변경안·AI 경계(planOperationSchema)는 거부한다', () => {
    const operation = { type: 'update-day', dayId: uuid(), title: '제목', cityText: '' };
    expect(planEditOperationSchema.safeParse(operation).success).toBe(true);
    expect(planOperationSchema.safeParse(operation).success).toBe(false);
  });
});

describe('활동 칸', () => {
  const base = {
    category: 'activity',
    summary: '',
    optional: false,
    menuText: '이전 메뉴',
    reservationText: '이전 예약',
    title: '가상 활동',
  } as unknown as PlanVersion['items'][number];

  it('종류·설명·식사·예약 안내·선택 활동을 반영하고 다른 칸은 그대로 둔다', () => {
    const next = applyActivityDetails(base, {
      category: '식사',
      summary: '여러 줄\n설명',
      menuText: ' 덮밥 ',
      reservationText: '예약 필요',
      optional: true,
    });
    expect(next).toMatchObject({
      title: '가상 활동',
      category: '식사',
      summary: '여러 줄\n설명',
      menuText: '덮밥',
      reservationText: '예약 필요',
      optional: true,
    });
  });

  it('빈 식사·메뉴·예약 안내는 칸을 지우고 빈 설명은 허용한다', () => {
    const next = applyActivityDetails(base, {
      category: '기타',
      summary: '',
      menuText: '',
      reservationText: '  ',
      optional: false,
    });
    expect('menuText' in next).toBe(false);
    expect('reservationText' in next).toBe(false);
    expect(next.summary).toBe('');
  });

  it('목록에 없는 기존 종류는 맨 앞 선택지로 그대로 보인다', () => {
    expect(activityCategoryOptions('hotel')).toEqual(['hotel', '관광', '식사', '쇼핑', '휴식', '이동', '기타']);
    expect(activityCategoryOptions('식사')).toEqual(['관광', '식사', '쇼핑', '휴식', '이동', '기타']);
    expect(activityCategoryOptions()).toEqual(['관광', '식사', '쇼핑', '휴식', '이동', '기타']);
  });
});
