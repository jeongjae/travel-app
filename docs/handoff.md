# travel-app 현재 상태

2026-11-05 · **main·Pages C-14까지 배포 / C-15 구현·CI 성공·Codex 조건부 통과(R1 대기) / U4 사용자 재수행 대기 / D 설계·계획 검토 준비**

새 Codex 세션은 먼저 [세션 인계](codex-session-handoff-2026-11-05.md)를 읽는다.

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 이전 상세는 [history](history/handoff-2026-11-05-before-session-handoff.md).
- 배포: Pages = main `4b43344` 코드(U1~U4 + C-14). 이후 main 커밋은 문서뿐(`18bb853`).
- [UI 정리 계획](ui-polish-plan.md): U1~U4 검토 통과·배포. CL-20은 U4 [대본 v2](u4-sapporo-scenario.md) 사용자 재수행 뒤 해소.
- [C-14 검토](claude-task-c14-review.md) 통과(CL-22 해소). [C-15 검토](claude-task-c15-review.md) 조건부: R1 한국어 `역` 판정·목차 id·스크린샷.
- REG-02: 데이터 손상 아님. 대표 사진이 첫 방문 장소(출발역·빵집)로 잡히는 표시 문제로 재분류 → C-15 Q3.
- 평소 공간: PC Chrome 배포 사이트에 파리 패키지 `712369b3…` 가져옴(11/05, 사용자).
- [D 설계](phase-d-design.md)·[D 계획](phase-d-plan.md) v0.2: 사용자 검토 대기, 구현·유료 호출 미착수.
- 원본·verified ZIP `d1832280…bbe0`·백업 보존. 미추적 `docs/status-review-2026-10-26.md`·`research_notes/` 커밋 제외.

## 최근 검증·한계

- C-14: GitHub CI(check·check:pilot·전체 E2E) 성공, main Pages 배포 성공. 실제 패키지 재현은 클라우드 검토 공간.
- CI는 `ubuntu-24.04` 고정(`a05dca8`). `ubuntu-latest`(26.04)에 Python 3.12.7 없음.
- 모바일은 에뮬레이션. iPhone 실기기 확인·빈 공간 복원은 대기.
- 실제 키/API·v2 AI 실행 없음. AI 운영/인증·모델/예산 미결정.

## 다음 작업·확인 관문

1. Claude: C-15 R1(같은 브랜치) → Codex 확인 → main 병합·배포.
2. 사용자: C-15 배포 뒤 평소 공간 파리 화면·43일 대표 사진 대조표 확인.
3. 사용자: U4 대본 v2 재수행(`?workspace=content&review=sapporo-u4`, 약 30분) → Q-U2·Q-U3·S6-d·CL-20.
4. 사용자 결정: D 설계 검토, iPhone 확인 시점.
- 기존 여행 삭제 금지. pnpm 12.14.0/Node 24.13.1. UI 5173, 미리보기 4173, 회귀 `check:deferred`.
