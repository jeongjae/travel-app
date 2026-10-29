# Claude T-05 R2 결과 · 비교 검증 보존·계획 UI 증거

2026-10-29 · **구현·자체 검사 완료 / Codex 재검토 대기 / 사용자 확인 검토 준비** · 시작 `f5c8faa` · 코드 `568b745` · 브랜치 `codex/t05-reimport-order`

## 1. 추가 필드 은폐 수정

- 원인: R1의 `canonicalPlanValue`가 `{ days, items, legs, stays }`만 반환해 기준 B의 최상위 추가 필드를 지웠고, 그 결과 기존 기준 불일치 검증이 우회됐다.
- 수정(`src/transfer/comparable.ts`): 네 배열만 정렬하고 `{ ...plan, days, items, legs, stays }`로 나머지 필드를 보존한다. 행의 추가 필드는 원래 보존된다. any[] 대신 `PlanVersion` 행 타입(planVersionId 제외)을 쓴다. 패키지 bytes/digest·provenance·DB 기준·과거 계획·검증 경로는 바꾸지 않았다.
- 회귀(`tests/reimport-legacy-baseline.test.ts`, 3개 추가, 순서가 뒤집힌 이전 기준 패키지): 최상위 추가 필드 / 행 추가 필드 / 실제 값 불일치는 모두 `기준 B가 대상 콘텐츠와 다릅니다.`로 거부.
  - 수정 전(R1 코드): 최상위 추가 필드 1건 실패(검증 우회), 나머지 2건은 이미 거부. 수정 후 9개 모두 통과.

## 2. 계획 단위 재가져오기 UI (신규 `tests/e2e/plan-reimport.spec.ts`, desktop·mobile 각 3개, 가상 fixture)

| 테스트 | desktop | mobile |
|---|---|---|
| 계획 재가져오기: 같은 입력은 계획 차이를 만들지 않는다 (`0개 차이`, plan 단위 없음) | 통과 | 통과 |
| 계획 재가져오기: 실제 원천 변경은 원본 변경으로 보이고 선택해 적용한다 | 통과 | 통과 |
| 계획 재가져오기: 앱 수정과 새 원천 변경이 겹치면 충돌이고 보류하면 앱 수정이 남는다 | 통과 | 통과 |

단독 실행 6 통과. 가이드 본문 검사(`content.spec.ts`)와 별개이며 대체 증거가 아니다. 사용자 프로필·실제 ZIP 미사용.

## 3. 검사

| 명령 | 결과 |
|---|---|
| `vitest run tests/reimport-legacy-baseline.test.ts` | 9 통과 |
| `pnpm run test:e2e tests/e2e/plan-reimport.spec.ts` | 6 통과 |
| `pnpm run check:deferred` | exit 0, `.cache/verification/2026-10-29T06-21-53-480Z/`, 로그 `.cache/t03-logs/t05r2-deferred.log` |

구 기준 호환·세 방향 분류·시간/지역/순서 변경·원본 비변경·승인 전 불변·충돌/defer 회귀는 변경 없이 유지·통과.

## 4. 미검증

- 원격 CI: push 후 보고. 새 E2E의 "차이 없음"은 `0개 차이` 문구와 plan 단위 부재로 판정한다.
- 이전 기준(순서 보존)으로 저장된 DB를 UI 경로로 재가져오는 E2E는 없다(저장소 수준 시험으로만 확인).
- 사용자 DB·iPhone·실제 ZIP·main 병합·배포·API 호출 없음. F-2/F-3·C 범위 밖.
