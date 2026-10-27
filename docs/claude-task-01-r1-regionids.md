# T-01-R1 · `day.regionIds` 의미 근거와 검증 범위

2026-10-27 · 기준 HEAD `73d75f9` · Claude 조사 · **Codex 계약 판정 대기** · 제품 코드·스키마·이행 정책은 변경하지 않았다.

## 1. 결론 요약

- 문서·코드·소비자 어디에도 `day.regionIds`와 `overnightRegionId`의 의미를 정의한 문장이 없다. 현 동작(그날을 덮는 숙박의 지역)은 **관찰된 구현**이며 의도된 계약이라고 확정할 근거는 찾지 못했다.
- 두 필드는 화면·AI 서버·검색 어디에서도 읽히지 않는다. 읽는 곳은 참조 무결성 검사 한 곳뿐이다. 그래서 현재 값이 사용자 화면 결함을 만들지는 않는다.
- T-01b 원 조건 "하루의 복수 지역 참조가 숙박 지역 하나로 축소되지 않는가" 중 **지역·장소 콘텐츠와 도시 표기는 검증됐고, 하루 지역 필드(`day.regionIds`)는 검증되지 않았다**(판단 대기).

## 2. 의미 근거표

| # | 근거 | 위치 | 말하는 것 | 의미 확정 여부 |
|---|---|---|---|---|
| 1 | 스키마 | `src/contracts/v2/planning.ts:51-52` | `regionIds: string[]`, `overnightRegionId?: string`. 이름·타입만 있고 설명 없음 | 아니오 |
| 2 | 매핑 문서 | `docs/content-db-mapping.md:51` D-10 | 필드를 나열만 함. 같은 문서 D-04는 `places.regionIds`(장소가 속한 지역)를 같은 이름으로 씀 | 아니오 |
| 3 | 검증 | `src/contracts/v2/validate.ts:379-380` | 두 필드의 ID가 지역 콘텐츠로 존재하는지만 확인(`pin`). 의미 검증 없음 | 아니오 |
| 4 | 생성(현상) | `src/transfer/spfr-candidate.ts:182-194` | `checkin <= date < checkout`인 숙박의 `key`를 day.regionIds로 사용. 이동일(전 숙박 checkout=그날, 새 숙박 checkin=그날)에는 도착 숙박만 들어감 | 현상 |
| 5 | 생성(현상) | `src/transfer/spfr-pilot.ts:232-233` | `regionIds.length === 1`이면 `overnightRegionId = regionIds[0]`, 복수면 미설정. overnight이 regionIds에 종속돼 정의됨 | 현상 |
| 6 | 결정 문서 | `docs/decisions.md:22`, `docs/phase-2-continuous-report.md:37` | "숙박 없는 날은 지역을 발명하지 않고 이동일은 명시 원천 지역을 포함한다" / "이동일의 장소 frontmatter·Fact에 명시된 지역을 **맥락 지역**으로 포함" | 적용 계층이 **지역 콘텐츠 선택**임(`spfr-candidate.ts:111-125`의 `contextRegions` → `region` 콘텐츠). 하루 필드에 적용한다는 문장은 없음 |
| 7 | 합성 fixture | `tests/fixtures/pilot.ts:222` | 하루마다 지역 1개. 날짜 경계·이동일 사례 없음 | 아니오(의미 근거 아님) |
| 8 | 변환 | `src/storage/legacy.ts:71,159` | 기존 앱 변환 시 `regionIds: []` | 아니오(지역 없음의 빈 값) |
| 9 | 소비자 | `Journey.tsx`, `DayDetails.tsx`, `ContentApp.tsx`, `server/` | `day.regionIds`·`overnightRegionId` 미사용. 도시는 `cityText`, 숙박 줄은 `plan.stays`에서 표시. `place.regionIds`만 가이드 검색에서 지역 이름 조인에 사용(`ContentApp.tsx:601`) | — |
| 10 | 원천 | SP-FR `itinerary.stays[].key`(지역), daily card `city`(텍스트) | 실제 원천 파일은 이번 조사에서 읽지 않았다(보호). 가상 fixture는 이 두 형태를 흉내 낸 것 | 미확인 |
| 11 | 재가져오기 | `src/transfer/reimport.ts:46,80`, `comparable.ts:7` | 계획은 하나의 원자 단위로 비교하며 `days[].regionIds`를 포함 | 영향 분석용 |

## 3. 무엇이 검증됐는가

| 요구(원 지시서 T-01a/b) | 상태 | 증거 |
|---|---|---|
| 귀국일 누락 없음·날짜/순서 유지 | 검증 | `spfr-return-day.test.ts` + 화면 `3-return-day-0504-*` |
| 귀국일이 앞날 숙박·지역을 상속하지 않음 | 검증(숙박·`overnightRegionId`·`regionIds`, 지역 미상 변형) | 같은 파일, 화면에 `숙박:` 줄 없음 |
| 원천 명시 지역의 **장소·지역 콘텐츠** 보존 | 검증 | `place.regionIds=['other']`, 지역 콘텐츠 `fiction`·`other` |
| 이동일 도시 표기·활동·이동 구간·시각 | 검증 | `spfr-move-day.test.ts` + 화면 `2-move-day-0503` |
| 이동일 `overnightRegionId`=도착 지역 | 검증(이름과 숙박 원천에 일치) | 같은 파일 |
| 이동일 **day.regionIds가 복수 지역을 보존** | **미검증·판단 대기** | `it.todo`로 남김 |
| 명시 지역이 있는 귀국일의 `day.regionIds` | **현 동작 관찰만**(`[]`) | 관찰 블록 |

테스트 코드는 두 종류로 나누었다. 계약 검증은 위 "검증" 행의 assertion이고, `[현 동작 관찰 · 계약 미확정]` 블록(`spfr-return-day.test.ts`, `spfr-move-day.test.ts` 끝)은 현재 값을 기록할 뿐이다. 기대값을 줄이거나 삭제로 통과시키지 않았다.

## 4. 판단 후보

### A. 숙박 전용으로 명문화 (현 동작 유지) — 잠정 추천

- 의미: `day.regionIds` = 그날 밤을 보내는 지역(숙박 근거), `overnightRegionId` = 그중 단일 값. 이동일 출발·방문 지역은 `cityText`, 활동→장소→`place.regionIds`로 표현.
- 변경: 코드·스키마 없음. `content-db-mapping.md` D-10과 `decisions.md`에 한 문장 추가, 관찰 블록을 계약 검증으로 승격. 원 지시서 T-01b의 하루 필드 조건은 "하루 필드가 아닌 장소·지역 계층에서 충족"으로 재정의해야 한다(Codex/사용자 판정).
- 호환: 기존 패키지·DB·과거 계획 전부 영향 없음. 재가져오기 차이 없음.
- 한계: 날짜별 "이 날 관련 지역" 질의가 필요해지면 장소를 거쳐 조인해야 한다.
- 추천 근거: 결정 문서의 "명시 지역 포함"이 지역 콘텐츠 계층 문장이고, 하루 필드의 소비자가 없으며, 가장 작은 변경이다. 단 하루 필드가 숙박 전용이라는 **의도 자체는 확인하지 못했으므로** 사용자·Codex 판정이 필요하다.

### B. 하루 관련 지역 전체로 확장

- 의미: `day.regionIds` = 숙박 지역 ∪ 그날 활동 장소의 명시 원천 지역. `overnightRegionId`는 숙박 지역으로만 유지. 이동일 `['fiction','other']`(순서 계약 별도), 지역 명시 귀국일 `['other']`.
- 변경: `spfr-candidate.ts:182-186`의 지역 계산 확장, `spfr-pilot.ts:232-233`의 overnight를 `regionIds.length===1`이 아닌 숙박에서 직접 도출(그대로 두면 이동일 overnight이 사라지는 회귀), 어댑터·정규화 버전 갱신, 두 테스트 파일 기대값 변경과 `it.todo` 해소.
- 호환: 스키마 변경 없음(배열은 이미 복수 허용). 기존 패키지·DB는 유효하며 값은 이전 그대로. 다시 만든 패키지를 재가져오기하면 계획이 원자 단위로 달라져 보이고, 사용자가 계획을 직접 수정했다면 양쪽 수정 충돌 검토가 필요하다. 과거 계획 버전은 불변이라 바뀌지 않는다.
- 위험: "숙박 없는 날은 지역을 발명하지 않는다" 결정과 귀국일의 명시 장소 지역 포함 사이의 해석 충돌. 의미·이행 정책 변경이므로 Codex 판정 전에는 적용하지 않는다.

## 5. 필요한 판정과 후속 검사

1. Codex/사용자: `day.regionIds`의 의미를 A/B 중 정하거나 폐기·보류한다.
2. A 선택 시: 문서 2곳 + 관찰 블록 승격(문서·테스트만). B 선택 시: 위 변경 + `pnpm run check`, 이행 변환 테스트, 재가져오기 E2E, 실제 원천 대조.
3. 어느 경우든 실제 SP-FR 원천의 이동일 사례에서 원천이 그 하루를 어떻게 표기하는지(`city` 형태, 숙박 경계) 별도 대조가 남아 있다.
