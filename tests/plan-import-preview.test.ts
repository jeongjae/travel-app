import { describe, expect, it } from 'vitest';
import { buildPlanPreview, canSavePreview, RETRY_REQUEST_HINT } from '../src/plan-import/preview';
import { act, fixture, newPlan } from './plan-import-helpers';

const T1 = fixture('chatgpt-t1-run2.md');

describe('미리보기 계산', () => {
  it('T1은 저장할 수 있는 상태이고 수치가 파일과 같다', () => {
    const preview = buildPlanPreview(T1);
    expect(preview.state).toBe('ready');
    expect(preview.tripName).toBe('후쿠오카 봄 여행 3박 4일');
    expect(preview.period).toBe('2027-04-15 ~ 2027-04-18');
    expect(preview.timeZoneLabel).toBe('Asia/Tokyo');
    expect(preview.activityCount).toBe(32);
    expect(preview.stayCount).toBe(1);
    expect(preview.placeCount).toBe(16);
    expect(preview.days.map((day) => day.activities.length)).toEqual([8, 10, 9, 5]);
    expect(preview.notImported).toEqual(['구역 "이동" 9줄']);
    expect(preview.errors).toEqual([]);
    expect(preview.dropped).toEqual([]);
    expect(preview.trip).toBeDefined();
    expect(canSavePreview(preview, false, false)).toBe(true);
  });

  it('활동 목록에 시간 표시와 자정 넘김(+1)이 나온다', () => {
    const preview = buildPlanPreview(T1);
    const midnight = preview.days[1].activities.at(-1);
    expect(midnight?.time).toBe('23:30-00:20(+1)');
    expect(preview.days[0].activities[0].time).toBe('08:00-10:30');
  });

  it('양식이 아니면 다음에 할 일을 안내하고 저장할 수 없다', () => {
    const preview = buildPlanPreview('그냥 대화 글입니다.');
    expect(preview.state).toBe('not-plan');
    expect(preview.message).toContain(RETRY_REQUEST_HINT);
    expect(preview.trip).toBeUndefined();
    expect(canSavePreview(preview, true, true)).toBe(false);
  });

  it('수정 파일은 저장할 수 없고 다음 단계 안내를 보여 준다', () => {
    const preview = buildPlanPreview(fixture('claude-t3-run2.md'));
    expect(preview.state).toBe('update');
    expect(preview.message).toContain('바뀐 곳');
    expect(canSavePreview(preview, true, true)).toBe(false);
  });

  it('여행ID 줄이 일부만 있으면 저장할 수 없다', () => {
    const text = T1.replace('- 시간대: Asia/Tokyo', '- 시간대: Asia/Tokyo\n- 여행ID: trip-1');
    expect(buildPlanPreview(text).state).toBe('invalid');
  });

  it('머리 줄 오류는 저장할 수 없고 줄 번호 없는 오류는 "머리 줄"로 표시한다', () => {
    const preview = buildPlanPreview(T1.replace(/- 기간: .*\n/, ''));
    expect(preview.state).toBe('header-error');
    expect(preview.errors[0].where).toBe('머리 줄');
    expect(canSavePreview(preview, true, true)).toBe(false);
  });

  it('빠지는 표는 줄 번호·이유와 함께 보이고 확인해야 저장할 수 있다', () => {
    const text = newPlan({
      days: [
        { heading: '2027-05-01 나쁨', rows: [act('10:00-10:00', '가', '관광')] },
        { heading: '2027-05-02 좋음', rows: [act('', '나', '관광')] },
      ],
    });
    const preview = buildPlanPreview(text);
    expect(preview.state).toBe('ready');
    expect(preview.dropped).toEqual([{ section: '일정', label: '2027-05-01', where: '7줄', rowCount: 1 }]);
    expect(preview.errors[0]).toMatchObject({ where: '10줄', section: '일정 2027-05-01' });
    expect(preview.errors[0].message).toContain('길이가 0');
    expect(canSavePreview(preview, false, false)).toBe(false);
    expect(canSavePreview(preview, true, false)).toBe(true);
  });

  it('같은 이름·같은 기간의 여행이 있으면 확인을 요구한다', () => {
    const existing = [{ name: '후쿠오카 봄 여행 3박 4일', startDate: '2027-04-15', endDate: '2027-04-18' }];
    const preview = buildPlanPreview(T1, existing);
    expect(preview.duplicateOfExisting).toBe(true);
    expect(canSavePreview(preview, false, false)).toBe(false);
    expect(canSavePreview(preview, false, true)).toBe(true);
    const other = buildPlanPreview(T1, [{ ...existing[0], endDate: '2027-04-19' }]);
    expect(other.duplicateOfExisting).toBe(false);
  });

  it('앱이 추가하는 활동은 목록에서 표시된다', () => {
    const text = [
      newPlan({ days: [{ heading: '2027-05-01 하루', rows: [act('', '산책', '관광')] }] }),
      '## 숙소',
      '| ID | 체크인 | 체크아웃 | 이름 | 지역 | 예약 |',
      '|---|---|---|---|---|---|',
      '|  | 2027-05-01 | 2027-05-02 | 호텔 | 난바 |  |',
    ].join('\n');
    const preview = buildPlanPreview(text);
    expect(preview.appChanges.addedActivities).toEqual([{ date: '2027-05-01', title: '숙소: 호텔' }]);
    expect(preview.days[0].activities.map((a) => [a.title, a.addedByApp])).toEqual([
      ['산책', false],
      ['숙소: 호텔', true],
    ]);
  });
});
