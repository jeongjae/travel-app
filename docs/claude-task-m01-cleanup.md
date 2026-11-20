# Claude 지시서 T-M1 — 시험 실행 정리 (E3 전)

- 작성 2026-11-20(Codex). 사용자 결정(11/20 10:37): "Claude Code 정리 작업을 한 다음 E3를 진행한다." 실사용 점검은 사용자가 따로 나중에 한다.
- 브랜치 `codex/m01-test-cleanup`(main 기준). 앱 화면·저장 동작은 바꾸지 않는다. 데이터 경계 4경로(`src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts`) 변경 0건.
- CI 워크플로(`.github/workflows/`)는 Codex가 이미 고쳤다(아래 0절). Claude는 건드리지 않는다.

## 0. 이미 바뀐 것 (Codex, 2026-11-20)

| 항목 | 전 | 후 |
|---|---|---|
| 전체 E2E | 한 작업에서 순서대로(약 14분) + 브라우저 설치(2~13분) | chromium 3조각 + webkit 1작업을 동시에. 브라우저는 캐시, webkit은 Playwright 이미지 |
| 문서만 바뀐 push | 전체 검사 | 검사 안 함(`docs/**`, `**.md`) |
| main | `ci.yml`과 `pages.yml`이 같은 검사를 두 번 | `pages.yml`이 한 번 검사하고 배포. `ci.yml`은 main을 건너뜀 |
| 같은 브랜치에 새 push | 앞 실행도 끝까지 | 앞 실행 취소 |

브랜치에 코드 push 뒤 문서만 따로 push하면 문서 커밋에는 실행이 없다. 보고에는 코드 커밋의 실행 결과를 적는다.

## 1. M1-1 — PC에서 `pnpm run check`가 흔들리지 않게 (CL-36)

- 증상: Windows에서 `pnpm run check` 중 Node 서버 시험(retention·ai-v2·ai 계열) 6~13건이 간헐 실패. 단독 실행과 CI(Linux)는 통과. 원인으로 본 것은 `jobs.json` rename 경쟁(CL-27 패턴).
- 할 일: 원인을 확인하고 시험 쪽에서 격리한다 — 시험 파일마다 따로 쓰는 임시 폴더, 또는 서버 시험만 순차 실행(vitest 설정). 앱·서버 동작을 바꿔야만 풀리면 멈추고 보고한다.
- 완료 조건: PC에서 `pnpm run check`를 **연속 5회** 돌려 5회 모두 통과. 5회의 결과(통과 수·시간)를 결과 문서에 적는다. CI에서 `static` 작업이 느려지지 않아야 한다(지금 약 1분).

## 2. M1-2 — PC에서 전체 E2E를 끝낼 수 있게

- 증상: PC에서 전체 `pnpm run test:e2e`가 메모리 부족으로 중단돼, 최근 세 번(E2-A, R3, E2-B) "관련 파일만" 돌린 채 보고됐고 그중 두 번은 CI에서 실패했다.
- 할 일:
  1. `pnpm run test:e2e:all`을 만든다 — CI와 같은 4묶음(chromium 1/3·2/3·3/3, webkit)을 **순서대로** 돌리고, 묶음마다 통과·실패 수를 모아 마지막에 한 번에 보여 준다. 한 묶음이 실패해도 나머지를 계속 돌리고 끝에서 실패로 끝난다. 빌드(`pnpm run build`)를 먼저 한다(미리보기는 `dist`를 쓴다).
  2. 메모리가 부족해지는 원인을 확인한다(추적 파일 보존, 서버 3개, 브라우저 재사용 등). 값싸게 줄일 수 있으면 줄이고, 아니면 적기만 한다.
  3. `docs/handoff.md`의 실행 명령 줄과 `AGENTS.md`의 "UI/저장 흐름 변경 후" 문장에 새 명령을 반영한다(이 두 줄만).
- 완료 조건: PC에서 `pnpm run test:e2e:all`이 끝까지 돌아 4묶음의 결과가 나온다. 그 출력을 결과 문서에 붙인다.

## 3. 하지 않는 것

- 구 화면(`?workspace=legacy`) 정리와 CL-46, Node 서버 제거 — E4 "기존 AI 정리"에서 한다.
- 시험 내용 변경(기다림 수정 등)은 M1-1·M1-2에 필요한 만큼만.

## 4. 보고

`docs/claude-task-m01-result.md`에 한 것·결과·남은 것을 적는다. push 뒤 `gh run list --branch codex/m01-test-cleanup`으로 CI 통과를 확인하고 보고한다. 사용자 화면 확인은 없다(화면이 바뀌지 않는다).
