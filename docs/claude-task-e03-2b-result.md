# T-E3-2b 결과 — 직접 입력 보완 (D1~D4)

- 브랜치 `codex/e03-2b-direct-entry`(main `57ebde4` 기준). 지시서: [claude-task-e03-2b-direct-entry.md](claude-task-e03-2b-direct-entry.md)
- 커밋: `fd60ec7` D1·D3·D4 / `c297f8d` D2 / `63719aa` R0(⋯ 메뉴, 별도) / `66474a2` 현재 계획 선택지 글 유지·ui-u2 칸 목록
- 사용자 확인 상태: **확인 대기**

## 구현

| 항목 | 내용 |
|---|---|
| D1 활동 칸 | `ContentApp.tsx` 활동 양식에 종류(선택)·설명(여러 줄)·식사·메뉴·예약 안내·선택 활동(체크)을 더했다. 반영 규칙은 순수 함수 `src/content/activity-details.ts`(`applyActivityDetails`, `activityCategoryOptions`)로 뺐다. 저장은 그대로 `upsert-item` 1회 |
| D1 종류 | 관광·식사·쇼핑·휴식·이동·기타. 목록에 없는 기존 값(`activity`·`hotel`·`legacy` 등)은 맨 앞 선택지로 그대로 두고, 바꾸지 않으면 그대로 저장한다. 새 활동 기본값 `기타`. `'activity'` 값에 기대는 코드는 **없다**(검색: 비교는 `hotel`·`transport`·`food`만 있음) |
| D1 빈 값 | 식사·메뉴·예약 안내가 비면(공백만 포함) 칸을 지운다. 설명은 빈 글 허용 |
| D2 연산 | `update-day { dayId, title, cityText }`를 `planEditOperationSchema`에만 더했다(`planOperationSchema` 변경 없음). 저장소 `newPlan`에서 그 날의 `title`·`cityText`만 앞뒤 공백을 빼고 바꾼다. 없는 `dayId` → `BROKEN_REFERENCE`, 빈 제목 → 스키마·저장소 양쪽에서 거부 |
| D2 화면 | 일정의 날짜 띠 아래 **날짜 정보 수정** 단추 → `DayInfo.tsx`(날짜 제목·도시). 바뀐 것이 없거나 제목이 비면 저장 단추를 끈다. 이전 계획 버전을 보는 중에는 단추를 끈다 |
| D3 | 더보기 목록에 **여행 이름 바꾸기** → `TripRename.tsx`. `UpdateTripMetadata`에 지금 `startDate`·`endDate`를 그대로 보낸다. 빈 이름·같은 이름이면 저장 단추를 끈다 |
| D4 CL-45 | 아래 |

### D4 CL-45 원인과 수정

- 원인(코드·390px 화면으로 판단): 계획 버전 화면은 선택 상자 하나와 그 옆의 `revision N`뿐이었다. 닫힌 선택 상자에는 고른 글만 보이고, 현재 계획은 `현재 계획`이라고만 적혀 **몇 번째 계획인지·이유가 보이지 않았다**. iPhone 선택 상자는 긴 글을 잘라 보여 주고 목록은 휠로만 연다. 그래서 "드롭다운 단추로만 보인다"는 관찰이 나온다. `revision N`은 영문 개발 용어이고, 좁은 폭에서 선택 상자 옆으로 밀려 있었다.
- 수정(화면 글·배치만, 저장 구조 변경 없음): 선택 상자 아래 줄에 `보고 있는 계획: 계획 N · 이유`를 전체 글로 적고(줄바꿈 허용), 그 아래에 `저장 번호(revision) N`을 둔다. 선택지 글·값은 그대로다. 처음에는 현재 계획 선택지를 `현재 계획 · 계획 N`으로 바꿨으나, `stays-legs.spec.ts`가 선택지를 글 `현재 계획`으로 고르므로 되돌렸다(`66474a2`).
- 캡처: `cl45-before-*.png` / `cl45-after-*.png`

### R0 — ⋯ 메뉴 방향 (Codex 추가 지시 11/27 17:35)

- 결함: 짧은 날짜의 마지막 활동 카드 `⋯` 메뉴가 아래로만 열려 모바일 하단 탭 줄 밑에 깔렸다(누를 수 없음). D2의 "날짜 정보 수정" 줄이 카드를 내리면서 `field-records.spec.ts:193`(mobile)에서 드러났다.
- 수정(`63719aa`): `ActionMenu.tsx`가 열릴 때(그리기 전) 단추 아래 공간 = (보이는 하단 탭 줄 위쪽, 없으면 창 아래 끝) − 단추 아래 끝 − 4px을 재고, 패널이 들어가지 않고 위에는 들어가면 `opens-up`(`bottom: calc(100% + 4px); top: auto`)으로 위로 연다. 위·아래 모두 모자라면 지금처럼 아래로. 판단은 순수 함수 `shouldOpenUp`.
- 시도했다 되돌린 것: 문서 `scroll-padding-bottom`, 단추를 일정 도구 줄로 옮기기 — 둘 다 커밋 전 되돌렸다. "날짜 정보 수정"은 지시서대로 날짜 띠 아래에 있다.

### ui-u2 기대 칸 목록 변경 (수용됨)

- `ui-u2.spec.ts:56`은 활동 양식의 칸 순서를 고정 목록으로 검사한다. D1이 칸(종류·설명·식사·메뉴·예약 안내·선택 활동)을 더하라고 지시했으므로 목록에 그 칸을 넣었다. 선택 활동은 체크 칸이 글보다 앞이라 첫 글이 빈 값으로 잡힌다. 기존 칸의 순서·숨김 검사는 그대로다.

## 검사

| 검사 | 결과 |
|---|---|
| 데이터 경계 | D2만 `src/contracts/v2/planning.ts`·`src/storage/content-repository.ts`를 바꿨다. D1·D3·D4는 경계 변경 0건. `worker/`·`.github`는 0건. 백업 형식·DB 판은 그대로 |
| `pnpm run check` | 통과(779 통과·1 건너뜀, `66474a2` 기준) |
| 새 단위 시험 `tests/direct-entry.test.ts` | 7건: update-day가 제목·도시만 바꾸고 다른 칸·다른 날·항목·이전 버전은 그대로 / 도시 비움 허용 / 빈 제목·없는 날짜 거부(revision·계획 그대로) / `planOperationSchema` 거부·`planEditOperationSchema` 허용 / 활동 칸 반영·빈 값 지우기 / 기존 종류 선택지 |
| 새 E2E `tests/e2e/direct-entry.spec.ts` | desktop·mobile 각 4건 통과(활동 칸 저장→다시 열기→빈 값 지우기 / 날짜 정보 / 여행 이름 / 계획 버전 표시) |
| R0 시험 | 단위 `tests/action-menu.test.ts` 4건(방향 규칙). E2E `tests/e2e/action-menu.spec.ts` mobile 1건(마지막 카드 ⋯ 패널이 탭 줄 위에 있고 일반 클릭으로 누름, desktop은 건너뜀). `field-records.spec.ts:193`은 **수정 없이** 통과. 가이드 머리 ⋯ 메뉴(`guides.spec.ts`) 통과 |
| `test:e2e:all` 전체(로컬) | 통과: 99·96·95 통과(건너뜀 2·4·2) + webkit 4 통과. 실패 0 |
| CI | push 뒤 확인(보고에 기록) |
| iPhone WebKit 확인 | **미실행**: Windows의 Playwright WebKit에서 가상 여행을 넣으면 IndexedDB 저장이 실패한다("unknown transient reason"). 2회 시도 뒤 중단했다. 390px 확인은 Chromium(Pixel 7 설정)으로 했다 |
| 캡처 | `docs/design/e03-2b/`: 활동 양식·날짜 정보·이름 바꾸기·CL-45 전·후. PC·390px 각 1장 |

## 미확인

- iPhone 실기기의 계획 버전 선택(휠)과 새 문구가 실제로 읽히는지는 사용자 확인이 필요하다.
- 활동의 설명·식사·예약 안내가 일정 카드·상세에 어떻게 보이는지는 이번에 바꾸지 않았다. 지금 화면이 보여 주는 칸만 보인다.
