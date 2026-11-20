# Claude 지시서 T-E4-1 — 개발용 Node 서버 경로 정리

- 작성 2026-11-20(Codex). 사용자 지시(11/20 15:08): "UI 확인은 한꺼번에 하겠다. 다음 단계로 진행하자." D단계 종료 때 사용자가 수용한 이월 항목 "Node 서버 정리"([종료 근거표](d-phase-closeout.md): 운영 경로는 Worker, 개발용 Node 경로만 남음)를 지금 한다. 무엇을 지우고 무엇을 남길지의 세부는 Codex가 정했다.
- 브랜치 `codex/e04-1-node-server`(main 기준). **화면·저장 동작·배포본은 바뀌지 않는다.** 데이터 경계 4경로와 `worker/`의 동작 변경 0건, `.github/workflows` 변경 0건.

## 0. 먼저 조사하고 표로 적는다 (지우기 전에)

1. `server/`(index·ai·ai-v2·ai-v2-jobs·jobs)가 내보내는 것 가운데 **앱(`src/`)이나 Worker(`worker/`)가 가져다 쓰는 것**이 있는지. 있으면 3절에 따라 멈춘다.
2. `server/`를 가져다 쓰는 시험(`tests/ai.test.ts`, `ai-v2.test.ts`, `ai-v2-job-retention.test.ts`, `ai-v2-send-surface.test.ts`, `ai-v2-repository.test.ts`, `ai-v2-semantics.test.ts`, `tests/fixtures/ai-v2.ts`)의 각 묶음이 **무엇을 검증하는지**와, 같은 것을 검증하는 **Worker·앱 쪽 시험이 이미 있는지**를 표로 만든다.

   | 시험 묶음 | 검증하는 것 | Node 서버만의 동작인가 | 대응 시험(파일:이름) | 처리(삭제 / 옮김 / 유지) |
   |---|---|---|---|---|

3. `server/`를 쓰는 스크립트·설정: `scripts/run-app.mjs`의 `node` 분기, `package.json`의 `ai:server`·`dev:node`·format 대상, E2E 설정, 문서.

## 1. 정리

1. 표에서 "Node 서버만의 동작"으로 분류한 시험은 지운다. **서버와 무관한 규칙**(전송 표면, 변경안 의미 검증, 저장소 적용 등 앱·Worker도 따르는 것)을 검증하는 시험은 지우지 않는다 — 대응 시험이 없으면 `server/` 의존만 떼어 옮긴다.
2. `server/` 폴더, `ai:server`·`dev:node` 명령, `run-app.mjs`의 `node` 분기, format 대상의 `server`를 지운다. Node 서버만 쓰던 의존성이 있으면 `package.json`에서 빼고 `pnpm-lock.yaml`을 갱신한다(Worker·앱이 쓰는 것은 그대로).
3. 문서에서 Node 경로 안내를 고친다: `docs/handoff.md`의 실행 명령 줄, `AGENTS.md`에 해당 문장이 있으면 그 문장만. 과거 기록 문서(`docs/history/`, 검토·결과 문서)는 고치지 않는다.
4. T-M1에서 올린 시험 시간 한도 가운데 지운 시험에만 걸려 있던 것은 함께 사라진다. `vite.config.ts`의 전체 한도는 그대로 둔다.

## 2. 완료 조건

- `pnpm run check`, `pnpm run check:pilot`, `pnpm run test:e2e:all` 전체 통과. `pnpm dev`(Vite + 로컬 Worker)가 전과 같이 뜬다.
- 결과 문서 `docs/claude-task-e04-1-result.md`: 0절의 표, 지운 파일·명령 목록, 시험 수의 전후(지운 수·옮긴 수), vitest 소요 시간의 전후.
- push 뒤 `gh run list --branch codex/e04-1-node-server`로 CI 통과를 확인하고 보고한다. 사용자 화면 확인은 없다.

## 3. 멈추고 보고할 때

- 앱이나 Worker가 `server/`의 코드를 가져다 쓴다.
- 지우면 대응 시험이 없는 규칙 검증이 사라지는데, 옮기려면 앱·Worker 코드를 고쳐야 한다.
- 구 화면(`?workspace=legacy`, `src/App.tsx`·`src/AiPlanner.tsx`·`src/storage/legacy.ts`)이 `server/` 없이는 동작하지 않게 된다 — **구 화면은 이번에 지우지 않는다**(사용자 결정 대기). 구 화면의 AI 요청이 실패하게 되는 것까지는 괜찮지만, 구 화면의 일정 조회가 깨지면 멈춘다.
