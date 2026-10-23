# travel-app 현재 상태

2026-10-23 · **G1 확인 대기(SP-FR UI/UX 보정 후)**

## 현재

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). [사용자 대기 목록](development-plan.md#사용자-결정실행-대기-항목)은 계획 한 절에서 관리한다.
- 사용자 확정: 가능한 SP-FR UI/UX를 살린다. 오늘·전체 일정·가이드·지도·준비, 첫/다음 일정·예약·시간표, 가이드 목차·같은 날짜 복귀를 구현했다. [대조·남은 차이](phase-1-uiux.md).
- 원본 읽기 토큰·이미지 카드·지역 우선 탐색을 적용했다. 여행/계획/원천 도구는 접고 저장소·백업은 상단 오른쪽에 항상 표시한다. PC도 하단 탐색이며 원본과 완전 동일한 화면은 아니다.
- 실제 표본 3일/18활동/15이동/10장소, 콘텐츠245개·미디어46+대응표1파일이다. DB/OPFS·기존 사용자 검토 프로필을 보존했다. 전체43일 이행은 아직이다.
- 사용자 지시: 작업 단위별 커밋·GitHub push. `0856f90` 결정/계획, `54d4263` UI/검사 코드를 origin/main에 반영했다. 실제 자료·키는 제외했다. 앱 공개 배포는 하지 않았다.

## 검증·보존

- `check`: 포맷/린트/타입·119/119·PWA 빌드. E2E38/38(PC19+모바일19). 실제 원천/DB 전체 행·47파일 해시, 편집 재조회·오프라인 기록·빈 저장소 전체 복원 통과.
- PC1504×1040/모바일390×844의 탐색 전후 DB 지문 동일·오류/가로 넘침0. 원본과 새 화면을 직접 대조했다. 원본 사이트 DNS 실패로 배포 HTML/CSS를 정적 렌더한 것이며 원본 동적 지도 검증은 아니다.
- 근거: `local-data/p07/phase1-28-30/uiux-browser-04/`, `uiux-check/`, `uiux-reference/`; 사용자 창 `user-review-final/uiux-ready.json`. 실제 원문·화면·파일·프로필은 Git 제외다.
- 원격 CI는 기능 commit의 push 실행이 queued임을 확인했다. 로컬 통과와 구분한다. iPhone Chrome·전체 이행·v2 API·다른 매체 백업·첫 실패 키 식별/폐기는 미완료다.

## 다음 작업·실행

1. 최신 Chromium의 기존 검토 프로필에서 [PC 확인 안내](phase-1-pc-review.md)를 따라 UI/UX와 편집/기록/백업을 확인한다. 기존 데이터 초기화·재가져오기는 하지 않는다.
2. G1 사용자 확인 전 Phase 2로 가지 않는다. G1 뒤 전체 확대 전 iPhone 1차 필요·접속/파일 전달 범위를 재판단한다. G0는 ‘가독성 충분함’으로 확인 완료다.
- 4173은 이 저장소 Vite preview(PID20340)를 소유 확인 후 재사용했다. 재개 시 상태를 다시 확인한다.
- pnpm12.14.0 / Node24.13.1 / Python `.venv`. `$env:COREPACK_HOME = Join-Path (Get-Location) '.cache/corepack'` 후 pnpm 실행.
- 코드: `pnpm run check`; UI/저장: 빌드·`pnpm run test:e2e`; 변환: `pnpm run check:pilot`. 사용자 창 재실행은 PC 안내를 따른다.
