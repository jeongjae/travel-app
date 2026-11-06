# travel-app 현재 상태

2026-11-06 · **main·Pages C-15까지 배포 / D v0.3·T-D0 통과·T-D1 지시 발행 / U4 사용자 재수행 대기**

새 Codex 세션은 먼저 [세션 인계](codex-session-handoff-2026-11-05.md)를 읽는다.

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 이전 상세는 [history](history/handoff-2026-11-06-before-d0.md).
- 배포: Pages = main `e0c4013` 코드(U1~U4 + C-14 + C-15).
- [상용 앱 비교·UI 개선 설계서](design/commercial-ui-design.md) 검토 준비. [오늘·회고 정적 시안](design/ui-review-2026-11-06/concept.html)에서 이동과 방문 결과의 읽는 순서를 확인한다.
- [UI 정리 계획](ui-polish-plan.md): U1~U4 검토 통과·배포. CL-20은 U4 [대본 v2](u4-sapporo-scenario.md) 사용자 재수행 뒤 해소.
- [C-14 검토](claude-task-c14-review.md) 통과(CL-22 해소). [C-15 검토](claude-task-c15-review.md) 통과(R1 확인, 사용자 답변 11/06).
- REG-02: 표시 문제로 재분류 → C-15 Q3 대표 사진 규칙으로 수정. 사용자 평소 공간 확인 뒤 종결.
- 평소 공간: PC Chrome 배포 사이트에 파리 패키지 `712369b3…` 가져옴(11/05, 사용자).
- D v0.3([설계 §12](phase-d-design.md)·[계획 §8](phase-d-plan.md)): 항목 단위 AI, 개인용 단순화, Pages+Cloudflare Worker, iPhone은 D 후반. [T-D0 검토](claude-task-d00-review.md): 전송 공백 등 차단 13건은 T-D4 전 해소.
- 원본·verified ZIP `d1832280…bbe0`·백업 보존. 미추적 `docs/status-review-2026-10-26.md`·`research_notes/` 커밋 제외.

## 최근 검증·한계

- C-15: GitHub CI(check·check:pilot·전체 E2E) 성공, main Pages 배포 성공. 실제 패키지 재현은 클라우드 검토 공간.
- CI는 `ubuntu-24.04` 고정(`a05dca8`). `ubuntu-latest`(26.04)에 Python 3.12.7 없음.
- 모바일은 에뮬레이션. iPhone 실기기 확인·빈 공간 복원은 대기.
- 실제 키/API·v2 AI 실행 없음. AI 운영/인증·모델/예산 미결정.

## 다음 작업·확인 관문

1. Claude: [T-D1](claude-task-d01-send-semantics.md) 수행(`codex/d01-send-semantics`) → Codex 검토. 결정: 패스키·background 수용·Workers Free·D 먼저.
2. 사용자: 평소 공간 파리 화면 확인 → REG-02 종결.
3. 사용자: U4 대본 v2 재수행(`?workspace=content&review=sapporo-u4`, 약 30분) → Q-U2·Q-U3·S6-d·CL-20.
4. 사용자 결정(첫 실제 호출 전): U-D2 모델·예산, U-D3 전송·보관.
- 기존 여행 삭제 금지. pnpm 12.14.0/Node 24.13.1. UI 5173, 미리보기 4173, 회귀 `check:deferred`.
