# P-01 공유 계약·가상 표본

2026-10-21 · 구현·검증 완료. 기존 v1 앱/DB에는 연결하지 않았다.

> 이후 실행 갱신(2026-10-22): P-02~P-05를 구현·검증했다. 이 문서의 ‘다음 P-02/미구현’은 P-01 종료 당시 기록이며 최신 결과와 구체화한 영수증/원천 mapping은 [인계](handoff.md) 및 [저장 계약](storage-and-exchange-contracts.md)을 따른다.

이 문서의 필드 구체화는 작성자의 기술 구현 선택이다. 사용자 요구의 추가 합의나 실제 원천 이행 완료가 아니다. 설계 기준은 [저장·교환 계약](storage-and-exchange-contracts.md), [D/P/V 대응](content-db-mapping.md), [대표 계획](pilot-migration-plan.md)이다.

## 코드와 사용 경계

공유 진입점은 [`src/contracts/v2/index.ts`](../src/contracts/v2/index.ts)다. 브라우저 번들 및 Node 24의 직접 TypeScript 로딩을 확인했다. 기존 `src/domain.ts`/`src/repository.ts`/v1 파일 입력과 분리했다. DB 생성·변환·저장·자동 활성화는 수행하지 않는다.

| 파일 | 실행 계약 |
|---|---|
| primitives.ts / time.ts | 안정 ID, 안전 정수, 여행/종류/불변 revision 참조, SHA-256, TimeSpec 및 구간 |
| content.ts | region/place/guide/fact/evidence/asset/booking/task/phrase-book/map-target의 strict payload와 head |
| planning.ts | 여행 헤더, 계획/일자/활동/이동/숙박, actual/note/task-state/legacy-state, 계획 연산만 가능한 변경안 |
| validate.ts | 여행별 전체 참조·중복·revision 연결·본문 바인딩·context 전이 참조 검사, 기존 불변 행 보존 후보 검사 |
| json.ts / exchange.ts | 중복 객체 키를 거부하는 JSON 경계, canonical JSON/SHA-256 fingerprint v2, C-01~09의 15개 명령 분기, 추출 v1·패키지/백업 v2 envelope와 manifest 경로 |

`validateTripDataset(raw)`의 aggregate는 **검증 후보용**이다. 장문/첨부/이력을 기존 trips aggregate에 추가 저장하는 구조가 아니다. `validateImmutableTransition(before, after)`도 순수 후보 검사이며 원자 저장·동시 입력 보호를 대신하지 않는다. 새 저장 경로는 P-02에서 repository 트랜잭션으로 연결해야 한다.

## 이번 필드 구체화

- 콘텐츠 종류 `guide`, `task`, `phrase-book`, `map-target`는 물리 kind 값이다. guide.payload의 `documentKind`는 place-guide/region-guide/region-essentials/transit/preparation/language-guide로 구분하며 structuredData도 종류별 허용 필드만 받는다. 임의 JSON으로 본문·예약을 우회하지 않는다.
- 시작/종료는 `time: { start, end? }`로 묶는다. local은 timeZoneStatus=unknown/confirmed를 필수로 받으며 unknown에 시간대를 채우지 않는다. 확인된 시간대의 DST 결손 시각은 거부하고 중복 현지 시각은 local로 남길 수 있다. instant는 offset과 실제 시점을 모두 검증한다.
- content heads는 `targetKind`를 사용하고 revision 행은 `kind`를 사용한다. 실제 물리 S-03/S-04 키 대응은 P-02에서 한다. 물리 spaceId는 논리 계약에 없다.
- day/activity 대상 참조에는 planVersionId가 필요하다. 예약·회화의 일자/활동 연결도 고정 계획 ID를 담는다. 계획 contextRefs는 관련 콘텐츠와 Fact/Evidence/Asset 등 전이 참조의 revision을 고정하고 Asset에는 hash도 고정한다. 가이드의 저장 당시 factBindings와 계획/기록의 표시 context를 구분한다.
- 초기 내부 본문 문법은 `{{fact:token}}`, `travel://<content-kind>/<entityId>`, `asset://<assetId>`다. 섹션 factRefs/linkRefs/assetRefs와 factBindings를 교차 검사한다. 이는 원본 SP-FR 문법 전체의 변환 완료를 뜻하지 않는다. 원본의 앵커/상대 링크/HTML·미지원 표현 분류와 표시 동등성은 P-03/04에서 처리한다.
- 명령은 `format=travel-app-command`, `commandVersion=2`, normalizationVersion을 가진다. 파일 manifest는 format/version/domainSchemaVersion으로 구분한다. 기존 schemaVersion=1 자료를 새 계약으로 재해석하지 않는다.
- 명령 입력에서 내부 commitSeq·기록 저장 시각·actor를 받지 않는다. 호출자가 발급한 ID와 명시적 업무 입력만 fingerprint에 넣고, 저장 결과 필드는 repository가 발급한다. 실제 발생 시각인 TimeSpec은 명시적 입력이다. 적용 결정에는 confirmedByUser=true가 필요하며 P-02에서 pending·저장된 baseDomainRevision을 다시 검사해야 한다.
- 외부 JSON은 parseStrictJson/parseCommandJson/parseManifestJson을 사용한다. 중복/escaped 키·잘못된 JSON·비유한/안전 범위 밖 정수·중첩/바이트 한도를 거부한다. canonical JSON은 키만 재귀 정렬하고 본문 공백·Unicode·배열 순서를 유지한다.
- manifest는 선언된 collection/path/수량/크기 조합과 중복·허용 목록을 검사한다. 실제 ZIP 스트리밍 한도, symlink 판별, 파일 바이트 해시·NDJSON 수량 대조·스키마별 적재·완전한 백업 포함 범위·복원 활성화는 아직 구현하지 않았다. 선언이 유효한 manifest를 복원 가능한 파일로 판정하지 않는다.

## 가상 표본과 검사

[`tests/fixtures/pilot.ts`](../tests/fixtures/pilot.ts)는 F-01 A(3일·2지역·4장소·재방문)와 F-02 B(1일·다른 언어·같은 source slug의 독립 사본)를 만든다. 3섹션 본문·표·Fact 토큰·내부 링크·미정/현지/DST 시각·코드 예약 대응·작업·숙박·동선·회화 추천·작은 PNG/PDF 바이트·legacy 체크·예정 외 실제 기록·미적용 모의 변경안을 포함한다. 실제 여행 값은 사용하지 않는다.

F-04에는 교차 여행/중복 ID/깨진 Fact·본문 링크·첨부·활동/전이 참조 누락과 시간·정정 분기·버전·경로·중복 JSON/ZIP entry 목록 실패 사례가 있다. ZIP 안전 처리 전체, B/L/R 충돌·용량 부족·취소/재시작의 저장 시나리오는 후속 단계다.

[`tests/fixtures/booking_literals.py`](../tests/fixtures/booking_literals.py)는 가상 리터럴과 미지원 계산식, 실행되면 실패하는 문장을 담는다. [`scripts/check-pilot-environment.py`](../scripts/check-pilot-environment.py)는 AST literal_eval과 임시 XLSX 표본을 검사한다. XLSX는 날짜·시각 원문·0·빈 값·캐시 없는 수식을 포함하고 `.cache/pilot-fixtures/` 하위 임시 경로에 생성/검사한다. 원천 파일 읽기 전후 해시 불변도 확인한다. 이 스크립트는 환경 검사이며 P-03의 생산용 추출기는 아니다.

## 전용 환경과 재현

Node 24.13.1/npm 11.8.0 및 기존 직접 의존성을 유지했다. 추가 고정 버전은 react-markdown 10.1.0, remark-gfm 4.0.1, @zip.js/zip.js 2.24.0이다. npm registry peer/engine 메타데이터·npm ls를 확인했고, 실제 React SSR 표/HTML 차단 및 ZIP UTF-8 왕복을 검사했다. 별도 Vite 브라우저 번들 검사는 `.cache/pilot-dependency-build/`에 출력하며 실행 앱에는 연결하지 않는다.

프로젝트 `.venv/`를 만들기 전에 Git 제외 규칙을 추가했다. 전역 Python과 다른 프로젝트는 변경하지 않았다. Python 3.12.7, openpyxl 3.1.5, et-xmlfile 2.0.0이며 버전은 `.python-version`/`requirements-extract.txt`에 기록했다.

PowerShell 재현 명령:

```powershell
npm ci
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip --cache-dir .cache/pip install -r requirements-extract.txt
.venv/Scripts/python.exe -m pip check
npm run check
npm run check:pilot
```

check:pilot은 native Node 공유 계약 로딩/fingerprint, Python 환경·AST/XLSX 3검사, 새 라이브러리/계약의 별도 브라우저 번들을 실행한다. 이 호스트에서 기존 AI 모의 검사의 임시 파일 rename/localhost 연결 및 npm 설치는 기본 샌드박스에서 제한되어 허용된 확장 실행으로 완료했다. TLS 검증을 우회하거나 유료 API를 호출하지 않았다.

## 완료와 다음 단계

- `npm run check`: 단위/통합 79개 통과(기존 26 + 신규 53), TypeScript 및 기존 앱 프로덕션/PWA 빌드 통과.
- `npm run check:pilot`: native Node, Python 3검사, 별도 Vite 브라우저 번들 통과. `npm ls --depth=0`, `pip check` 통과.
- 기존 UI·저장 흐름을 변경하지 않아 E2E는 이번에 재실행하지 않았다. 과거 E2E 통과를 새 이행 검증으로 재사용하지 않는다.
- P-01 완료, P-02 미착수. S-01~20 실제 store/트랜잭션·v1 보호/명시적 전환·receipt replay가 다음이다. R-01~09 전체 흐름·실제 원천·휴대폰·새 백업 복원은 미검증이다.
