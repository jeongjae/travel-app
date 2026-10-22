# pnpm 전환 후 재개 검증

2026-10-22 · 사용자가 node_modules/잠금 파일 전환 후 작업 재개를 요청했다.

## 확인·보완한 항목

- 기존 사용자 변경을 보존했다. node_modules/.modules.yaml의 packageManager는 pnpm@12.14.0이며 pnpm-lock.yaml이 있고 package-lock.json은 없다.
- package.json의 packageManager를 설치된 12.14.0으로 고정했다. 이 값이 없을 때 Corepack이 latest 조회를 시도해 제한 환경에서 실패했던 문제를 해결한다. 임의 최신 버전으로 올리지 않았다.
- build/check/check:pilot의 하위 npm 호출, Playwright의 preview 기동, README/AGENTS의 현재 명령, CI를 pnpm으로 맞췄다. CI는 setup-node 다음 Corepack 활성화/고정 버전 준비와 `pnpm install --frozen-lockfile`을 사용한다. 과거 보고서의 npm 실행 기록은 역사적 증거로 보존한다.
- pnpm의 의존성 격리에서 PWA 가상 모듈의 `workbox-window`가 해석되지 않는 실제 빌드 실패를 발견했다. 잠금 파일에 이미 있던 7.4.1을 명시적 개발 의존성으로 추가해 해소했다. 호이스팅을 느슨하게 바꾸지 않았다.
- 오프라인 add 첫 시도는 캐시 메타데이터 누락으로 실패했다. 같은 고정 버전의 일반 add는 정책 검증을 통과했다. 이후 `pnpm install --frozen-lockfile --offline`도 통과했다. 전역 pnpm store를 이동하거나 node_modules를 다시 삭제하지 않았다.

## 검증

- `pnpm --version`: **12.14.0**, Node **24.13.1**.
- 최종 `pnpm run check`: **110/110**, 타입/프로덕션/PWA 빌드 통과. P-07 가상 회귀 2개를 추가했다.
- `pnpm run test:e2e`: **30/30**(PC 15+모바일 15). pnpm으로 UI 전용 preview를 기동해 오프라인/백업·복원/현장 기록을 회귀 검증했다.
- `pnpm run check:pilot`: native Node·Python 3검사·별도 브라우저 번들 통과. 원격 GitHub CI는 미실행이다.
- 재개 시 기본 샌드박스 실행기가 경로 오류로 시작되지 않아 호스트 실행을 사용했다. 기존 포트 5173/4173/8787 리스너가 없음을 확인했고, E2E가 자신의 4173 preview를 시작/정리했다. 소유 불명 프로세스를 종료하지 않았다.

이번 pnpm 보완은 사용자 전환·재개 지시에 따른 기술 구현이다. 실제 AI 호출·여행 데이터 적용·worktree/커밋/push·공개 배포는 하지 않았다.
