# Claude T-05 결과 · 재가져오기 항목 순서 오탐 수정 (F-4)

2026-10-29 · **구현·자체 검사 완료 / Codex 검토 대기 / 사용자 확인 검토 준비** · 시작 `d2b1065` · 브랜치 `codex/t05-reimport-order` · 코드 커밋 `7aa04b5`

## 요약

- 원인: 재가져오기의 계획 비교(`comparablePlan`)가 `days/items/legs/stays` 배열 위치를 그대로 비교했다. 저장소 조회(`ContentRepository.get()`)는 항목을 `order`로만 정렬하고 legs/stays는 기본 키 순서로 돌려주므로, 패키지 배열 순서가 다르면 같은 계획도 `app-only` 차이로 보일 수 있었다.
- 수정: `src/transfer/comparable.ts`만 변경. 정렬 기준을 명시했다.
  - 날짜 행: `ordinal` → `dayId`
  - 항목: 날짜 순위(위 정렬 기준) → `order` → `activityId`
  - 이동(legs): 날짜 순위 → `legId` / 숙박(stays): `stayId`
  - 필드 값·원본 배열은 건드리지 않는다(복사 후 정렬). 값이 다르면 그대로 차이다. `get()` 정렬·스키마·UI는 변경하지 않았다.
- 판단 근거: legs/stays에는 순서 필드가 없고 저장소가 기본 키 순서로 돌려주므로 배열 위치는 의미가 없다. 항목의 순서 의미는 `order` 값에 있으며 그 값은 비교에 남는다.

## 재현 전후

가상 fixture(여러 날짜가 같은 `order` 값을 쓰고 패키지 배열을 뒤집어 둠) `tests/reimport-order.test.ts`:

| 검사 | 수정 전 | 수정 후 |
|---|---|---|
| 같은 패키지 재검토 시 계획 검토 단위 없음 | 실패 | 통과 |
| 저장본과 패키지 계획의 비교 표현 동일 | 실패 | 통과 |
| order·제목·dayId 이동·`regionIds` 변경은 다른 표현 | 통과 | 통과 |

기존 `spfr-reg01-reimport.test.ts`(3개: 구 v2→v3 `source-only`, 사용자 편집 시 `conflict`·defer·승인 전 불변·과거 버전 불변)는 변경 없이 통과한다. 그 파일의 패키지 항목 `order` 사전 정렬 우회는 남겨 두었다(제거해도 되지만 이번 범위 밖).

## 실제 사본(가상 DB, 임시 시험·미커밋)

`fake-indexeddb` 가상 DB에 verified ZIP을 가져온 뒤 재검토:

- verified 재가져오기: 차이 0건(수정 전·후 동일). 실제 패키지는 이미 저장 정렬 순서라 **실제 사본에서는 오탐이 재현되지 않았다.** F-4는 순서가 다른 패키지에서 나타나는 잠재 결함이며, 가상 회귀로만 재현된다.
- T-04 후보 재가져오기: `plan source-only` 1, `trip source-only` 1(여행 이름 기본값). 계획 차이는 T-04의 `regionIds` 9일 변경과 일치(수정 전과 같은 결과).
- 사용자 DB·iPhone·기존 ZIP은 읽기만 했고 변경하지 않았다. 임시 시험 파일은 삭제했다.

## 검사

| 명령 | 결과 |
|---|---|
| `vitest run tests/reimport-order.test.ts tests/spfr-reg01-reimport.test.ts` | 6 통과 |
| `pnpm run check:deferred` | exit 0 (check·E2E·pilot 통과), `.cache/verification/2026-10-29T02-07-08-437Z/`, 로그 `.cache/t03-logs/t05-deferred.log` |

첫 실행은 새 시험 파일의 Prettier 형식 때문에 exit 1이었고, 형식 수정 후 통과했다.

## 미검증·한계

- 원격 CI: push 후 확인(아래 갱신 또는 보고).
- 별도 PC/모바일 재가져오기 UI 수동 확인은 하지 않았다. 기존 E2E(54)가 통과했을 뿐이다.
- 사용자 편집+새 원천 변경 충돌은 기존 시험이 유지됨을 확인했고 신규 시나리오는 추가하지 않았다.
- F-2(예약 `regionId`)·F-3(지역 ZIP)·후보 적용·C 기능은 범위 밖. main 병합·배포 없음.
