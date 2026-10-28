# Codex T-02 검증

2026-10-28 · 대상 `fa3871fb569b15632ea77d7596b44e558f63e015`·제출 `32788aa`

**구조 검토·main 필수 검사·성공 경로 배포 확인 / 실패 주입·사용자 화면 확인은 별도**

## 확인한 결과

- 변경은 workflow3개와 결과 문서다. 제품 코드·의존성·키·실제 데이터 변경은 없다.
- ci/pages가 같은 재사용 `checks.yml`을 호출하며 필수 `check`·`check:pilot`·`test:e2e`가 유지됐다.
- 검사·공개 빌드의 checkout 모두 `github.sha`를 명시한다. 별도 실행의 최신 성공이나 artifact를 가져오지 않는다.
- Pages의 `checks → build → deploy` 의존 관계와 main 조건을 diff에서 확인했다.
  `always()`·`continue-on-error` 우회가 없고 브랜치 dispatch도 build를 실행하지 않게 구성됐다.
- 검사에는 contents 읽기 권한만 있으며, Pages/토큰 권한은 기존 빌드·배포 job에만 있다.
- `/travel-app/` base·정적 호스팅·개인 자료 제외 검사·배포 SHA 기록·동시성 설정을 유지했다.
- Codex 독립 `pnpm exec prettier --check`의 workflow3개 문법/포맷 검사가 통과했다. `git diff --check`도 통과했다.
- [브랜치 CI](https://github.com/jeongjae/travel-app/actions/runs/40646226413)의 `test / checks` 성공과
  필수3개 명령의 성공을 GitHub 연결 도구로 재확인했다. 제품 회귀를 로컬에서 반복하지 않았다.

로컬 검증의 초기 시도에서 직접 YAML 모듈을 찾지 못했다. 새 설치 없이 프로젝트 Prettier로 문법/포맷을 검사했다.
기본 Corepack 경로의 다운로드 실패는 프로젝트 캐시 설정 후 재실행해 해소했다. 제품 실패로 분류하지 않는다.

## 반영 전 한계·확인 사항 (후속 반영 결과는 아래 참조)

- 실패·취소·생략 시 배포 차단은 의존 구조에 대한 판정이다. GitHub에서 실패를 주입한 실행 증거는 없다.
- main의 공개 빌드·업로드·배포는 실행하지 않았다. 따라서 실제 운영 적용 완료로 판정하지 않는다.
- CI 표시 이름이 `test`에서 `test / checks`로 바뀐다. 10/28 GitHub API 조회에서 main 적용 rules는 빈 배열,
  기존 protection 조회는 `Branch not protected`였다. 현재 필수 체크 이름 충돌은 확인되지 않았다. 설정은 변경하지 않았다.
  이후 보호 규칙이 추가되면 새 체크 이름과 맞춰야 한다.
- 병합 시 pages.yml/checks.yml 경로 변경이 공개 배포를 유발한다. 사용자 명시 승인 뒤 별도 반영 작업으로 수행한다.
- REG-01·T-01 사용자 화면·iPhone 복원·전체 G2/G2′/G3 확인은 별도 대기다.

## 검토할 산출물

[브랜치 비교](https://github.com/jeongjae/travel-app/compare/main...codex/t02-pages-gate)와
[Claude 결과](claude-task-02-result.md)의 그래프·상황별 표를 함께 확인한다.
main을 변경하지 않고 검토 가능한 결과다. 사용자 ‘완료’는 구현 제출 알림이며 배포 승인으로 기록하지 않는다.

## 사용자 승인 후 main 반영·배포 (2026-10-28)

- 사용자의 ‘배포하고 다음 단계 진행’ 요청에 따라 원격 main을 확인했다. 기존 main과 origin/main은 `48b9d22`로 같았다.
- 검토한 브랜치를 main `ac09ca04b8ceb583fc60ad4da509a3bd67fb3b63`로 fast-forward 반영·push했다. 충돌·강제 push 없음.
- [Pages 실행](https://github.com/jeongjae/travel-app/actions/runs/40648440929) success:
  `checks / checks` 4분15초 → 공개 build 20초 → deploy 11초 순서로 성공했다. 필수 check·pilot·E2E 모두 통과했다.
- 같은 SHA의 [main CI](https://github.com/jeongjae/travel-app/actions/runs/40648441108)도 success를 확인했다.
- 공개 앱 HTTP200, deployment.json의 전체 SHA 일치·staticHosting=true를 확인했다. HTML root 요소 존재를 확인한 것이며 추가 UI 실기기 검사로 보고하지 않는다.
- 앱/가상 표본만 배포했다. 제품 코드·의존성·개인 데이터·AI 서버 변경은 없었다.
- 이 성공 경로는 실패/취소 주입의 런타임 검증을 대신하지 않는다. T-01 사용자 확인·iPhone 복원·REG-01도 유지한다.
