# Codex 세션 인계 · 2026-11-05

다음 Codex(계획·검증 담당) 세션이 이어받을 때 읽는 문서다. 현재 상태 요약은 [handoff.md](handoff.md), 결정은 [decisions.md](decisions.md), 후속 목록은 [change-log.md](change-log.md)에 있다. 이 문서는 **역할·작업 방식·환경 함정·진행 중 작업**만 다룬다.

## 1. 역할과 원칙 (사용자 지시)

- **Codex(이 세션)**: 작업 지시서 작성, Claude 결과 독립 검토, 계획·검증 문서 관리, 사용자 결정 기록, git push·main 병합·배포 실행(11/05 사용자 지시: "git 명령들은 네가 직접 수행하라").
- **Claude Sonnet(Claude Code 터미널, 사용자 PC)**: 앱 구현·시험·스크린샷·결과 문서. 지시서 하나를 끝까지 자율 수행하고 `codex/<id>` 브랜치에 커밋·push.
- Codex 토큰은 아낀다: 결과 요약 → 위험 diff(데이터 경계) → 필요한 독립 검사만. 결함은 직접 고치지 않고 수정 지시(`R1` 등)로 돌린다(문서·CI 설정은 Codex가 직접).
- 사용자 확인 상태(`검토 준비 / 확인 대기 / 수정 요청 / 확인 완료`)와 Codex 검토를 구분한다. 시험 통과·무응답은 확인 완료가 아니다.
- 금지: SP-FR 원본·manifest 수정, 실제 여행 데이터·백업·사진 커밋, Claude가 작업 중인 브랜치에 Codex 커밋, 사용자 평소 공간 데이터 임의 변경.
- 사용자 선호: 한국어, 간단명료, 기술 용어에 짧은 설명, 표 요약, 사실·해석·할 일 구분.

## 2. 작업 흐름 (한 사이클)

1. Codex가 `docs/claude-task-<id>-<name>.md` 지시서 작성 → main에 커밋·push(문서만이라 배포 안 됨).
2. 사용자가 Claude Code에 전달: "`docs/claude-task-….md` 수행. main에서 `codex/<id>-…`를 만들어 시작."
3. Claude 완료 보고 → Codex 검토:
   - `git diff <base> <head> --stat -- src/contracts src/storage src/transfer src/repository.ts` = 0건 확인(데이터 경계).
   - 위험 diff·스크린샷(`docs/design/…`) 확인.
   - 독립 검사: **GitHub CI 결과를 기본 근거로 쓴다**(check·check:pilot·전체 E2E가 실제 환경에서 돈다). 필요할 때만 클라우드 재현.
4. `docs/claude-task-<id>-review.md` 작성. 조건부면 §수정 지시 R1 → Claude 수행 → 확인 절 추가.
5. 통과 시 change-log·ui-polish-plan·handoff 갱신 → main 병합(가능하면 fast-forward) → push → Pages·checks 워크플로 성공 확인 → PC `main` 참조 갱신.

## 3. 환경과 함정

| 항목 | 내용 |
|---|---|
| 사용자 PC | `C:\Users\NB-24021500\Projects\travel-app` (device_bash에서 `$HOME/mnt/travel-app`). Windows PowerShell 5.1: `&&` 대신 `; if ($?) { … }` |
| PC git | **GitHub 자격 증명 없음**(push 불가). 커밋 시 `-c user.name="Jason-jeongjae" -c user.email="jeongjae.kim@bankwareglobal.com" -c core.safecrlf=false`. 삭제 권한이 없으면 `.git/*.lock`·`tmp_obj_*`가 남음 → `device_request_delete_permission`(세션마다 다시 요청) |
| push 방법 | 클라우드에서 `add_repo(jeongjae/travel-app, push)` → `git clone --depth 1` → `register_repo_root`. PC 커밋은 PC에서 `git bundle create local-data/x.bundle A..branch` → `device_stage_files` → 클라우드 `git fetch <bundle> branch:tmp` → `git push origin tmp:branch`. 끝나면 PC `git fetch; git branch -f main origin/main` |
| 클라우드 클론 | 얕은 클론이라 브랜치는 `git fetch --depth=300 origin +refs/heads/X:refs/remotes/origin/X`. 로컬 검토 브랜치는 upstream을 설정해 둔다(안 하면 stop hook이 "unpushed" 경고) |
| 클라우드 시험 | 별도 클론 `/home/claude/ta`(node_modules 설치됨, 컨테이너가 바뀌면 없음). Playwright 브라우저 리비전 불일치 시 `.cache/ms-playwright`에 1243→1248 심볼릭 링크. `pnpm run test:e2e`의 경로 `setInputFiles`가 이 환경에서 실패 → spec 앞에 버퍼 업로드 shim을 임시로 붙이고(`*.orig` 백업) 끝나면 되돌린다. 50MB 넘는 실제 pilot.zip은 시스템 Playwright(`/opt/npm-tools`)로 **경로** 업로드가 된다 |
| CI | `.github/workflows/checks.yml`·`pages.yml` 러너 `ubuntu-24.04` 고정(11/02 이후 `ubuntu-latest`=26.04에 Python 3.12.7 없음). main 이전에 갈라진 브랜치는 main을 병합해야 CI가 통과. Pages는 main의 `src/**` 등 변경 push 때만 배포 |
| Chrome 확장 | `jeongjae.github.io`에 접근 차단 상태가 반복됨(사이트 권한). 사용자가 별도 Claude 확장 세션으로 테스트하기도 함 → 같은 탭을 동시에 조작하지 않는다. 확장 파일 업로드 한도 10MB라 pilot.zip(84MB)은 사용자가 직접 선택 |
| 문서 줄바꿈 | `change-log.md`·`handoff.md`는 CRLF. Python으로 읽어 `\r\n` 보존해 저장. `handoff.md`는 50줄·2,500자 이내, 갱신 전 `docs/history/`에 사본 |
| 실제 패키지 | C-09 후보 `local-data/phase2/c09-candidate/package/pilot.zip` 84,446,537B `712369b3…2b0c`. 검토는 클라우드 검토 공간(`?workspace=content&review=<이름>`)에서만, 사진·본문 커밋 금지 |

## 4. 진행 중 작업 (11/05 15시 기준)

| 항목 | 상태 | 다음 |
|---|---|---|
| C-15 [파리 읽기 화면](claude-task-c15-paris-reading.md) | 지시 발행, 사용자 전달 전/구현 대기 | Claude 결과 → 검토. 핵심 확인: 데이터 경계, `tripDisplayName` 전수 적용 목록, 준비·회화 묶음 순서, 가이드 상세 목차·`⋯ 편집`, **43일 대표 사진 대조표**(출발역·빵집이 대표로 남은 날) |
| U4 사용자 재수행 | 대기 | [u4-user-check.md](u4-user-check.md) 사용자 기록 → CL-20 해소 처리 |
| 평소 공간 파리 확인 | C-15 배포 뒤 | 사용자 보고를 받아 REG-02 종결 여부 판단 |
| D 설계·계획 v0.2 | 사용자 검토 대기 | 사용자 요청 시 착수 |
| iPhone 실기기 | 대기 | 사용자 결정 |

브랜치: main `18bb853`(코드 = `4b43344`). 끝난 작업 브랜치(`codex/c08`~`c14`)는 main에 포함됐다. PC 체크아웃은 `codex/c14-paris-display`이며, C-15는 Claude가 main에서 새로 만든다.

## 5. 최근 판단 기록 (근거는 각 검토서)

- 11/04 C-12〔U3〕 통과, R1·R2 후속 → C-13. 11/05 C-13〔U4〕 통과(시험 간헐 실패 R1 보강) → main `ec6c461` 배포.
- 11/04 CI 실패 원인 = 러너 변경 → `a05dca8` 고정, main fast-forward·배포.
- 11/05 C-14 조건부 → R1(첫 화면 가져오기 입구 하나) → 통과, main `4b43344` 배포. CL-22 해소.
- 11/05 사용자 보고 3건(메모 제목·준비·회화·날짜 사진) 클라우드 재현 → C-15. REG-02를 표시 문제로 재분류.
- 교훈: 지시서 문구가 중복 UI를 허용하는 것으로 읽힌 적이 있다(C-14 P7). "하나만", "숨긴다"처럼 결과 상태로 쓴다. 표시 함수는 "적용 지점 전수"를 요구한다(C-14 P1 누락 → C-15 Q1).
