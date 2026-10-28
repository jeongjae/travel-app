# Claude T-02 결과 · Pages 배포 전 회귀 검사 강제

2026-10-28 · **구현·원격 CI 통과(브랜치) / Codex 검토 대기 / 사용자 확인 검토 준비** · main 미반영·실제 배포 미실행

## 요약

- Pages `build`가 같은 커밋의 `pnpm run check`·`check:pilot`·`test:e2e` 전체(재사용 workflow `checks.yml`)에 `needs`로 의존한다. 실패·취소·생략이면 build·deploy가 건너뛰어진다.
- 시작 `48b9d22`(main) → 종료 `fa3871f`(`codex/t02-pages-gate`). 비교: https://github.com/jeongjae/travel-app/compare/main...codex/t02-pages-gate
- 변경 파일: `.github/workflows/checks.yml`(신규), `ci.yml`, `pages.yml`. 제품 코드·의존성·Action 버전·비밀값·권한 설정 변경 없음.
- 원격 CI(브랜치 push): https://github.com/jeongjae/travel-app/actions/runs/40646226413 — `test / checks` 성공(3m38s). 브랜치 push로 Pages workflow는 실행되지 않았다.
- **미검증**: 필수 검사 실패·취소가 build/deploy를 막는 GitHub 런타임 실행. main 실제 배포 성공. 아래 §4.

## 1. 대안 비교(선택 A)

| | A. 재사용 workflow + `needs` (선택) | B. pages.yml에 검사 단계 직접 복제 |
|---|---|---|
| 같은 SHA | 호출한 workflow의 `github.sha`로 검사·빌드 모두 checkout | 같은 job이면 동일, 분리하면 직접 맞춰야 함 |
| 중복 | 검사 정의 1곳(ci·pages 공유) | ci와 pages에 같은 단계 2벌, 어긋날 위험 |
| 권한 | 검사 job은 `contents: read`만 | 한 job에 pages 쓰기 권한이 섞이기 쉬움 |
| 단점 | main push에서 ci.yml과 pages.yml이 각각 검사를 실행(검사 2회) | 동일 |

"다른 실행의 최신 성공"을 참조하는 `workflow_run` 방식은 SHA 보장이 약해 비교하지 않았다.

## 2. 실행 그래프와 판정

```
ci.yml    (push/PR 전체 브랜치) : test ─ uses checks.yml
pages.yml (push main + paths / workflow_dispatch):
  checks (main만) ─needs→ build (main만, pages:write) ─needs→ deploy (pages:write, id-token:write)
```

| 상황 | checks | build | deploy |
|---|---|---|---|
| main push·모두 성공 | 성공 | 실행 | 실행 |
| 검사 단계 하나 실패 | 실패 | 건너뜀 | 건너뜀 |
| 취소 | 취소 | 건너뜀 | 건너뜀 |
| 토픽 브랜치 push/PR | pages.yml 미실행(push 대상 main만). ci.yml만 검사 | — | — |
| 토픽 브랜치 workflow_dispatch | `if` 불충족으로 건너뜀 | 건너뜀 | 건너뜀 |

`always()`·`continue-on-error` 없음(정적 검사로 확인). 건너뛴 need는 후속 job을 기본 규칙으로 건너뛰게 한다.

## 3. 변경 요점

- `checks.yml`(workflow_call): 기존 ci.yml의 단계와 명령 그대로. checkout에 `ref: ${{ github.sha }}` 명시.
- `ci.yml`: job id `test`는 유지, 본문은 `uses: ./.github/workflows/checks.yml`. 표시 이름이 `test / checks`로 바뀐다. 브랜치 보호가 옛 이름 `test`를 필수로 지정했다면 확인이 필요하다(저장소 설정은 읽거나 바꾸지 않았다).
- `pages.yml`: `checks` job 추가(`contents: read`), `build`에 `needs: checks`와 `github.ref == 'refs/heads/main'` 조건, checkout `ref: ${{ github.sha }}`. `checks.yml` 변경도 paths에 추가. build의 `format:check && lint`는 checks의 `pnpm run check`에 포함되어 제거(중복). `/travel-app/` base·`VITE_STATIC_HOSTING`·개인 자료 제외 검사·`deployment.json` SHA 기록·concurrency는 그대로.
- Prettier 검사 통과. `pages.yml`의 줄바꿈은 LF로 유지(.gitattributes 기준).

## 4. 검증 범위와 한계

- 정적(로컬): YAML 파싱, job 이름·`needs` 체인·`if`·권한(검사 job에 pages 권한 없음)·필수 명령 3개 포함·우회 키워드 없음.
- 원격: 브랜치 커밋의 ci.yml → 재사용 workflow 경로 실행 성공(필수 3개 명령 모두 통과). 재사용 호출 경로가 검사 경로에서 실제 실행됨을 확인.
- 미검증: 실패 주입 원격 실행(pages.yml은 main/기본 브랜치 dispatch 없이는 브랜치에서 실행할 수 없고, 요청에 따라 main 병합·dispatch·배포를 하지 않았다). 따라서 "실패 시 build/deploy 차단"은 workflow 구조(needs)에서 도출한 것이며 런타임 증거가 아니다.
- actionlint는 설치되어 있지 않아 사용하지 않았다(설치 금지).
- 로컬 `check:deferred` 등 전체 회귀는 반복하지 않았다(제품 코드 불변, 원격 CI가 같은 명령을 실행).
- 첫 main 병합 시 pages.yml이 `checks.yml` 변경 때문에 실행되어 배포가 일어난다. 병합 시점의 결정은 Codex/사용자 몫이다.
- 이 작업은 T-01 REG-01·사용자 화면 확인을 해소하지 않았다. T-03 미착수.

## 5. 증거 색인

- 커밋 `fa3871f`(workflow), 이 문서·handoff·잔여 목록은 후속 문서 커밋.
- CI 실행 로그: 위 run 링크(`gh run view 40646226413`).
