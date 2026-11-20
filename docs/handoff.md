# travel-app 현재 상태

2026-11-18 · **AI 개편 T-E1 확인 완료 / T-P1 확인 완료(11/19, 화면 의견 4건 종결) / AI 개편 E1·P1·E2 확인 완료, E3-1 배포·확인 대기(11/20) → E4-1 정리**

새 Codex 역할 세션은 먼저 [세션 인계](codex-session-handoff.md)를 읽는다.

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 이전 상세는 [history](history/handoff-2026-11-13-g3-pending.md).
- D 단계: [종료 근거표](d-phase-closeout.md)(G-03~07 모두 "부분"으로 종료, 미검증 목록 유지) · [T-D5 결과](claude-task-d05-result.md) · [검토](claude-task-d05-review.md).
- 배포: Pages = main. **Worker 운영 `https://travel-app-ai.jeongjae-kim.workers.dev` 버전 `c5bc2d69…`**(롤백 `b3720c46…`). DAILY_LIMIT 20, preview 끔. 패스키 2개(PC Chrome·iPhone).
- AI 개편: [설계서 v0.6](ai-rework-requirements-design.md)·[양식 규격 v1](plan-format-v1.md). 챗봇이 md 양식을 만들고 앱이 AI 없이 읽는다.
- 열린 항목은 [변경 목록](change-log.md) CL 표. D에서 이월: CL-20·23·25·29·32·36·37·40~45, REG-02, U4 재수행, Node 서버 정리.
- 원본·verified ZIP `d1832280…bbe0`·백업 보존.

## 최근 검증·한계

- CI(11/20 변경): E2E 4작업 동시 실행, 약 7~11분. 문서만 바뀐 push는 실행 없음. main은 Pages 워크플로가 검사 후 배포.
- G3 사용자 확인: iPhone 1시간 만료 재로그인 OK, PC 평소 공간 불변.
- 미검증인 채 종료(사용자 수용): C3 미리보기 수·1회차 거절·작업 상태·이전 버전 조회, 운영 재작성 경로·429, U3·U4 일부, CL-29, CL-32(CPU 미측정).
- T-E1 변환기는 고정 자료 8개 통과. 사용자 확인 G-E1 완료.

## 다음 작업·확인 관문

1. Claude: [T-E4-1](claude-task-e04-1-node-server.md)(개발용 Node 서버 정리) → Codex 검토·병합. 사용자 결정 대기: 구 화면 제거.
2. 사용자: UI는 [일괄 확인 목록](batch-check-list.md)으로 한 번에. E3-2·P2는 실사용 점검 뒤.
3. 사용자 확인 대기: G-2(준비 초안을 기기 설정에 저장), 가이드 화면 위치.
4. 사용자(이월): U4 대본 v2 재수행 → CL-20. 평소 공간 파리 확인 → REG-02.

- 기존 여행 삭제 금지. pnpm 12.14.0/Node 24.13.1. `pnpm dev`=Vite+Worker(`worker/.dev.vars`, `localhost:5173`), `dev:node`=Node. UI 5173, 미리보기 4173, 회귀 `check:deferred`. PC 전체 E2E `pnpm run test:e2e:all`.
