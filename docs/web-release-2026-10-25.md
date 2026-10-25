# iPhone 웹 접속용 GitHub Pages·사전 릴리스

2026-10-25 · **배포 준비 중**

사용자의 GitHub 커밋/릴리스·iPhone 웹 접속 요청에 따라 공개 앱 셸을 GitHub Pages로 배포한다. 실제 여행 자료·예약·키·사용자 백업은 공개 사이트/릴리스 자산에 넣지 않는다.

## 배포 대상

- 웹 주소: `https://jeongjae.github.io/travel-app/`.
- 릴리스 태그: `v0.1.0-preview.1`. 단위별 커밋과 앱 빌드 ZIP·체크섬을 제공한다. 전체 이행·실기기·AI 실행 검증이 남은 사전 릴리스다.
- 기본 진입은 여행 가이드다. 기존 화면은 `?workspace=legacy`로 명시적으로 연다. `/travel-app/`의 JS/CSS·아이콘·가상 샘플·PWA 시작 주소/범위를 맞춘다.
- 기기 DB·첨부 파일은 해당 브라우저에 저장한다. PC와 iPhone, Chrome과 Safari의 데이터가 자동 공유되지는 않는다. 정적 사이트에는 AI 실행 서버가 없으며 불필요한 API 요청을 하지 않는다.

## iPhone에서 사용

1. Chrome에서 웹 주소를 연다. 앱 화면만 먼저 보려면 ‘가상 여행 둘러보기’를 선택한다.
2. 실제 여행은 PC의 `local-data/phase2/continuous-10/full/package/pilot.zip`을 iCloud Drive 등 본인이 관리하는 경로로 iPhone 파일 앱에 복사한다. 이 파일은 GitHub 공개 릴리스에 올리지 않는다.
3. 웹 앱의 ‘여행 선택·가져오기 → 여행 패키지 선택’에서 해당 ZIP을 고르고 미리보기 후 ‘여행에 추가’를 누른다. 같은 브라우저와 웹 주소를 계속 사용한다.
4. 가져온 뒤 일정·본문·사진을 열고 ‘저장소·백업’에서 별도 백업을 만든다. 실제 비행기 모드·종료/재실행·파일 재선택/복원은 [실기기 절차](phase-2-prime-runbook.md)에 따라 확인한다.

## 준비·검증 상태

배포 전 기존 GitHub CI 실패2건을 확인했다. 새 `StageAiProposal` 명령의 입력 사례와, 차단에서 보존으로 바뀐 메모 변환의 기대값을 보완했다. 관련 계약·변환 검사57개는 통과했다. 전체 이행·기기 검증을 이 결과로 대신하지 않는다.

포맷·린트·타입, 정적 배포 빌드와 HTML 자산·manifest 경로·개인 경로 제외를 확인한다. 원격 배포·공개 URL·브라우저 기본 동작 결과는 실제 확인 후 갱신한다. 기존 PC preview/사용자 DB는 유지하며 배포 빌드는 `.cache/pages-dist/`로 분리한다.

구성 근거: [Vite GitHub Pages 배포](https://vite.dev/guide/static-deploy.html), [GitHub Pages 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
