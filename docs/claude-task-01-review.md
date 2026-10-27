# Codex T-01 검증

2026-10-27 · 대상 `a268c9e`(구현 `eec4200`·`30024f8`·`c253693`) · **보완 요청 / 사용자 확인 대기**

## 판정

테스트 실행과 Fact UI 격리는 통과했다. T-01 전체 완료는 아래 두 보완 뒤 재판정한다.
제품 코드 변경·실제 여행 자료 공개·기존 기대값 수정은 없었다. 실제 원천·iPhone 복원·실제 API는 미검증이다.

| 증거 | 결과 |
|---|---|
| 제출 범위 | tests/가상 fixture·문서 9파일, 제품/의존성/workflow 변경 없음 |
| Claude 전체 검사 | 단위168·E2E52·pilot exit 0, `.cache/verification/2026-10-27T07-47-06-848Z/` 로그 대조 |
| Codex 독립 단위 | 신규3파일 16개 통과, `pnpm exec vitest run tests/spfr-return-day.test.ts tests/spfr-move-day.test.ts tests/guide-fact-isolation.test.ts` |
| Codex 독립 UI | `pnpm run test:e2e tests/e2e/guide-facts.spec.ts`, PC1504×1040/모바일390×844의4개 통과(16.2초) |
| UI/콘솔 | A/B 초기값·A만 갱신·왕복 탐색/재로드·과거 계획·다른 여행, 콘솔 오류/overlay/가로 넘침 assertion 통과 |
| 화면 열람 | `.cache/t01-screenshots/desktop-fact-a-updated.png`, `mobile-fact-b-unchanged.png` 직접 확인 |
| 원격 CI | 이번 검토에서 확인하지 않음. 전체 회귀 재실행 없음 |

Browser plugin not available: 기존 프로젝트 Playwright·캐시 Chromium으로 검사했다. 기존 사용자 프로필은 사용하지 않았다.
제품 소스는 기준점 이후 동일하므로 Claude 전체 검사에서 만든 빌드를 재사용하고 신규 검사만 독립 실행했다.

## 보완 1 · 화면 산출물과 실행 절차

원 지시서 §5는 날짜/지역 의미와 Fact의 PC·모바일 화면 및 직접 재현 경로를 요구한다.
제출한14장은 Fact/재가져오기 화면이며 귀국일·이동일 화면이 없다.
보고서의 ‘factory를 패키지로 만들어 올린다’는 안내에는 실행 가능한 생성 명령·제공 패키지가 없다.
기존 가상 fixture에서 Git 제외 패키지와 재현 명령을 제공하고 귀국일/이동일 화면을 추가한다.

## 보완 2 · 지역 기대값의 근거

`tests/spfr-move-day.test.ts:83`은 이동일 `regionIds=['other']`, `tests/spfr-return-day.test.ts:81`은
명시된 장소 지역이 있어도 귀국일 `regionIds=[]`인 현 구현을 단언한다.
`spfr-candidate.ts:182-194`는 숙박에서 해당 필드를 만들고 `spfr-pilot.ts:232-233`은 이를 overnightRegionId로 사용한다.
이는 현상 설명이며 `regionIds` 자체가 숙박 전용이라는 의도된 계약의 증명은 아니다.
기존 지시서의 ‘복수 지역 참조 보존’과 문서의 ‘명시 원천 지역 포함’은 적용 계층을 구체화할 필요가 있다.
장소·지역 콘텐츠 보존 검사는 유효하지만 그 결과를 하루의 복수 지역 필드 보존까지 확대할 수 없다.

이 관찰만으로 제품 결함을 확정하거나 현재 동작을 새 계약으로 승인하지 않는다.
명시된 계약 검사와 현 동작 관찰을 구분하고 생성·소비 경로/원천 근거 및 영향표를 제출한다.
[T-01-R1 보완 지시](claude-task-01-r1.md)를 따른다. 코드 수정이 필요하면 별도 지시한다.

Claude 보고의 당시 ‘재현된 제품 결함 없음’ 기록은 보존한다. 사용자 ‘완료’ 응답은 구현 제출 알림이며 화면 확인 완료가 아니다.
