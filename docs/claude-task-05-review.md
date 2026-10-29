# T-05 Codex 독립 검토

2026-10-29 · 코드 `7aa04b5`·결과 `f4e6f1d` · **수정 요청 / main 병합·배포·사용자 사본 적용 대기**

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
