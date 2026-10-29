# Claude T-05 R1 결과 · 기존 원천 기준 호환 보완

2026-10-29 · **구현·자체 검사 완료 / Codex 재검토 대기 / 사용자 확인 검토 준비** · 시작 `2cd99c4` · 브랜치 `codex/t05-reimport-order`

## 원인과 수정

- 원인(Codex P1 재현): T-05 이전 `comparablePlan`은 배열 순서를 보존한 채 기준 B를 만들었다. T-05가 현재 계획만 정렬해, `prepareImport`가 이전 패키지의 기준 B와 비교할 때 `기준 B가 대상 콘텐츠와 다릅니다.`로 거부했고, `compareReimport`도 baseline/remote는 정렬하지 않았다.
- 수정: `comparable.ts`에 `canonicalPlanValue`(비교 표현 정렬, 입력 비변경)를 두고 `comparablePlan`이 이를 쓴다. 같은 정규화를 `prepareImport`의 기준 B 검증(`content-repository.ts`)과 `compareReimport`의 기준(base)·새 원천(remote)에 적용했다(plan 대상만). 현재 계획은 이미 정규화된다.
- 경계: 비교 표현만 정규화한다. 패키지 bytes/digest, provenance, DB 저장 기준, 과거 계획·기록은 다시 쓰지 않는다. 검증을 생략하거나 baseline을 local로 바꾸지 않는다. 정렬은 안정 키(day ordinal·dayId, item order·ID, legId, stayId)뿐이라 order·시간·날짜 이동·제목·지역·숙박/이동 필드 변화는 그대로 차이다.

## 재현 전후 (`tests/reimport-legacy-baseline.test.ts`, 가상 fixture)

이전 map(strip) 방식으로 기준 B를 만든 v2 패키지(items/legs/stays 뒤집음)로 6개 시험.

| 시험 | 수정 전 | 수정 후 |
|---|---|---|
| 이전 기준 패키지 최초 가져오기 | 실패(INVALID_INPUT 기준 B) | 통과 |
| 이전 기준 저장 DB에서 같은 패키지 재검토: 계획 차이 없음 | 실패 | 통과 |
| 새 원천만 변경(시간) → source-only | 실패 | 통과 |
| 앱만 변경 → app-only | 실패 | 통과 |
| 양쪽 변경 → conflict, defer 권고 | 실패 | 통과 |
| 입력·기준 비변경, 실제 시간 변경은 다른 표현 | 실패 | 통과 |

## 검사

| 명령 | 결과 |
|---|---|
| vitest 5파일(legacy-baseline, reimport-order, reimport, spfr-reg01-reimport, content-repository) | 24 통과 |
| `pnpm run check:deferred` | exit 0, `.cache/verification/2026-10-29T03-05-30-228Z/`, 로그 `.cache/t03-logs/t05r1-deferred.log` |

기존 T-04 시험(spfr-reg01-reimport: 9일 지역 변경 탐지·구 v2 의미·충돌/defer·과거 불변)과 T-05 시험은 변경 없이 통과한다.

## 미검증

- 재가져오기 UI: 기존 E2E `content.spec.ts` '새 원본과 앱 본문의 충돌을 검토하고 선택한 섹션만 반영한다'(desktop·mobile 프로젝트, check:deferred에 포함, 통과)는 **가이드 본문** 재가져오기 경로다. 계획 단위 재가져오기 UI의 같은 입력/변경/보류 E2E는 기존에 없고 추가하지 않았다. 계획 경로는 저장소 수준 가상 시험으로만 확인했다.
- 원격 CI는 push 후 보고. 실제 사본·사용자 DB·iPhone·main 병합·배포·후보 적용 없음. F-2/F-3·C 범위 밖.
