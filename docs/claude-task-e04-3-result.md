# T-E4-3 결과 — 구 화면 전용 잔여 코드 정리

- 브랜치 `codex/e04-3-legacy-leftovers`(main 806e842 기준). 화면·저장 동작·백업 형식 변경 없음. 데이터 경계(`src/contracts`·`storage`·`transfer`·`repository.ts`) 수정 **0건**.

## 0. 후보 표

| 심볼·규칙 | 파일 | 앱 사용 | 시험 사용 | 판정 | 근거 |
|---|---|---|---|---|---|
| `TravelRepository.create`·`changePlan` | repository.ts | 0 | domain.test(셋업 포함 약 10개 시험, 백업·복원 시험 포함) | 유지 | 지우면 백업·복원(1절 2번) 시험의 셋업을 고쳐야 함 → 삭제 아닌 수정 |
| `record`·`propose`·`decide`·`importTrip`·`get`·`command`·`legacyWrite` | repository.ts | 0 | content-repository.test(구 형식 전환 시험이 구 자료 준비에 사용) | 유지 | 전환 경로 시험이 사용 |
| `rename` | repository.ts | 0 | content-repository.test:77(전환 뒤 읽기 전용 확인) | 유지 | 전환 경로 검증 |
| `backup`·`restore` | repository.ts | 0(앱은 transfer 경로 사용) | domain.test:230 | 유지 | 백업·복원 경로(1절 2번) |
| `workspaceUrl(…'legacy')` 인자 | storage/workspace-name.ts | 호출 인자는 `'content'`뿐 | 0 | 유지 | 유니온 타입 축소는 시그니처 변경(수정)이라 멈춤 대상 |
| `newTrip`·`demoTrips` 등 domain/demo 내보내기 | domain.ts, demo.ts | 앱 0 | 여러 시험·E2E | 유지 | 시험이 전환·복구 자료에 사용 |
| CSS 구 화면 클래스 21종(규칙 69개 선택자) | styles.css | 클래스명이 src·tests·worker 어디에도 없음 | 0 | **삭제** | 1절 4번 |
| `.trip-header`·`.save-state` | styles.css | tsx 0, `content/journey.css`에 규칙 있음 | 0 | 유지(불확실) | 다른 CSS가 같은 이름을 참조, 분리 판단 보류 |
| `.time` | styles.css | — | — | 유지 | 복합 선택자에서 단독 규칙으로 남음(사용 여부 미확인) |

삭제한 CSS 클래스: activity-copy, actual-row, ai-boundary, app-layout, changes-list, compact-label, context-column, context-panel, empty-list, evidence-list, form-grid, notifications, plan-reason, row-actions, skip-link, timeline-row, title-button, version-select, visually-hidden, workspace-columns(+ 같은 규칙 안의 연계 선택자).

## 경계 안에서 지운 것

없음(0줄). `TravelRepository` 구 CRUD는 전환·백업 시험이 쓰므로 유지. 지우려면 시험 셋업 수정이 필요해 지시서 3절 취지(수정 필요 시 보고)에 해당 — 별도 결정 사항으로 남김.

## CSS 크기

| | 전 | 후 |
|---|---|---|
| src/styles.css | 962줄 / 16,202 B | 638줄 / 10,718 B (-324줄, -5,484 B) |

번들 JS 크기는 CSS 외 변경이 없어 별도 측정 안 함.

## 검사

- `pnpm run check`: 통과. `check:pilot`: 통과.
- `test:e2e:all`: 통과(4묶음 93·87·89·4건, 실패 0). 구 형식 전환·복구·백업 E2E 포함, 시험 수정 없음.
- CSS 삭제는 postcss로 선택자 단위 제거 후 Prettier 적용(압축 없음).
