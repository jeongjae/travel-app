# C-13〔U4〕 결과 — UI 정리 마감 · 삿포로 대본 v2

2026-11-04 · 브랜치 `codex/c13-ui-u4` · 상태: **구현 / 자체 검사 통과 / Codex 검토 대기 / 사용자 확인 대기(U4 재수행)**
저장 명령·스키마·백업 형식·모델 필드 의미는 바꾸지 않았다(표시와 읽기 모델만).

## 변경 요약

| 항목 | 변경 | 위치 |
|---|---|---|
| R1 날짜 머리 | `top`을 상단 바 높이(`--journey-topbar-height: 56px`)로 맞춤. 뷰포트 증거 확인 | `content.css` `.record-day > h3`, `journey.css` |
| R2 다른 날 정정 | 배지에 발생일(`방문 1/1 00:30`). 발생일 타임라인에 기록 카드 + `12/31 계획 항목의 기록`. 계획 항목 수 불변 | `field-rules.ts` `dayRecordView`(4번째 인자 `activityDates`, 결과 `plannedOn`), `TimelineRecords.tsx`, `ContentApp.tsx` |
| 회고 `ⓘ` | 글자 단추(`계획 설명`·`이유 설명`·`근거 설명`), 눌러 펼침, 접근성 이름=보이는 글자 | `ui.tsx` `HelpNote`, `Retrospective.tsx`, CSS |
| 기록 행 `⋯` | 펼침이 `정정` 옆 남는 자리에 놓이고 단추 글자는 줄바꿈 없음 | `content.css` |
| 가이드 썸네일 | 사진이 있는 장소 행 왼쪽에 정사각 썸네일(모바일 48px, PC 64px). 없으면 자리 없음. 로딩은 기존 `AssetImage` | `GuideList.tsx`, `Guide.tsx`(`className`·`hideWhenMissing`) |
| 대본 v2 | `u4-sapporo-scenario.md`(검토 공간 `review=sapporo-u4`), `u4-user-check.md`(확인 대기) | `docs/` |

## 검사

| 구분 | 결과 |
|---|---|
| `pnpm run check`(포맷·린트·단위·빌드) | 통과, 단위 322 통과 · 1 건너뜀(기존). 신규 단위 1건(R2: 12/31 계획·1/1 정정 → 12/31 배지 날짜, 1/1 카드 1건, 항목 수 불변) |
| `pnpm run test:e2e`(전체) | 159 통과 · 1 건너뜀(기존) · 실패 0. 신규 `u4-sapporo.spec.ts`·`ui-u4.spec.ts`(PC·모바일 각 4건) 포함 |
| `pnpm run check:deferred` | exit 0 (check · test:e2e · check:pilot 통과) |
| 미검증 | 사진이 있는 장소는 사진 입력 화면이 없어 합성 패키지 시험(R5)과 그림으로만 확인. 실기기·iPhone·사용자 화면 확인 없음 |

## 기존 E2E 선택자 변경 대응표 (단언 약화 없음)

| 시험 | 이전 | 이후 | 이유 |
|---|---|---|---|
| `ui-u3.spec.ts` 회고 | `getByLabel('도움말').first().click()` | `getByText('계획 설명', {exact:true}).click()` | `ⓘ` 아이콘 → 글자 단추. 펼침 전 숨김/펼침 후 표시 단언은 그대로 |
| `ui-u3.spec.ts` C8 배지 | `/^방문 \d\d:\d\d$/` | `/^방문( \d+\/\d+)? \d\d:\d\d$/` | 이 시험은 실제 시계(오늘)로 방문을 남기므로 계획일(2032-06-01)과 날짜가 달라 R2 규칙으로 발생일이 붙음. 시각·`방문` 단언 유지 |
| `Retrospective.tsx` 라벨 | `변경안 없음 도움말` | `근거 설명` | 새 글자 단추 `변경안 없음 설명`이 `retrospective.spec.ts`의 `getByText('변경안 없음')`과 겹쳐(strict mode) 라벨만 바꿈. 시험은 수정하지 않음 |

c07 대본·시험·사용자 기록(`c07-user-check.md`)은 수정하지 않았다.

## 스크린샷 색인 (`docs/design/ui-u4/`, PC `-desktop`·모바일 `-mobile`, 뷰포트 캡처)

- R1 `r1-sticky-day` (스크롤 상태, 상단 바 바로 아래에 붙음) · R3 `r3-retro-help` · R4 `r4-more-open` · R5 `r5-thumbnail`
- S1 `s1-new-trip` · S2 `s2-guide-regions`, `s2-guide-empty` · S3 `s3-plan-day`, `s3-edit-reason` · S4 `s4-today-records`, `s4-records` · S5 `s5-retro` · S6 `s6-restore-disabled`, `s6-restored`
- 재생성: `UI_U4_SHOTS=1 pnpm run test:e2e tests/e2e/ui-u4.spec.ts tests/e2e/u4-sapporo.spec.ts`

## 남은 후보

- 사진 입력 UI가 없어 썸네일을 실제 화면에서 사용자가 볼 방법이 없음(패키지 가져오기 경로로만).
- R2는 한 활동의 기록이 다른 날 타임라인에 보이는 읽기 표시일 뿐, 계획은 옮기지 않는다. 계획 이동 제안은 별도 판단.
- 상단 바 높이 56px은 CSS 변수 기본값이다. 상단 바가 커지면 변수도 함께 조정해야 한다.
- 대본 S4 방문 시각은 시험이 시계를 고정해 14:20/23:30이 되지만, 사용자 수행에서는 그 순간의 시각이 찍힌다(대본에 "HH:MM"으로 적음). 정정으로 1/1 00:30을 넣으므로 이후 단계에는 영향 없음.

## Codex 검토 R1 보강 (c07 S4 정정 접기 간헐 실패)

- 원인: 저장 직후 목록이 다시 그려지기 전에 접기를 열면 새로 그려진 접기는 닫혀 있어 `정정 3/3단계 · 최신 정정본`이 hidden.
- 조치: `tests/e2e/c07-sapporo.spec.ts` S4에서 접기 열기와 확인을 `expect(async () => {…}).toPass()`로 묶음(확인 `timeout: 1000`). 단언 내용은 그대로. 같은 `evaluateAll` 패턴은 다른 spec에 없음.
- 검사: 해당 spec 모바일 `--repeat-each=5` 5/5 통과, 전체 E2E 159 통과 · 1 건너뜀 · 실패 0.
