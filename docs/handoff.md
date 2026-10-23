# travel-app 현재 상태

2026-10-23 · **G1 확인 대기(백업 메뉴 수정 후)**

## 현재

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). [사용자 대기 목록](development-plan.md#사용자-결정실행-대기-항목)을 한 절에서 관리한다.
- G0: 사용자 ‘가독성 충분함’ 확인 완료. I-7 포맷·린트 재발 방지 유지. [Phase 0](phase-0-report.md).
- Phase 1: 실제 31입력 파일 → 3일/18활동/15이동/10장소, 콘텐츠 245개, `packageReady=true`. 미디어 46+대응표 1파일. [실행 보고](phase-1-report.md)·[P-07](p07-report.md).
- 실제 ZIP/격리 DB 전체 행·47파일 해시 일치, 편집·오프라인 기록·빈 저장소 전체 복원 통과. 평소 사용자 DB와 기존 원천은 보존했다.
- 이미지 기준은 ‘앱 화면에서 조회·점검’. 작성자는 OPFS 파일+DB 참조를 선택했다. 큰 대응표는 파일 자산, import_packages만 4 MiB·일반 행 512 KiB 예산이다.
- 사용자 ‘저장소·백업 메뉴가 없다’ 수정 요청 처리: 메뉴를 왼쪽 상단으로 이동하고 고정 창 높이를 제거했다. 기존 창에서 저장 후 Ctrl+Shift+R·새 버전 열기로 재확인한다. [PC 안내](phase-1-pc-review.md).
- 사용자 화면 확인 전 Phase 2로 가지 않는다. 43일/9지역 후속 작업표는 `local-data/p07/phase1-28-30/regional-batches.md`. G1 뒤 확대 전 iPhone 1차를 앞당기는 안 추천.

## 검증·보존

- 메뉴 수정 후 `check` **119/119**·포맷/린트/타입/PWA 빌드, E2E **36/36**(PC 18+모바일 viewport 18), 실제 창의 메뉴→47파일 백업 화면 통과. 변환의 기존 `check:pilot` 통과 유지.
- 실제 검사 `local-data/p07/phase1-28-30/browser-07/`; ZIP/보고 `final-07/`; 사용자 프로필 `user-review-final/`. 실제 원문·첨부·화면은 Git 제외.
- 기존 46파일·Phase 0의 환경 포함 47파일 해시 동일. `backup/phase1-2026-10-23/`의 273파일 ZIP·Git bundle(코드 `3c51a66`) 검증. 환경 파일 포함 비공개 사본이며 같은 디스크다. 다른 매체 백업은 미완료.
- 외부 근거 없는 Fact는 검토 필요. 코드/XLSX 같은 제목 예약은 출처별 대조본으로 보존. 표본 밖 상태/필드는 다음 배치 보류이며 전체 이행 제외가 아니다.
- 미검증: G1, iPhone Chrome·기기 용량/메모리·파일 앱, 전체 43일, 원격 CI·v2 실제 API·공개 배포. 첫 실패 키는 식별/폐기 미완료, 현재 키 보존·API 호출 없음.

## 다음 작업·실행

1. `http://127.0.0.1:4173/?workspace=content&review=phase-1`의 수정 메뉴·백업/복원을 사용자가 재확인한다. 기존 프로필은 보존했다. G1은 아직 확인 완료가 아니다.
2. G1 뒤 실기기 시점·접근/파일 전달 범위를 판단하고 지역별 이행을 시작한다. 과거는 [이력](history/handoff-2026-10.md)·[G0 종료 인계](history/handoff-phase0-g0-2026-10-23.md).
- 4173 기존 Vite preview(PID 20340)를 소유 확인 후 재사용했다. 재개할 때 포트·프로세스를 다시 확인한다. worktree·push·배포 없음.
- pnpm 12.14.0 / Node 24.13.1 / Python `.venv`. `$env:COREPACK_HOME = Join-Path (Get-Location) '.cache/corepack'` 후 pnpm 실행.
- 코드 변경 후 `pnpm run check`, UI/저장 변경 후 빌드·`pnpm run test:e2e`, 변환 변경 후 `pnpm run check:pilot`. 브라우저 재실행 명령은 PC 안내 참조.
