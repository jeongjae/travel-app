# T-P1 결과 보고 (C1 검토 반영 + C2·C3·C4)

2026-11-17 · 브랜치 `codex/p01-guide-select` · 작성: Claude

## 상태

C2·C3·C4 구현과 자체 검사를 마쳤다. **Codex 검토 대기.** 전체 E2E는 PC에서 돌리지 않았다(아래). G-P1 사용자 확인 없음, iPhone 실기기 확인 없음.

## 커밋 (push 완료)

| 커밋 | 내용 |
|---|---|
| `7d3c6f2` | origin/main 병합 |
| `6e9282d` | C1 검토 보충: 계획 붙여넣기에 가이드 글이 들어오면 `is-guide` 거부 + 안내(시험 2건 추가) |
| `86c442d` | C2·C3 코드: 가이드 화면, 고르기·거르기·일괄·같은 이름 알림·바꾸기·지우기·파일 저장, 준비 초안 저장 |
| `640f9ff` | C4 코드: 요청서 결합, 미리보기 옆 "내가 고른 것" 목록 |
| `36e1149` | 저장 성공 뒤 초안 지우기 제안, C2~C4 시험 |

C2와 C3는 화면 상태와 저장이 한 덩어리라 한 커밋으로 묶었고, 시험은 마지막 커밋에 모았다(중간 커밋 단독으로는 새 시험이 통과하지 않는다).

## 단계별 한 일

- **C2** `src/content/GuidePanel.tsx`, `src/guide-import/{selection,guide-request}.ts`: 요청문 복사(여행지가 비면 단추 비활성 + "여행지를 먼저 적어 주세요", 문서에서 읽어 `{목적지}`·`{기간}` 채움), 붙여넣기·클립보드·파일, 오류는 줄 번호·이유 전부(줄 1은 "머리 줄")와 가져오지 않은 것 표시, 카드(종류·이름·지역·설명·소요·확인 필요, 글자로만), 세 단추(눌림 상태 `aria-pressed`, 다시 누르면 해제), 종류 칩·고른 것만 보기, 보이는 항목 일괄(바뀌는 개수 표시), 제외 항목과 앞 낱말이 같은 항목 알림, 현황, 가이드 바꾸기·지우기 확인·취소, 가이드 원문 `.md` 저장, "가이드 없이 계속". 오류 가이드는 기존 가이드·고른 상태를 건드리지 않는다.
- **C3** `src/guide-import/draft.ts`, `src/content/prep-state.ts`: localStorage 키 `travel-app.prep-draft.v1` 하나(버전 포함, 초안 1건). 조건·취향 답 + 가이드 원문 + 고른 상태. 가이드는 원문에서 다시 해석한다. 깨진 JSON·다른 버전은 버리고 알림, 가이드가 깨졌으면 가이드·고른 것만 버리고 답은 유지, 가이드에 없는 key의 선택은 버림, 저장 실패는 알리고 메모리로 계속. 화면에 "이 기기에만 저장됩니다…" 안내와 "준비 초안 지우기". 새 여행 저장 뒤 초안은 자동으로 지우지 않고 지우기를 제안한다.
- **C4** `travel-brief.ts`, `guide-request.ts`의 `buildGuideSection`, `src/content/ChosenList.tsx`: 순서 조건 → 취향 → `[꼭 포함]` → `[관심]` → `[제외]` → `[확인할 것]`(꼭 포함·관심 항목의 확인 필요만) → 부탁할 일 → 양식 안내문. 고르지 않은 항목은 넣지 않고 빈 묶음은 제목도 뺀다. 가이드 묶음이 있을 때만 부탁할 일에 "[꼭 포함]을 넣기 어렵거나…" 줄을 양식 줄 앞에 더한다. 요청서 미리보기는 외부로 나가는 글 전체를 보여 준다. AI 결과 붙여넣기 화면에 초안의 `꼭 포함`·`제외` 목록을 옆(900px 이상, 좁으면 아래)에 보여 준다. 자동 판정·계획 수정 없음. 초안·고른 것이 없으면 그리지 않는다.

## 시험 수와 결과 (Claude 자체 검사)

| 항목 | 결과 |
|---|---|
| 단위: `guide-import` 25 + `guide-select` 16 + `plan-import-*` 기존·추가 합계 | 178건 통과(단독 실행) |
| 신규 E2E `guide-select.spec.ts` ①~⑦ + 오류 화면·초안 지우기·깨진 초안·저장 뒤 제안 (desktop·mobile) | 20건 통과 |
| 영향 E2E `plan-brief`·`plan-paste`·`content`·`modal-cancel`·`restore-ux`·`ai-v2` | 63건 통과, 1건 실패(아래) |
| format:check · eslint · tsc · build | 통과 |
| 데이터 경계 4경로 diff (main 대비) | 0건 |
| 전체 `test:e2e` | **실행하지 않음**(지난번 메모리 부족 중단). CI로 확인 필요 |

E2E ①은 하코다테 고정 자료로 카드 34개 → 3·1·3 고르기 → 요청서 구분 대로 → 새로고침 뒤 유지, 그리고 **IndexedDB 전체 저장소 내용의 전후가 같음**(AC-24)을 확인한다. ⑥은 P0 `g3-b-with-selection.md`를 붙여 넣어 옆 목록을 확인한다. P0와 같은 7개의 정확한 목록은 문서에 없어, P0 기록의 이름으로 3·1·3을 골랐다.

### 실패 1건
`ai-v2.spec.ts:148` "v2 조사 중 현장 기록이 추가되면 오래된 결과 자동 저장을 거부한다"가 mobile에서 재현되게 실패한다(`CONFLICT` 알림이 안 보임, desktop은 통과). AI 변경안 화면 코드는 이번에 건드리지 않았다. main에서 같은지는 확인하지 않았다 — CI·Codex 확인 필요.

## 고친 기존 시험

없다. 기존 시험의 단언은 바꾸지 않았다(`plan-brief` E2E는 시험마다 새 브라우저라 초안 유지의 영향을 받지 않았다). T-E1 "AI로 계획 만들기"의 답이 이제 저장·복원되므로 `PlanBriefDialog`의 상태 관리가 `usePrepState`로 바뀌었다(화면 문구 "답은 저장하지 않습니다"는 삭제).

## `src/plan-import/`를 고친 부분 (Codex가 먼저 볼 위험)

1. `input-text.ts`: 계획 쪽 `mismatch`로 `travel-app-guide/1`이면 `is-guide` 거부(위 `6e9282d`). 계획 시험의 기존 단언은 그대로.
2. `types.ts`: 거부 코드 `is-guide` 추가. `preview.ts`: `is-guide`면 "챗봇에게 다시 정리해 달라" 안내를 붙이지 않고 가이드 안내만 보여 준다.
3. `travel-brief.ts`: `guideSection`이 비어 있지 않을 때만 부탁할 일에 한 줄 추가. 가이드 없는 요청서는 이전과 글자 단위로 같다(시험으로 확인).

## Codex가 먼저 볼 위험

- 같은 이름 알림은 "이름의 앞 낱말(공백·`·` 기준, 2글자 이상)이 같은 항목"으로 정했다. 규칙이 지시서에 정확히 없어 내가 정했다.
- 가이드를 지우거나 바꿀 때 고른 것이 있으면 확인을 거치지만, 고른 것이 없으면 확인 없이 바로 바뀐다.
- 가이드 원문은 localStorage에 통째로 들어간다(상한 200,000자). 브라우저 용량이 작으면 저장 실패 안내가 뜬다.
- "꼭 포함·제외 안내 줄"은 관심만 골라도 들어간다(묶음이 하나라도 있으면).
- `GuidePanel`의 "가이드 없이 계속"은 구역을 접을 뿐 상태를 바꾸지 않는다.

## 완료 조건 대조 (§7)

| # | 조건 | 자체 검사 |
|---|---|---|
| 1 | CI | 미확인(위 실패 1건·전체 E2E 미실행) |
| 2 | 고른 항목이 구분대로, 안 고른 것은 안 들어감 (AC-23) | 단위·E2E ① |
| 3 | 여행 DB·백업 불변 (AC-24) | E2E ① IndexedDB 전후 비교(백업 파일 내용은 직접 비교하지 않음) |
| 4 | 건너뛰어도 요청서 (AC-22) | 단위·E2E ④ |
| 5 | 오류 가이드는 기존 상태 유지 | E2E ③ |
| 6 | 바꾸기는 확인 뒤에만 | E2E ③ |
| 7 | 새로고침 뒤 복원 | E2E ① |
| 8 | 오프라인 | E2E ⑦ (Playwright 오프라인) |
| 9 | 경계 4경로 diff 0 | 확인 |

## 미검증·사용자 미확인

- 전체 E2E, iPhone 실기기(붙여넣기·파일 선택·44px 단추 크기·한 열 배치의 실제 느낌), 다른 챗봇·다른 목적지 왕복, 실제 용량 초과 저장 실패는 확인하지 않았다.
- 화면의 모양(카드 배치, 옆 목록의 2열 배치)은 Playwright 폭 검사(가로 넘침 없음)만 했고 눈으로 확인하지 않았다.
- 사용자 확인(G-P1): 없음.

---

# 부록: C1 보고 (2026-11-17, `b26da04`)

2026-11-17 · 브랜치 `codex/p01-guide-select` · 작성: Claude

### 상태

C1 구현·단위 시험 완료. **Codex 검토 대기.** C2~C4는 시작하지 않았다. 사용자 확인(G-P1) 없음.

### 한 일

- `src/guide-import/` 신설: `parseGuide(text)` → `GuideResult`(`accepted` true면 `destination`·`referenceDate?`·`items[]`·`issues[]`·`notImported[]`, false면 `rejection?`·`issues[]`).
- 항목 `{ key, kind, name, area, description, durationText, needsCheck, line }`. `key` = 본문 지문(FNV-1a 32비트) + 항목 순번.
- 규격 §3대로 오류가 하나라도 있으면 가이드 전체를 받지 않고, 오류는 줄 번호·이유로 모두 모은다. 중복(종류+이름+지역)은 경고만 하고 둘 다 남긴다.
- 거부 코드: `too-large` · `not-guide` · `ambiguous` · `format-version` · `is-plan`.
- 고정 자료 `docs/p0-results/g1-guide-hakodate.md`를 `tests/fixtures/guide-format/hakodate.md`로 복사. `.prettierignore`에 해당 폴더 추가.

### `src/plan-import/`를 고친 부분 (Codex가 먼저 볼 것)

1. `input-text.ts`: `selectBody`의 본문을 `selectFormattedBody(lines, spec)`으로 꺼내고 `selectBody`는 계획 양식 값으로 이를 부른다. `FormatSpec { format, example, mismatch? }` 추가. 계획 쪽 거부 코드·문구는 그대로다(문구의 양식 예시 문자열만 spec에서 만들며 결과 문자열은 같다).
2. `types.ts`: `RejectionCode`에 `'is-plan'` 추가(가이드 쪽 `mismatch`가 쓴다. 계획 변환기는 이 코드를 만들지 않는다).
3. 그 외(`table.ts`·`time-cell.ts`의 `splitTableRow`·`readRawTable`·`mapColumns`·`isRealDate`, `splitSourceLines`)는 수정 없이 재사용했다.
- 계획 변환기의 기존 시험은 고치지 않았고 모두 통과한다.

### 시험 (Claude 자체 검사)

| 항목 | 결과 |
|---|---|
| `tests/guide-import.test.ts` 신규 | 통과 |
| `tests/plan-import-*.test.ts` 기존 | 통과(합계 160건 = 신규 포함, 단독 실행) |
| 고정 자료 | 34항목, 지역 4·볼거리 15·먹거리 8·체험 4·코스 3, 오류 0, 기준일 2026-11-16 |
| 입력 변형 | 코드 블록·앞뒤 설명문·CRLF·BOM에서 같은 항목 목록 |
| 거부·오류 | 양식 줄 없음·두 번·다른 값, 계획 글(`is-plan`), 모르는 종류, 열 개수 불일치, 이름 빈 칸(오류 모두 수집), 필수 열 없음, 구역·표·항목 없음, 목적지 없음, 201줄, 글 상한 |
| 경고·읽기 | 중복 경고(지역이 다르면 중복 아님), 열 순서 바뀜, 모르는 열·구역·머리 줄 → 가져오지 않음, 기준일 형식 오류 경고, `\|` |
| typecheck · prettier · eslint | 통과 |
| 데이터 경계 4경로 diff | 0건 (`src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts`) |

### 미검증·주의

- 전체 `vitest run`은 실행할 때마다 다른 파일(`ai-v2-job-retention`·`source-preflight`·`transfer` 등, 이번 변경과 무관)이 실패했다. `ai-v2-job-retention`은 단독 실행에서 14건 모두 통과해 부하로 인한 흔들림으로 보이나, 원인은 확인하지 않았다. CI에서 확인 필요.
- E2E는 이 단계에서 해당 없음(화면 없음).
- 계획 쪽 붙여넣기에 가이드 글이 들어왔을 때 "이것은 가이드입니다"로 안내하는 것(규격 §1 "반대도 같다")은 계획 변환기 동작을 바꾸므로 하지 않았다. C2에서 계획 쪽 화면을 고칠지 지시가 필요하다.
- 사용자 확인: 없음.

---

## 부록 R2 · 화면 4건 수정 (`codex/p01-r2-ui`, Claude 자체 검사)

변환기·초안 저장·요청서 글(`src/guide-import`·`src/plan-import`)과 저장 구조 4경로는 바꾸지 않았다(diff 0건). 바꾼 곳: `PlanBrief.tsx`·`GuidePanel.tsx`·`ChosenList.tsx`·`PlanPaste.tsx`·`content.css`.

### 고친 것

| # | 내용 |
|---|---|
| U-1 | 시작·종료 날짜를 `.date-row`에 나란히 둔다(칸 최대 11rem, 340px 이하에서만 두 줄). |
| U-2 | 단추·칩·파일 선택 라벨을 44px 높이·같은 글자 크기로 맞추고, 묶음(`.prep-actions`)은 같은 간격으로 줄바꿈한다. 주요 단추(요청서 복사·미리보기·새 여행으로 저장·가이드 읽기·요청서 만들기로)는 오른쪽 끝, 600px 이하에서는 전체 폭. **원인 하나를 찾았다**: `.content-app dialog .primary { margin-top: 12px }`가 눌린 칩(`primary`)만 12px 아래로 밀고 있었다. 칩 묶음·`.prep-actions` 안에서는 0으로 덮었다(다른 화면의 눌린 칩에도 같은 효과). |
| U-3 | 요약 줄 `고른 항목 — 꼭 포함 n · 관심 n · 제외 n (전체 N개 중)`, 거르면 `지금 보이는 M개 중 — …` 줄 추가. 일괄 단추는 `모두 꼭 포함` 등으로 바꾸고 `n개가 바뀝니다`는 단추 밖 작은 글씨. 붙여넣기 옆 목록에 `꼭 포함·제외만 보여 줍니다. 관심은 넣지 않습니다.` 안내. |
| U-4 | 카드는 접힌 한 줄(종류·이름·지역 + 꼭·관심·제외, 접근성 이름은 전체 낱말)이고 이름을 누르면 설명·예상 소요·확인 필요가 펼쳐진다(`aria-expanded`). `모두 펼치기/접기`. 요약 줄·종류 칩 sticky(칩은 한 줄 가로 스크롤). `한 번에 고르기`는 접어 둠. 목록 끝 `요청서 만들기로`(요청서 미리보기 제목으로 이동). 비슷한 항목 알림은 접어도 카드 아래에 보인다. |

### 고친 기존 시험 (`tests/e2e/guide-select.spec.ts`)

| 시험 | 고친 단언 | 이유 |
|---|---|---|
| ①·③ 요약 줄 | `getByText('꼭 포함 n · …')` → `getByTestId('guide-total')`의 `toContainText` | 거른 상태에서 `지금 보이는` 줄에도 같은 글이 나와 `getByText`가 둘을 잡는다(strict 위반). 전체 수 줄을 testid로 지정. |
| ② 한 번에 고르기 | `꼭 포함으로 (8개 바뀜)`·`고르지 않음으로 (8개 바뀜)` → `한 번에 고르기`를 펼친 뒤 `모두 꼭 포함`·`모두 고르지 않음` 단추와 `8개가 바뀝니다` 글 | 단추 글과 위치(접힌 묶음, 바뀌는 수는 단추 밖)가 바뀜. |
| 카드 단추 찾기(`choose`) | 변경 없음 | 고르기 단추의 접근성 이름이 전체 낱말(꼭 포함·관심·제외)이라 그대로 통과. |

계획 변환기·초안·요청서 단위 시험은 고치지 않았다.

### 새 시험 (E2E 3건 × desktop·mobile)

- R2-1: 요약 줄 전체 수(34개 중)와 거른 뒤 `지금 보이는 8개 중`·`고른 것만 보기` 3개 중이 서로 다르게 맞게 나온다.
- R2-2: 카드 접힘·펼침, 고르기가 펼침과 따로 동작, 모두 펼치기·접기(34개), `요청서 만들기로` 단추.
- R2-3: 날짜 두 칸 같은 줄(mobile 프로젝트 폭 포함)·칸 폭 ≤11rem, 단추 높이 ≥44px, 눌린 종류 칩과 다른 칩의 위치·높이 동일.

### 검사 결과

| 항목 | 결과 |
|---|---|
| `pnpm run check`(format·lint·vitest 59파일 662건·typecheck·build) | 통과 |
| E2E `guide-select`(26건)·`plan-brief`·`plan-paste` 합계 42건 (desktop·mobile) | 통과 |
| 데이터 경계 4경로 + guide-import·plan-import diff | 0건 |

### 화면 캡처 (`docs/p01-r2-screens/`)

PC(`desktop-*`)·iPhone 폭(`mobile-*`, Playwright mobile 프로젝트 뷰포트)의 대화상자 캡처: `1-top-dates`(날짜·칩), `2-guide-sticky-filtered`(거른 상태 요약 두 줄·접힌 카드), `3-bulk-open`(한 번에 고르기), `4-bottom-actions`(요청서 미리보기·주요 단추), `5-paste-compare`(붙여넣기 옆 고른 목록).
캡처는 요소(대화상자) 스크린샷이라 sticky 위치가 화면 실제와 다르게 보일 수 있다.

### 미검증

- iPhone 실기기(Safari의 날짜 입력·sticky·고정 폭)는 확인하지 않았다. 사용자 확인: 없음(수정 요청 → 확인 대기).
- 전체 `test:e2e`는 돌리지 않았다(관련 3개 파일만).

## R3 · iPhone 날짜 칸 겹침 (CSS만) — `codex/p01-r3-date`

구분: **구현 / Claude 자체 검사 통과 / 실기기 미확인 / Codex 검토 대기 / 사용자 확인 없음.**

- 고친 것: `src/content/content.css`의 `.date-row`만. 칸은 `repeat(auto-fit, minmax(min(100%, 9.5rem), 11rem))`로 두 칸이 안 들어가면 두 줄로 내려가고, `label`에 `min-width: 0`, `input[type=date]`에 `width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; appearance: none; font-size: 1rem(16px)`. 기존 `max-width: 340px` 규칙은 auto-fit으로 대체. 다른 화면의 날짜 입력·TSX는 바꾸지 않았다. 데이터 경계 4경로 diff 0건.
- 시험: `tests/e2e/date-row-webkit.spec.ts`(390·360·320px, 3건) — 두 입력 칸이 서로 겹치지 않고 대화상자 폭을 넘지 않는지 사각형으로 확인. 통과.
- 추가한 것: Playwright 프로젝트 `webkit-iphone`(iPhone 13 설정, `*-webkit.spec.ts`만 실행)과 기존 두 프로젝트의 `testIgnore`. WebKit 브라우저(60MB)는 `.cache/ms-playwright`에 설치했다(`node scripts/playwright.mjs`가 그 경로를 쓴다. 새 환경은 `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright pnpm exec playwright install webkit`).
- 캡처: [iphone-webkit-390-date-row.png](p01-r3-screens/iphone-webkit-390-date-row.png) — 390px에서 두 칸이 위아래 두 줄로 놓인다.
- **한계(중요)**: 수정 전 CSS로도 이 시험이 통과했다. Windows의 Playwright WebKit은 실기기 iOS Safari의 날짜 입력 고유 폭을 재현하지 못한다. 이 시험은 "겹치지 않는다"는 회귀 방지용이며 **실기기에서 고쳐졌다는 증거가 아니다.** iPhone 실기기 확인이 필요하다.
- 미실행: 전체 `test:e2e`, iPhone 실기기.
