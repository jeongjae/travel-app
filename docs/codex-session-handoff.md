# Codex 역할 세션 인계 · 2026-11-13

Codex 역할(계획·검증·병합)을 이어받는 세션이 읽는 문서다. 11/11 인계([history](history/codex-session-handoff-2026-11-11.md))를 대체한다. 현재 상태는 [handoff.md](handoff.md), 결정은 [decisions.md](decisions.md), 열린 항목은 [change-log.md](change-log.md) CL 표.

## 1. 역할 (사용자 지시 11/09: Claude 대화 세션이 Codex 역할을 대신한다)

- **Codex 역할 세션**: 작업 지시서 작성, Claude 결과 독립 검토(검토서 `docs/claude-task-<id>-review.md`), 결정 기록, change-log·handoff 관리, **main 병합·push·Pages 확인·PC main 참조 갱신**, Worker 배포 관문 판정. 결함은 직접 고치지 않고 수정 지시(R1…)로 돌린다. 문서·CI 설정은 직접 고친다.
- **Claude Code(사용자 PC)**: 구현·시험·스크린샷·결과 문서, `codex/<id>` 브랜치 push, `wrangler deploy`(로그인된 PC에서만).
- **사용자**: 결정, 관문 알림, 비밀값 입력, 동의 단추 클릭, 확인 완료.
- 확인 상태는 `검토 준비 / 확인 대기 / 수정 요청 / 확인 완료`. 시험 통과·무응답은 확인 완료가 아니다. **결정은 `decisions.md`에 기록돼야 유효**(Claude 세션에서 사용자가 직접 답한 결정도 사후 기록).
- **11/12 예외(범위 미확정)**: 사용자가 실제 호출 시험 중 드러난 미비를 Claude가 직접 고치도록 지시했고, 검토 전 브랜치 배포도 승인했다. 이번 1건인지 T-D5 남은 기간 전체인지 사용자 확인 대기. 확정 전에는 "멈춤 보고 → Codex 수정 지시"가 기준이다. Claude가 먼저 고친 경우 Codex는 사후 검토하고 main을 운영과 맞춘다.
- 토큰 절약: 결과 문서 요약 → 데이터 경계 diff → 위험 diff → CI로 안 잡히는 것만 독립 검사. 시험 재실행은 보통 하지 않고 코드·시험 단언을 정독한다.

## 2. 한 사이클

1. 지시서 `docs/claude-task-<id>-<name>.md` 작성 → main 커밋·push. 사용자가 Claude Code에 한 줄로 전달(전달 문구를 함께 준다).
2. Claude 완료 보고(사용자가 붙여 넣음) → `git fetch` → `git diff origin/main...<head> --stat -- src/contracts src/storage src/transfer src/repository.ts` = **0건** → `gh run list -b <branch>`로 CI → 위험 파일 정독.
3. 검토서 작성(판정 통과/조건부/반려). 조건부면 R 지시 → Claude → 확인 절 추가.
4. 통과: `decisions.md`·`change-log.md`(CL 표 + 처리 이력 1줄)·`handoff.md`(50줄·2,500자, 이전본 `docs/history/`) 갱신 → 브랜치에 push → main fast-forward(브랜치가 뒤면 먼저 main을 브랜치에 병합) → push → `travel-app checks`·`Publish travel-app to GitHub Pages` 성공 확인 → PC `git fetch; git branch -f main origin/main`.
5. 상태 기록은 프로젝트 문서(`claude/status-review-…`)에도 남긴다.
6. main push 1회마다 CI·Pages가 약 15분씩 돈다. 작은 문서 기록은 다음 검토 커밋에 모은다.

## 3. 환경과 함정

| 항목 | 내용 |
|---|---|
| 권한 | 세션 시작 시 **GitHub push**(`add_repo jeongjae/travel-app push` → `git clone --depth 1` → `register_repo_root`), **PC 폴더 연결**(`device_request_folder_access` — 연결돼 있지 않을 수 있다), **PC 삭제 권한**(`device_request_delete_permission` — 날이 바뀌면 다시 요청해야 했다). 사용자 지시: 부족한 권한은 승인 요청한다 |
| 클라우드 클론 | 얕은 클론. 브랜치는 `git fetch --depth=150 origin +refs/heads/X:refs/remotes/origin/X`. 커밋은 `-c user.name="Jason-jeongjae" -c user.email="jeongjae.kim@bankwareglobal.com"` + 세션 attribution 줄 |
| PC git | `$HOME/mnt/travel-app`. fetch가 `.git/objects/*/tmp_obj_*`·`maintenance.lock`을 남기면 삭제 권한 뒤 `find … -delete`·`rm -f`. 작업 트리·stash는 건드리지 않는다 |
| 프록시 | `github.io`·저장소 변수 API 접근 불가. Pages 번들 확인은 Claude Code가 한다 |
| CI | `travel-app checks` 1 job이 check·check:pilot·test:e2e 순차 실행. Pages 워크플로가 경쟁 조건으로 1회 실패하면 `gh run rerun --failed` |
| PC 로컬 check | Windows에서 Node 서버 시험 간헐 실패(CL-36). CI 통과면 판정에 영향 없음 |
| Worker 운영 | `https://travel-app-ai.jeongjae-kim.workers.dev`, 버전 `c5bc2d69…`(롤백 `b3720c46…`). `--env production` 필수. DAILY_LIMIT 20, 월 $10 하드 리밋, preview URL 끔 |
| `wrangler tail` | `Ok`는 "잡히지 않은 예외 없음"일 뿐 200이 아니다(401·400·409도 Ok). 성공 여부는 화면이 증거 |
| 실제 호출 | 사용자가 동의 단추를 직접 누른다. 가상 여행은 검토 공간 `?workspace=content&review=<이름>`. 실제 패키지·백업은 `local-data/`(gitignore), 본문·사진은 어디에도 기록하지 않음 |
| 문서 | 저장소 안은 LF. `handoff.md`는 Python으로 고친 뒤 `wc -lm`으로 50줄·2,500자 확인 |
| 사용자 선호 | 설명은 간단명료, 기술 용어에 짧은 풀이, 불명확하면 먼저 질문. iPhone 점검은 Chrome 기준 |

## 4. 현재 진행 (11/13 10:30)

| 항목 | 상태 | 다음 |
|---|---|---|
| T-D5 C1(두 번째 패스키·작업 목록·officialUrl·관측) | 검토 통과·병합·배포 | — |
| T-D5 C2 iPhone 실기기 | G-D·G-P·G-B 통과, U1~U6 사용자 통과 보고 | U3·U4 기록 처리·U5 만료는 보고 없음 → 근거표에서 미검증 |
| T-D5 C3 실제 여행 호출 | **마감(사용자 11/12)**: 4회·$0.15, 실패 1(형식) | 미보고: 미리보기 항목 수, 1회차 거절, 2단계 원복(추가 항목 삭제), 작업 상태, `d05-real` 삭제 |
| 수정 `a3fcac5`(형식 실패 재작성) | Codex 사후 검토 통과, main 병합, 운영 배포 | 운영에서 재작성 경로가 실제로 돈 사례 없음 |
| **11/13 iPhone 시험 결과** | 사용자가 Claude Code에 전달함. **저장소에는 아직 없다**(브랜치 최신 `d78c0b7` 11/12 16:28) | Claude 보고·push를 받아 검토. 코드 수정이 들어오면 §1 예외 규칙으로 사후 검토 |
| T-D5 C4 종료 근거표 | 미작성(`docs/d-phase-closeout.md` 없음) | [C2~C4 지시](claude-task-d05-c2-iphone.md) §4 → Codex 검토 → 사용자 G3 |
| U4 사용자 재수행 | 대기(10월부터 이월) | CL-20·REG-02 종결 |
| CL-39 AI 방식 개편 | D 단계 뒤 | 입력: CL-42·43·44·45. 그 전까지 AI 기능 확장 동결 |

**사용자 확인 대기 4건**: ① "Claude 직접 수정" 범위 ② C1 검토의 Codex 판단 2건(관측값 유지, CL-40 수용) ③ iPhone 평소 공간에 2단계 추가 항목이 남아 있는지(삭제 원복 보고 없음) ④ PC 평소 공간 "계획 2 · 오후에 1시간 커피시간…" 표기 — 사용자는 "들어가지 않았다"고 확인했으나 사유 문구가 AI 변경안과 같아 종료 판정 때 화면으로 한 번 더 본다.

## 5. 최근 판단 요약 (근거는 각 검토서)

- T-D1~T-D4(11/6~11): [11/11 인계](history/codex-session-handoff-2026-11-11.md) §5.
- T-D5 C1(11/11): 통과. 재인증 없는 패스키 추가·삭제는 수용(CL-40). 운영 DO 열 추가·iPhone QR 패스키·iOS 교차 출처 로그인은 실기기에서 확인됨.
- T-D5 C3(11/12): 실제 응답이 형식 검사에서 실패했는데 원인이 남지 않았다 → 위치 코드만 남기는 재작성으로 수정. 품질 불만(길이 0·겹침, 장소 없는 활동 미조사)은 고치지 않고 개편 입력으로 넘김.
- 교훈: 사용자 단계는 "통과" 한마디로 끝나기 쉽다. 관문(G)에 필요한 값만 2~3개 물어 확정하고, 나머지는 "보고 없음"으로 적어 통과로 쓰지 않는다. 실제 비용 단계에서는 사용자가 속도를 위해 순서를 바꿀 수 있으니, 사후 검토와 main-운영 일치를 Codex가 챙긴다.
