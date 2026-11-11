# travel-app 현재 상태

2026-11-11 · **T-D4 종결 / T-D5 C1 Codex 검토 통과·main 병합, Worker 재배포 대기 / U4 재수행 대기**

새 Codex 역할 세션은 먼저 [세션 인계](codex-session-handoff.md)를 읽는다.

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 이전 상세는 [history](history/handoff-2026-11-10-before-d05-c1.md).
- 배포: Pages = main(T-D1~T-D4 + T-D5 C1). **Worker 운영 `https://travel-app-ai.jeongjae-kim.workers.dev` 버전 `e5e62de9…`는 C1 이전**(DAILY_LIMIT 20, preview 끔). 재배포 전에는 화면의 "패스키 관리"·"AI 작업 기록"이 404를 받는다.
- 패스키 1개 등록(PC Chrome). iPhone 패스키는 G-P에서 추가.
- [T-D5 지시](claude-task-d05-iphone-real.md) · [C1 결과](claude-task-d05-result.md) · [C1 검토](claude-task-d05-review.md). G-T 확정은 [결정](decisions.md) 11-11.
- 열린 항목은 [변경 목록](change-log.md) CL 표(CL-20·23·25·29·32·36·37·39·40·41).
- AI 기능 범위 동결: D 단계는 T-D5에서 마감, 개편은 그 뒤(CL-39).
- 원본·verified ZIP `d1832280…bbe0`·백업 보존.

## 최근 검증·한계

- T-D5 C1: GitHub CI(check·check:pilot·test:e2e) `4cc6c47` 성공. 데이터 경계 4경로 변경 0건. 실제 호출·배포 0회.
- T-D4: 가상 여행 실제 호출 5회 $0.12. 실제 여행 데이터 호출은 아직 0회.
- 미검증: iPhone QR 패스키 생성, iOS 교차 출처 로그인, 운영 DO 열 추가, 운영 429, 실데이터 추정 규칙(CL-29).
- PC(Windows) 로컬 전체 단위 시험은 간헐 실패(CL-36). 판정은 CI 기준.

## 다음 작업·확인 관문

1. Claude: `wrangler deploy --env production` → 버전 기록 → 패스키 목록 1회로 운영 DO 열 추가 확인. 대본 `docs/d05-iphone-script.md` 작성.
2. 사용자: iPhone 실기기(지시 §2) — G-P 패스키 추가, G-B 전체 백업·복원.
3. 사용자+Claude: 실제 여행 선별 호출(지시 §3, 최대 6회·$1). 멈춤 조건은 지시서.
4. Claude: `docs/d-phase-closeout.md` G-03~07 근거표 → 사용자 G3 판정.
5. 사용자: U4 대본 v2 재수행 → CL-20. 평소 공간 파리 확인 → REG-02.
6. 사용자 확인 대기: C1 검토의 Codex 판단 2건(관측값 유지, CL-40 수용).

- 기존 여행 삭제 금지. pnpm 12.14.0/Node 24.13.1. `pnpm dev`=Vite+Worker(`worker/.dev.vars`, `localhost:5173`), `dev:node`=Node. UI 5173, 미리보기 4173, 회귀 `check:deferred`.
