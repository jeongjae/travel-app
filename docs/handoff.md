# travel-app 현재 상태

2026-11-12 · **T-D5 C3 진행 중(실제 여행 호출 3/6회·$0.13) / 수정 `a3fcac5` Codex 사후 검토 통과·main 병합 / U4 재수행 대기**

새 Codex 역할 세션은 먼저 [세션 인계](codex-session-handoff.md)를 읽는다.

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 이전 상세는 [history](history/handoff-2026-11-10-before-d05-c1.md).
- 배포: Pages = main. **Worker 운영 `https://travel-app-ai.jeongjae-kim.workers.dev` 버전 `c5bc2d69…`**(C1 + 형식 실패 재작성 `a3fcac5`, 롤백 `b3720c46…`). DAILY_LIMIT 20, preview 끔.
- 패스키 2개(PC Chrome·iPhone). 관문 G-T·G-D·G-P·G-B 통과.
- [T-D5 지시](claude-task-d05-iphone-real.md) · [C2~C4 지시](claude-task-d05-c2-iphone.md) · [결과](claude-task-d05-result.md) · [검토](claude-task-d05-review.md) · [iPhone 기록표](d05-iphone-script.md).
- 열린 항목은 [변경 목록](change-log.md) CL 표(CL-20·23·25·29·32·36·37·39~44).
- 원본·verified ZIP `d1832280…bbe0`·백업 보존. 11/12 전체 백업(iPhone 87MB·PC) 사용자 보관.

## 최근 검증·한계

- CI(check·check:pilot·test:e2e): `a3fcac5`·`33b26e1` 성공. 데이터 경계 4경로 변경 0건.
- iPhone Chrome U1~U6 사용자 통과 보고. U3 화면 문제·U4 점검용 기록 처리·U5 1시간 만료 재로그인은 보고 없음(미검증).
- C3: 1회차 추가 성공($0.04), 2회차 수정 실패(형식), 3회차 수정 변경안 생성(사용자 불만족, CL-43). 미리보기 항목 수·1회차 거절 여부·3회차 적용 여부 미기록.
- 미검증: 운영에서 형식 실패 → 재작성 경로, 운영 429, CL-29, 2단계(iPhone 평소 공간 적용·삭제 원복).

## 다음 작업·확인 관문

1. 사용자 결정: "Claude 직접 수정" 지시의 범위(이번 1건 / T-D5 남은 기간) — [결정 11/12](decisions.md).
2. 사용자+Claude: C3 남은 3회·$0.87 — 1단계 적용 확인 → 2단계 iPhone 평소 공간(추가 1건 적용 → 삭제 원복). 멈춤 조건은 지시서 §3.
3. Claude: `docs/d-phase-closeout.md` G-03~07 근거표 → Codex 검토 → 사용자 G3 판정.
4. 사용자: U4 대본 v2 재수행 → CL-20. 평소 공간 파리 확인 → REG-02.
5. 사용자 확인 대기: C1 검토의 Codex 판단 2건(관측값 유지, CL-40 수용).

- 기존 여행 삭제 금지. pnpm 12.14.0/Node 24.13.1. `pnpm dev`=Vite+Worker(`worker/.dev.vars`, `localhost:5173`), `dev:node`=Node. UI 5173, 미리보기 4173, 회귀 `check:deferred`.
