# Claude C-01 결과 · 새 여행 → 지역·장소 작성 → 일정 연결

2026-10-29 · **구현·자체 검사 완료 / Codex 검토 대기 / 사용자 확인 검토 준비** · 시작 `429a5f4` · 브랜치 `codex/c01-authoring` · 기능 커밋 `b49bd16` `8089c8f` `143717a` `3e1c4c9`

## 요약

- 개발계획 T-C1·T-C2·T-C3.1을 한 사용자 흐름으로 구현했다: 지역 없는 새 여행 생성 → 가이드에서 지역·장소+설명 작성 → 오늘 화면에서 장소 연결·순서/시각 수정 → 재실행·백업 복원 뒤 재조회.
- 모두 가상 입력이다. 사용자 DB·iPhone·실제 ZIP·main·배포·API는 건드리지 않았다.

## 변경 범위

| 커밋 | 단위 | 내용 |
|---|---|---|
| `b49bd16` | T-C2 | `src/content/trip-factory.ts`(순수 함수): 이름·실재 달력 날짜·역전 기간·3660일 한도·확인한 시간대 검증, 콘텐츠 참조 없는 날짜 행(`regionIds=[]`, 야간 미설정). 새 여행 모달이 사용하고 시간대 입력 추가. 빈 날 안내문. |
| `8089c8f` | T-C1 | 신규 명령 `CreateContentBatch`(`exchange.ts`), 저장 로직 `src/storage/content-batch.ts`, `mutate` 분기 연결. |
| `143717a` | T-C3.1 | `src/content/Authoring.tsx`(지역 작성·장소+설명 작성 모달), 가이드 화면 버튼, 일정 편집의 "연결할 장소" 선택, 항목 위로/아래로. |
| `3e1c4c9` | 시험 | 명령 분기 전수 계약 시험에 새 분기 추가(기대값 완화 아님). |

### 계약 결정 (설계 §4.2 제안과의 차이·근거)

- 명령 이름은 제안 그대로 `CreateContentBatch`. payload `{ create: 1~20, updateOwners: 0~20 }`, 최상위 `expectedDomainRevision`. 각 소유자 갱신은 `expectedRevisionId` + 새 revision(`previousRevisionId` 일치).
- 입력 종류를 `region|place|guide`(소유자 갱신은 `region|place`)로 제한했고 `commitSeq/recordedAt/actor`는 저장소가 부여한다. 범용 쓰기 API가 아니다.
- 최종 그래프 검사: `place.guideId`↔place-guide `ownerRef`, `region.guideIds`↔guide `ownerRef`, place-guide는 장소가 가리켜야 하고 region-guide는 지역이 가리켜야 한다. `place.regionIds`는 활성 지역이어야 한다. 이 C-01 UI가 쓰지 않는 다른 가이드 종류는 거부한다. 중복 ID·이전 revision을 가진 신규 콘텐츠·비활성/없는/다른 여행 참조·필수 섹션 누락(기존 검증)·stale 도메인 revision·stale 소유자 revision 거부.
- 기존 `execute()` 트랜잭션을 그대로 쓰므로 어느 단계든 실패하면 콘텐츠·head·여행 revision·영수증이 함께 롤백되고, 성공 시 여행 revision은 정확히 1 증가, replay는 영수증으로 처리된다. 명령/파일 버전(`commandVersion` 2, 패키지 v2)은 올리지 않았다(추가 분기라 구 파일 읽기에 영향 없음).
- 한 번의 저장으로 장소와 설명을 만들며 부분 상태(설명 없는 장소)는 UI 경로로는 생기지 않는다.

## 검사

| 명령 | 결과 |
|---|---|
| `vitest tests/content-batch.test.ts` (14) | 통과. 원자 생성·소유 갱신·거부 7종·stale 2종·비활성 참조·replay/재사용·쓰기 실패 롤백·과거 계획/기록 불변·두 여행 격리 |
| `vitest tests/authoring-plan.test.ts` (4) | 통과. 장소 링크 새 계획+이전 불변+contextRefs, 순서·시간 변경 이력, **같은 계획 ID라도 다른 탭 기록으로 revision이 바뀌면 CONFLICT**, 전체 백업→빈 DB 복원 일치 |
| `vitest tests/trip-factory.test.ts` (8) | 통과 |
| `pnpm exec playwright` `tests/e2e/authoring.spec.ts` | desktop 3·mobile 3 통과(빌드 후) |
| `pnpm run check:deferred` | **exit 0**, `.cache/verification/2026-10-29T07-22-55-706Z/`, 로그 `.cache/t03-logs/c01-deferred.log` |

E2E 이름(desktop·mobile 동일):
1. 새 여행→지역·장소 작성→일정 연결·순서 변경→재실행 뒤에도 같은 내용을 읽는다 (빈 날 안내, 전체 일정 3일, 작성 후 상세, 장소 연결·시각 입력, 위로 이동, reload 후 순서·장소 안내·본문, 가이드 검색)
2. 두 여행의 작성 내용은 섞이지 않고, 입력 오류는 입력을 보존한다 (필수 설명 누락 시 입력 유지)
3. 작성한 여행을 전체 백업해 빈 브라우저에 복원하면 같은 내용을 다시 읽는다 (2개 여행, 복원 뒤 활동·장소 본문, 두 번째 여행 비어 있음)

첫 `check:deferred` 시도는 명령 분기 전수 시험이 새 분기 수와 달라 실패했고(`17 vs 16`), 분기를 추가한 뒤 통과했다. E2E는 `dist`를 쓰므로 UI 변경 뒤 `pnpm run build`가 필요하다(`check:deferred`는 포함).

원격 CI(`11b8760`): 1차 시도는 기존 `content.spec.ts` '전체 ZIP 백업 파일 저장→빈 브라우저에서 오프라인 미리보기·복원·재시작'(mobile)이 첫 단계 `가상 여행 둘러보기` 버튼 대기 30초 초과로 실패(65 통과·1 실패). 로컬 전체 검사에서는 같은 시험이 통과했고 새 코드와 무관한 첫 화면 대기라 불안정(flaky) 가능성이 높다고 보지만 원인을 규명하지 않았다. 실패한 작업만 재실행한 2차 시도는 성공했다. 재발하면 별도 조사 대상이다.

## 사용자가 볼 수 있는 산출물·확인 동작

실행: `pnpm run build && pnpm run preview:ui` → `http://127.0.0.1:4173/?workspace=content` (또는 `dev:ui` 5173). 새 브라우저 프로필 또는 빈 검토 공간에서만 확인한다(기존 프로필 사용 금지).
1. `여행 선택·가져오기` → `새 여행` → 이름·기간(·시간대) → 만들기. 오늘 화면에 "아직 일정이 없습니다" 안내, 전체 일정에 날짜 카드.
2. 하단 `가이드` → `지역 작성`, `장소 작성`(왜 가는가 필수) → 저장하면 상세 화면으로 이동. 목록·검색으로 다시 찾기.
3. `오늘` → `활동 추가` → 연결할 장소 선택·시각 → `계획 저장`. 항목의 `위로/아래로`, `일정 수정`. `장소 안내 · …`로 상세 이동.
4. 새로고침 후 같은 내용. `저장소·백업`에서 전체 백업→빈 브라우저 복원.
화면 캡처는 별도로 만들지 않았다. 증거는 위 시험 이름과 로그다. 모바일은 Playwright 에뮬레이션(Pixel 7)이며 실기기 확인이 아니다.

## 미검증·한계

- 사용자 화면 확인(편집 경험: 입력 항목 수, 문구)과 Codex 독립 검토는 대기. 실기기(iPhone) 작성 확인 없음.
- 오프라인 상태에서의 신규 작성·재조회는 이번에 새로 검사하지 않았다(기존 오프라인 시험은 그대로 통과).
- 구 v2 파일/백업 읽기: 기존 시험(`check:deferred` 단위·E2E 복원)이 변경 없이 통과. 새 영수증 종류(`CreateContentBatch`)가 든 백업은 이 변경 이전 앱이 읽지 못할 수 있다(영수증 종류 열거). 배포 순서 결정 시 참고.
- T-05 재가져오기 비교: 기존 시험 통과. 작성 콘텐츠가 든 가져온 여행의 재가져오기 app-only 보존은 이번에 별도 시험하지 않았다(T-C7 범위).

## 경미한 발견 (영향·재개 조건)

1. `timeZone` 공용 스키마(`primitives.ts`)가 `Mars/Base` 같은 알 수 없는 이름을 통과시킨다(폴리필 동작). 새 여행 생성은 플랫폼 `Intl`로 추가 검증했지만 `TimeEditor`의 시간대 입력은 같은 구멍이 있다. 영향: 잘못된 시간대 저장 가능. 재개: T-C3.2 숙박/시간대 입력 전에 스키마 강화.
2. 작성 후 장소 이름·요약·소속 지역과 지역 소개를 고치는 UI는 없다(본문 섹션 편집만 가능). 영향: 오타 수정 불가. 재개: T-C4(지역/가이드 UI)에서 `updateOwners` 경로를 UI로 연결.
3. 장소는 `place-guide`만 UI에서 작성한다. 지역 가이드 문서는 계약·저장은 지원하지만 UI 없음(T-C4).
4. `위로/아래로`는 같은 날 안에서만 동작한다. 다른 날로 옮기기는 `일정 수정`의 날짜 선택을 쓴다(그 경우 해당 날 끝 순서로 들어감).
5. 일정 연결의 `relation`은 `visit` 고정(기존 값 보존).
6. handoff·개발계획·후속 목록은 Codex 관리 문서라 수정하지 않았다.

## Git

- 브랜치 `codex/c01-authoring`에 코드 4커밋 + 결과 문서 커밋. 미추적 `docs/status-review-2026-10-26.md`는 커밋하지 않았다. main 병합·배포 없음.
