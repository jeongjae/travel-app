# Codex 역할 세션 인계 · 2026-11-11

Codex 역할(계획·검증·병합)을 이어받는 세션이 읽는 문서다. 11/05 인계([history](history/codex-session-handoff-2026-11-05.md))를 대체한다. 현재 상태는 [handoff.md](handoff.md), 결정은 [decisions.md](decisions.md), 열린 항목은 [change-log.md](change-log.md) CL 표.

## 1. 역할 (사용자 지시 11/09: Claude 대화 세션이 Codex 역할을 대신한다)

- **Codex 역할 세션**: 작업 지시서 작성, Claude 결과 독립 검토(검토서 `docs/claude-task-<id>-review.md`), 결정 기록, change-log·handoff 관리, **main 병합·push·Pages 확인·PC main 참조 갱신**, Worker 배포 관문 판정. 결함은 직접 고치지 않고 수정 지시(R1…)로 돌린다. 문서·CI 설정은 직접 고친다.
- **Claude Code(사용자 PC, Sonnet)**: 구현·시험·스크린샷·결과 문서, `codex/<id>` 브랜치 push, `wrangler deploy`(로그인된 PC에서만).
- **사용자**: 결정, 관문 알림(G1 "비밀값 설정 완료" 식), 비밀값 입력, 동의 단추 클릭, 확인 완료.
- 확인 상태는 `검토 준비 / 확인 대기 / 수정 요청 / 확인 완료`. 시험 통과·무응답은 확인 완료가 아니다. **결정은 `decisions.md`에 기록돼야 유효**(Claude 세션에서 사용자가 직접 답한 결정도 사후 기록).
- 토큰 절약: 결과 문서 요약 → 데이터 경계 diff → 위험 diff → CI로 안 잡히는 것만 독립 검사. 시험 재실행은 보통 하지 않고 코드·시험 단언을 정독한다.

## 2. 한 사이클

1. 지시서 `docs/claude-task-<id>-<name>.md` 작성 → main 커밋·push. 사용자가 Claude Code에 한 줄로 전달.
2. Claude 완료 보고(사용자가 붙여 넣거나 첨부) → `git fetch` → `git diff origin/main <head> --stat -- src/contracts src/storage src/transfer src/repository.ts` = **0건** → `gh run list -b <branch>`로 CI → 위험 파일 정독.
3. 검토서 작성(판정 통과/조건부/반려). 조건부면 R 지시 → Claude → 확인 절 추가.
4. 통과: `decisions.md`(결정)·`change-log.md`(CL 표 + 처리 이력 1줄)·`handoff.md`(50줄·2,500자, 이전본 `docs/history/`) 갱신 → 같은 커밋으로 브랜치에 push → main fast-forward(아니면 `--no-ff` 병합) → push → `travel-app checks`·`Publish travel-app to GitHub Pages` 성공 대기 → PC `git fetch; git branch -f main origin/main`.
5. 상태 기록은 프로젝트 문서(`claude/status-review-…`)에도 남긴다.

## 3. 환경과 함정

| 항목 | 내용 |
|---|---|
| 권한 | 세션 시작 시 **GitHub push**(`add_repo jeongjae/travel-app push` → 사용자 승인 → `git clone --depth 1` → `register_repo_root`)와 **PC 삭제 권한**(`device_request_delete_permission`)을 받는다. 사용자 지시: 부족한 권한은 승인 요청한다 |
| 클라우드 클론 | 얕은 클론. 브랜치는 `git fetch --depth=80 origin +refs/heads/X:refs/remotes/origin/X`. 커밋은 `-c user.name="Jason-jeongjae" -c user.email="jeongjae.kim@bankwareglobal.com"` + 세션 attribution 줄 |
| PC git | `$HOME/mnt/travel-app`. fetch가 `.git/objects/*/tmp_obj_*`·`maintenance.lock`을 남기면 삭제 권한 뒤 `rm -f`. 작업 트리·stash는 건드리지 않는다. `git checkout --`는 분류기가 거부함(사용자 직접) |
| 프록시 | `github.io`·저장소 변수 API 접근 불가. Pages 번들 확인은 Claude Code가 한다. Worker 주소는 `pages.yml`에 직접 기재 |
| CI | `travel-app checks` 1 job이 check·check:pilot·test:e2e 순차 실행 = "3종". Pages 워크플로는 배포 전 자체 E2E를 돌려 경쟁 조건으로 1회 실패할 수 있음 → `gh run rerun --failed`. 러너 `ubuntu-24.04` 고정 |
| PC 로컬 check | Windows에서 Node 서버 시험 6~13건 간헐 실패(CL-36). CI 통과면 판정에 영향 없음 |
| Worker 운영 | `https://travel-app-ai.jeongjae-kim.workers.dev`, `--env production` 필수(기본 환경 이름은 `-dev`). 비밀값 3종은 사용자가 `wrangler secret put`. DAILY_LIMIT 20, 월 $10 하드 리밋, preview URL 끔 |
| 실제 호출 | 사용자가 동의 단추를 직접 누른다. 가상 여행은 검토 공간 `?workspace=content&review=<이름>`. 실제 패키지는 `local-data/`(gitignore), 본문·사진은 어디에도 기록하지 않음 |
| 문서 | `change-log.md`·`handoff.md` CRLF. Python으로 읽어 쓰면 보존됨 |

## 4. 현재 진행 (11/11 16:50)

| 항목 | 상태 | 다음 |
|---|---|---|
| T-D5 C1 (두 번째 패스키·작업 목록 CL-38·officialUrl CL-26·관측 보강) | Claude 구현 중, `codex/d05-iphone-real` | 보고 → 검토(데이터 경계 0건, §C officialUrl이 4경로를 건드리면 멈춤 보고 확인) → 병합 → Claude 재배포 |
| T-D5 iPhone 실기기·G-P·G-B | C1 병합 뒤 사용자 수행 | 대본 `docs/d05-iphone-script.md`(Claude 작성) |
| T-D5 실제 여행 호출 | G-T 확정(43일 여행·날짜 제한 없음·기록 미포함·2단계 적용은 지울 수 있는 추가 1건) | ≤6회·$1. 멈춤 조건은 지시서 §3 |
| T-D5 종료 판정 준비 | `docs/d-phase-closeout.md` G-03~07 근거표 | 판정은 사용자(G3) |
| U4 사용자 재수행 | 대기(10월부터 이월) | CL-20·REG-02 종결 |
| CL-39 AI 방식 개편 | D 단계 뒤 | 그 전까지 AI 기능 확장 동결 |

## 5. 최근 판단 요약 (근거는 각 검토서)
- T-D1(11/6~9): 구현자 자체 검토가 두 번 Codex 검토로 오인 전달됨 → 역할 분리 재확인. R1~R7, 만료 라벨.
- T-D2(11/9): Worker·패스키·DO 저장소. `aiV2JobLimits` 분리 수용.
- T-D3(11/10): inflight·ACK→acknowledged·tick 격리·등록 잠금.
- T-D4(11/10~11): 첫 공개 배포. CORS `X-Travel-App` 실결함을 배포 전 발견. 가상 여행 5회 $0.12. 빈 title add → R2 서버 검증.
- 교훈: 지시서는 결과 상태로 쓴다. 사용자 단계(U)와 Claude 단계(C), 관문(G)을 분리하면 실제 돈·공개가 걸린 단계도 안전하게 돈다.
