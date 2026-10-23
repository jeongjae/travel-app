# travel-app 현재 상태

2026-10-23 · **G1 수정 중 · SP-FR UI/UX 보정·GitHub 단위 반영**

## 현재

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). [사용자 대기 목록](development-plan.md#사용자-결정실행-대기-항목)은 계획 한 절에서 관리한다.
- G0 가독성 사용자 확인 완료. G1은 백업 메뉴 수정 후 SP-FR 경험 보존 요청을 반영 중이다. [UI/UX 보정](phase-1-uiux.md)·[Phase 1 보고](phase-1-report.md).
- 사용자 확정: 가능한 SP-FR UI/UX를 살린다. 오늘·전체 일정·가이드·지도·준비, 첫/다음 일정·예약·시간표, 가이드 목차·일정 복귀·원본 읽기 토큰을 보정한다.
- 사용자 지시: 작업을 나눠 커밋하고 GitHub에 push한다. 문서 결정과 기능/검증을 분리한다. 원격은 origin의 jeongjae/travel-app, main이며 최초 확인에서 원격 브랜치는 없었다.
- 실제 표본은 3일/18활동/15이동/10장소, 콘텐츠245개·미디어46+대응표1파일이다. DB/OPFS·기존 사용자 프로필과 평소 저장소는 보존한다. 전체43일 이행은 아직이다.

## 검증·보존

- 이번 보정 중 형식/린트·119개 단위·PWA 빌드 통과. 이후 작은 보정의 최종 검사와 38개 E2E·실제47파일/전체 복원 재검증은 진행 중이다. 이전 통과를 최종 결과로 쓰지 않는다.
- 원본 고정 commit은 `35498adc6413dad45922f2dab87781afeb04d898`. 원본 사이트 DNS 실패로 GitHub 배포 HTML/CSS의 정적 렌더를 대조했다. 원본 동적 지도·JavaScript 실검증은 아니다.
- 실제 원문·ZIP·화면·프로필은 `local-data/`, 백업은 `backup/`의 Git 제외 경로다. 기존9커밋에서 키·기기 경로 패턴이 없고 배포 ZIP은 가상 픽스처임을 확인했다.
- 기존 데이터 해시·로컬 백업은 [Phase 1 보고](phase-1-report.md)에 있다. 다른 매체 백업·첫 실패 키 식별/폐기·iPhone Chrome·전체 이행·v2 API·앱 공개 배포는 미완료다.

## 다음 작업·실행

1. 문서 결정 단위를 커밋·push하고 화면/검증 단위를 최종 검사해 별도 커밋·push한다. 강제 push·worktree·앱 배포는 하지 않는다.
2. 보정한 실제 화면을 다시 제시해 G1을 확인한다. 사용자 확인 전 Phase 2로 넘어가지 않는다. [PC 안내](phase-1-pc-review.md)는 검증 종료 때 메뉴 경로를 갱신한다.
- 4173은 이 저장소의 Vite preview(PID20340)를 소유 확인 후 재사용한다. 재개 시 상태를 다시 확인한다.
- pnpm12.14.0 / Node24.13.1 / Python `.venv`. `$env:COREPACK_HOME = Join-Path (Get-Location) '.cache/corepack'` 후 pnpm 실행.
- 코드: `pnpm run check`; UI/저장: 빌드·`pnpm run test:e2e`; 변환: `pnpm run check:pilot`. 실제 3일과 사용자 프로필 위치는 PC 안내를 따른다.
