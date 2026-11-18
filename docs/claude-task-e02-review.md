# T-E2 Codex 검토

지시: [claude-task-e02-update-import.md](claude-task-e02-update-import.md) · 결과: [claude-task-e02-result.md](claude-task-e02-result.md)(브랜치에 있음)

## E2-A A1 내보내기 변환 (2026-11-18 11:10) — **통과, A2~A4 진행**

대상 `codex/e02a-update-import` `3405766`(main `d286a45` 기준, 커밋 1개). main에는 아직 병합하지 않는다(화면이 없다 — E2-A 끝에 병합).

| 확인 | 결과 |
|---|---|
| 데이터 경계 4경로 diff | 0건(Codex 확인) |
| 바뀐 파일 | 새 폴더 `src/plan-update/` 4개, 시험 1개, 결과 문서 — 기존 코드 수정 없음 |
| CI `travel-app checks` | 성공(`3405766`) |
| Codex가 읽은 것 | `cells.ts`·`export-plan.ts`·`export-rules.ts` 전체, 결과 문서 |
| 지시 대비 | 머리 줄·규칙 6줄 한 곳 관리·4표현 시간·표현 못 하는 시간의 메모 보존과 경고·G-b·G-c·G-d·날짜 범위·`\|` 처리 모두 반영 |

Claude가 물은 4건에 대한 판정:

1. **"변경 0건"을 칸 비교로 대신한 것**: 수용. A3이 생기면 같은 시험을 "변경 계산 결과 0건"으로 바꾼다(아래 보완 1).
2. **표현 못 하는 시간·줄바꿈 줄은 왕복 0건이 아니다**: 지시대로다. 조용한 손실이 아니라 경고가 붙는 알려진 예외로 둔다. A2 화면에서 사용자에게 보여 준다(보완 2).
3. **예시 문서와 다르다**: Codex 문서 쪽을 맞췄다 — [규격 §6](plan-format-v1.md)에 "실제 내보내기는 숙소의 지역·예약 칸을 비우고 `## 장소` 표는 E2-B부터"라고 적었다. 예시 파일은 E0 시험 자료이자 고정 자료의 바탕이라 그대로 둔다.
4. **기준revision = `header.domainRevision`**: 맞다. 저장 명령이 `expectedDomainRevision`으로 같은 값을 검사한다(`src/contracts/v2/exchange.ts`).

Codex가 더 본 것 → 지시서 "A1 검토 뒤 보완"에 넣었다:

- 장소 칸과 메모 칸은 저장할 때 한 값으로 합쳐진다. 한쪽만 고친 줄에서 다른 쪽이 사라지지 않게 A3이 합쳐야 한다.
- 날짜 범위로 내보낸 글의 `- 범위:` 줄은 다시 읽을 때 "모르는 머리 줄" 경고가 된다(규격 §2). 오류처럼 보이면 안 된다.
- 기준revision은 여행 전체의 값이다. 복사한 뒤 그 여행에 다른 저장이 있으면 붙여넣기가 막힌다. **어떤 저장이 이 값을 올리는지는 미확인**(Claude에 조사 지시).
- 규칙 1번의 "머리 줄 7개"는 시간대가 없으면 6개, 범위가 있으면 8개다. 글자 수만 다르고 동작에는 영향 없음 — 고치지 않는다(예시와 같은 문장 유지).

미검증: 시험 코드(`tests/plan-update-export.test.ts`)는 정독하지 않았다(CI 통과와 결과 문서의 항목으로 판단). 일정이 없는 날·날짜에 속하지 않은 활동의 내보내기.

## A2~A4 검토 (2026-11-18 17:50) — 판정: **통과. main 병합 → 사용자 확인 대기(G-E2A)**

대상 `codex/e02a-update-import` `14a074a`(main `54a8ecb` 병합 포함).

| 확인 | 결과 |
|---|---|
| 데이터 경계 4경로 diff | 0건 |
| 바뀐 코드 | 새 `src/plan-update/`(7파일)·`UpdateExport.tsx`·`UpdatePreview.tsx`, 기존 `ContentApp.tsx`(+28)·`PlanPaste.tsx`·`plan-import/preview.ts`(안내문·범위 줄) |
| CI(`14a074a`) | **성공** — check → check:pilot → 전체 E2E. Claude가 PC에서 끝내지 못한 "수정 뒤 전체 E2E 2차"와 `retrospective` mobile을 CI가 대신 확인했다 |
| Codex가 정독한 것 | `compute-update.ts` 전체, `apply-selection.ts`, `update-types.ts`, `UpdatePreview.tsx`, `ContentApp.tsx`·`PlanPaste.tsx` diff, 고친 기존 시험 4건의 diff |

지시 대비(코드로 확인):

- 대상 확인: 여행ID 다름 → 차단(여행 이름 안내), 기준계획·기준revision 다름 → 차단. 머리 줄을 못 읽으면 차단.
- 빈 칸 = 변경 없음, `(비움)` = 지움(`compare`). 바뀐 칸이 없으면 `unchanged`.
- 삭제는 삭제 구역의 줄만. 없는 ID·종류 불일치·같은 글에서 수정한 ID는 오류. 이동이 연결된 활동의 삭제·날짜 이동은 오류.
- 고른 결과 전체 재검사(`buildSelection`): 같은 대상 중복, 저장 형식, 현재 계획 버전, 이동의 양 끝 활동. 그 뒤 `ChangePlan` **1회**, `expectedDomainRevision`은 화면이 읽은 값. 실패하면 입력·미리보기가 남는다(단위 시험이 저장소 불변을 확인).
- 삭제가 들어 있으면 확인 칸을 체크해야 적용 단추가 켜진다. 건너뜀 후보는 기본 해제.
- 보완 5건 반영. `domainRevision` 조사는 시험(`plan-update-apply.test.ts`)으로 뒷받침된다.

고친 기존 시험에 대한 판단:

- `c06-integration`·`retrospective`의 "수정 단추 0개" 정규식에서 "AI로 수정하기"만 제외 — **수용**. 그 시험은 당시 고정 내용 화면에 편집 단추가 없음을 보는 것이고, 새 단추는 여행 메뉴(사이드바)의 것으로 이름에 "수정"이 들어가 걸렸다. 과거 계획 버전을 보는 중에는 단추를 그리지 않는다(`!planId`). 확인하는 내용은 그대로다.
- `plan-import-preview.test.ts`·`plan-update-export.test.ts`: 안내문 변경, 보완 1번에 따른 것.

Codex가 본 것(수정 지시 아님, G-E2A에서 사용자가 판단):

1. **새 활동·날짜를 옮긴 활동은 그날의 맨 끝에 붙는다.** 화면은 `order`(저장된 순서)대로 보여 주므로, 챗봇이 "12:00 점심"을 추가해도 저녁 활동 뒤에 나온다. 지시서에 순서 규칙이 없었다(Codex 지시의 빈틈). 불편하면 "그날 표에 든 줄 순서를 따른다" 또는 "시간순으로 끼워 넣는다"를 R로 지시한다 — **사용자 결정 필요**.
2. 표현하지 못하는 시간·줄바꿈 줄은 A1 검토의 예상("수정으로 보인다")과 달리 **변경 0건**으로 나온다(칸 비교 방식). 더 나은 결과다. 그 칸을 실제로 고치면 `[원래 시간: …]` 표시 없이 저장된다.
3. 복사한 뒤 그 여행에 메모 하나만 저장해도 같은 글은 막힌다(보완 5, 의도한 대가).

### 미검증 → G-E2A

- 실제 챗봇 왕복, iPhone 실기기(복사·붙여넣기·미리보기 길이), 배포 화면 직접 확인(이 세션은 `github.io` 접근 불가).
- `UpdateExport.tsx`·`export-plan.ts`의 A2 추가분과 시험 코드는 정독하지 않았다(CI와 시험 목록으로 판단).
- 캡처 없음(Claude가 제출하지 않음).
