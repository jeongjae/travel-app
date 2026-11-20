# T-M1 결과 — 시험 실행 정리 (Claude, 2026-11-20)

브랜치 `codex/m01-test-cleanup`(main 29f3e41 기준). 앱 화면·저장 동작 변경 없음. 데이터 경계 4경로 변경 0건.

## M1-1 — `pnpm run check` 흔들림

- **원인**: `jobs.json` rename 경쟁이 아니었다. 서버는 쓰기를 한 줄로 이어 붙이고(`writes` 체인), 시험마다 따로 `mkdtemp` 폴더를 쓴다. 다른 작업(E2E·빌드)과 CPU를 나눠 쓰면 시험이 시간 한도에 걸렸다.
  - vitest 기본 시험 한도 5초, `vi.waitFor` 기본 1초.
  - 확인: `vitest run`을 동시에 3개 돌리면 41건 실패(`Test timed out in 5000ms` 103회, `validating`≠`awaiting-decision` 1건). 단독 실행은 통과.
- **고침(시험 쪽만)**: `vite.config.ts`에 `testTimeout`·`hookTimeout` 60초, `vi.waitFor` 20초(`ai.test`·`ai-v2.test`·`ai-v2-job-retention.test`), 명시 한도 `spfr-pilot`·`transfer` 30초, `exchange-limits` 90초. 통과하는 시험은 느려지지 않는다(한도는 멈춘 시험을 끊는 안전장치).
- **동시 3개 부하**: 고치기 전 41건 실패 → 고친 뒤 3개 모두 764 통과(각 약 60초).
- **연속 5회 `pnpm run check`**(format·lint·vitest·build):

| 회 | 결과 | 시간 | vitest |
|---|---|---|---|
| 1 | 통과 | 39초 | 764 통과·1 건너뜀 |
| 2 | 통과 | 38초 | 764 통과·1 건너뜀 |
| 3 | 통과 | 37초 | 764 통과·1 건너뜀 |
| 4 | 통과 | 40초 | 764 통과·1 건너뜀 |
| 5 | 통과 | 37초 | 764 통과·1 건너뜀 |

- CI `static` 작업: 통과하는 시험의 시간은 그대로라 느려지지 않는다(CI 결과는 아래).

## M1-2 — PC 전체 E2E

- `pnpm run test:e2e:all`(`scripts/e2e-all.mjs`): 먼저 `pnpm run build`, 이어 CI와 같은 4묶음(chromium 1/3·2/3·3/3, webkit)을 순서대로 돌린다. 묶음이 실패해도 계속 돌리고, 끝에 묶음별 통과·실패·불안정·건너뜀 수와 시간을 모아 보이며 실패가 있으면 실패로 끝난다. 묶음 정의는 `.github/workflows/checks.yml`과 같다(바꾸면 함께 고친다).
- `AGENTS.md`(UI/저장 흐름 문장)와 `docs/handoff.md`(실행 명령 줄)에 새 명령을 반영했다.
- **실행 출력(PC, 끝까지 완료, 종료 코드 0)**:

```
chromium 1/3: 통과 · 통과 93 · 실패 0 · 불안정 0 · 건너뜀 1 · 407초
chromium 2/3: 통과 · 통과 91 · 실패 0 · 불안정 0 · 건너뜀 4 · 419초
chromium 3/3: 통과 · 통과 89 · 실패 0 · 불안정 0 · 건너뜀 2 · 204초
webkit: 통과 · 통과 4 · 실패 0 · 불안정 0 · 건너뜀 0 · 16초
```

- **메모리 부족 원인(확인한 것)**: 한 번에 서버 3개(미리보기·가상 OpenAI·workerd)와 브라우저가 함께 떠 있고, 이전에는 다른 작업이 동시에 돌았다. 중단된 것은 시험이 아니라 Claude Code가 메모리 부족 때 백그라운드 명령을 끊은 것이다. 이번에는 다른 작업 없이 묶음을 순서대로 돌려 중단 없이 끝났다. 줄이는 코드 변경은 하지 않았다(`trace: retain-on-failure`는 실패 때만 파일을 남기므로 통과 시험에는 영향이 없다).
- 남은 것: Windows에서 `shell: true`로 `pnpm.cmd`를 부를 때 Node `DEP0190` 경고가 한 줄 나온다(동작에는 영향 없음).

## CI
