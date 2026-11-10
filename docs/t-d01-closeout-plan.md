# T-D1 종결 통합 지시 — R5 → Codex 검토 → 병합 → UI 복원

작성 2026-11-06 17:55 · 개정 11-09 10:45(stash 실체 반영) · **개정 11-09 12:00(R5 완료, Codex 의뢰문 확정)**

T-D1을 끝까지 마무리하는 단일 문서다. 단계마다 **담당·전달 문구·붙일 블록·완료 판정**을 적었다. 사용자는 각 단계의 블록을 해당 에이전트에 전달하고, 보고를 받으면 다음 단계로 넘긴다.

## 전체 흐름

| 단계 | 담당 | 내용 | 완료 판정 | 11-09 12:00 상태 |
|---|---|---|---|---|
| 1 | Claude Code | R5: AI 출력 24시간 보존 + 작업 트리 정리 | push 완료, 보고 수신 | **완료** — `bd6c7bb`, `bed2e18`. 원격 CI는 미확인(2단계 절차 1에서 확인) |
| 2 | Codex | 독립 검토 1회 → `claude-task-d01-review.md` 교체 | 판정 통과 또는 조건부(R6…) | **진행 차례** |
| 2′ | Claude Code → Codex | (조건부일 때만) R6… 수정 → Codex 확인 절 추가 | Codex "해소" 기록 | — |
| 3 | Codex | change-log·handoff·decisions 갱신 → main 병합 → push → Pages·checks 확인 → PC main 갱신 | main에 반영, 배포 성공 | 대기 |
| 4 | Claude Code | stash pop + 미추적 UI 파일 4건을 새 브랜치에 모음 | 작업 트리 복원, check 통과 | 대기 |
| 5 | 사용자 | 실데이터 확인(B4), Gemini 로그인 | 기록 | 대기 |
| 6 | Codex | T-D2 지시서 초안 | 발행 | 대기 |

**확정된 사용자 결정** (각 블록이 참조한다): D-1 되돌리기 T-D2 이월 · D-2 이동 시각 추정 유지, leg 시각 필드 없음 · 야간 일정 허용(12시간 상한) · R3 (a) 요청 원문·고른 기록 미저장 · R5 AI 출력 완료 후 24시간 보존, 조회 인증은 T-D2.

**전 단계 공통 금지**: 저장 스키마·백업 형식 변경, `src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts` 변경, SP-FR 원본·manifest·실제 여행 데이터·사진 커밋, Claude 작업 중 브랜치에 Codex 커밋, stash@{0}과 미추적 UI 파일 4건을 4단계 전에 건드리는 것.

**PC 작업 트리 메모(11-09)**: `docs/u4-sapporo-scenario.md`(Obsidian 표 구분선 공백)·`docs/claude-task-d00-result.md`(파일 모드)에 미커밋 변경이 있다. 내용 변경 없음 확인. 되돌리기(`git checkout -- 두 파일`)는 자동 실행이 거부돼 사용자가 직접 실행한다. 브랜치·검토·병합에는 영향 없음.

---

## 1단계 — Claude Code: R5 (완료)

지시서 `docs/claude-task-d01-r5.md`. 결과: `bd6c7bb` fix(R5) — `server/ai-v2-jobs.ts`에 `outputRetentionMs`(24시간, 한 곳), 끝난 지 24시간 지난 작업의 result·error 문구를 서버 시작 시와 create() 시에만 제거, 시험 7건(수정 전 4 실패). `bed2e18` docs — 결과 문서 §R3, .gitignore 3줄, 지시서 사본. 데이터 경계 0건. check exit 0, E2E 181 통과·5 skip. 원격 CI 미확인.

Claude가 지목한 검토 포인트: 만료 시 awaiting-decision → failed 전환 / 만료 문구는 서버 error 필드, 화면 E2E 없음 / 브라우저 무영향 시험은 구조 확인만.

---

## 2단계 — Codex: 독립 검토

전달 문구: **"아래 의뢰로 T-D1 독립 검토를 수행한다."**

```
T-D1 수정본(R1~R5)의 독립 검토를 의뢰한다. 역할·절차는 docs/codex-session-handoff(11/05) §1~§2를 따른다.
토큰 절약 원칙: 결과 문서 → 위험 diff → CI로 확인되지 않는 것만 독립 검사. 결함은 수정 지시(R6…)로 돌린다.

## 대상
- 브랜치: codex/d01-send-semantics, head bed2e18. main(c678390) 미병합.
- 커밋: 45ce310, abc311c(T-D1 본체) · d126e61(R1) · 6d48bfa(야간) · 7266546(R2) · 6366e8d(R3) · 5ceaaea(R4) · f2558c3(야간 저장소 시험) · 800f209(문서) · bd6c7bb(R5 구현+시험) · bed2e18(R5 문서·.gitignore·docs/claude-task-d01-r5.md)
- 지시서: docs/claude-task-d01-*.md (R5는 docs/claude-task-d01-r5.md)
- 결과 문서: docs/claude-task-d01-result.md (§6 후속, §R3 저장 필드 전후 표 + 보존 24시간)
- Claude 자체 검토서: docs/claude-task-d01-review.md — "Codex 독립 검토 아님" 표기. Codex 검토서로 교체한다.
- Claude 보고(R5 시점): check exit 0, E2E 181 통과·5 skip, 데이터 경계 4경로 0건. 원격 CI는 Claude도 미확인 — 절차 1이 첫 관문.
- 사용자 결정(11/06): D-1 되돌리기 T-D2 이월 / D-2 이동 시각 추정 유지, leg 시각 필드 없음 / 야간 일정 허용(12시간 상한) / R3 (a) 요청 원문·고른 기록 미저장 / R5 AI 출력 완료 후 24시간 보존, 조회 인증은 T-D2.

## 절차
1. 원격 CI(checks 3종: check·check:pilot·test:e2e) bed2e18 결과. 실패면 여기서 멈추고 보고. skip 5건 사유 기록.
2. 데이터 경계: `git diff c678390 bed2e18 --stat -- src/contracts src/storage src/transfer src/repository.ts` = 0건.
3. 재현 시험이 "수정 전 실패"를 실제로 잡는지 — ai-v2-windows / overnight / day-times / job-retention / confirmations에서 수정 코드를 되돌렸을 때 실패하는지 1~2건 표본. R2 E2E 2건은 수정 전 실패 기록이 없으므로 단위 7건이 같은 결함을 덮는지 확인.
4. 아래 검토 항목.
5. docs/claude-task-d01-review.md 교체. 판정: 통과 / 조건부(R6…) / 반려.

## 검토 항목
A1. R1 — 이동 1회 오전 도착 / 오후 출발 / 이동 2회 / 이동 뒤 활동 없음 / 이동 없음 5경우 시험 존재. "구간 미합침" 코드 보장.
A2. 야간 — 23:00~00:30 허용, 다음 날 첫 활동 겹침 거부, 09:00~08:00 거부. 종료 날짜 다음 날 기록이 스키마 변경 없이 되는지.
A3. R2 — 비운 입력은 전송 본문에 키 자체가 없음을 단언. 화면값=전송값 단언 채운/비운 모두.
A4. R3 — toStoredJob 허용 목록이 저장·응답 양쪽을 지나는지. 시작 시 정리가 형식 불변. §R3 전후 표와 코드 일치.
A5. R4 — 확인 표시가 활동 ID에 묶이고 revision 변경 시 지워짐. "체크하지 않은 항목 적용 경로" 코드 재확인.
A6. R5 — server/ai-v2-jobs.ts outputRetentionMs(24시간, 한 곳). 끝난 지 24시간 지난 작업의 result·error 문구를 서버 시작 시와 create() 시에만 제거. 새 필드·스키마 변경 없음. 자동 재요청 없음. 확인할 것:
   (a) GET /api/ai/v2/jobs/{id} 응답에서도 result가 빠지는지(저장만 지우고 응답은 캐시에서 내는 경로가 없는지).
   (b) awaiting-decision(변경안 대기) 작업을 만료 시 failed로 바꾸는 선택 — Claude가 검토 요청. 사용자가 아직 결정하지 않은 변경안이 24시간 뒤 실패로 바뀌면 화면에서 어떻게 보이는지, "만료"와 "실패"가 구분되는지. 구분이 안 되면 R6 후보.
   (c) 만료 문구가 서버 error 필드로만 전달되고 화면 E2E가 없음 — 화면이 기존 오류 표시로 그 문구를 그대로 보여주는지 코드로 확인.
   (d) 재시작으로 중단된 작업은 updatedAt부터 24시간 — 완료 시각이 없는 작업의 기준 시각으로 타당한지.
   (e) "브라우저 적용 결과 무영향" 시험은 서버가 브라우저 저장소를 건드리지 않는 구조 확인만이다(실제 저장소 통합 시험 아님). 충분한지 판단.
B1. followingDay(지시서 외) — 날짜·첫 시각·도착 시각만, 제목·내용 없음을 시험으로. 허용 목록 한 곳.
B2. jobs 조회 무인증 — T-D2 이월(결정). 기록만. 24시간 안 노출 필드를 결과 문서와 대조.
B3. "이동 구간 제약 끄기"(지시서 외) — 저장 위치, 새로고침·백업·복원 후 유지 여부(미유지면 문서 명시), 고정 활동 겹침 검증까지 끄지 않는지.
B4. 추정 규칙 경계(오후 출발일 도착지 활동 거부) — D-2 비용. "사용자 실데이터 확인"으로 기록만.
B5. 구형식 결과 폐기 — 로컬 개발 자료만, 브라우저 사용자 데이터 무영향 코드 확인.
B6. 두 번 저장 유지 — 기록만.
C1. 결과 문서 §정정, §R3 보존 24시간·인증 T-D2.
C2. §후속 5건: D-1·officialUrl 입력 경로·사유 JSON 노출·rename EPERM·jobs 조회 인증.
C3. .gitignore 3줄(.obsidian/, travel-app/, research_notes/) 포함 확인. PC 작업 트리의 u4-sapporo-scenario.md·claude-task-d00-result.md 미커밋 변경은 Obsidian 공백·파일모드만 — 브랜치 무관, 기록만.

## 미검증(그대로 옮긴다)
실제 OpenAI 응답 호환 · 실제 여행 데이터 필드·추정 규칙 적합성 · iPhone 실기기 · 로컬 Node 서버 HTTP 경로(단위만) · 적용 중간 실패 화면(단위만) · 만료 문구 화면 표시(E2E 없음)

## 판정 뒤
- 통과: 3단계(병합·배포)로. 블록은 사용자가 별도 전달.
- 조건부: §수정 지시 R6…를 결과 상태 문장으로 쓴다("하나만", "키가 없다" 식). 사용자가 Claude에 전달.
- 반려: 사유와 함께 멈춘다. 사용자 결정.
```

**2′ (조건부일 때)**: Codex 검토서의 R6… 절을 그대로 Claude Code에 전달 — "`docs/claude-task-d01-review.md` §수정 지시 R6…를 수행. 같은 브랜치에 push. 병합·handoff·stash 금지." → Claude 보고 → Codex가 검토서에 "확인" 절 추가 → 3단계.

---

## 3단계 — Codex: 병합·배포

전달 문구: **"T-D1 검토 통과. 병합·배포를 수행한다."**

```
T-D1 병합·배포. 인계 §2-5 절차.
1. docs/change-log.md: T-D1 항목(R1~R5 포함), 후속 5건(D-1·officialUrl·사유 JSON·rename EPERM·jobs 인증)을 T-D2 후보로. CRLF 보존.
2. docs/decisions.md: D-1 T-D2 이월 / D-2 추정 유지·leg 시각 필드 없음 / 야간 일정 허용(12시간 상한) / R3 (a) / R5 24시간 보존·인증 T-D2 — 사용자 결정(11/06)으로 기록.
3. docs/handoff.md: docs/history/에 사본 → 갱신(50줄·2,500자 이내, CRLF). 현재 상태 = T-D1 main 반영, 다음 = UI 작업 복원(Claude) → T-D2. 미추적 UI 파일 4건이 PC 작업 트리에 있음을 한 줄 명시.
4. main 병합: fast-forward 가능하면 ff. 아니면 브랜치에 main을 병합해 CI 재확인 뒤 병합. push.
5. Pages·checks 워크플로 성공 확인. deployment.json 일치.
6. PC main 참조 갱신(git fetch; git branch -f main origin/main). PC 작업 트리·stash·미추적 파일은 건드리지 않는다.
7. 보고: main 해시, 배포 URL 상태, handoff 갱신 요지.
```

**다음 단계로 넘기는 조건**: main 해시와 Pages 성공이 보고에 있다.

---

## 4단계 — Claude Code: UI 작업 복원

전달 문구: **"T-D1이 main에 병합됐다. UI 작업을 복원한다."**

```
# UI 작업 복원
전제: stash@{0}에는 docs/handoff.md 1줄만 있다. UI 설계 문서·스크린샷은 미추적 파일로 작업 트리에 있다.
1. git fetch; main 참조가 origin/main과 같은지 확인. 다르면 멈추고 보고.
2. main에서 새 브랜치 codex/ui-resume(Codex와 합의한 이름이 있으면 그것)을 만든다.
3. git stash pop. handoff.md 1줄이 Codex가 3단계에서 갱신한 handoff.md와 충돌하면 stash 쪽을 버리고(Codex 갱신본이 최신) 그 1줄 내용을 보고에 적는다.
4. 미추적 UI 파일 4건을 git add로 추적에 올린다(커밋은 하지 않는다):
   - docs/claude-task-ui01-day-retro.md
   - docs/design/commercial-ui-design.md
   - docs/design/commercial-ui-development-plan.md
   - docs/design/ui-review-2026-11-06/ (스크린샷 6장 + concept.html)
   docs/status-review-2026-10-26.md와 Obsidian 흔적(.obsidian/, travel-app/, research_notes/)은 추가하지 않는다.
5. pnpm run check 실행. 실패가 있으면 원인을 보고하고 고치지 않는다 — UI 작업은 별도 지시서에서 이어간다.
6. 커밋하지 않는다. 작업 트리 상태(스테이징 파일 목록, stash 비움 여부, check 결과)만 보고한다.
```

**완료 판정**: stash 비움, UI 파일 4건 스테이징, check 결과 보고. 이후 UI 작업은 Codex가 지시서로 발행.

---

## 5단계 — 사용자

| 항목 | 내용 | 기록 위치 |
|---|---|---|
| 실데이터 확인(B4) | 평소 공간에서 오후 출발일·장거리 이동 2회 날이 몇 날인지, 그날 AI 제안이 거부되는지 | Codex에 보고 → T-D2 지시서 반영 |
| Gemini CLI | Google 로그인 | — |
| 사용자 확인 상태 | T-D1 결과를 실제로 써 본 뒤 "확인 완료 / 수정 요청" | Codex가 검토서에 기록 |

---

## 6단계 — Codex: T-D2 지시서 초안

후보 범위(우선순위는 사용자 확정): ① 앱 rename EPERM ② jobs 조회 인증 ③ 부분 적용 되돌리기 ④ 사유 JSON 표시 정리(UI 복원 뒤) ⑤ officialUrl 입력 경로 ⑥ 5단계 실데이터 확인 결과에 따른 추정 규칙 보정 ⑦ (A6(b) 결과에 따라) 만료/실패 상태 구분.

---

## T-D1 종결 판정

아래가 모두 참이면 T-D1 종결로 기록한다.
- [ ] Codex 검토서 판정 통과(조건부면 해소 확인 포함)
- [ ] main 병합·Pages 배포 성공
- [ ] decisions.md에 결정 5건 기록
- [ ] handoff.md 갱신
- [ ] stash 복원 + 미추적 UI 파일 4건 스테이징, 작업 트리 정상
- [ ] 사용자 확인 상태 기록(시험 통과·무응답은 확인 완료가 아니다)
