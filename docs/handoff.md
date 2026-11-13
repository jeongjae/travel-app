# travel-app 현재 상태

2026-11-13 · **T-D5 C3 마감(실제 여행 호출 4회·$0.15) / C4 종료 근거표 Codex 검토 통과 → **사용자 G3 판정 대기** / U4 재수행 대기**

새 Codex 역할 세션은 먼저 [세션 인계](codex-session-handoff.md)를 읽는다.

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 이전 상세는 [history](history/handoff-2026-11-12-c3-closed.md).
- 배포: Pages = main. **Worker 운영 `https://travel-app-ai.jeongjae-kim.workers.dev` 버전 `c5bc2d69…`**(C1 + 형식 실패 재작성 `a3fcac5`, 롤백 `b3720c46…`). DAILY_LIMIT 20, preview 끔.
- 패스키 2개(PC Chrome·iPhone). 관문 G-T·G-D·G-P·G-B 통과. iPhone 점검은 Chrome 기준.
- [T-D5 지시](claude-task-d05-iphone-real.md) · [C2~C4 지시](claude-task-d05-c2-iphone.md) · [결과](claude-task-d05-result.md) · [검토](claude-task-d05-review.md) · [iPhone 기록표](d05-iphone-script.md).
- 열린 항목은 [변경 목록](change-log.md) CL 표(CL-20·23·25·29·32·36·37·39~45).
- 원본·verified ZIP `d1832280…bbe0`·백업 보존.

## 최근 검증·한계

- CI: `a3fcac5` 이후 전부 성공. 데이터 경계 4경로 변경 0건.
- iPhone Chrome U1~U6 사용자 통과 보고. U3 화면 문제·U4 점검용 기록 처리·U5 1시간 만료 재로그인은 보고 없음(미검증).
- C3: 추가 성공 · 수정 실패(형식) · 수정 생성(불만족, CL-43) · iPhone 평소 공간 추가 적용(revision 4). PC 평소 공간 변화 없음(사용자 확인).
- 미보고·미검증: 미리보기 수, 1회차 거절, 2단계 원복, 작업 상태, `d05-real` 삭제, 운영 재작성 경로·429, CL-29.

## 다음 작업·확인 관문

1. 11/13 iPhone 확인 기록 완료(`a0a4534`, 코드 수정 없음).
2. 사용자 확인 대기 건은 11/13 모두 확정(iPhone 추가 항목은 유지). AI 개편 제안은 [결정](decisions.md) 11/13 15:07.
3. 사용자 G3: [종료 근거표](d-phase-closeout.md) §4 질문 7개. 종료 전 확인 2건 = iPhone U5 1시간 만료 재로그인, PC "계획 2" 화면.
4. 사용자: U4 대본 v2 재수행 → CL-20. 평소 공간 파리 확인 → REG-02.

- 기존 여행 삭제 금지. pnpm 12.14.0/Node 24.13.1. `pnpm dev`=Vite+Worker(`worker/.dev.vars`, `localhost:5173`), `dev:node`=Node. UI 5173, 미리보기 4173, 회귀 `check:deferred`.
