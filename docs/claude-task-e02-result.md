# T-E2 결과 보고

지시: [claude-task-e02-update-import.md](claude-task-e02-update-import.md) · 규격: [plan-format-v1.md](plan-format-v1.md)

## E2-A · A1 내보내기 변환 (중간 보고) — `codex/e02a-update-import`

구분: **구현 완료 / Claude 자체 검사 통과 / Codex 검토 대기 / 사용자 확인 없음(화면 없음).** A2~A4는 시작하지 않았다.

### 만든 것

| 파일 | 내용 |
|---|---|
| `src/plan-update/export-plan.ts` | `exportPlan({ header, plan, placeNames? }, { range?, includeReservation? })` → `{ text, warnings, counts }`. 순수 함수 |
| `src/plan-update/cells.ts` | 활동 한 줄의 칸 계산 `activityCellsOf`(내보내기와 A3의 비교가 같은 함수를 쓰도록 분리), 시간 칸 `timeCellOf`, 칸 글 규칙 `tableCell` |
| `src/plan-update/export-rules.ts` | 머리 아래 인용 규칙 6줄 한 곳 관리(`EXPORT_RULE_LINES`) |
| `tests/plan-update-export.test.ts` | 16건 |

### 규칙 구현

- 머리: 이름·양식·기간·(시간대)·여행ID·기준계획(`plan.planVersionId`)·기준revision(`header.domainRevision`)·범위 내보내기면 `- 범위:`. 그 아래 인용 규칙, 날짜별 일정 표(모든 줄 ID), 숙소 표, 빈 `## 삭제`. `## 이동`·`## 장소`는 내보내지 않는다.
- 시간: 빈 칸·`HH:MM`·`HH:MM-HH:MM`·`…(+1)`. 표현할 수 없는 경우(텍스트 시간, 다른 날짜 시작, 초가 0이 아닌 시각, 길이 0·역전·12시간 초과, 시작 없이 끝만 있음)는 시간 칸을 비우고 메모 끝에 `[원래 시간: …]`을 적고 경고 `time-unrepresentable`로 모은다.
- 장소 칸(G-b): 연결된 장소가 있으면 그 이름, 없고 메모가 `[장소: X]`로 시작하면 X를 장소 칸으로 올리고 메모에서 뺀다.
- 숙소 표(G-c): 지역·예약 칸은 비운다. 메모의 `[숙소 지역: …]`은 그대로 둔다.
- 예약 칸(G-d): 기본 비움, `includeReservation`이면 채움.
- 칸 글: `|`→`\|`, 글자 그대로의 `(비움)`→`\(비움)`, 줄바꿈→공백(경고 `newline-flattened`).
- 날짜 범위: 그 날짜 표만, 숙소는 체크인~체크아웃이 범위와 겹치는 것만.
- 기타 경고: `id-format`(양식의 ID 형식과 다른 ID), `stay-incomplete`(숙소 날짜 없음). 날짜 제목 끝 `(시간대: …)`는 그날 시간 있는 활동이 모두 같은 시간대이고 여행 기본과 다를 때만 붙인다.

### 시험 (Claude 자체 검사)

| 항목 | 결과 |
|---|---|
| T-E1 새 여행 고정 자료 2개(`chatgpt-t1-run2`·`claude-t1-run2`) → 가져오기 → 내보내기 → `parsePlanFile`·`checkPlanFile` | 오류·경고·빠진 표 0건, 삭제 줄 0건, 모든 ID 줄의 칸이 내부 항목에서 계산한 칸과 같음, 숙소 ID·체크인·체크아웃·이름 같음, 같은 글 두 번 내보내면 같은 글 |
| 가상 여행(자정 넘김, 시간 미정, 메모에 `\|`, `[장소: …]`, `[숙소 지역: …]`, 숙소 2곳) | 같은 기준으로 0건, 내보내기 경고 0건 |
| 예약 메모 포함 | 채워지고 같은 기준 0건 |
| 날짜 범위 / 표현 못 하는 시간 / 줄바꿈·`\|`·`(비움)` / 연결 장소 / 시간 칸 단위 | 통과 |
| 인용 규칙 6줄 = 예시 문서의 인용 글 | 같음 |
| typecheck · eslint · prettier | 통과 |
| 데이터 경계(`src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts`) diff | 0건 |

시험 중 `tableCell`의 `\|` 이스케이프가 한 번 빠졌던 것을 시험이 잡았고 고쳤다(`|` 있는 메모 줄의 칸 수 오류).

### 알아 둘 것 · 지시와 다르거나 판단이 필요한 점

1. **"변경 0건"은 아직 A3의 변경 계산으로 확인하지 못했다.** A3이 없어서 이번 시험은 칸 단위 대용 기준이다: 다시 읽은 모든 ID 줄의 칸이 `activityCellsOf`가 그 항목에서 계산한 칸과 같고(표를 거친 뒤의 모습 기준), 삭제 줄·오류·경고·빠진 표가 없는 것. A3 뒤에는 이 확인을 "변경 계산 결과 0건"으로 바꿔야 한다.
2. **표현할 수 없는 시간이 든 줄은 왕복이 0건이 되지 않는다**(규칙대로 메모 끝에 `[원래 시간: …]`이 붙어 다시 읽으면 메모 수정으로 잡힌다). 줄바꿈을 공백으로 바꾼 칸도 마찬가지다. 지시도 이 둘을 경고로 모으라고 하므로 그대로 구현했고, 고정 자료·가상 여행에는 없다. 사용자에게 "이 경고가 있는 줄은 다시 가져올 때 수정으로 보인다"고 알릴지는 A2 화면에서 정하면 된다.
3. **예시 문서 `docs/examples/plan-export-sapporo.md`와 지시(G-b·G-c)가 다르다.** 예시는 숙소 표의 지역·예약 칸이 차 있고 `## 장소` 표가 있다. 지시대로 A1은 숙소의 지역·예약을 비우고 장소 표는 E2-B까지 내보내지 않았다. 예시 문서는 고치지 않았다(Codex 관리).
4. 기준revision은 `header.domainRevision`으로 썼다. 설계서·규격에 어느 값인지 한 줄로 못 박혀 있지 않아 헤더의 도메인 revision으로 해석했다(A3에서 같은 값과 비교). 다르면 알려 달라.
5. 같은 ID 줄의 날짜 이동·활동 순서 변경은 A3의 일이라 여기서 다루지 않았다. 내보내기는 활동 순서(`order`)대로 적는다.

### 미실행

- E2E(화면이 없어 해당 없음). 사용자 확인: 없음.
- 전체 `pnpm run check`: 포맷·lint·typecheck 통과, vitest는 병렬 실행에서 `ai-v2-job-retention`·`ai-v2`·`ai` 7건이 실패했다(이번 변경과 무관한 서버 시험, 부하 때문에 흔들리는 것으로 알려진 파일). 그 3개 파일만 단독으로 다시 돌리면 39건 모두 통과, 나머지 57개 파일 671건 통과.

다음: Codex가 A1을 검토하면 A2~A4로 진행한다.

---

## A2~A4 결과 (E2-A 마감)

### 만든 것

- **A2 "AI로 수정하기"**(`src/content/UpdateExport.tsx`, ContentApp 사이드바 단추): 범위(전체/날짜 범위)·"예약 메모도 넣기"를 고르고, 요청 틀 + 내보낸 글의 전문과 글자 수를 복사 전에 보여 준다. 40,000자를 넘으면 날짜 범위를 권한다. 복사가 막히면 글을 펼친다. "파일로 저장"도 있다. 서버 호출 없음(E2E가 외부 요청 0건을 확인). 열린 여행이 없거나 v2 모드가 아니면 단추가 꺼진다.
- **A4 미리보기·적용**(`src/content/UpdatePreview.tsx`, `PlanPaste.tsx`에 `current`·`onUpdated` 추가): 수정 글이면 열린 여행과 비교해 추가/수정(칸별 이전→이후, 비움 강조)/삭제/변경 없음(접힘)/건너뜀 후보(기본 해제)/오류/가져오지 않는 칸을 보인다. 항목마다 체크 상자가 있고, 고른 것 전체를 다시 검사한 뒤 `ChangePlan` 1회로 적용한다. 이유: "AI 결과 붙여넣기: 수정 n·추가 n·삭제 n". 삭제가 들어 있으면 확인 칸을 체크해야 적용된다(AC-10).
- 막는 경우: 다른 여행의 글(그 여행 이름을 알림), 복사 뒤 다른 저장이 있었음(`STALE_REVISION_MESSAGE`), 계획이 바뀜. 적용 중 저장소가 `CONFLICT`를 내면 "계획이 그사이 바뀌었습니다. 다시 복사해 작업하세요"를 보이고, 입력과 미리보기는 그대로 둔다.
- `- 범위:` 머리 줄은 오류·경고·"가져오지 않음"이 아니라 "범위 내보내기" 안내로만 보인다(`preview.ts`가 수정 글에서 걸러 냄).

### A1 검토 뒤 보완 5건

1. 왕복 시험 = 변경 계산 0건(A3에서 완료, `expectZeroChanges`).
2. 내보내기 경고를 복사 전에 화면에 보인다. `id-format`: "다시 가져올 때 오류가 됩니다".
3. 장소·메모 칸 → `summary` 병합은 A3에서 완료(연결된 장소는 바뀌지 않음 안내, `(비움)` 처리).
4. 범위 머리 줄 처리: 위와 같다.
5. **domainRevision을 올리는 동작**(코드 읽기 + `tests/plan-update-apply.test.ts`로 확인): `CreateTrip`·`ImportNewTrip`을 뺀 모든 저장 명령(`ChangePlan`·`AddNote`·`UpdateTripMetadata`·기록·가이드·복원 등)이 그 여행의 값을 1 올린다. 올리지 않는 것: `SaveProposal`, `DecideProposal`의 거절, 읽기, **다른 여행의 저장**. 따라서 복사한 뒤 이 여행에 메모 하나만 저장해도 같은 글은 적용할 수 없다(자동 합치기·우회 없음, 안내문만 보인다).

### 시험

- 단위: `plan-update-export/compute/apply`·`plan-import-preview`. 실제 저장소(fake IndexedDB)로 적용·충돌·부분 선택·이전 버전 보존을 확인한다.
- E2E `tests/e2e/plan-update.spec.ts`(desktop·mobile 각 5건): 수정 글 내보내기(요청 틀·글자 수·외부 요청 0건) / 내보내기→고치기→붙여넣기→개수→적용→일정 화면과 이전 버전(계획 버전 목록에서 이전 계획 확인), 같은 글 재적용 차단 / 일부만 골라 적용 / 삭제 확인 칸 / 다른 여행 글 차단.
- 저장 실패 주입은 E2E로 만들 수 없어 단위 시험(`미리보기 뒤 다른 저장이 끼면 … 아무것도 바뀌지 않는다`)으로 대신했다.

### 고친 기존 시험

- `tests/plan-update-export.test.ts`: 칸 단위 대용 기준 → `expectZeroChanges`(A3).
- `tests/plan-import-preview.test.ts`: 수정 글 안내문이 "다음 단계"에서 "바뀐 곳"을 보여 주는 문장으로 바뀌어 기대값 수정(1건).

### 알아 둘 것·한계

- 검토 문서는 "표현 못 하는 시간·줄바꿈 줄이 다시 가져오면 수정으로 보인다"고 했으나, 칸 비교 방식이라 **변경 0건**으로 나온다(경고는 정보용). 그 칸을 고치면 `[원래 시간: …]` 없이 저장된다.
- 기존 활동은 행 순서로 재배치하지 않는다. 날짜 이동은 대상 날짜의 끝에 붙는다. 이동이 있는 활동의 삭제·날짜 이동은 오류다. 숙소 지역·예약 칸은 무시(안내 목록)하고, 새 숙소 줄은 지역·예약 없이 만든다.
- `src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts` 변경 0건.

### 미검증

- 실기기·iPhone 화면, 클립보드 권한이 있는 실제 챗봇 왕복, 사용자 화면 확인(상태: **검토 준비**, 확인 완료 아님).
- `pnpm run check`의 vitest는 병렬 부하에서 `ai`·`ai-v2` 계열이 흔들린다(단독 실행 39건 통과, 이번 변경과 무관).

### 검사 결과 (최종)

- `pnpm run check`: 포맷·lint·typecheck·build 통과. vitest 709건 통과, 9건 실패는 `ai`·`ai-v2` 계열(부하 흔들림)로 단독 재실행 39건 모두 통과.
- 전체 `pnpm run test:e2e`(1차, 빌드 후): 254 통과·7 건너뜀·**6 실패**(desktop·mobile 각 3개 시험). 원인은 이번 변경이었고 고쳤다.
  - `plan-paste` "오류로 빠지는 표…": 확인란 문구를 바꿔서 실패 → 새 수정 글(update)일 때만 다른 문구를 쓰도록 되돌렸다(기존 시험은 그대로).
  - `c06-integration`(2개)·`retrospective`: 읽기 전용 화면에서 "수정" 단추가 0개인지 보는 시험이 새 "AI로 수정하기" 단추를 잡았다 → 이 두 시험의 정규식에서 그 단추만 제외했다(**고친 기존 시험**: `c06-integration.spec.ts:288`, `retrospective.spec.ts:211`). 단추는 과거 계획 버전을 보는 중에는 아예 그리지 않는다.
- 수정 뒤 재실행: `plan-paste`·`c06-integration`·`plan-update`(desktop+mobile 12건 통과, plan-update 10건 통과), `c06-integration`·`retrospective`(desktop 6건 통과).
- **미실행**: 수정 뒤의 전체 `test:e2e` 2차 재실행은 시스템 메모리 부족으로 백그라운드 작업이 중단되어 끝내지 못했다. `retrospective` mobile은 수정 뒤 재실행하지 않았다. 다시 돌리려면 `pnpm run build && pnpm run test:e2e`.
- 고친 기존 시험 전체: `plan-update-export.test.ts`, `plan-import-preview.test.ts`, `c06-integration.spec.ts`, `retrospective.spec.ts`.
