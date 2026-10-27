# travel-app 현재 상태

2026-10-27 · **활동 메모 재조회 수정 / iPhone 수정본 확인 대기**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). G0·G1·기존 B-01 사용자 확인 완료. G2/G2′/G3/G4 전체 확인은 대기.
- [메모 수정 보고](note-visibility-fix-2026-10-27.md)·[v2 모의/경계](phase-3-mock-verification-2026-10-26.md). `ea4a928` 검사 대기·`01c2716` 메모 조회 수정 커밋/push 완료. 문서 HEAD는 `git log -1`로 확인.
- [웹 앱](https://jeongjae.github.io/travel-app/)은 앱·가상 표본만 공개. 실제 여행·예약·키·백업 제외. 사전 릴리스 태그 `v0.1.0-preview.1`/`00a546a` 보존. 메모 수정 `01c2716` Pages 반영 확인.
- 개인 ZIP `local-data/phase2/verified-package-20261026/pilot.zip`, 84,453,766바이트·blob594개.
- SHA-256=`d183228064312c2a69d27018f5cfc6f5c909e262d621890f101770049274bbe0`.
- 원본·기존 통합본·G1/B-01·백업·프로필 보존. 다른 검토의 미추적 `docs/status-review-2026-10-26.md`는 커밋 제외.

## 검증·사용자 상태

- [앞선 실데이터 PC](full-verification-2026-10-26.md): 43일·첨부594해시·편집/오프라인·B/L/R·전체 복원 통과. 새 메모 UI 검사와 구분한다.
- 기존 PC 검토 프로필 `local-data/phase2/user-review-full-20261026/` 보존. 전체 PC 사용자 확인 대기. 창·서버 동작을 가정하지 않는다.
- iPhone 15 Plus/iOS27.0.1/Chrome147.0.7727.47: ZIP 가져오기·일정/사진 조회 사용자 확인. 10/27 ‘오늘 활동 옆 메모를 다시 열면 안 보인다’ **수정 요청**. 오프라인/종료/복원 통과로 표시하지 않는다.
- 가상 여행에서 수정 전 메모가 DB1건으로 저장됐지만 같은 창에서 보이지 않는 오류를 재현했다. 사용자 iPhone DB 잔존 여부를 직접 확인한 것은 아니다.
- 같은 활동 카드/메모 창에 저장 이력을 표시하고 새 입력과 구분했다. 기존 records 구독·AddNote 트랜잭션/revision을 재사용. 저장 형식 변경·원문 수정·데이터 삭제 없음. 기존 메모 확인에 ZIP 재가져오기 불필요.
- 대상 단위3개·PC/모바일 E2E6개 통과: 재조회/추가·계획 변경/대상·여행 격리·오프라인 새 페이지·빈 공간 백업 복원. 실제 iPhone 재확인 대기.
- 수정 후 `check:deferred`: check152개·E2E48개·pilot 통과. 로그 `.cache/verification/2026-10-27T01-58-31-206Z/`.
- 전일 `8c9ba6c`: 로컬149/42/pilot·Pages 성공, 원격 E2E41/42. 복원 대기 보완 후 `01c2716` 원격 CI 성공.
- v2 모의23개/E2E4개·512KiB/16MiB 경계2개는 앞선 로컬 통과. 실제 키 로드/변경·OpenAI 호출·v2 활성화·AI 서버 공개는 없음.

## 다음 작업·명령

1. iPhone 온라인에서 같은 주소 새로고침 → ‘저장 후 새 버전 열기’ → 기존 활동의 저장 메모 재조회. 데이터 삭제·ZIP 재가져오기·기존 문장 재입력 없이 먼저 확인한다.
2. 사용자 확인 후 비행기 모드/Wi-Fi 차단·메모·Chrome 종료/재실행·첨부 백업/빈 공간 복원 재검증. [실기기 절차](phase-2-prime-runbook.md).
3. [남은 목록](deferred-verification.md)의 원천 잔여/의미·지역 ZIP·Fact65개/권리·다른 매체 백업은 미완료. 실제 AI는 호스팅/인증·모델/예산/전송 확정 전 실행 금지.
- pnpm12.14.0/Node24.13.1/Python `.venv`. `COREPACK_HOME=.cache/corepack`, `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright`.
- UI `pnpm run dev:ui`(5173), 빌드 후 `pnpm run preview:ui`(4173). 회귀 `pnpm run check:deferred`. 포트 소유 확인 후 preview 재사용.
- [이전 PC 인계](history/handoff-2026-10-26-full-pc.md). 자동 검사·기기 보고·사용자 확인을 분리한다.
