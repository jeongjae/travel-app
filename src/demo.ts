import { fromLocal, newTrip, uid, validateTrip, type Trip } from './domain.ts';

export function demoTrips(): Trip[] {
  const paris = newTrip({
    id: uid(),
    name: '파리의 느린 주말',
    startDate: '2026-11-07',
    endDate: '2026-11-09',
    timeZone: 'Europe/Paris',
  });
  paris.versions[0].reason = '가상 예시 일정';
  paris.versions[0].activities = [
    ['09:00', '10:00', '동네 카페에서 아침', '여유롭게 하루 시작'],
    ['11:00', '12:30', '강변 산책', '날씨에 따라 조정'],
    ['14:00', '16:00', '작은 미술관', '관람 시간은 방문 전 확인'],
  ].map(([start, end, title, note]) => ({
    id: uid(),
    title,
    note,
    start: fromLocal(`2026-11-07T${start}`, paris.timeZone),
    end: fromLocal(`2026-11-07T${end}`, paris.timeZone),
    timeZone: paris.timeZone,
  }));
  const seoul = newTrip({
    id: uid(),
    name: '서울 산책',
    startDate: '2026-11-14',
    endDate: '2026-11-14',
    timeZone: 'Asia/Seoul',
  });
  seoul.versions[0].activities = [
    {
      id: uid(),
      title: '동네 책방 들르기',
      note: '두 번째 가상 예시 여행',
      start: fromLocal('2026-11-14T14:00', seoul.timeZone),
      end: fromLocal('2026-11-14T15:00', seoul.timeZone),
      timeZone: seoul.timeZone,
    },
  ];
  return [validateTrip(paris), validateTrip(seoul)];
}
