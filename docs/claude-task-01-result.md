# Claude T-01 결과 · 이행 핵심 회귀 보완

2026-10-27 · 구현·자체 검사 완료 / **Codex 검토: 대기 · 사용자 확인: 검토 준비**

## 요약·증거 색인

- 범위: tests·fixture만 추가. `src/`·`server/`·의존성·workflow·샘플 ZIP 변경 없음. 기존 테스트 기대값 변경 없음.
- 자체 검사: `pnpm run check:deferred` exit 0 — 단위 168개(기존 152+신규 16), E2E 52개(기존 48+신규 4), pilot 통과.
- 로그: `.cache/verification/2026-10-27T07-47-06-848Z/`(check·test-e2e·check-pilot), 요약 `.cache/t01-check-deferred.log`. Git 제외.
- 스크린샷(PC/모바일 각 7장): `.cache/t01-screenshots/`. 콘솔 오류·가로 넘침은 E2E afterEach가 매번 단언(0건).
- 실제 결함: **재현된 제품 결함 없음.** 관찰 1건은 아래 「범위 밖 발견」.
- 미검증: 실제 SP-FR 원천, iPhone 복원, 실제 API. 제품 코드 변이(mutation) 검사는 범위 밖이라 하지 않았다.

## 실행 기준

| 항목 | 값 |
|---|---|
| 시작 HEAD | `bc43e94` main, dirty는 미추적 `docs/status-review-2026-10-26.md`뿐(미수정·미커밋) |
| 종료 HEAD | `c253693`(+보고 커밋) |
| 모델 | Sonnet 5.5 (`claude-sonnet-5-5`) 시스템 표기, 변경하지 않음 |
| 포트·환경 | 5173/4173/8787 리스너 없음, Node 24.13.1, pnpm 12.14.0 |

## 기존 검사 충분성 판단과 추가 내용

| 단위 | 기존 | 판단 | 추가 |
|---|---|---|---|
| T-01a 귀국일 | `spfr-normalize`는 1일 fixture만 사용 | 없음 | `tests/spfr-return-day.test.ts` 6개, `tests/fixtures/spfr-return-trip.ts`(4일 가상 원천: 05-04는 마지막 날, 숙박 없음) |
| T-01b 이동일 | 복수 지역 하루 없음 | 없음 | `tests/spfr-move-day.test.ts` 5개(05-03: fiction checkout·other 숙박) |
| T-01c Fact | `content-repository`는 두 여행 간 r1 격리·본문 편집 replay만, E2E는 A/B 여행 값 구분 | 일부(가이드 간 격리·Fact 갱신·고정 context 없음) | `tests/guide-fact-isolation.test.ts` 5개, `tests/e2e/guide-facts.spec.ts` 2개×PC/모바일, `tests/fixtures/guide-fact-isolation.ts` |

## 결과표(assertion ↔ 사례)

| 사례 | 확인 내용 | 위치 |
|---|---|---|
| a 날짜·순서 | day-31 누락 없음·ordinal 4·날짜·활동 순서·원천 시각 | return-day.test.ts:20 |
| a 상속 금지 | `regionIds=[]`·overnight 없음·숙박 2건뿐·05-04를 덮는 숙박 없음 | return-day.test.ts:38 |
| a 지역 미상/명시 | 미상: placeLinks·지도·예약 없음. 명시: place 지역 `other` 보존, day 숙박 지역은 여전히 없음 | return-day.test.ts:55·68 |
| a 타 날짜 불변 | 귀국일 포함/제외 변환에서 day-28~30 days/items/legs/stays 동일 | return-day.test.ts:88 |
| a 패키지 왕복 | canonicalJson 동일, day-31·stays 동일 | return-day.test.ts:100 |
| b 의미 | cityText `가상 지역 → 다른 지역`, overnight `other`, 두 활동이 각각 fiction/other 장소, 지역 2개 | move-day.test.ts:72·86 |
| b 시각·이동 | 출발 09:00–10:00, 도착 12:30(끝 없음), train 구간 1개, 다른 날 구간 없음 | move-day.test.ts:103 |
| b 날짜별 지역 | 28·29 fiction, 30 other, 31 없음 | move-day.test.ts:130 |
| b repository | 왕복 후 `get/plan/content` 동일, 별도 여행 가져온 뒤 첫 여행 `toEqual` 불변, 별도 여행에 `other` 없음 | move-day.test.ts:141 |
| c 처음 | 두 가이드 r1·토큰 `opening` 동일, 각자 Fact·상태(미확인/확인됨) | guide-fact-isolation.test.ts:108 |
| c 갱신 | `UpdateContent`로 A만 r2: A 새 값, B 값·헤드·가이드 헤드·plans·records 불변 | 같은 파일:131 |
| c 고정 context | plan-1 context는 r1 값, 현재는 새 값, contextRefs 불변 | 같은 파일:167 |
| c 다른 여행 | 같은 ID·r1·토큰의 fixture-b 값 불변, 서로 갱신해도 격리 | 같은 파일:185 |
| c 재열기·충돌 | 재열기 후 A→B→A 동일, 오래된 r1 기준 덮어쓰기 `CONFLICT` | 같은 파일:213 |
| c UI | PC/모바일: 처음 A/B, 재가져오기(ApplyReimport)로 A 갱신, A→B→A, 재로드, 과거 계획 `당시 고정 내용`, 다른 여행 | guide-facts.spec.ts |

한계: c의 repository 테스트는 `Guide.tsx:61-78`의 조회 규칙을 헬퍼로 재현한 것이며 UI 캐시 문제는 E2E가 증거다. Fact 편집 UI가 없어 E2E는 기존 재가져오기 UI 명령으로 갱신했고, `UpdateContent`는 repository 테스트에서 썼다. 사용자용 Fact 편집 기능이 아니다.

## 재현 방법

1. `pnpm exec vitest run tests/spfr-return-day.test.ts tests/spfr-move-day.test.ts tests/guide-fact-isolation.test.ts`
2. `pnpm run build` 후 `pnpm run test:e2e tests/e2e/guide-facts.spec.ts`(PC·모바일, 4173 preview는 Playwright가 기동).
3. 화면: E2E는 가상 검토 공간 `/?workspace=content&review=fiction-fact-isolation`에 패키지를 올린다. 임시 프로필은 테스트 종료와 함께 사라지며 URL만으로 DB가 공유되지 않는다. 사람이 보려면 `tests/fixtures/guide-fact-isolation.ts`의 `factIsolationTrip()`을 패키지로 만들어 같은 URL의 「여행 패키지 선택」에 올린다.
4. 기대 문구: 가이드 `가상 장소 1` 실용 → `시간: 가상 원문: 오후 개방` + `사실 확인 상태: 미확인 · … 2026-01-01`, `가상 장소 2` → `B 가이드 운영시간 오전 개방` + `확인됨 · … 2026-02-02`. 재가져오기 적용 뒤 장소 1만 `A 개정 운영시간 정오 개방`·`검토 필요`.

## 시도·수정 이력

- T-01a 커밋 직후 `tsc`가 fixture의 `unknown` 타입을 거부했다(명령 파이프 때문에 커밋이 먼저 진행). push 전이라 `JSON` 왕복 변환으로 고쳐 같은 커밋에 합쳤다.
- T-01b: `repository.plan()`은 저장 순서, `get()`은 `order` 정렬로 활동을 돌려줘 배열이 달랐다. 의미 동일성은 `order` 기준 정렬 비교로 두고 `order` 필드 자체도 단언한다(기대값 완화 아님).
- 스크린샷이 첫 화면만 찍어 Fact 줄이 보이지 않아 촬영 전 상태 줄로 스크롤하도록 고쳤다.

## 범위 밖 발견(관찰, 수정 지시 필요 여부는 Codex 판단)

`day.regionIds`는 그날을 덮는 숙박의 지역만 담는다(`spfr-candidate.ts:182-184`). 이동일 05-03의 `regionIds`는 `['other']`뿐이며 출발 지역 `fiction`은 day 필드에 없다. 출발 지역은 `cityText`·활동의 장소→지역 참조로만 복원된다. `decisions.md`의 "이동일은 명시 원천 지역을 포함한다"는 지역 콘텐츠·장소 수준에서 충족되고 day 필드 수준은 아니다. 현 동작을 `move-day` 테스트가 고정하므로 의도를 바꾸면 기대값 변경이 필요하다. 제품 코드는 수정하지 않았다.

## Git

| 커밋 | 목적 |
|---|---|
| `eec4200` | T-01a 귀국일(공통 fixture `spfr-return-trip.ts` 포함 — T-01b가 의존) |
| `30024f8` | T-01b 이동일 |
| `c253693` | T-01c Fact 격리 |
| 보고 커밋 | 본 문서·deferred-verification·handoff |

push 대상 origin/main, 원격 CI는 push 후 미확인. 강제 push·태그·worktree 없음. Pages 대상 경로 변경 없음.

## 판정

구현 완료 · 자동 검사 통과 · 실제 환경 미검증 · Codex 검토 대기 · 사용자 확인 검토 준비. G2/G2′/G3 전체 통과로 확대하지 않는다.

---

# R1 보완 (2026-10-27, 기준 `73d75f9`) · Codex 검토 대기 · 사용자 확인 검토 준비

위 T-01 결과는 보존한다. [Codex 검증](claude-task-01-review.md)의 두 보완만 수행했다. 제품 코드·의존성·workflow·공개 샘플 변경 없음.

## R1 요약·증거 색인

- R1-1 화면: 귀국일·이동일 가상 패키지 생성 명령과 PC·모바일 화면 12장을 만들었다. E2E 1개×PC/모바일 통과.
- R1-2 의미: `regionIds` 근거표·판단 후보 A/B는 [분석](claude-task-01-r1-regionids.md). **하루 `regionIds`의 복수 지역 보존은 미검증·판단 대기**이며 현 값은 관찰 블록과 `it.todo`로 분리했다.
- 검사: `pnpm run check` exit 0(단위 169 통과·1 skipped·1 todo, 포맷·린트·타입·빌드), 패키지 생성 exit 0, E2E 6개(guide-facts 2+return-move-days 1, PC·모바일) exit 0. 로그 `.cache/t01-r1-logs/`.
- 전체 `check:deferred`는 반복하지 않았다. 앱·제품 코드·공개 샘플이 그대로이고 변경은 tests·문서이며, 영향 검사(`check` 전체 + 변경·추가 E2E)로 충분하다고 판단했다.
- 미검증: 실제 원천·iPhone·실제 API. 이 화면 증거는 가상 fixture이며 실제 SP-FR 이동일 표기와 대조하지 않았다.

## R1-1 직접 확인 절차

**생성(새 의존성 없음, 출력은 Git 제외 `.cache/`)**

```powershell
$env:COREPACK_HOME = Join-Path (Get-Location) '.cache/corepack'
$env:T01_REVIEW_OUT = '.cache/t01-review'
pnpm exec vitest run tests/t01-review-packages.test.ts
```

`.cache/t01-review/`에 `fiction-return-unknown.zip`, `fiction-return-explicit.zip`, `fact-isolation-v1.zip`, `fact-isolation-v2-update.zip`, `manifest.json`이 생긴다(크기·SHA-256·tripId·fixture 함수명 기록. zip 해시는 생성할 때마다 달라질 수 있어 manifest를 기준으로 본다). 환경변수가 없으면 이 테스트는 건너뛴다.

**같은 입력 식별**: 패키지는 `tests/fixtures/review-packages.ts`가 단위 테스트와 같은 fixture 함수(`spfrReturnTripFixture('unknown'|'explicit')`, `factIsolationTrip()`, `factIsolationUpdatedTrip()`)로 만든다. 단위 테스트와 다른 점은 여행 이름뿐이다(한 프로필에 두 변형을 나란히 열기 위함, 이름 변경 후 이행 대응표 재생성). Fact 화면은 T-01의 기존 증거를 재사용한다.

**열기(빈 가상 전용 저장소)**: 사용자 검토 프로필·기존 저장소는 열지 않는다.
1. `pnpm run build` 후 4173 포트 소유를 확인하고 `pnpm run preview:ui`.
2. **InPrivate/시크릿 창**에서 `http://127.0.0.1:4173/?workspace=content&review=t01-human-review`를 연다. `review=` 이름이 별도 저장소를 만들 뿐 URL이 데이터를 공유하지는 않는다. 가져오기는 그 브라우저 프로필 안에만 저장되며 창을 닫으면 사라진다. 같은 프로필의 4173 사이트 데이터를 지우면 다른 저장소도 지워지므로 지우지 않는다.
3. 「여행 선택·가져오기」→ 「여행 패키지 선택」에서 `fiction-return-unknown.zip`, 「여행에 추가」, 같은 방식으로 `fiction-return-explicit.zip`.

**확인 동작과 기대 문구**(화면에 표시되는 값만; `regionIds`·`overnightRegionId`는 화면에 표시되지 않는다)

| 화면 | 동작 | 기대 |
|---|---|---|
| 전체 일정 | 「귀국일 장소 지역 미상」 여행 → 전체 일정 | 카드 4개: `가상 지역`·`가상 지역`·`가상 지역 → 다른 지역`·`가상 귀국` |
| 이동일 5/3 | 카드 `가상 지역 → 다른 지역` | `TRANSFER DAY`, `09:00 ~ 10:00 가상 출발`, `12:30 가상 도착`, 구간 `가상 출발 → 가상 도착 · train · 약 2시간 · 미상 · 가상 노선`, 버튼 `장소 안내 · 가상 장소`/`가상 다른 장소`, 하단 `숙박: 가상 다른 숙소` |
| 귀국일 5/4(지역 미상) | 카드 `가상 귀국` | `08:00 가상 공항`, `11:00 가상 선물 가게`, **`숙박:` 줄 없음**, `장소 안내` 버튼 없음 |
| 귀국일 5/4(지역 명시) | 「귀국일 장소 지역 명시」 여행 → `가상 귀국` | 위와 같고 `가상 선물 가게`에만 `장소 안내 · 가상 다른 장소`, `숙박:` 줄 없음 |
| 장소→지역 | 가이드 → 검색 `다른 지역` / `가상 지역` | `다른 지역`: `가상 다른 장소`만(지역 카드 제외), `가상 지역`: `가상 장소`만 |

스크린샷(PC 1504×1040·모바일 390×844 각 6장): `.cache/t01-review/screens/{desktop,mobile}-{1-overview-4days,2-move-day-0503,3-return-day-0504-unknown,4-return-day-0504-explicit,5-guide-search-other-region,6-guide-search-fiction-region}.png`. 재현: `pnpm run test:e2e tests/e2e/return-move-days.spec.ts`(자동 임시 프로필은 테스트 종료 때 폐기, 스크린샷·패키지는 `.cache/`에 남음, 콘솔 오류·가로 넘침 0건 단언).

## R1 커밋

| 커밋 | 내용 |
|---|---|
| 도구·화면 | `tests/fixtures/review-packages.ts`, `tests/t01-review-packages.test.ts`, `tests/e2e/return-move-days.spec.ts`, `tests/fixtures/guide-fact-isolation.ts`(`factIsolationUpdatedTrip` 추가)·`tests/e2e/guide-facts.spec.ts`(그 함수를 쓰도록 이동) |
| 의미 분리 | `tests/spfr-return-day.test.ts`·`tests/spfr-move-day.test.ts`: `regionIds` 단언을 관찰 블록으로 이동, `it.todo` 추가. 삭제로 완료를 주장하지 않음 |
| 문서 | `docs/claude-task-01-r1-regionids.md`, 본 R1 절, handoff |

시도·수정: 이름만 바꾼 패키지를 앱이 `INVALID_INPUT: 기준 B가 대상 콘텐츠와 다릅니다`로 거부했다(제 빌더가 이행 대응표를 갱신하지 않은 결함). 이름 변경 후 `currentMappings`를 다시 만들도록 고쳐 통과했다.

## R1 판정

구현·자체 검사 완료. `regionIds` 의미는 **미해결**(Codex 판정 대기, 후보 A 잠정 추천). Codex 검토 대기, 사용자 확인 검토 준비. G2/G2′/G3 종료·제품 코드 수정 승인을 뜻하지 않는다.
