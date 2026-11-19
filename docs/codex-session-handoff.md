# Codex 역할 세션 인계 · 2026-11-18

Codex 역할(계획·검증·병합)을 이어받는 세션이 읽는 문서다. 11/13 인계([history](history/codex-session-handoff-2026-11-13.md))를 대체한다. 현재 상태는 [handoff.md](handoff.md), 결정은 [decisions.md](decisions.md) 맨 위부터.

## 1. 역할

- **Codex 역할 세션(Claude 대화 세션)**: 지시서 작성, Claude Code 결과 독립 검토(`docs/claude-task-<id>-review.md`), 결정 기록, handoff 관리, **main 병합·push·CI/Pages 확인·PC main 참조 갱신**. git 명령은 이 세션이 직접 한다.
- **Claude Code(사용자 PC, Sonnet)**: 구현·시험·캡처·결과 문서, `codex/<id>` 브랜치 push.
- **사용자**: 결정, Claude Code에 전달, 화면 확인. 완료 보고를 이 대화에 붙여 넣는다.
- 앱 결함은 Codex가 고치지 않고 수정 지시(R)로 돌린다. 문서·CI 설정은 직접 고친다.
- 확인 상태 `검토 준비 / 확인 대기 / 수정 요청 / 확인 완료`. "통과" 한마디는 세부를 "보고 없음"으로 적는다. 제안·가정을 사용자 합의로 적지 않는다.
- 응답: `[상태] → [적용한 변경] → [다음 행동]`, 사실·해석·미확인 구분, 간단명료, 기술 용어에 짧은 풀이, Claude Code 전달 문구를 코드 블록으로 준다.

## 2. 한 사이클

1. 지시서를 main에 push → 전달 문구 제공.
2. 보고를 받으면: `git fetch -q --depth=200 origin +refs/heads/X:refs/remotes/origin/X` → 데이터 경계 diff(`src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts`) **0건** → 변경 범위 → `gh run list --branch X`로 CI → 위험한 diff 정독 → 캡처가 있으면 본다.
3. 검토 절 작성(통과/조건부). 조건부면 R 지시.
4. 통과: main을 브랜치에 병합 → 브랜치 push → main fast-forward → `decisions.md`(맨 위에 `## 날짜 시각 · 제목`)·`handoff.md`(**50줄·2,500자**, `wc -lm`) → push → CI·Pages 확인(각 약 15분, 30초 간격 `gh run list` 반복이 `gh run watch`보다 안정적) → PC `git fetch; git branch -f main origin/main`.
5. 프로젝트 문서 `claude/status-review-YYYY-MM-DD-HHMM.md`에 상태를 남긴다(사실/해석/미확인/다음 행동). 지시서 사본도 `claude/`에 올린다.

## 3. 환경과 함정

| 항목 | 내용 |
|---|---|
| 세션 시작 | `add_repo jeongjae/travel-app`(push) → `/home/claude/travel-app`에 얕은 클론 → `register_repo_root`. PC 폴더 `C:\Users\NB-24021500\Projects\travel-app` 연결 요청(`device_bash` 경로 `$HOME/mnt/travel-app`) |
| 커밋 | `-c user.name="Jason-jeongjae" -c user.email="jeongjae.kim@bankwareglobal.com"`, 메시지 끝에 세션 attribution 두 줄. push는 `git -c push.negotiate=true push origin HEAD:main` |
| PC git | fetch가 `.git/objects/maintenance.lock`을 남긴다. 삭제 권한 없이 `mv … .git/stale-…`로 치운다. 체크아웃된 브랜치가 main이면 `branch -f` 불가. 작업 트리는 건드리지 않는다 |
| 접근 불가 | `github.io`(배포 화면). 배포는 워크플로 성공까지만 확인하고 그렇게 적는다 |
| CI | `travel-app checks` 한 job(check → check:pilot → 전체 E2E). 11/18부터 chromium + **webkit** 설치. Claude의 PC 로컬 vitest 흔들림(서버 시험)은 CI에서 재현되지 않는다 |
| 자동 시험의 한계 | Playwright는 실기기 iPhone Safari의 날짜 입력 폭을 재현하지 못했다(R2-3 통과 → 실기기 겹침). iPhone 화면은 사용자 확인이 기준 |
| 문서 | LF. 파이썬으로 고치고 치환이 실제로 됐는지 확인한다 |
| 금지 | 실제 여행 데이터·백업·비밀값 커밋, 기존 여행 삭제, PC 평소 공간 DB·"Clear site data" |

## 4. 현재 진행 (11/18 14:30)

| 항목 | 상태 | 다음 |
|---|---|---|
| AI 개편 T-E1(새 여행 가져오기) | 확인 완료(G-E1 11/17) | — |
| T-P1(가이드 고르기) | 기능 확인 완료. R2 병합. 사용자: 단추 높이 OK, **U-3 숫자·U-4 길이는 확인 대기** | 사용자 확인 |
| T-P1 R3(iPhone 날짜 칸 겹침) | R3-1 `efc700a` 병합. **사용자 iPhone 확인 완료**(11/18 15:51), 한 줄 유지 확정 | — |
| T-E2 E2-A(기존 여행 고치기) | G-E2A 확인 완료(11/18). R1(추가·날짜 이동 활동을 시간순 자리에) `04990e0` **통과·병합**(11/19). [R2](claude-task-e02-review.md)(시각이 바뀐 활동도 옮긴다, 사용자 확정) 지시 | Claude R2(`codex/e02a-r2-time-move`) → 검토·병합. 사용자 R1·R2 화면 확인 |
| T-E2 E2-B(장소) | R2 보고 뒤 Claude가 바로 시작(`codex/e02b-places`, R2 브랜치 위) | 완료 보고 → 검토 → G-E2B |
| 이월 | U4 대본 v2 재수행(CL-20·REG-02), CL-46, Node 서버 정리, T-E3, P2 | [change-log](change-log.md) |

E2-A 검토 때 볼 것: [지시서](claude-task-e02-update-import.md) "A1 검토 뒤 보완" 5건, 완료 조건 표(AC), 빈 칸=변경 없음·`(비움)`=지움, 삭제는 삭제 구역만, 오래된 기준 차단, `ChangePlan` 1회, 실패 시 불변. Claude 보고(11/18): `CreateTrip`·`ImportNewTrip`을 뺀 거의 모든 저장이 `domainRevision`을 올린다(예외 `SaveProposal`·거절) — 복사 뒤 다른 저장이 있으면 붙여넣기가 막힌다는 점을 사용자에게 알렸다.

## 5. 최근 판단 요약

- 양식은 md 표, 앱이 AI 없이 읽는다(E0 시험). 새 여행에는 장소를 한 번에 못 넣어 메모 앞 `[장소: 이름]`으로 보존, 장소 생성은 E2-B.
- T-E2 사용자 확정(11/17~18): E2-A 먼저 / 내보낼 때 `[장소: X]`를 장소 칸으로 / 숙소 표 지역·예약 칸 비움 / 예약 메모 기본 제외 / 40,000자 넘으면 날짜 범위 권함.
- 교훈: ① 지시서의 규칙이 틀릴 수 있다(T-P1 "비슷한 항목") — 실제 자료로 확인한다 ② Claude가 "관련 E2E만" 돌렸다고 하면 CI 전체 결과를 반드시 본다(R3) ③ 새 시험 프로젝트를 추가하면 CI 설치 단계도 함께 본다.
