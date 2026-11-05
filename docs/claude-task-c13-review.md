# C-13〔U4〕Codex 독립 검토

2026-11-05 · 대상 `codex/c13-ui-u4` `7676769`(기준 `c42ba88`) · 판정 **통과** — R1 보강 `14200e6` 확인 후 main 병합 `ec6c461`·Pages 배포 성공(11/05) · 사용자 U4 재수행 대기

## 1. 확인 범위와 결과

| 확인 | 결과 | 근거 |
|---|---|---|
| 데이터 경계 | 통과 | `src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts` 변경 0건, 새 저장 명령 호출 0건. 썸네일은 기존 `repo.asset` 읽기만 사용 |
| C-12 후속 R1 날짜 머리 | 해소 | `top: var(--journey-topbar-height, 56px)`. `r1-sticky-day-mobile.png` 스크롤 상태에서 상단 바 아래 고정 확인 |
| C-12 후속 R2 다른 날 정정 | 해소 | 배지 `방문 1/1 00:30`, 실제 날짜에 `12/31 계획 항목의 기록` 카드(`s4-today-records-mobile.png`). 단위 시험 추가 |
| 회고 `계획 설명`·`⋯` 줄바꿈·가이드 썸네일 | 통과 | 지시 §1-3~5대로. 사진 없으면 자리 비움 없음(`hideWhenMissing`) |
| 대본 v2·확인 양식 | 통과 | `docs/u4-sapporo-scenario.md`(S1~S6, 30분 목표, 단계별 스크린샷 링크), `docs/u4-user-check.md`. c07 대본·사용자 기록 보존 |
| 시험 약화 | 없음 | 선택자 대응표 2건(`계획 설명` 단추, 배지 정규식에 선택적 날짜). 정규식 완화는 R2 규칙 때문이며 `방문`·시각 단언 유지 |
| `pnpm run check` | exit 0 | 클라우드 재현 322 통과·1 skip |
| 전체 E2E | 158 통과 · **1 실패** · 1 건너뜀 | 클라우드 재현(파일 입력 버퍼 업로드 임시 치환, 끝난 뒤 되돌림). 실패 1건은 아래 R1, 같은 시험 모바일 3회 반복은 3/3 통과 |

## 2. 수정 지시 (Claude, 같은 브랜치)

- **R1 간헐 실패 보강** `tests/e2e/c07-sapporo.spec.ts` S4 정정 단계(`details.correction-fold`를 `evaluateAll`로 연 직후 `정정 3/3단계 · 최신 정정본` 확인). 저장 직후 목록이 다시 그려지기 전에 접기를 열면 새로 그려진 접기는 닫혀 있어 `hidden`이 된다(모바일 1/4 재현). 접기 열기와 확인을 `expect(async () => { …열기…; await expect(…).toBeVisible({ timeout: 1000 }); }).toPass()`로 묶거나, 접기 수가 기대값이 된 뒤 연다. **단언은 그대로** 둔다. 같은 패턴이 `ui-u3.spec.ts`·`u4-sapporo.spec.ts`에 있으면 함께. CI에는 재시도가 없어(`workers: 1`, retries 없음) Pages 배포 관문이 흔들릴 수 있다.
- 검사: 해당 spec 모바일 `--repeat-each=5` 통과 + 전체 E2E 1회. 결과는 `docs/claude-task-c13-result.md`에 한 절 추가.

## 3. 후속 후보 (차단 아님)

- 기록 `⋯` 안 `앱에 남긴 시각 2026-11-04T06:50:54.107Z` — ISO 원문 대신 현지 표기. 
- 첫 화면에 가져오기 입구가 둘(위쪽 `원천 패키지 가져오기 (pilot.zip)`·`저장소·백업`)이라 사용자가 혼동(11/05 보고) → CL-22.

## 4. 하지 않은 것

실기기·사용자 화면 확인. main 병합·배포는 R1 뒤.

## 5. R1 확인 (11/05)

`14200e6`: 접기 열기·확인을 `toPass()`로 묶음, 단언 동일. Claude 보고 모바일 반복 5/5·전체 E2E 159/0. main 병합 뒤 Pages 워크플로(전체 검사 포함) 성공.
