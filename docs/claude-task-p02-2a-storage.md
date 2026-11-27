# Claude 지시서 T-P2-2a — 준비 자료 DB 저장: 저장 계약·DB 판 3·백업 판 3 (화면 없음)

- 작성 2026-11-27(Codex). 근거: [P2 설계서 v0.3 §10](p2-design.md). 사용자 결정(11/27 13:33 "모두 추천대로"): 목적 = 목적지별 보관함·여행에 기록·지워져도 잃지 않기 · 같은 목적지 여러 건 허용 · 보관함 삭제는 확인 뒤 삭제(되살리기 없음) · 여행의 준비 기록에 여행지·날짜·예산 답도 모두 남김 · 백업 판 3(이전 앱이 못 읽음) 수용 · **main 병합 전 현재 형식 전체 백업을 다른 매체에 보관(병합 조건)** · 순서는 T-E3-2b 다음.
- **순서: [T-E3-2b](claude-task-e03-2b-direct-entry.md)를 끝내고 보고한 뒤 시작한다.** 브랜치 `codex/p02-2-prep-db`(그때의 main 기준). T-P2-2b·c도 같은 브랜치에 이어 쌓는다. **main 병합은 Codex가 b·c까지 검토하고, 사용자가 병합 조건을 채운 뒤 한 번에 한다.**
- 이 작업은 데이터 경계 4곳(`src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts`)을 바꾼다 — 허용. `worker/`·`.github` 변경 0건. 화면 변경 0건.
- 아래 세부(이름, 키, 판 번호 표기)는 **Codex가 정했다 — 사용자 합의가 아니다.** 맞지 않거나 막히면 멈추고 보고한다.

## A. 저장 계약 (`src/contracts/v2/`)

1. 보관함 항목 `prepLibraryEntry`: `spaceId, entryId, revision(양의 정수), name(빈 글 거부), destination, guideText, selections, answers(취향 8칸 — `pickLastAnswers`와 같은 칸), createdAt, updatedAt`. 여행지·날짜 답은 받지 않는다(스키마에서 거부).
2. 여행의 준비 기록 `tripPrepRecord`: `spaceId, tripId, recordId, recordedAt, answers(준비 초안의 답 전체), destination, guideText, selections`. 만든 뒤 바꾸지 않는다.
3. `selections`·`answers`의 모양은 지금 준비 초안(`PrepDraft`)과 같게 한다. 크기 한도는 가이드 한도와 같다.

## B. DB 판 3 (`src/repository.ts`, `src/storage/schema.ts`)

1. `this.version(3).stores({ ...storesV2, prep_library: '[spaceId+entryId],[spaceId+destination]', trip_prep_records: '[spaceId+tripId+recordId],[spaceId+tripId]' })`. 업그레이드 함수 없음(기존 자료 변환 없음).
2. 시험: 판 2 DB에 실제 모양의 자료를 넣고 판 3으로 열면 모든 표·건수·내용이 그대로다(`fake-indexeddb` 등 지금 시험 방식).

## C. 저장 경로

1. 보관함: 저장(새 건) · 덮어쓰기 · 이름 바꾸기 · 삭제를 **저장소 트랜잭션**으로. 덮어쓰기·이름 바꾸기·삭제는 호출자가 가진 `revision`과 다르면 `CONFLICT`로 거부한다(오래된 판을 덮어쓰지 않음). 읽기: 목록(목적지·이름·updatedAt·항목 수·고른 것 수), 한 건.
2. 여행의 준비 기록: `ImportNewTrip` 입력에 선택 칸 `prepRecord`를 더한다. 있으면 새 여행과 **같은 트랜잭션**에서 1건 저장한다. 여행 저장이 실패하면 기록도 없어야 하고, 기록 검증이 실패하면 여행도 만들지 않는다. 없으면 지금과 같다.
3. 여행 삭제·비활성화가 있으면 그 여행의 준비 기록도 같은 규칙을 따른다(지금 여행 자료가 어떻게 처리되는지 확인해 같게 하고 보고에 적는다).

## D. 백업 판 3 (`src/transfer/`, `exchange.ts`)

1. 전체 백업 매니페스트 `version 3`. `trip_prep_records`는 `exchangeCollections`에 더한다(행마다 `tripId`). `prep_library`는 여행에 속하지 않으므로 공간 단위 파일 `records/prep_library.ndjson`으로 따로 담는다(매니페스트 파일 목록에 `collection` 또는 그에 맞는 표시).
2. 읽기: **판 2와 판 3 백업을 모두** 읽는다. 판 2에는 두 표가 없다(빈 것으로 처리). 판 3은 무결성(sha256·건수) 검사를 기존 표와 같게 한다.
3. 복원은 빈 공간 전용 그대로. 복원 뒤 보관함·준비 기록 건수·내용이 같다.
4. 여행 1건 보내기·이행 패키지(trip-transfer)에는 준비 기록을 포함하고 보관함은 포함하지 않는다. 이 패키지 판을 바꿔야 하면 멈추고 보고한다.

## 시험·보고

- 단위: A의 허용·거부, B 판 올림 보존, C 보관함 CRUD·오래된 판 거부·같은 목적지 여러 건, C2 원자성(둘 다 있거나 둘 다 없음), D 판 2·3 읽기·왕복·변조 거부. **기존 백업·복원·이행 시험은 수정 없이** 통과해야 한다(고쳐야 하면 이유를 적는다).
- `pnpm run check`, `test:e2e:all`(포트가 막혀 있으면 CI로 대체한다고 적는다). push 뒤 CI 통과 확인. `docs/claude-task-p02-2a-result.md`에 바뀐 파일·판 번호·시험 목록을 적어 보고한다.
- 멈춤: 기존 백업·이행 시험의 기대값을 바꿔야 한다 / `ImportNewTrip`의 원자성을 지킬 수 없다 / 판 2 자료가 판 3에서 하나라도 달라진다 / 패키지(trip-transfer) 판을 올려야 한다.
