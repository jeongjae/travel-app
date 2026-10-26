# travel-app 현재 상태

2026-10-26 · **세션 인계 준비 / 웹 배포 완료·전체 이행 검증 대기**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 재개 지시문: [새 세션 시작](session-resume-prompt.md). G0·G1·기존 B-01은 사용자 확인 완료.
- 인계 시작 시 main=`1b95505`, 작업 트리 깨끗함·GitHub main 일치. 이후 변경은 이번 인계 문서뿐이며 최종 문서 커밋은 `git log -1`로 확인한다.
- [웹 앱](https://jeongjae.github.io/travel-app/)·[v0.1.0-preview.1](https://github.com/jeongjae/travel-app/releases/tag/v0.1.0-preview.1) 공개 완료. 배포·태그 대상=`00a546a`, 최신 main의 문서 커밋과 구분. [배포 보고](web-release-2026-10-25.md).
- 공개에는 앱·가상 표본만 포함. 실제 여행·예약·키·백업은 Git 제외. PC/iPhone·브라우저별 데이터 자동 동기화 없음. 개인 ZIP은 사용자가 파일 앱에 별도 복사해 가져온다.
- [통합 이행](phase-2-continuous-report.md): 43일·9지역·227장소/주제·267활동·224이동·콘텐츠3,831개. 선택 leaf35,667개=표시35,134+메타533, 보류/미대응0. 전체 원천 보존 완료 판정은 아님.
- 개인 ZIP: `local-data/phase2/continuous-10/full/package/pilot.zip`(84,453,758바이트, blob594개). SHA-256: `3e73d4bdd5e9c5a99628816f64e528bd715276da360f7b492784476b3a5b0282`.
- [v2 AI](phase-3-report.md)는 구현 상태·기본 비활성(`OPENAI_V2_ENABLED=0`). Pages에 AI 서버 없음. 호스팅/인증·모델/예산/전송 미정, 실제 유료 호출 미실행.

## 검증·환경

- 10/25 `00a546a` 원격 `check`123개·`check:pilot`·E2E38개 통과. 공개 사이트 가상 여행의 PC/모바일 크기·가져오기·백업 메뉴·오프라인 재실행 통과. iPhone 실기기 결과가 아님.
- 10/26 인계 점검: 공개 HTML/deployment.json HTTP200·배포 커밋 일치, 개인 ZIP 크기/해시·Git 제외 일치. 기능 테스트는 재실행하지 않음. 이번 변경은 문서뿐.
- 10/26 포트5173·4173·8787 리스너 없음. 이전 PID20340은 실행 중으로 가정하지 말 것. 서버·브라우저 DB/기존 프로필을 새로 시작하거나 초기화하지 않았음.
- 전체 실데이터 DB 적재·독립 원천 대조·전체 복원·B/L/R·iPhone·v2 실제 API 미검증. [일괄 목록](deferred-verification.md). G2·G2′·G3·G4 미완료, 웹 배포 사용자 확인 대기.
- 65Fact 외부 근거 부족·이미지2그룹/지도 권리·렌더 잔여 원천 검토가 남음. 원천·G1/B-01·사용자 DB/프로필 보존. [직전 인계](history/handoff-2026-10-25-web-release.md).

## 다음 작업·명령

1. 재개 시 git/프로세스·원천/ZIP을 먼저 확인. [실기기 절차](phase-2-prime-runbook.md)로 iPhone Chrome 접속·파일 선택·OPFS·오프라인·종료/복원·사용자 확인을 지원한다.
2. 별도 검증 저장소에서 전체43일 실제 PC/원천 대조·복원을 준비/진행하고 근거를 남긴다. [운영 복구](phase-4-operations.md). 다른 매체 백업·첫 실패 키 식별/폐기도 대기.
- pnpm12.14.0 / Node24.13.1 / Python `.venv`. PowerShell: `$env:COREPACK_HOME=Join-Path (Get-Location) '.cache/corepack'`.
- 로컬 UI: `pnpm run dev:ui`(5173), 빌드 후 `pnpm run preview:ui`(4173). 자동 회귀: `pnpm run check:deferred`; 4173 충돌 시 소유 확인 후 재사용 여부 판단. 유료 API·키 변경은 별도 범위 결정 전 실행 금지.
