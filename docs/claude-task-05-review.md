# T-05 Codex 독립 검토

2026-10-29 · 최종 코드 `568b745`·결과 `767f68f` · **R2 독립 검토 통과 / main 병합·배포·사용자 사본 적용·사용자 확인 대기**

아래 최초/R1 검토는 발견·보완 이력이다. 최종 판정은 마지막 R2 절을 따른다.

## 판정

배열 복사 후 안정 키로 비교하는 방향은 적절하다. days ordinal·item order 및 모든 필드 값을 유지하고,
legs/stays에는 순서 필드가 없다는 조사 근거도 수용한다. 저장 조회·UI·실제 기록을 변경하지 않은 범위는 적절하다.
그러나 구버전 원천 비교 기준과의 호환성이 깨져 T-05 수용 조건 5를 충족하지 못한다.

## 독립 실행

- `pnpm exec vitest run tests/reimport-order.test.ts tests/reimport.test.ts tests/spfr-reg01-reimport.test.ts tests/content-repository.test.ts`
  → **4파일·18검사 통과**, exit 0, 11:52:18, 3.27초.
- 추가 가상 패키지 검사 → **1검사 실패**, exit 1, 11:52:39.
  임시 재현 원본은 `.cache/t05-codex/legacy-baseline-repro.test.ts`에 보존했다(테스트 자동 검색 대상 밖, 미커밋).
- Claude 전체 검사 증거 `.cache/verification/2026-10-29T02-07-08-437Z/results.json`에서 check/E2E/pilot exit 0을 확인했다.
  전체 회귀를 독립 재실행하지 않았다. 원격 CI·추가 PC/모바일 UI·실제 ZIP 대조는 이번에 독립 확인하지 않았다.

## P1 · 이전 패키지 기준 B의 배열 순서 호환

T-05 이전 `comparablePlan`은 planVersionId만 제외하고 배열 순서를 유지했다. 따라서 기존 유효 패키지의
`provenance.mappings[].baselineValue`와 이미 가져온 DB의 원천 기준도 그 순서를 보존한다.
새 `comparablePlan`만 정렬하면 `ContentRepository.prepareImport()`는 정렬한 계획과 기존 기준 B를 그대로 비교해 거부한다.
`compareReimport()` 역시 현재 계획은 정규화하지만 remote/baseline 값은 그대로 비교하므로 세 방향 비교 일관성이 없다.

재현: 가상 SP-FR fixture의 items/legs/stays를 뒤집고 이전 구현과 동일한 map(strip)로 기준 B를 만든다.
가상 v2 패키지를 build/read한 뒤 가상 DB에서 prepareImport한다.
기대는 기존 패키지 허용, 실제는 `INVALID_INPUT: 기준 B가 대상 콘텐츠와 다릅니다.`이며 위치는
`src/storage/content-repository.ts:514`다. 이 시험은 개인 여행 데이터·사용자 프로필을 사용하지 않았다.

신규 회귀는 currentMappings를 새 비교 함수로 생성하므로 이전 기준과의 차이를 검사하지 못한다.
기존 v2→v3 시험도 현재 코드로 기준을 다시 만들고 order 정렬 우회를 유지해 구버전 생성 기준의 증거를 대체하지 못한다.
실제 verified 사본에서 기존 오탐이 재현되지 않았다는 Claude 결과는 유지한다. 모든 실자료가 실패한다고 일반화하지 않는다.

## 보완

[T-05 R1](claude-task-05-r1.md): 이전 패키지·저장 기준·신규 입력·현재 계획을 같은 의미로 비교하되
원본 bytes/digest·기존 기준·과거 계획을 덮어쓰거나 검증을 생략하지 않는다. 실제 값 변경·충돌·보류는 유지한다.
추가로 제목에 있는 시간 변경의 실제 단언과 원본 비변경 단언, 지정한 PC/모바일 재가져오기 흐름의 증거를 보완한다.
사용자 확인은 검토 준비이며 T-05 구현 제출을 확인 완료로 간주하지 않는다.

## R1 재검토 · 2026-10-29

대상 `3ed7409`·결과 `08dde96`. **기존 P1 해결 / 최종 수용은 R2 보완 대기**.

- Codex: 관련 5파일·24검사 직접 통과(exit 0, 14:35:45, 5.50초).
- 앞서 실패한 구버전 기준 B 패키지 재현을 그대로 다시 실행해 통과했다(14:36:12).
- Claude 전체 검사 results.json에서 check/E2E/pilot exit 0 확인. 전체 회귀·원격 CI·PC/모바일 UI는 Codex 독립 실행 아님.
- 입력·저장 기준·패키지 digest를 직접 다시 쓰지 않고 세 방향 plan 값에 같은 정규화를 적용한 경계는 적절하다.

### P2 · 정규화에서 최상위 추가 필드를 제거해 기준 불일치를 허용

`canonicalPlanValue`는 입력에서 days/items/legs/stays만 반환해 그 외 필드를 제거한다.
Codex 가상 검사에서 기존 패키지 기준 B에만 `unexpected: 'reject-me'`를 추가했다.
prepareImport는 기준 불일치로 거부해야 하지만 실제로 허용했다(추가 검사 1개 실패, exit 1, 14:36:12).
배열 위치 정규화가 기준 B의 내용 불일치까지 지우므로 기존 대상 일치 검증이 약화된다.
추가 필드를 보존해 비교하거나 지원하지 않는 비교 표현을 명시적으로 거부한다. 의미 있는 값은 제거하지 않는다.
개인 데이터 손상/노출을 관찰한 것은 아니며 가상 패키지의 검증 우회다.
재현은 `.cache/t05-codex/zz-codex-t05-extra-field.test.ts`에 보존했다(미커밋).

### 남은 수용 증거

계획 재가져오기 UI의 동일 입력/실제 변경/보류 PC·모바일 검사가 미제출이다.
가이드 본문 E2E 통과를 계획 UI 증거로 대체하지 않는다. [R2 지시서](claude-task-05-r2.md)에서 작은 보완으로 마무리한다.

## R2 최종 검토 · 2026-10-29

대상 코드 `568b745`·결과 `767f68f`. **T-05 지정 범위 독립 검토 통과**.

- `canonicalPlanValue`가 최상위 추가 필드를 보존하고 네 배열만 복사/정렬하는 것을 diff로 확인했다.
  구버전 비교 기준 호환을 유지하면서 최상위/행 추가 필드·실제 값 불일치는 거부하는 회귀를 확인했다.
  any[]를 기존 계획 row 타입으로 교체했으며 저장 bytes/digest·DB 기준·과거 계획·현장 기록을 다시 쓰는 변경은 없다.
- Codex 직접 실행: `pnpm exec vitest run tests/reimport-legacy-baseline.test.ts tests/reimport-order.test.ts tests/reimport.test.ts tests/spfr-reg01-reimport.test.ts tests/content-repository.test.ts`
  → **5파일·27검사 통과**, exit 0, 15:30:44, 6.40초.
- Codex 직접 실행: `pnpm run build` → 타입 검사·빌드·PWA 생성 exit 0.
- Codex 직접 실행: `pnpm run test:e2e tests/e2e/plan-reimport.spec.ts`
  → **desktop 3·mobile 3, 총 6검사 통과**, exit 0, 13.0초.
  동일 입력 0개 차이, 실제 원천 변경 선택 적용, 양쪽 충돌/defer 후 앱 수정 보존을 화면에서 검증했다.
- 최초 기본 환경에서는 미리보기 서버가 응답하지 않아 실행을 중단했다. 권한 검토를 거친 로컬 서버/브라우저 실행으로 다시 실행해 통과했다.
  Browser plugin/browser 스킬 미제공으로 프로젝트 Playwright 회귀를 사용했다. 기존 개인 브라우저 프로필은 사용하지 않았다.
- Claude 전체 검사 `.cache/verification/2026-10-29T06-21-53-480Z/results.json`의 check/E2E/pilot exit 0을 확인했다.
  전체 회귀를 독립 반복하지 않았으며 원격 CI는 독립 확인하지 않았다.

R1 P1·R2 P2는 해결됐고 요구한 계획 UI 검사 증거가 충족됐다. 추가 수정 지시는 없다.
구 baseline DB의 UI 복합 경로는 저장소 호환 검사와 신규 UI 검사로 나누어 확인했으며 별도 조합 E2E는 미실행이다.
모바일은 브라우저 에뮬레이션으로 실제 iPhone 검증이 아니다. 실제 ZIP/사용자 DB·기기 적용·main 병합·배포는 실행하지 않았다.
사용자 상태는 **검토 준비**다. 전체 B 이행/G2/G2′·C 기능·AI 완료로 확대하지 않는다.
