# travel-app 현재 상태

2026-10-26 · **전체43일 PC 검증 / 실기기·사용자 확인 진행**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). G0·G1·기존 B-01 사용자 확인 완료. [상세 검증](full-verification-2026-10-26.md).
- 구현 main=`c5b6c0e`. `4437852` pnpm 실행, `50c5c39` 모의 검사 대기, `c5b6c0e` 실행 체크 출처 경로 수정·가상 회귀를 각각 커밋/push. 최종 문서 HEAD는 `git log -1`로 확인.
- [웹 앱](https://jeongjae.github.io/travel-app/) Pages는 `c5b6c0e` 자동 배포 성공. 사전 릴리스 `v0.1.0-preview.1` 태그/자산은 `00a546a` 그대로. 실제 자료·키·백업 공개 제외.
- 수정 개인 ZIP: `local-data/phase2/verified-package-20261026/pilot.zip`, 84,453,766바이트·blob594개.
- SHA-256: `d183228064312c2a69d27018f5cfc6f5c909e262d621890f101770049274bbe0`.
- 기존 통합 ZIP·원천·G1/B-01·백업/프로필 보존. [연속 이행](phase-2-continuous-report.md): 43일·9지역·227장소/주제·267활동·224이동·콘텐츠3,831개. 전체 원천 의미 보존 완료 판정은 아님.

## 최근 검증·산출물

- 10/26 수정 후 `check:deferred`: check124개·E2E38개·pilot 통과. `c5b6c0e` 원격 CI·Pages 모두 success. 과거 성공을 새 수정 증거로 재사용하지 않음.
- 고정 원천313/첨부594파일·기존 G1/B-01 ZIP·백업177/273entry 해시 일치. 원본→추출 JSON56·Markdown184·XLSX2,539셀 대조, 수정본 Fact760·메모9·체크17개 역조회 통과.
- 기존 ZIP PC: 도메인 전체 행/첨부594해시·43일/227가이드/54예약 조회·편집/오프라인 기록·전체 백업/빈 공간 복원 통과. 증거 `local-data/phase2/full-verification-20261026-04/`.
- 수정본 PC 전체 화면·프로세스 재시작·B/L/R·오프라인 운영15컬렉션/15,911행·594파일 복원·여행 전환 통과. 증거 `full-verification-20261026-05/`→`06/`→`07/`. 도구 실패2건과 연속 증거를 구분 기록.
- 사용자용 별도 Chromium 검토 창: `http://127.0.0.1:4173/?workspace=content&review=full-user-20261026`. 프로필은 `local-data/phase2/user-review-full-20261026/`. 자동 검증 문장 없음·사용자 확인 대기.
- iPhone 사용자 보고: 15 Plus/iOS27.0.1/Chrome147.0.7727.47, 보안·DB·OPFS 지원/앱 셸 제어 표시. 실제 ZIP 선택·적재·오프라인/종료·복원은 응답 대기. [절차](phase-2-prime-runbook.md).
- 전체 PC 사용자 확인·추가 경계/원천 의미 대조·실기기·v2 AI는 미완료. Fact65개 근거 부족·이미지/지도 권리 검토·다른 매체 백업 대기. G2/G2′/G3/G4를 완료로 표시하지 않음.

## 다음 작업·명령

1. [일괄 목록](deferred-verification.md)의 미검증을 이어가고 PC 검토 창의 전체 일정/Day1·18·42·43/가이드/사진/백업 사용자 확인을 받는다. iPhone에서는 수정 ZIP만 별도 전달하며 기존 DB를 지우지 않는다.
2. v2 AI는 기본 비활성·Pages AI 서버 없음. 호스팅/인증·모델/예산/전송 확정 전 활성화·유료 호출·키 변경 금지.
- pnpm12.14.0/Node24.13.1/Python `.venv`. `COREPACK_HOME=.cache/corepack`, `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright`.
- UI `pnpm run dev:ui`(5173), 빌드 후 `pnpm run preview:ui`(4173), 회귀 `pnpm run check:deferred`. 현재 4173은 이번 세션 UI preview이며 재개 시 소유 재확인.
- [직전 인계](history/handoff-2026-10-26-resume.md). 다른 검토의 미추적 `docs/status-review-2026-10-26.md`는 보존·커밋 제외.
