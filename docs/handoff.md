# travel-app 현재 상태

2026-11-09 · **T-D1 종결(사용자 확인 완료 13:02) / T-D2 지시 발행 / UI 작업 복원·U4 재수행 대기**

새 Codex 세션은 먼저 [세션 인계](codex-session-handoff-2026-11-05.md)를 읽는다.

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 이전 상세는 [history](history/handoff-2026-11-09-before-d1-merge.md).
- 배포: Pages = main T-D1 코드(`9f5cb88`). 전송 허용 목록·동의 지문·의미 검증·검토 카드·R1~R7.
- [T-D1 검토](claude-task-d01-review.md) 통과·사용자 확인 완료. 결정 5건은 [결정](decisions.md) 11-06~09.
- 후속 CL-23~29는 [변경 목록](change-log.md).
- PC 작업 트리: stash@{0}은 `handoff.md` 1줄. **미추적 UI 설계 4건**(`claude-task-ui01-*`, `design/commercial-ui-*`, `design/ui-review-2026-11-06/`)은 UI 복원 때 새 브랜치에 추가. `u4-sapporo-scenario.md`·`claude-task-d00-result.md` 미커밋 변경은 공백·파일모드만.
- [UI 정리 계획](ui-polish-plan.md) U1~U4 배포. CL-20·REG-02는 사용자 확인 뒤 종결. D v0.3([설계](phase-d-design.md)·[계획](phase-d-plan.md)); [T-D0 검토](claude-task-d00-review.md) 차단 13건은 T-D4 전.
- 원본·verified ZIP `d1832280…bbe0`·백업 보존.

## 최근 검증·한계

- T-D1: GitHub CI(check·check:pilot·test:e2e) `9f5cb88` 성공. 단위 check exit 0, E2E 181/5 skip. 데이터 경계 4경로 변경 0건.
- 미검증: 실제 OpenAI 응답, 실데이터 추정 규칙(CL-29), 만료 라벨 E2E, Node HTTP 경로(단위만), iPhone 실기기.
- CI는 `ubuntu-24.04` 고정(`a05dca8`). 실제 키/API 실행 없음. AI 인증(패스키)·모델/예산 미결정.

## 다음 작업·확인 관문

1. Claude: UI 복원 — main에서 `codex/ui-resume`, `git stash pop`, 미추적 4건 `git add`(커밋 없음), check 보고.
2. Claude: [T-D2](claude-task-d02-worker-auth.md) 수행(`codex/d02-worker-auth`, UI 복원 커밋 뒤) → Codex 검토. 사용자: 실데이터로 CL-29 영향 날 수 보고.
3. 사용자: U4 대본 v2 재수행(`?workspace=content&review=sapporo-u4`) → CL-20. 평소 공간 파리 확인 → REG-02.
4. 사용자 결정(T-D4 전): U-D2 모델·예산·U-D3. UI 후속(CL-23·25·26)은 UI 복원 뒤 별도 지시.
- 기존 여행 삭제 금지. pnpm 12.14.0/Node 24.13.1. UI 5173, 미리보기 4173, 회귀 `check:deferred`.
