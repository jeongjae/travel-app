# travel-app 현재 상태

2026-10-25 · **iPhone 웹 접속 배포 / 전체 이행·실기기 확인 대기**

## 현재

- [계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). G0·G1·B-01 사용자 확인 완료.
- 사용자 요청으로 [웹 앱](https://jeongjae.github.io/travel-app/) 공개 배포. [v0.1.0-preview.1](https://github.com/jeongjae/travel-app/releases/tag/v0.1.0-preview.1) 앱 ZIP·체크섬 제공. 실제 자료·예약·키·백업은 공개 제외.
- `eee01ff` 검사 기대값, `71b31bd` Pages/하위 경로/PWA/기본 가이드, `00a546a` 모의 AI 상태 응답을 개별 커밋·push. 태그·배포 기준은 `00a546a`. [배포 보고](web-release-2026-10-25.md).
- [이행 보고](phase-2-continuous-report.md): 통합43일·9지역·227장소/주제·267활동·224이동·콘텐츠3,831개. 선택 leaf35,667개 중 표시35,134·메타533·보류/미대응0.
- 개인 ZIP: `local-data/phase2/continuous-10/full/package/pilot.zip`(84,453,758바이트). source594경로, ZIP blob594개. iPhone 파일 앱에 본인이 별도 복사해 가져온다.
- [v2 AI](phase-3-report.md)는 구현 상태, 유료 호출 미실행. Pages에는 AI 서버가 없고 미연결 안내를 표시한다. 모델/예산/전송·서버 인증은 미결정.

## 최근 검증·보존

- 로컬 포맷·린트·타입·배포/PWA 빌드 통과. 계약/변환57개, 실패 사례 E2E2개 통과. Pages 워크플로 성공·HTTPS 200·배포 커밋 확인.
- 원격 `check`(123개)·`check:pilot`·E2E38개 모두 통과. [배포 보고](web-release-2026-10-25.md). 공개 사이트 PC/모바일 크기로 가상 여행 가져오기·백업 메뉴·오프라인 재실행 확인, 오류/실패 자산/가로 넘침0.
- 전체 실데이터 DB 적재·독립 원천 대조·전체 복원·B/L/R·iPhone 실기기·실제 API는 미검증. [일괄 목록](deferred-verification.md). G2·G2′·G3 사용자 미확인.
- 65Fact 근거 부족·이미지2그룹/실행 지도 권리·렌더 잔여 콘텐츠 독립 검토는 남았다. 선택 필드 대응0을 전체 완료로 확대하지 않는다.
- 고정 원천·G1/B-01·사용자 DB/프로필 보존. 4173 preview(PID20340) 소유 확인, 종료하지 않음. 과거 요약은 [이력](history/handoff-2026-10-23-continuous.md).

## 다음 작업·실행

1. iPhone Chrome에서 웹 주소 열기 → 가상 여행 또는 개인 ZIP 가져오기. [실기기 절차](phase-2-prime-runbook.md)로 파일 선택·오프라인·종료/복원·사용자 확인.
2. 전체 실제 PC/원천 대조와 [운영 복구](phase-4-operations.md) 일괄 검증. 다른 매체 백업·첫 실패 키 식별/폐기도 대기.
- pnpm12.14.0 / Node24.13.1 / Python `.venv`. 재개 시 git/프로세스 확인. `COREPACK_HOME=.cache/corepack`, 후속 `pnpm run check:deferred`.
- 개발5173·로컬 preview4173·AI8787. 공개 앱은 별도 origin이며 PC/기기 데이터 자동 동기화 없음.
