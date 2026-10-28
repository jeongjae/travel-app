# travel-app 현재 상태

2026-10-28 · **T-01-R1 검토 통과 / REG-01·사용자 확인 대기 / T-02 Codex 검토 대기**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md).
- [T-01 결과](claude-task-01-result.md) `1e56c71`·[Codex 검증](claude-task-01-review.md): R1 화면/의미 분석 제출은 통과.
- 하루 regionIds 의미(REG-01)는 현 값 유지·확정 보류. 관찰/todo를 유지하고 T-03 원천 대조에서 처리한다.
- [T-02 결과](claude-task-02-result.md): 브랜치 `codex/t02-pages-gate` `fa3871f`, 원격 CI 성공. 실패 차단 런타임·main 배포는 미검증.
- Codex는 계획/독립 검증, Sonnet은 상세 조사·구현·전체 검사. 짧은 요약·위험 diff 중심으로 검토한다.
- G0·G1·기존 B-01 확인 완료. G2/G2′/G3/G4·전체 PC·T-01 사용자 확인은 대기.
- [웹 앱](https://jeongjae.github.io/travel-app/)은 앱/가상 표본만 공개. 앱 코드는 메모 수정 `01c2716` Pages 반영 확인.
- 개인 ZIP `local-data/phase2/verified-package-20261026/pilot.zip`: 84,453,766바이트·blob594개.
- SHA-256=`d183228064312c2a69d27018f5cfc6f5c909e262d621890f101770049274bbe0`, 10/27 일치.
- 원본·기존 통합본·백업·프로필 보존. 미추적 `docs/status-review-2026-10-26.md`는 커밋 제외.

## 최근 검증·한계

- Claude T-01 전체 회귀: 단위168·E2E52·pilot. R1 자체: check169·대상 E2E6, skipped1·todo1 구분.
- Codex T-01: 신규 단위16·Fact UI4 통과. R1: 10/27 변경 단위/생성 도구13 통과·todo1.
- 10/27 R1 UI 요청은 자동 승인 검토 사용 한도로 미실행. 10/28 정상 재실행 PC/모바일2 통과(15.8초).
- 귀국/이동일 화면 직접 확인·가상ZIP4개 생성/읽기 통과. `.cache/t01-codex-review/`, `.cache/t01-review/screens/`.
- 전체 회귀를 다시 반복하지 않았다. 제품 코드/의존성/workflow 변경 없음. 원격 CI는 이번에 미확인.
- [실데이터 PC](full-verification-2026-10-26.md)의 43일·594해시·편집/오프라인·B/L/R·전체 복원 증거는 유지한다.
- PC 사용자 프로필 `local-data/phase2/user-review-full-20261026/` 보존. 창·서버 상태를 가정하지 않는다.
- [iPhone](phase-2-prime-runbook.md): 가져오기·일정/사진/메모·오프라인 저장·종료 후 유지·백업 파일 저장 확인.
- iPhone 백업 크기·재선택/빈 공간 복원·복원 공간 재실행·기기 해시는 대기. 실제 키/API·v2 활성화 없음.

## 다음 작업·명령

1. T-02 브랜치를 Codex가 검토한다. main 병합 시 Pages 배포가 실행되므로 병합 결정은 별도다.
2. T-01 가상 화면 확인은 결과 보고의 명령·기대 문구를 따른다. 사용자 ‘완료’는 제출 알림이며 화면 승인과 구분한다.
3. iPhone은 `?workspace=content&review=iphone-restore-20261027`의 빈 공간에서 전체 백업 복원·재실행을 확인한다.
4. [잔여 목록](deferred-verification.md): REG-01·원천/의미·지역 ZIP·Fact65개/권리·별도 매체 백업·전체 PC 확인.
- 기존 여행은 삭제하지 않는다. 검토 공간이 비어 있지 않으면 중단한다. AI 운영/인증·모델/예산/전송 미결정 유지.
- pnpm12.14.0/Node24.13.1/프로젝트 `.venv`, 캐시 `.cache/corepack`·`.cache/ms-playwright`.
- UI `pnpm run dev:ui` 5173, 빌드 후 `preview:ui` 4173, 회귀 `check:deferred`. 포트 소유 먼저 확인.
- [직전 인계](history/handoff-2026-10-28-before-r1-review.md). 상세 판단·검사 근거는 Codex 검증 보고를 따른다.
