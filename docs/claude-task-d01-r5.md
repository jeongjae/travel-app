# T-D1 수정 지시 R5 — AI 출력 보존 기한

발행: 2026-11-07 (사용자 결정 2026-11-06 17:46). 브랜치 `codex/d01-send-semantics`에서 이어서 작업하고 push한다. **main 병합, docs/handoff.md 갱신, stash 복원은 하지 않는다.**

## 0. 배경과 결정

R3(a)로 요청 원문·사용자가 고른 기록은 jobs.json에 저장하지 않게 됐다. 그러나 AI 출력은 재회수를 위해 남고, 모델이 요청 내용을 답변에 옮겨 적으면 그 문장이 jobs.json과 `GET /api/ai/v2/jobs/{id}`(무인증)로 나간다.

사용자 결정: **보존 기한을 지금 넣는다. 조회 경로 인증은 T-D2.**

## 1. 범위와 금지

- 커밋 1~2개(R5 구현, 필요 시 문서). push. main 병합·handoff·stash 복원 금지.
- 데이터 경계 4경로(`src/contracts`, `src/storage`, `src/transfer`, `src/repository.ts`) 변경 0건 유지.
- jobs.json 파일 형식(스키마) 변경 금지 — 기존 필드만 쓴다. 완료 시각 필드가 없으면 작업을 멈추고 보고한다.
- 재현 시험 선행(수정 전 실패 → 수정 후 통과).
- stash@{0}(UI 작업 3경로)은 건드리지 않는다.

## 2. 결과 상태

- 작업이 완료(성공·실패·취소 모두)된 시각부터 **24시간**이 지나면 그 작업의 AI 출력은 jobs.json에서 제거된다. 작업 ID·상태·시각·모델·한도·오류 코드처럼 사용자 내용이 없는 필드는 남는다(R3 허용 목록과 같다).
- 제거는 **서버 시작 시**와 **새 작업 저장 시**에만 실행된다. 별도 타이머·백그라운드 프로세스를 두지 않는다.
- 출력이 제거된 작업을 `GET /api/ai/v2/jobs/{id}`로 조회하면 출력 필드가 없고, 기존 상태 필드로 "만료"임을 알 수 있다. 새 필드 추가 금지(기존 상태 값 재사용 또는 기존 문자열 필드).
- 사용자가 브라우저에 이미 저장(적용)한 결과는 영향받지 않는다. 보존 기한은 서버 쪽 jobs.json에만 적용된다.
- 재회수: 24시간 안에는 지금처럼 가능. 지나면 화면에 "결과가 만료되어 다시 요청해야 합니다"를 보여주고 새 요청으로 안내한다. 자동으로 재요청하지 않는다(유료 호출).
- 24시간은 코드 한 곳의 상수다.

## 3. 시험 (최소)

- 완료 23시간 작업 → 출력 유지 / 25시간 작업 → 출력 제거, 비내용 필드 유지.
- 제거 후 GET 응답에 출력 키가 없고 만료 상태를 읽을 수 있다.
- 실패·취소 작업도 같은 규칙으로 제거된다.
- 브라우저 저장소의 적용 결과는 제거 뒤에도 그대로다(통합 시험 1건).
- 서버 시작 시 정리가 실행된다.

## 4. 완료 조건

- `pnpm run check` exit 0, E2E 통과, 원격 CI(check·check:pilot·test:e2e) 성공, 데이터 경계 0건.
- `docs/claude-task-d01-result.md` §R3에 "출력 보존 24시간, 조회 인증은 T-D2" 추가. §6 후속에 "jobs 조회 인증(T-D2)" 유지.

## 5. 완료 보고 형식

이전 보고와 같은 구조: 상태(자체 검사 / Codex 검토 / 사용자 확인) → 커밋 목록 → 수정 요약·재현 시험 이름·수정 전→후 → 데이터 경계 diff → CI 결과 → Codex가 먼저 볼 위험 → 미검증 → 다음 단계. 시험 통과를 "확인 완료"로 쓰지 않는다.

## 6. 이 작업 뒤

R5 보고 → Codex 독립 검토 1회 → 통과 시 Codex가 병합·handoff 갱신 → 그 뒤 Claude가 main 기준 새 브랜치에서 `git stash pop`(커밋 없이 보고). 전체 절차는 사용자가 별도 전달한다.

## 7. 작업 트리 정리 (R5 문서 커밋에 함께 포함)

11/09 상태 점검에서 발견된 Obsidian 흔적을 정리한다. 기능 변경이 아니므로 R5 문서 커밋에 넣는다.

- `.gitignore`에 `.obsidian/`, `travel-app/`, `research_notes/` 3줄이 이미 추가돼 있다(11/09 점검 세션이 추가). 그대로 커밋한다.
- `docs/u4-sapporo-scenario.md`의 미커밋 변경은 Obsidian 표 자동 정렬(공백만)이다. `git checkout -- docs/u4-sapporo-scenario.md`로 되돌린다. 내용 변경이 보이면 멈추고 보고한다.
- `docs/claude-task-d00-result.md`는 파일 모드만 바뀐 상태다. `git config core.filemode false`가 아니라면 `git checkout -- docs/claude-task-d00-result.md`로 되돌린다.
- 미추적 UI 파일 4건(`docs/claude-task-ui01-day-retro.md`, `docs/design/commercial-ui-design.md`, `docs/design/commercial-ui-development-plan.md`, `docs/design/ui-review-2026-11-06/`)은 **건드리지 않는다.** stash에는 `handoff.md` 1줄만 들어 있고 이 4건은 작업 트리에 남아 있다. 4단계(UI 복원)에서 새 브랜치에 추가한다.
