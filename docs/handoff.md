# travel-app 현재 상태

2026-10-27 · **Codex 계획/검증·Claude Sonnet 구현 분리 / T-01 구현 완료·Codex 검토 대기**

## 현재 기준

- [실행계획 개정안](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md).
- [T-01 결과](claude-task-01-result.md): 귀국일·이동일·가이드 Fact 격리 회귀 구현. Claude 자체 검사 통과(단위168·E2E52·pilot), Codex 검토 대기·사용자 확인 검토 준비. 범위 밖 관찰: day.regionIds는 숙박 지역만.
- Codex는 계획·지시/독립 검증, Claude는 구현·자체 검사, 사용자는 제품 결정·실제 산출물 확인을 맡는다.
- G0·G1·기존 B-01 확인 완료 유지. G2/G2′/G3/G4 전체 확인은 대기. 개정안 세부 해법은 검토안이다.
- [웹 앱](https://jeongjae.github.io/travel-app/)은 앱·가상 표본만 공개. 개인 여행·예약·키·백업 제외. 메모 수정 `01c2716` Pages 반영 확인.
- 개인 ZIP `local-data/phase2/verified-package-20261026/pilot.zip`: 84,453,766바이트·blob594개.
- SHA-256=`d183228064312c2a69d27018f5cfc6f5c909e262d621890f101770049274bbe0`, 10/27 재대조 일치.
- 원본·기존 통합본·G1/B-01·백업·사용자 프로필 보존. 미추적 `docs/status-review-2026-10-26.md`는 커밋 제외.

## 검증·사용자 상태

- [실데이터 PC](full-verification-2026-10-26.md): 43일·첨부594해시·편집/오프라인·B/L/R·전체 복원 통과. 전체 PC 사용자 확인 대기.
- PC 검토 프로필 `local-data/phase2/user-review-full-20261026/` 보존. 창·서버 동작을 가정하지 않는다.
- [iPhone 기록](phase-2-prime-runbook.md): 가져오기·일정/사진/기존 메모·오프라인 새 메모 저장·Chrome 종료 후 유지 사용자 확인 완료.
- 10/27 백업 파일 저장 사용자 확인. 크기·재선택/빈 공간 복원·복원 공간 재실행·기기 해시 대조는 대기.
- [메모 수정](note-visibility-fix-2026-10-27.md): DB 저장 후 조회 UI 누락 수정, 저장 형식·revision/트랜잭션 유지.
- Codex가 `a7070b4`에서 재실행한 `check:deferred`: check152개·PC/모바일 E2E48개·pilot 통과.
- 로그 `.cache/verification/2026-10-27T07-10-29-263Z/`. 최초 sandbox 파일/localhost 제한 실패 후 권한 검토 재실행.
- 위 152·48개 결과는 T-01 이전 기준이다. T-01 로그 `.cache/verification/2026-10-27T07-47-06-848Z/`.
- `01c2716` 원격 CI/Pages success 재확인. [v2 모의/경계](phase-3-mock-verification-2026-10-26.md)는 실제 AI 증거가 아니다.
- 실제 키 로드/변경·OpenAI 호출·v2 활성화·AI 서버 공개 없음.

## 다음 작업·명령

1. Codex가 T-01 커밋 eec4200·30024f8·c253693·보고를 독립 검증하고 day.regionIds 관찰을 판단한다. 그 뒤 T-02.
2. 병행: iPhone 백업 크기 확인 후 `?workspace=content&review=iphone-restore-20261027`의 빈 공간에서 전체 백업 복원.
3. 기존 데이터는 삭제하지 않는다. 빈 공간이 아니면 중단한다. 일정·사진·메모·오프라인/종료 후 유지를 확인한다.
4. [잔여 목록](deferred-verification.md)의 원천/의미·지역 ZIP·Fact65개/권리·다른 매체 백업과 전체 PC 확인을 마감한다.
5. 별도 여행 작성·회고 및 실제 AI 운영은 개정안 C/D로 진행한다. 호스팅/인증·모델/예산/전송 미결정은 유지한다.
- pnpm12.14.0/Node24.13.1/프로젝트 `.venv`; `COREPACK_HOME=.cache/corepack`, `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright`.
- UI `pnpm run dev:ui`(5173), 빌드 후 `pnpm run preview:ui`(4173), 회귀 `pnpm run check:deferred`. 포트 소유 먼저 확인.
- [직전 인계](history/handoff-2026-10-27-before-claude.md). 구현/검토/확인 상태를 구분한다.
