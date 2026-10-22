# travel-app 현재 상태

2026-10-22 · Phase 0 포맷·검증 실행 · G0 사용자 확인 대기

## 현재

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md) 순서로 읽는다. [사용자 대기 목록](development-plan.md#사용자-결정실행-대기-항목)은 한 절에서 관리한다.
- Phase 0: Prettier·ESLint·로컬 기준 커밋·검증 자료 준비. **G0 가독성 확인 대기, Phase 1 미착수.** [실행 보고](phase-0-report.md)·[코드 전후 비교](phase-0-readability.md).
- 커밋: 기준 `54d7959`, 포맷 `3a23044`, ESLint `6042fa3`. 구조 리팩터링·원격 push·배포는 하지 않았다.
- P-01~P-06: 가상 표본 구현. P-07: 실제 파리 3일의 31파일 추출·105콘텐츠 후보. `packageReady=false`, 실제 이행 ZIP/사용자 DB 적용 없음. [P-07](p07-report.md)·[잠정 P-08](p08-report.md).
- 실제 원천 차단: XLSX·첨부·지역/언어/현장 상태·전체 필드·Fact 근거. 46 variants 바이트 미확보.
- PC 실제 표본 → 전체 이행 → iPhone Chrome → v2 AI. 실기기 시점은 Phase 1 끝에 재판단한다.
- 이미지 의도는 기기 파일+링크. DB 바이트와 같다는 해석 철회, [방식 재점검](media-storage-review.md) 후 선택. Phase 0에서 저장 구조는 바꾸지 않았다.

## 검증·보존

- 2026-10-22 최종 `pnpm run check`: 포맷·린트·110/110·타입/빌드 통과. E2E 30/30(PC 15+모바일 viewport 15), `check:pilot`·frozen/offline 설치 통과.
- 포맷 63파일 대조, ESLint 61파일 구문 대조·압축 코드 거부 확인. 원천/환경 등 기존 실제 파일 47개 SHA-256 동일, dist 키 누출 없음.
- `backup/phase0-2026-10-22/`에 비공개 ZIP·manifest·Git bundle. `backup/`은 Git 제외. 같은 디스크의 복구 사본이며 다른 매체 백업은 미완료.
- 첫 실패 키는 미폐기·같은 날 생성해 구분 어려움. 현재 키를 보존하며 식별 전 삭제하지 않는다. 실제 API 호출 없음.
- 실제 원천 UI·iPhone Chrome·용량/메모리·원격 CI는 미검증. 이번 브라우저 검증은 별도 context의 가상 표본이다.

## 다음 작업·실행

1. **사용자가 코드 전후 비교와 실제 파일의 가독성을 확인한다(G0).** 수정 요청이면 Phase 0에서 보완한다. 보고서만으로 다음 단계에 진입하지 않는다.
2. G0 이후 Phase 1: 이미지 방식 선택·실제 3일 차단 해소 → ZIP/검증 DB → **PC 표본 화면 직접 확인(G1)**.
- 로컬 UI 미리보기 `http://127.0.0.1:4173/?workspace=content` 실행 중. AI 서버는 시작하지 않았다. 다음 작업 시작 때 실제 포트/프로세스를 다시 확인한다.
- pnpm 12.14.0 / Node 24.13.1 / Python `.venv`. pnpm 캐시/store는 `.cache/pnpm/`, 이번 Corepack 캐시는 `.cache/corepack/`.
- `pnpm run format`, `pnpm run lint`; 코드 변경 후 `pnpm run check`, UI/저장 변경 후 빌드·`pnpm run test:e2e`, 변환 변경 후 `pnpm run check:pilot`.
- 상세는 보고서, 과거는 [handoff 이력](history/handoff-2026-10.md)·[이전 계획](history/development-plan-2026-10.md). 현재 문서는 50줄·2,500자 이내로 교체 갱신한다.
