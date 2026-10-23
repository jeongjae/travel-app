# travel-app 현재 상태

2026-10-23 · **Phase 2 B-01 Barcelona 사용자 확인 대기**

## 현재

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). [사용자 대기 목록](development-plan.md#사용자-결정실행-대기-항목)을 한 절에서 관리한다.
- G0·G1 사용자 확인 완료. SP-FR 탐색·읽기 경험 보존을 유지한다. 사용자 ‘계속 진행’으로 B-01 Barcelona Day1~3을 이행했다. [실행 보고](phase-2-report.md)·[B-01 확인 안내](phase-2-b01-review.md).
- B-01: 33입력 파일→3일/17활동/14이동, 일정 연결9·장소/주제22, 콘텐츠383개, 미디어51+대응표1파일. 독립 본문12·없는10을 구분하고 원천 밖 설명/방문을 만들지 않았다.
- 검토 창은 `?workspace=content&review=phase2-b01`, 새 프로필 `local-data/phase2/b01-barcelona/user-review/`. 기존 파리 프로필·기본 DB는 보존했다. B-01 확인 전 다음 지역으로 가지 않는다.
- `83df7f4` 착수 계획, `0fd47b8` 배치/명부·Fact·첨부·검증 도구를 origin/main에 push했다. 실제 자료·키·백업은 Git 제외. 앱 배포/worktree/실기기 접속은 하지 않았다.

## 검증·보존

- `check`: 포맷/린트/타입·123/123·PWA 빌드. E2E38/38(PC19+모바일19), `check:pilot` 통과. Fact84개 독립 원천 대조, DB 전체 행·52파일 해시·편집 재조회/오프라인 기록·빈 저장소 전체 복원 통과.
- PC1504×1040/모바일390×844 탐색·날짜/장소 복귀·지도/준비, 탐색 전후 DB 지문 동일·오류/가로 넘침0. 원본 정적 HTML/CSS와 직접 대조했으며 동적 지도 검증은 아니다.
- 기존 원천34파일·G1 ZIP 해시 동일. 기존 G1 전체 행/47파일·오프라인 복원 호환 통과. 새 WebP는 검증 바이트로 MIME를 식별한다.
- 근거: B-01 `input-01/`, `final-02/`, `browser-03/`, `uiux-check/`, `reference/`; 기존 호환 `local-data/phase2/g1-compat-01/`; 로그 `.cache/phase2/`. 사용자 산출물과 자동 검사 사본은 분리했다.
- 전체 목록은 카드43파일·코어9지역·명부166ID·본문162파일·Fact195항목이다. 서로 다른 분모이며 전체 바이트/이행 검증은 아니다. iPhone Chrome·전체 이행·v2 API·다른 매체 백업·첫 실패 키 폐기는 미완료. 원격 CI 성공은 미확인이다.

## 다음 작업·실행

1. 열어 둔 Chromium에서 B-01을 확인받고 수정 요청을 처리한다. 확인 후 다음 지역을 선정한다. 현재 G2 전체/실기기 완료가 아니다.
2. PC 우선 유지. U-04의 iPhone 접속·파일 전달 결정 전 기기 접속/배포를 시작하지 않는다.
- 4173은 이 저장소 Vite preview(PID20340)를 확인해 재사용했다. 재개 시 상태를 다시 확인한다.
- pnpm12.14.0 / Node24.13.1 / Python `.venv`. `$env:COREPACK_HOME = Join-Path (Get-Location) '.cache/corepack'` 후 pnpm 실행.
- 코드: `pnpm run check`; UI/저장: 빌드·`pnpm run test:e2e`; 변환: `pnpm run check:pilot`. 배치 재실행·검토 명령은 B-01 안내를 따른다.
