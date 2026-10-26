# iPhone 웹 접속용 GitHub Pages·사전 릴리스

2026-10-25 · **공개 HTTPS 배포 완료 · 사용자 확인 대기**

2026-10-26 후속: 출처 경로 수정 `c5b6c0e` push 후 [Pages 자동 배포](https://github.com/jeongjae/travel-app/actions/runs/40255564148)가 성공했다. 기존 사전 릴리스 태그/자산은 그대로 보존한다. 현재 iPhone 전달 대상은 `local-data/phase2/verified-package-20261026/pilot.zip`이며 [실제 PC 검증·기기 진행](full-verification-2026-10-26.md)을 따른다. 아래 10/25 배포 검증과 구버전 파일 안내는 당시 이력이다.

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

포맷·린트·타입, 정적 배포/PWA 빌드, HTML 자산·manifest 경로·개인 경로 제외를 통과했다. 기존 PC preview/사용자 DB를 유지하고 배포 빌드는 `.cache/pages-dist/`로 분리했다.

- `eee01ff`: 계약·메모 변환 기대값 보완, `71b31bd`: 정적 앱/Pages 기능, `00a546a`: 모의 변경안 E2E에 AI 상태 응답 추가. 모두 origin/main에 push했다. 태그는 `00a546a4408b036538b2f6f738ccd699e707ded9`를 가리킨다.
- [Pages 실행](https://github.com/jeongjae/travel-app/actions/runs/40151051669)은 성공했다. 공개 HTML·manifest·서비스워커·deployment.json은 HTTPS 200이며 배포 커밋이 태그와 일치한다.
- 첫 원격 회귀는 `check`·`check:pilot`을 통과했으나 E2E36/38이었다. 실제 앱 결함 대신 모의 변경안 검사에서 새 AI 상태 응답을 준비하지 않아 502가 발생했다. `00a546a`에서 해당 조회를 모의 응답으로 격리했으며 로컬 실패 사례2/2가 통과했다. 최종 [원격 CI](https://github.com/jeongjae/travel-app/actions/runs/40151025915)는 전체 성공했다. `check`(13파일·123단위 검사/포맷/린트/타입/빌드)·`check:pilot`·PC/모바일 E2E38/38을 통과했다.
- Browser plugin not available: 해당 Browser 플러그인/skill이 없어 프로젝트 Playwright·기존 캐시 Chromium을 사용했다. 기본 브라우저 프로필은 건드리지 않았다.
- 공개 URL의 별도 새 브라우저에서 PC1504×1040·모바일390×844로 `첫 화면 → 가상 여행 → 미리보기 → 여행에 추가 → 저장소·백업 → 닫기`를 확인했다. 제목/본문·오류 overlay 없음·JS/CSS/ZIP 로딩·PWA scope를 통과했다. 콘솔 오류·실패 응답·가로 넘침은0이었다. 변경안 화면의 AI 미연결 안내가 보이며 API 요청0건이었다. 서비스워커 준비 후 온라인 재읽기로 활성화하고 오프라인 재실행해 가상 여행 재조회를 양쪽 크기에서 통과했다. 모바일 크기는 실제 iPhone 결과가 아니다.
- 화면/원시 결과는 Git 밖 `C:/Users/NB-24021500/.codex/visualizations/2026/10/22/01a1613b-c347-75e2-8548-92803623031d/pages-*.png`, `pages-smoke-result.json`에 보관했다.

## 릴리스 자산과 잔여 확인

[사전 릴리스](https://github.com/jeongjae/travel-app/releases/tag/v0.1.0-preview.1)는 2026-10-25 10:35 KST에 공개했고 앱 전용 ZIP392,870바이트와 `SHA256SUMS.txt`를 제공한다. ZIP SHA-256은 `e4622823b150df326bd9a2cd51076c797c61b908acceba0beea63599ddc89961`이다. 개인 여행 ZIP은 공개 자산에 포함하지 않았다. 공개 다운로드2개는 HTTP200·파일 길이/ZIP SHA-256 일치를 확인했다.

전체43일 실데이터의 DB 적재·독립 원천 대조·실제 iPhone 파일 선택/OPFS/오프라인/복원·유료 AI 호출은 미검증이다. 사용자 확인 상태는 **확인 대기**다. 웹 배포 성공을 G2·G2′·G3 완료로 확대하지 않는다.

구성 근거: [Vite GitHub Pages 배포](https://vite.dev/guide/static-deploy.html), [GitHub Pages 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
