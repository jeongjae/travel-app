# travel-app 현재 상태

2026-10-22 · 실행계획 갱신 · Phase 0 코드 작업 미착수

## 현재

- 순서: [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). [전체 점검](status-review-2026-10-22.md)은 판단 배경이다.
- P-01~P-06: 대표 가상 데이터 구현·검증. P-07: 파리 Day 28~30 실제 추출·후보까지. P-08: 잠정 판정.
- 실제 표본: 31파일 추출, 콘텐츠 후보 105개. `packageReady=false`; 실제 이행 ZIP·사용자 DB 적용·사용자 화면 확인은 아직 없다.
- 차단: XLSX, 미디어, 지역/언어/현장 상태, 전체 필드 대응, Notre-Dame Fact 근거. 미디어 46 variants 바이트 미확보. [P-07 상세](p07-report.md).
- PC 웹 실제 데이터 검증 우선 → 전체 이행 → iPhone Chrome → v2 AI. iPhone 시점은 Phase 1 종료 때 재판단한다. 이미지 바이트는 DB, 콘텐츠는 참조다.
- 이번 변경: 실행계획, AGENTS 규칙, 결정·문서 이력 정리. 코드 포맷·의존성 설치·DB 변경·커밋·push·배포는 실행하지 않았다.

## 검증과 제약

- 최근 실행 증거: [pnpm 전환 검사](pnpm-transition.md) `check` 110/110·타입/빌드, E2E 30/30(PC 15+모바일 viewport 15), `check:pilot` 통과. 이번 문서 작업에서는 재실행하지 않았다.
- iPhone Chrome 실기기·실제 전체 데이터·용량/메모리·원격 CI는 미검증. [P-08 판정](p08-report.md). v2 AI는 실제 호출 미구현이며 v1 성공과 구분한다.
- 작업 시점 Git은 전부 untracked. 프로세스 상세 CIM 조회는 권한 제한, Get-Process에서 node/python 결과 없음. 포트·브라우저 DB는 미확인; 서버가 동작한다고 가정하지 않는다.

## 다음 작업과 사용자 관문

1. Phase 0 코드 작업 착수 지시 후 현재 데이터·프로세스·제외 경로/복구 기준점을 확인한다.
2. Prettier·ESLint·구조 개선을 분리한다. 대표 코드 전후와 실제 파일을 열어 가독성을 보여준다. **G0: 사용자 포맷 결과 확인 전 Phase 1 진입 금지.**
3. G0 이후 실제 3일의 차단 해소 → ZIP → 검증 DB → PC 화면·편집·기록·복원. **G1: 사용자가 PC 표본 화면을 직접 확인해야 완료.**
4. 이후에도 매 단계 실제 산출물과 사용자 확인이 필요하다. 현재 G0~G4 모두 미실행. 공개 저장소 유지가 push·앱 배포 승인을 뜻하지 않는다.

## 실행·기록

- pnpm 12.14.0 / Node 24.13.x / 프로젝트 Python `.venv`. 잠금 파일·프로젝트 캐시 사용. UI 개발 `pnpm run dev:ui`(5173), 미리보기 `pnpm run preview:ui`(빌드 후 4173).
- 코드 변경 후 `pnpm run check`; UI/저장 변경 후 빌드·`pnpm run test:e2e`; 변환/환경 변경 후 `pnpm run check:pilot`. 포맷/린트 명령은 Phase 0 연결 예정.
- 상세는 단계 보고서, 이력은 [과거 handoff](history/handoff-2026-10.md)·[이전 계획](history/development-plan-2026-10.md). 과거 ‘최신’ 절을 누적하지 않는다(50줄·2,500자 이내).
