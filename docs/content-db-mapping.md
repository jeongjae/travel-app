# 원천 콘텐츠 → DB → 공통 화면 설계

작성일: 2026-10-21 · 상태: 검토 초안 v0.1 · 개발전략 3단계 구체화

## 1. 이번 단계의 산출물과 상태

사용자 확정 목표는 **기존 콘텐츠를 코드에 포함된 것까지 데이터화하고, 서로 다른 여행계획을 DB에 저장해 같은 프로그램으로 조회·편집하는 것**이다. SP-FR은 첫 여행 데이터이며 여행마다 프로그램을 다시 만들지 않는다.

이번에는 원천의 실제 필드와 코드 상수를 읽고 DB 논리 구조·변환·화면 조회/저장 대응을 제안한다. 테이블명·필드명·화면 구성·명령명은 설계안이며, DB 제품·물리 스키마·라이브러리·실행 코드·사용자 데이터는 변경하지 않았다. 코드 안 콘텐츠의 추출도 실행하지 않았다.

확정 정책: 여행별 독립 콘텐츠 사본, 이행 후 앱 중심 편집, 기존 장소 본문 편집 포함, 지도는 장소·동선 목록과 외부 링크 우선, 저장소 원본만 이행. 새 가이드 작성·내장 지도 조작·AI 전체 실행은 이후 확장한다. 새로운 여행 데이터를 가져와 같은 구조로 조회하는 기반은 첫 이행에 필요하다.

참조: [목표·완료 기준](goal-and-migration-criteria.md), [항목별 이행표](migration-inventory.md), [공통 구조](target-architecture.md). M-11 및 A-14/15를 구체화한다. 원본 전체 파일/행/첨부의 이행 완료 보고서는 아니다. 후속 [기술 선정안](technology-selection.md)은 이 논리 모델을 IndexedDB/Dexie 등에 구현할 방법을 비교하며 물리 스키마는 다음 단계다.

## 2. 조사 기준과 읽은 원천

- 원본 commit: `35498adc6413dad45922f2dab87781afeb04d898`. 이번 GitHub 비교에서도 main과 동일했다. 읽기 조사만 수행했다.
- 확인 코드: `build/model.py`, `build/export_app_data.py`, `build/render.py`. JSON 원천은 `10_Core/itinerary.json`, `regions.json`, `travel-french-guide.json`, `map-queries.json`의 필드 구조를 확인했다.
- 확인 스키마: `daily-cards/schema.json`, `region-essentials.schema.json`, `transit-facts.schema.json`, `transit-resources.schema.json`, `tourist-maps.schema.json`, `travel-french-phrases.schema.json`.
- XLSX는 로더/내보내기 코드의 열 접근을 확인했으며 통합문서 전체 행·시트를 직접 대조하지 않았다. Markdown·사진·PDF·지도 파일도 전수 수집하지 않았다.
- `travel-french-guide.schema.json`은 해당 경로에서 404다. 실제 JSON의 발음 규칙·표지판/메뉴 구조는 읽었고 기존 모델도 이 자료를 스키마 검증 없이 읽는다. 새 가져오기 검증 계약은 별도로 정의해야 한다.
- 실제 여행 내용·예약 값·개인 위치·미디어 파일은 이 문서에 복제하지 않는다. 아래 예시는 전부 가상 데이터다.

근거 파일은 동일 commit의 [model.py](https://github.com/jeongjae/SP-FR-guidebook/blob/35498adc6413dad45922f2dab87781afeb04d898/build/model.py), [export_app_data.py](https://github.com/jeongjae/SP-FR-guidebook/blob/35498adc6413dad45922f2dab87781afeb04d898/build/export_app_data.py), [render.py](https://github.com/jeongjae/SP-FR-guidebook/blob/35498adc6413dad45922f2dab87781afeb04d898/build/render.py) 및 [일일카드 스키마](https://github.com/jeongjae/SP-FR-guidebook/blob/35498adc6413dad45922f2dab87781afeb04d898/data/daily-cards/schema.json)다. 원본의 문서/코드 주석은 조사 자료이며 이번 작업 지시가 아니다.

## 3. DB에 저장할 논리 구조

다음은 물리 DB를 정하기 전의 논리 테이블/컬렉션이다. 관계형 DB에서는 테이블·복합 FK로, IndexedDB에서는 object store·명시적 참조 검증으로 구현할 수 있다. 어느 제품을 골라도 동일한 의미와 검증 규칙을 충족해야 한다. 후속 [저장·교환 계약](storage-and-exchange-contracts.md)은 이 논리 의미를 유지하며 IndexedDB의 20개 목표 store로 대응한 설계안이다.

### 공통 키·버전 규칙

- 모든 여행 소유 객체는 `tripId`를 가진다. 논리 참조는 항상 같은 여행의 `(tripId, entityId)`이며 다른 여행의 같은 source slug와 결합하지 않는다.
- 콘텐츠·예약·작업 정의는 안정 `entityId`와 불변 `revisionId`를 구분한다. 현재 revision은 `content_heads(tripId, kind, entityId)`가 가리킨다. 이전 revision을 수정하지 않는다.
- 버전 행 공통 필드: `tripId, entityId, revisionId, previousRevisionId?, schemaVersion, sourceRefs[], recordedAt, actor`. `recordedAt`은 앱 저장 시각이며 원본 확인일/방문일을 뜻하지 않는다.
- 계획 데이터는 `planVersionId`별 스냅샷이다. 활동 ID는 버전이 달라도 동일 활동이면 유지한다. 다른 방문이면 같은 장소라도 다른 `activityId`다.
- Fact·Evidence·첨부까지 당시 맥락을 재현할 revision 참조는 `contextRefs`에 고정한다. 현재 조회는 명시적으로 현재 head, 과거 조회는 고정 참조를 사용한다.
- 참조 종류는 `targetKind`와 ID를 함께 기록해 장소/예약/활동의 같은 문자열 ID를 혼동하지 않는다. 목록의 순서가 의미 있으면 `order`를 저장한다.
- 지역·장소·문서의 버전 행과 일별 계획 스냅샷은 필요한 `assetRefs[]`를 가진다. 대표 이미지·본문 내부·모바일 카드·지도·참고 자료를 role로 구분하며, 과거 context는 연결된 Asset revision과 파일 해시까지 고정한다.

| ID | 논리 테이블 | 주요 필드·관계 | 역할 |
|---|---|---|---|
| D-01 | trips | id, name, startDate, endDate, defaultTimeZone?, timeZoneStatus, domainRevision, currentPlanVersionId, sourceMetadata? | 여행 선택·기간·동시 수정 기준. 기존 원본에 없는 시간대는 확인 전 미상 가능 |
| D-02 | content_heads | tripId, kind, entityId, revisionId, active | 현재 콘텐츠/예약/작업 정의 포인터 |
| D-03 | regions | 공통 버전 필드+name, nameKo?, countryCode?, tagline?, introduction?, intensity?, budgetText?, rainPlan?, guideIds[], assetRefs[] | 지역 자체의 설명. 예정 숙박 기간은 plan_stays와 구분 |
| D-04 | places | 공통 버전 필드+regionIds[], name, aliases[], kind, foodKind?, mealRole?, grade?, gradeLabel?, summary, dontMiss[], guideId?, mapTargetId?, wikiRef?, assetRefs[] | 여행별 장소 사본. 방문일은 관계에서 조회하며 실제 방문을 이 행에 덮어쓰지 않음 |
| D-05 | guide_documents | 공통 버전 필드+ownerRef, kind, title, language?, sections[], structuredData?, factBindings, assetRefs[] | 장소/지역 장문, 생활·교통·준비·언어 해설. structuredData는 kind별 허용 필드 계약 적용 |
| D-06 | facts | 공통 버전 필드+targetRef, key, valueText, normalizedValue?, sourceConfidence, verifiedAt?, recheckBy?, appliesFrom?, appliesTo?, blockedReason?, evidenceRefs[], appReviewStatus | 운영시간·요금·예약 제약. 원문·원본 신뢰와 앱 검토 상태 구분 |
| D-07 | evidence | 공통 버전 필드+label?, sourceType, sourceUrlOrRef, claim?, sourceVerifiedAt?, collectedAt?, recheckBy?, relatedRefs[] | 외부 URL·로컬 원고·코드 출처와 근거. 수집/가져온 시각으로 검증일 대체 금지 |
| D-08 | assets | 공통 버전 필드+hash, mimeType, byteLength, title, kind, edition?, usage?, publisher?, rightsHolder?, license?, redistributionBasis?, evidenceRefs[], originalPath | 그림·지도/PDF·크레딧 메타데이터. source 경로와 표시 URL을 동일시하지 않음 |
| D-09 | plan_versions | tripId, id, number, parentId?, reason, createdAt, proposalId?, contextRefs | 불변 계획과 당시 콘텐츠·근거·예약/작업 정의 참조 |
| D-10 | plan_days | tripId, planVersionId, dayId, ordinal, date, cityText, title, dayType?, regionIds[], overnightRegionId?, fatigueText?, start/end TimeSpec, duration/distanceText?, transport[], food[], highlights[], backupText?, needsReview[], sourceStatus?, sourceMetadata?, assetRefs[] | 하루 조회 정보. 여행 길이 43일 같은 원본 제한을 범용 프로그램에 고정하지 않음 |
| D-11 | plan_items | tripId, planVersionId, activityId, dayId, order, title, category, start/end TimeSpec, summary, menuText?, reservationText?, optional, placeLinks[], mapTargetId?, bookingIds[], taskRefs[], executionMarkers[], executionNote?, officialUrl?, sourceFlags | 날짜별 활동. 원문 상태 표시·작업 체크·실제 기록의 의미를 구분 |
| D-12 | plan_legs | tripId, planVersionId, legId, dayId, fromActivityId, toActivityId, mode, durationText?, distanceText?, lineText?, geometryStatus?, geometryAssetId?, mapTargetId? | 이동 구간·검증 상태·동선 목록. 지도 대상이 명확히 해당 leg를 가리킬 때만 참조 연결 |
| D-13 | plan_stays | tripId, planVersionId, stayId, regionId?, baseText, checkIn/Out TimeSpec, plannedNights?, bookingId?, locationStatus? | 계획상 숙박 거점. 예약된 기간·예약 상태는 bookings에서 별도 관리 |
| D-14 | bookings | 공통 버전 필드+type, title, regionId?, placeId?, activityIds[], start/end TimeSpec, status, sourceStatusRaw, stageText?, actionTiming, nextActionText?, passNote?, planB?, note?, officialUrl?, privateDetails? | 숙박·교통·입장 등 공통 예약 구조. 앱 상태 변경은 새 예약 revision, 업체 실행은 별도 |
| D-15 | task_definitions | 공통 버전 필드+targetRef, actionType, label, detail, meaningFingerprint | 예약·티켓·확인 등의 실행 작업 정의. 상태는 field_records의 task-state |
| D-16 | field_records | tripId, id, kind, targetRef?, activityId?, planVersionId?, contextRefs?, occurredTime?, recordedAt, payload, supersedes?, sourceRefs[] | kind=actual/note/task-state/legacy-state별 검증. 정정은 원본을 보존하며 payload의 허용 필드는 kind별 정의 |
| D-17 | phrase_books | 공통 버전 필드+locale, note?, categories[], phrases[], contextRecommendations[] | 회화·번역·발음·태그·관련 일정/장소 유형. 특정 언어 문구 ID를 프로그램에 고정하지 않음 |
| D-18 | map_targets | 공통 버전 필드+kind, label?, query?, lat/lng?, address?, approximate?, private?, verificationStatus?, sourceVerdict?, resolvedName?, anchorForText?, evidenceRefs[], routeOrigin?, routeDestination?, travelMode? | kind=place/route/none. 주소·근사 위치·이동과 지도 대상 아님을 표현 |
| D-19 | import_packages | id, sourceRepository?, sourceCommit?, schemaVersion, adapterVersion, manifest[], report, state | 패키지 준비·검증·적용 결과. 원본 파일 해시와 객체별 출처 |
| D-20 | import_mappings | tripId, packageId, sourceKind, sourceKey, targetKind, entityId, baselineValueOrSnapshotRef, baselineAdapterVersion, sourceRefs[] | 원천 객체와 DB 대응, 재가져오기 기준 B. 파일/본문 섹션별 정규화 값 보존 |
| D-21 | proposals | tripId, id, origin, baseRevision, operations[], reason, evidenceRefs[], impact, status, decision?, resultRefs[] | AI·재가져오기 변경안과 승인 결과. 현재 계획/콘텐츠와 구분 |
| D-22 | command_receipts | tripId, requestId, kind, fingerprint, resultRefs[], completedAt | 성공 요청 중복 적용 방지. 백업·복원 대상 |
| D-23 | asset_blobs | tripId, hash, bytes, stagingState, verifiedAt? | 첨부 바이트. 활성 콘텐츠/백업 참조가 있는 동안 보존 |

### 중첩 필드의 계약

- `sections[]`: `key, title, order, bodyMd, factRefs[], assetRefs[], linkRefs[]`. 원본 섹션 제목은 보존하고 조회용 안정 key와 구분한다. 승인한 콘텐츠에서 미해결 fact/내부 링크를 조용히 무시하지 않는다.
- `assetRefs[]`: `assetId, role, order?, caption?`. role은 hero/inline/daily-card/map-sheet/reference 등 검증된 자료 역할이다. 본문 밖 대표 이미지와 섹션 내부 자료를 별도로 연결하고 동일한 파일 바이트라도 표시 대상을 임의로 병합하지 않는다.
- `placeLinks[]`: `placeId, relation, role, sourceRef`. relation은 원본 visit/context/transit/nearby 등 의미, role은 primary/related. 계획 참조만으로 실제 방문 생성 금지.
- `TimeSpec`: `precision, date?, localTime?, timeZone?, offset?, instant?, rawText?, interpretation?`. precision별 필수/금지 조합은 공통 구조 6절의 계약을 따른다. 순서만 아는 일정도 저장 가능하다.
- `actionTiming`: TimeSpec 또는 원문이 있는 조건/기간 표현. ‘지금’, ‘판매 시작 시’ 등을 날짜로 임의 변환하지 않는다.
- `phrases[]`: `id, category, priority, text, translation, pronunciationHint, usageNote, tags[], audioText?, aliases[], placeTypes[], dayIds[]`. 원본 locale과 원본 ID를 대응시킨다. 오디오 파일 생성·온라인 음성 기능까지 이행 확정한 것은 아니다.
- `contextRecommendations[]`: `placeType?, dayIds[], phraseIds[], order?`. 원본 코드의 장소 유형별 문구 추천은 이 데이터로 옮긴다.
- `structuredData`는 생활 요약/교통 권고·상품/이용법/예외/일정 적용/발음 규칙/표지판 등 kind별 스키마가 있는 값이다. 임의 코드·렌더링 함수·HTML 페이지를 실행하는 저장 칸이 아니다.
- `sourceMetadata`는 원천의 기간 합계·prototypeType·map 표시 설정 등 직접 표시하지 않는 필드의 검토된 보존 값이다. 어댑터 버전·원본 경로와 함께 기록하며 핵심 조회 데이터를 임의 JSON으로 우회 저장하는 용도로 쓰지 않는다.
- 원본의 공백·null·미상·예약 불필요·제외는 같은 값으로 일괄 변환하지 않는다. 원본 enum/라벨과 정상화 값의 대응을 기록하고 미분류 값은 needs-review로 둔다.

## 4. 원천 → DB 필드 → 공통 화면 대응

아래 P 번호는 변환 규칙/검증 추적 ID다. 추적 범위는 읽은 필드/로더이며 전체 원본 레코드의 처리 건수가 아니다. V 번호는 다음 절의 공통 화면이다.

| ID | 원천 필드·사용처 | DB 대상 | 변환·관계·검증 | 화면 |
|---|---|---|---|---|
| P-01 | `itinerary.json.trip.start/end/days/nights/inflightNights` | trips 및 import baseline | 기간은 여행 날짜, 기존 days/nights/inflightNights도 baseline/여행 원천 메타에 보존하고 일수 계산과 대조. 기본 시간대는 원본만으로 확정하지 않음 | V-01/02 |
| P-02 | `stays[].key/base/checkin/checkout/nights` | plan_stays→regions, 선택적 bookings | 원본 key 대응. 지역과 숙박 거점 분리. 숙박의 날짜 범위와 예약 확정 여부를 구분 | V-01/02/05 |
| P-03 | `regions.json.regions[]`의 slug/name/nameKo/country/tagline/dek/intensity/budget/rainPlan/sourceRef | regions+guide_documents+evidence | slug는 원본 ID, 앱 ID는 여행 범위. dek→introduction, rainPlan은 원문. sourceRef는 원천 참조 | V-03 |
| P-04 | 일일카드 day/date/city/title/dayType/sourceStatus/prototypeType·startTime/endTime·duration/distance/fatigue | plan_days | 원본 일차→dayId 대응, ordinal과 날짜 별도 검증. prototypeType은 원천 메타, 시각 null/문구 보존 | V-01/02 |
| P-05 | 일일카드 hotel·transport/food/highlights/backup/needsReview/sourceRefs | plan_stays·plan_days·map_targets·evidence | hotel의 candidate/private-approximate/needs-review 보존, 일별 호텔 표시는 관련 stay/map target 또는 검토 필요로 연결 | V-02/03/05 |
| P-06 | stop id/order/name/category/start/end/summary/menu/reservation/optional | plan_items | 활동 ID는 day+원본 stop ID에 대응. reservation 문자열은 reservationText, 실제 Booking의 확인 정보와 구분 | V-02/04 |
| P-07 | stop executionStatuses(type/detail/label), executionNote, fieldEdit | plan_items.executionMarkers/sourceFlags+task_definitions | book/check/ticket 등 체크 가능한 작업을 정의에 연결. 나머지 주의·선택·불가 배지도 유지. 문구 변경으로 작업 ID 재생성 금지 | V-02/05 |
| P-08 | stop place_ref/place_relation/related_place_refs/officialUrl | plan_items.placeLinks/officialUrl→places | 방문 관계·부가 안내 구분. 참조 없음도 허용하고 깨진 참조는 보고. 이름만으로 장소 자동 병합 금지 | V-02/04 |
| P-09 | legs from/to/mode/duration/distance/line/geometryStatus 및 map의 center/zoom/routeCache | plan_legs+plan_days 원천 메타+assets | 같은 day의 활동 참조 확인. geometryStatus를 버리지 않음. 배경 지도/조작은 후속이지만 필요한 원천/첨부 정보 보존 | V-02/06 |
| P-10 | 장소 명부 slug/name/kind/gradeLabel/pin/wiki, 장문 frontmatter의 summary/dont_miss/food_kind/meal_role | places+map_targets+import baseline | 원본 등급↔정상화 값, 위키 언어, 지도 pin/search 의미를 구분. 중복 필드 충돌은 원천별 대조 후 결정 | V-03/04/08 |
| P-11 | `30_Places/<slug>.md` 왜 가는가/더 깊이/실용 | guide_documents(kind=place-guide).sections | why_go/deep/practical 안정 key, 원문 Markdown/출처와 내부 링크·fact 참조·첨부 연결 보존 | V-04 |
| P-12 | `20_Regions` 및 원고/설정의 verdict/scenes/skip/overview/role/rhythm/context/neighborhoods/stay_budget/transport_deep/food_culture·layerTitles | guide_documents(kind=region-guide).sections | 섹션 key와 실제 표시 제목을 데이터로 보존. 생성된 지역 MD와 원고의 우선순위는 상세 대조 필요 | V-03 |
| P-13 | `place-facts.json.places[slug].facts[key]`: value/confidence/source/verified_at/blocked_reason | facts+evidence | valueText와 원본 확인 상태·날짜 보존. fact 토큰의 ID 대응과 고정 revision 기록. importer가 확인일을 현재로 바꾸지 않음 | V-04 |
| P-14 | `region-essentials`의 staySummary/lifeEssentials/arrivalStrategy/departureStrategy/lateReturnRule/sourceRefs | guide_documents(kind=region-essentials)+evidence | 별도 생활 정보 필드와 목록 순서 보존. 객관적 예약 확정과 계획상 권고 구분 | V-03 |
| P-15 | `transit-facts`의 recommendation/products/howToUse/exceptions/itineraryUses/sources | guide_documents(kind=transit).structuredData+evidence | 가격 원문·공유 가능 여부·접근 조건·적합성을 보존. 원본 day→현재 계획 dayId 연결, 확인/재확인일 보존 | V-03/07 |
| P-16 | `transit-resources`, `tourist-maps`의 title/kind/scope/edition/usage/localPath/rights/URL/verifiedAt/recheckBy 등 | assets+evidence+관련 guide의 assetRefs | source 경로와 배포 산출물 경로를 별도로 해석. 외부 URL과 로컬 파일 구분, 권리/출처·확인 시점 보존 | V-03/06/07/09 |
| P-17 | XLSX Accommodation/Reservations 및 booking-overrides | bookings+plan_stays 대응+notes | 거점·기간·상태·목표일·주소·비고 및 원천에서 지원할 상세 필드 대조. 정적 renderer의 예약 코드와 중복/우선순위 확인. 실제 개인 값은 추적 파일에 넣지 않음 | V-05 |
| P-18 | `render.py.PARIS_MUSEUM_BOOKINGS`의 id/slug/name/day/date/schedule/canonical_status/stage/when/action_date/pmp/plan_b/note/official_url | bookings+task_definitions+evidence+계획/장소 대응 | 세부 예약 상태·단계·시점·패스 설명·대안 보존. 일자/문구를 무단 정밀화하지 않음. 특정 도시명 조건으로 UI를 분기하지 않음 | V-05/07 |
| P-19 | `PARIS_BOOKING_DUPLICATE_TITLES` 및 원본·예약 ID 별칭 | import_mappings와 이행용 중복/별칭 대응 자료 | 문자열 목록을 범용 실행 코드로 복사하지 않음. 같은 제목만으로 병합하지 않고 원본 ID·날짜·대상 대조. 기존 제거 규칙의 효과를 보고 | V-05/10 |
| P-20 | `render.py` 준비·긴급 안내의 여행/국가별 본문, 코드의 회화 추천 ID/언어 안내 | guide_documents(kind=preparation/language-guide)+phrase_books.contextRecommendations | 실제 안내와 언어별 콘텐츠는 데이터화. 일반 카드·표·링크·필터 렌더러는 프로그램에 둠 | V-07 |
| P-21 | `travel-french-phrases` language/note_ko/phrases의 fr/ko/pronunciation_hint/usage_note/tags/audio_text/aliases/place_types/day_ids/category/priority | phrase_books | fr→text, ko→translation, 언어는 locale. source count와 이행 수량 대조, 원본 ID·일정 연결. 새 언어에서 프랑스어 상수를 요구하지 않음 | V-07/08 |
| P-22 | `travel-french-guide`의 pronunciation_rules[]와 signs_and_menu[] | guide_documents(kind=language-guide).structuredData | rule의 pattern/sound/example/note와 단어 fr/ko/pronunciation을 읽을 수 있는 구조로 보존. 임의 HTML 표만 저장하지 않음 | V-07 |
| P-23 | `map-queries` places/hotels/routes/nonMapStops의 query/verdict/resolvedName/anchorFor/origin/destination/travelMode/evidence/verifiedAt | map_targets+evidence+계획·장소 대응 | 원본 routes의 day/stop 키는 해당 plan_item.mapTargetId로 대응. leg에 대한 명시적 근거가 있으면 plan_leg.mapTargetId도 연결하며 출발/도착 문자열만으로 추정하지 않음. place/route/none과 verdict/resolvedName/anchorFor 원문 보존 | V-02/04/06 |
| P-24 | 저장소 `field-notes.json`의 notes/visited/checkedActions, `field-edits/state.json`의 cursors/rejected | field_records(kind별)+import baseline/report | note의 대상·원본 시각·ID 보존. visited는 legacy-state이며 실제 시각 생성 금지. 작업 키를 task ID로 대응. 커서는 이행 근거, 옛 기기 동기화를 재개하지 않음 | V-02/04/05/11 |
| P-25 | 이미지 manifest/별칭·크레딧·모바일 카드·지도/PDF와 본문 첨부 | assets+asset_blobs+관련 문서/지역/장소/일별 계획의 assetRefs | 실제 사용처·역할·원본/파생 파일·크레딧·필수 여부를 전수 목록에서 대조. 모바일 카드는 확인된 dayId로 대응. 파일 해시만으로 표시 대상의 의미를 병합하지 않음 | V-02/03/04/06/09 |

### 원본 필드 전수 확인 규칙

각 원천 필드는 `direct / transformed / derived / retained-source / excluded-by-decision / unresolved` 중 하나로 기록하고 대상 필드·규칙·검증 사례를 연결한다. 사전 계약에 없는 값은 조용히 삭제하지 않고 미분류 보고서에 보존한다. `retained-source`에 원문을 보관한 것만으로 실제 조회 기능 이행을 완료 처리하지 않는다.

P-01의 기간 합계와 P-04의 원천 전용 메타 등은 화면 핵심 필드가 아니어도 비교 기준에 보존한다. 날짜 라벨·장소의 예정 방문일·검색 색인은 DB 원천에서 계산하는 derived 값이다. 실제 방문일로 잘못 계산하지 않도록 관계를 구분한다.

## 5. 공통 화면의 조회와 저장 계약

모든 화면/조회는 `tripId`와 필요한 경우 `planVersionId`/고정 context를 입력받는다. UI가 SP-FR 원본 파일·Python 코드·미리 만든 HTML을 직접 읽지 않는다. URL/라우팅 문법과 화면 배치는 아직 설계안이다.

| ID | 공통 화면 | DB 조회·결합 | 사용자 저장 경로 |
|---|---|---|---|
| V-01 | 여행 선택·홈·전체 일정 | trips→현재 plan_versions→plan_days/plan_stays, 필요한 예약 상태 | CreateTrip/ApplyImport/ChangeTripMetadata. 새 데이터 추가 후 같은 화면 갱신 |
| V-02 | 날짜별 현장 일정 | 선택 plan의 day→items/legs→관련 장소/지도·예약·작업 정의/체크·메모 | ChangePlan, RecordActual, AddNote, SetTaskState. 일정 원본과 실제 기록 분리 |
| V-03 | 지역 가이드 | regions→지역/생활/교통 guide→places·예정 방문 관계·assets/evidence | 이행은 주로 조회. 원문 데이터의 지역별 섹션 제목·유무로 구성하며 지역명별 코드 분기 금지 |
| V-04 | 장소 상세·기존 본문 편집 | places→guide_documents→fact/evidence/asset·관련 계획/기록 | EditGuideSection(expectedTripRevision, expectedDocumentRevision). 새 본문 revision 저장 후 현재 조회 갱신 |
| V-05 | 숙박·예약·할 일 | bookings→관련 plan_stays/items/places, 작업 정의·완료 기록·메모 | SetBookingState/AddNote/SetTaskState. 예약 공급자에 외부 변경 실행하지 않음 |
| V-06 | 장소·동선 목록·지도 열기 | plan_items/legs→map_targets, 지도·교통 assets | 초기에는 조회/외부 링크. 배경 지도·앱 내부 조작은 후속 |
| V-07 | 준비·회화·공식 자료 | guide_documents(kind별), phrase_books, 예약 행동·기한, assets/evidence | 초기 확정 편집 범위 밖 신규 작성 기능은 후속. 조회·검색은 언어/국가를 데이터로 선택 |
| V-08 | 여행 내 검색 | 같은 tripId의 장소/지역/날짜/예약/회화 메타데이터 색인→해당 현재/선택 context 조회 | 저장 없음. 원천 변경 후 색인을 갱신하며 색인 자체를 정본으로 삼지 않음 |
| V-09 | 오프라인 준비·자료 열기·백업/복원 | 선택된 콘텐츠/계획/기록/첨부 참조·바이트·누락 상태 | PrepareOffline/CreateBackup/RestoreBackup. 적용·복원 원자성과 첨부 포함 원칙 유지 |
| V-10 | 가져오기 미리보기·차이·충돌 | import_packages/mappings의 B, 현재 DB L, 새 패키지 R | ApplyImport 또는 충돌 보류. 기준 domainRevision 일치 검사 |
| V-11 | 실제 기록·과거 계획 조회 | field_records의 actual/정정 연결과 legacy-state를 구분 조회, plan_versions와 고정 contextRefs | CorrectActual은 실제 기록에만 적용. legacy 방문 상태는 기존 체크 정보로 별도 표시하고 실제 발생 시각/활동으로 변환하지 않음 |

화면에서 저장하는 데이터는 반드시 도메인 검증·트랜잭션 명령을 거친다. 조회용 모델은 DB를 읽어 조립하며 중복된 정적 HTML/검색 색인/별도 지역 파일을 수정 기준으로 삼지 않는다. 화면 단위 캐시가 있으면 원천 revision 변화에 따라 무효화한다.

## 6. 코드 안 콘텐츠를 분리하는 기준

| 원본 사례 | 이행 대상 데이터 | 공통 프로그램에 남길 책임 |
|---|---|---|
| 특정 여행의 예약 목록·상태/기한·패스 설명 | bookings·tasks와 출처/원본 대응 | 상태 배지·목록·필터·상세·사용자 상태 수정 |
| 중복 예약 제목 집합·지역 챕터 번호→지역 slug 대응 | SP-FR 어댑터의 원본 대응 자료와 이행 결과 | 안정 ID/관계로 연결하는 일반 검증. 다른 여행에 SP-FR 챕터 번호·제목 집합 요구 금지 |
| 특정 국가의 안내 본문·언어별 문구 추천 ID | preparation/language 자료·phrase_books | 범용 섹션/표/링크·검색·문구 추천 조회 |
| 도시별 섹션 제목/생략·표시 설정 | 문서 섹션과 검증된 표시 메타데이터 | 허용된 섹션 타입의 공통 표시. DB의 임의 코드를 평가하지 않음 |
| 범용 상태 코드의 한글 배지·아이콘·유효성 검사 | 원본 상태/라벨·예외 설명은 데이터 | 공통 enum 해석·일관된 UX·참조/시각/저장 검증 |

추출 작업은 Python 모듈을 import/실행해 임의 부작용을 일으키는 대신 원문·안전한 구문 분석·검토한 변환 규칙으로 수행하는 안을 우선한다. 기존 site 빌드의 원본 재생성은 실행하지 않는다. SP-FR 전용 경로·원본 코드 상수명은 변환 어댑터/출처에만 존재할 수 있고 범용 화면 동작의 필수 조건이 되면 안 된다.

## 7. 두 여행으로 확인하는 데이터 기반 동작 예시

다음은 실행 결과가 아닌 가상 행 예시다. 키 구조는 설명용이다.

| 데이터 | 여행 A | 여행 B |
|---|---|---|
| trips | trip-a, ‘가상 산책 여행’, 기본 시간대 미정 | trip-b, ‘가상 미술 여행’, 기본 시간대 미정 |
| regions | trip-a/region-1 | trip-b/region-1 |
| places | trip-a/place-1, ‘가상 전망대’ | trip-b/place-1, ‘가상 전시관’ |
| guide_documents | guide-1의 why_go/deep/practical, revision a-1 | guide-1의 why_go/deep/practical, revision b-1 |
| 계획 | plan-a-1의 day-a-1, activity-a-1→place-1, 시각 미정·순서 1 | plan-b-1의 day-b-1, activity-b-1→place-1, ‘오전’·순서 1 |
| 현재 본문 포인터 | trip-a/guide-1→a-1 | trip-b/guide-1→b-1 |

1. 프로그램을 한 번 실행하고 trip-a를 선택하면 DB의 A 일정·가이드가 보인다.
2. B 데이터를 가져와 trip-b를 선택하면 같은 조회 코드/화면이 B 내용을 읽는다. 프로그램 빌드·여행별 페이지 생성은 없다.
3. A의 practical 본문을 바꾸면 guide revision a-2와 현재 포인터가 저장되고 A의 현재 상세에 반영된다. B의 b-1은 변하지 않는다.
4. plan-a-1의 contextRefs는 a-1과 당시 fact/예약/첨부를 계속 참조한다. 과거 조회와 현재 설명을 구분한다.
5. 활동 시간을 모르는 상태와 ‘오전’을 그대로 조회하고, 필요한 방문/현장 입력을 별도 기록으로 저장한다. 화면 동작을 위해 가짜 시각을 채우지 않는다.

## 8. 이행 검증 단위와 우선순위

검증은 아직 실행하지 않았다. 테스트 코드를 이번에 작성하지도 않았다. 실제 구현 전에 다음 기준과 원천 manifest를 연결한다.

| 검증 묶음 | 확인할 것 |
|---|---|
| 매핑 완전성 | 선택한 각 원천 필드·코드 콘텐츠에 대상/제외/미분류가 있고, 필수 조회 정보가 단순 source 보관으로 끝나지 않음 |
| 관계·의미 | 일정↔장소↔지역·숙박·예약·근거·첨부가 같은 여행에서 연결. 방문 관계와 실제 방문, 미정 시각·상태 구분 |
| DB→화면 | 각 P 행에서 V 화면으로 조회 가능한지 확인. 긴 본문·섹션·표·fact·미디어·원천 코드 예약 정보의 표시 표본 대조 |
| 데이터만 변경 | 실행 프로그램/번들 변경 없이 다른 여행 추가·선택과 기존 본문/일정/예약 수정이 화면에 반영. 원본 파일·여행별 HTML 빌드에 의존하지 않음 |
| 저장·복구 | 기존 revision·실제 기록 보존, 중복 재가져오기·실패·충돌·오프라인 재시작·첨부/기준 B/receipt 포함 백업·복원 |

대표 구간은 본문+fact 토큰+첨부, 시각 미정/재방문/이동, 예약+작업 체크, 지역 생활/교통, 코드 내부 콘텐츠를 포함하도록 선정한다. 특정 실제 날짜·레코드는 파일별 조사 후 정한다. 작은 두 번째 가상 여행은 SP-FR 지명·43일·프랑스어가 필수인 숨은 결합을 드러내는 대조군이다.

## 9. 남은 정의와 다음 단계

- DB 제품·서버/로컬 정본 위치·물리 테이블/인덱스·명령 및 교환 포맷의 정확 스키마는 아직 확정하지 않았다. 이번 D/P/V는 구현 가능한 필드/관계·화면 계약을 정리한 논리 설계다.
- 상세 원천 manifest에는 file/hash/object key/field, P 매핑 ID, 대상 kind/id/revision, 처리 방식, 검증 결과를 기록한다. 현재 문서는 실제 파일별 해시·전체 처리 건수·기본 원본 우선순위 결정을 대신하지 않는다.
- 원본 중복 필드·예약 충돌, 지역 생성본/원고, 미디어 파생 경로, XLSX 비공개 상세 필드·다른 시트와 자료는 상세 조사와 범위 판단이 남아 있다. 시간대와 시각 해석도 원천 근거 없이 확정하지 않는다.
- Source ID가 없는 배열 항목·이동 구간의 재가져오기 대응은 최초 mapping을 보존하되 순서나 이름만으로 갱신 대상을 단정하지 않는다. 모호하면 충돌/검토 대상으로 남긴다.
- 새 입력 형식은 합의한 패키지 계약을 거친다. 임의의 모든 PDF/XLSX/웹페이지를 자동 해석하는 기능까지 확정한 것은 아니다.
- 다음은 이 논리 구조와 오프라인·본문 편집·첨부/이행 조건을 기준으로 DB·화면·변환/패키지 기술을 비교·선정하고, 대표 구간의 상세 명세/검증·개발 순서를 정하는 것이다. 구현은 아직 보류한다.

## 10. 문서 확인 결과

독립 독자 검토 후 이동 구간→지도 대상의 명시적 참조, 지역/장소/문서/일별 계획의 첨부 역할·당시 버전/해시, actual과 legacy-state의 구분 조회를 보완했다. 재검토에서 해당 세 공백 해결과 같은 수정 범위의 추가 모순 없음으로 확인됐다. 이는 읽기 검토이며 원본 변환·DB 생성·앱 동작·실기기 검증 결과가 아니다.

D/P/V ID는 각각 23/25/11개이며 중복 없음과 문서의 로컬 Markdown 링크 대상 존재를 확인했다. 이번에는 계획 문서만 갱신해 코드 테스트를 재실행하지 않았다.
