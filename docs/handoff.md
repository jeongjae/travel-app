# travel-app 현재 상태

2026-11-13 · **D 단계 종료(사용자 G3 판정 17:19) / AI 개편(CL-39) E0 판정 완료·E1 전 결정 대기 / `d05-real` 검토 공간 삭제 대기**

새 Codex 역할 세션은 먼저 [세션 인계](codex-session-handoff.md)를 읽는다.

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 이전 상세는 [history](history/handoff-2026-11-13-g3-pending.md).
- D 단계: [종료 근거표](d-phase-closeout.md)(G-03~07 모두 "부분"으로 종료, 미검증 목록 유지) · [T-D5 결과](claude-task-d05-result.md) · [검토](claude-task-d05-review.md).
- 배포: Pages = main. **Worker 운영 `https://travel-app-ai.jeongjae-kim.workers.dev` 버전 `c5bc2d69…`**(롤백 `b3720c46…`). DAILY_LIMIT 20, preview 끔. 패스키 2개(PC Chrome·iPhone).
- AI 개편: [설계서 v0.3](ai-rework-requirements-design.md)(제3자 검토 2회 반영, 결정 9건 승인). 챗봇이 md 양식 파일을 만들고 앱이 AI 없이 읽어 넣는다.
- 열린 항목은 [변경 목록](change-log.md) CL 표. D에서 이월: CL-20·23·25·29·32·36·37·40~45, REG-02, U4 재수행, Node 서버 정리.
- 원본·verified ZIP `d1832280…bbe0`·백업 보존.

## 최근 검증·한계

- CI: `e401bc6`까지 main·브랜치 성공. 11/13 커밋은 문서만이라 Pages 재배포 없음.
- G3 사용자 확인: iPhone 1시간 만료 재로그인 OK, PC 평소 공간 불변.
- 미검증인 채 종료(사용자 수용): C3 미리보기 수·1회차 거절·작업 상태·이전 버전 조회, 운영 재작성 경로·429, U3·U4 일부, CL-29, CL-32(CPU 미측정).
- AI 개편 양식: 챗봇 2종 6개 파일이 규칙 대조 통과. 변환기 코드는 없다.

## 다음 작업·확인 관문

1. E0 [챗봇 시험](e0-chatbot-trial.md) 판정: md 표 유지(2회차 6/6). **사용자 결정 대기**: 설계서 §8.1 M-1·M-2, 보완 3건.
2. 사용자: PC에서 `d05-real` 검토 공간 삭제(방법은 [결정 11/13 17:19](decisions.md)).
3. Codex: 양식 v1 확정 뒤 E1 지시서(새 여행 가져오기, 기존 AI 변경안 적용 차단, 길이 0·역전 거부) → Claude 구현.
4. 사용자(이월): U4 대본 v2 재수행 → CL-20. 평소 공간 파리 확인 → REG-02.

- 기존 여행 삭제 금지. pnpm 12.14.0/Node 24.13.1. `pnpm dev`=Vite+Worker(`worker/.dev.vars`, `localhost:5173`), `dev:node`=Node. UI 5173, 미리보기 4173, 회귀 `check:deferred`.
