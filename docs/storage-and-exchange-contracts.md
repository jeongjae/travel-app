# 물리 DB·저장 명령·교환 계약

작성일: 2026-10-21 · 상태: 설계 검토안 v0.1 · 구현 전

> 2026-10-22 실행 갱신: [P-01 공유 계약](p01-contracts.md), [P-02 물리 저장/명령·v1 보호](p02-report.md), [P-03 패키지 입력](p03-report.md), [P-05 재가져오기](p05-report.md), [P-06 전체 백업/복원·첨부 준비/복구](p06-report.md)를 구현했다. 실제 원천·실기기·한도 실측은 P-07에 남는다. 아래는 원래 설계 기준이며 실제 구현 구체화/검증은 단계별 보고서를 따른다. 새 제품 정책의 일괄 합의가 아니다.

실행 필드 구체화: command_receipts의 v2 성공 결과는 `result={status:applied,requestId,domainRevision,commitSeq,resultRefs[]}`로 보존하고 요청/순번/revision을 공유 receiptSchema로 교차 검사한다. resultRefs는 콘텐츠/계획/기록/변경안/여행을 구분한다. replay는 그 결과에 status=replayed만 바꿔 반환한다. v1 영수증은 별도 prototype-v1 태그로 차단한다. 원천 mapping은 콘텐츠 payload 외 계획의 의미 스냅샷과 여행 메타데이터도 targetKind=plan/trip으로 구분하며, 가이드 섹션은 안정 key별 B/L/R로 검토한다.

## 1. 목적과 경계

[논리 모델 D-01~23](content-db-mapping.md)을 [기술 선정안](technology-selection.md)의 IndexedDB/Dexie로 구현할 저장 구조와 명령·파일 계약을 정의한다. 사용자 확정 요구를 구현하기 위한 작성자의 설계안이며 새 정책 합의·실행 가능한 스키마·구현 완료가 아니다. 원본·앱 코드·의존성·사용자 DB는 변경하지 않았다.

원칙은 **콘텐츠는 DB, 표시·검증·저장은 공통 프로그램**이다. SP-FR 어댑터와 공통 도메인 계약을 구분하며 여행 이름·43일·특정 언어를 프로그램 제약으로 만들지 않는다. 계획·실제 기록·초안은 독립 저장한다. 과거 내용 재현·재가져오기·백업의 의미는 [공통 구조](target-architecture.md)를 따른다.

## 2. 식별자·불변성·시간

- `tripId`, `entityId`, `activityId` 등은 안정 ID다. 이름·날짜·목록 위치로 재발급하지 않는다. 여행 내 모든 참조에 종류와 ID를 명시하며 다른 여행 참조는 거부한다.
- 콘텐츠의 `revisionId`, 계획의 `planVersionId`, 기록의 `recordId`는 불변 행의 식별자다. 수정은 새 행과 현재 포인터 변경이다. 계획에서 제거한 활동도 과거 버전·실제 기록에서 조회된다.
- `spaceId`는 전체 복원을 준비·공개하는 물리 저장 영역 ID다. 하나의 `workspace_meta.activeSpaceId`만 사용자에게 공개한다. 논리 참조·여행 ID·패키지 fingerprint에는 물리 spaceId를 넣지 않는다. 복원은 논리 ID를 유지하면서 새 spaceId에 적재할 수 있다.
- `domainRevision`은 여행의 의미 있는 콘텐츠·계획·운영 기록이 바뀔 때 증가한다. AI 기준과 열린 편집 폼의 충돌 검사에 사용한다. 초안 저장·거절만으로 증가시키지 않는다.
- `commitSeq`는 성공한 업무 저장마다 workspace에서 증가하는 정수다. 초안·결정·영수증도 해당한다. 불변 행에 저장하며 일관된 백업 시점의 경계로 사용한다. 첨부 다운로드·임시 작업 상태는 업무 commitSeq를 올리지 않는다.
- 모든 성공 명령은 영수증을 남긴다. 콘텐츠·계획·기록·기준 B·영수증의 물리 삭제는 초기 설계에서 제공하지 않는다. 임시 자료 정리와 사용자의 완전 삭제 정책은 별개다.

### TimeSpec 공통 계약

| precision | 필수 값 | 허용/검증 규칙 |
|---|---|---|
| unspecified | precision | 날짜를 알면 date 허용. 현지 시각·instant·offset 없음 |
| date | 유효한 ISO date | 시각·instant·offset 없음 |
| text | 비어 있지 않은 rawText | 확인된 date 선택. ‘오전’ 등을 분 단위 시각으로 추정하지 않음 |
| local | date, localTime | 확인된 IANA timeZone 선택. instant·offset 없음. 시간대 미확인은 별도 상태로 표현 |
| instant | date, localTime, IANA timeZone, offset, instant | 모두 같은 시점을 가리켜야 함. DST 모호 시 offset으로 확인, 존재하지 않는 현지 시각 거부 |

전 variant는 원문·해석 근거를 보존할 수 있다. 시작·종료는 각각 TimeSpec이며 종료 미정 가능하다. instant끼리는 실제 순서를 검증하고, 비교 불가능한 정밀도는 억지로 UTC 순서로 정렬하지 않는다. 일정은 day/order로 정렬한다. recordedAt은 저장 시각이며 발생 시각·원본 확인일을 대신하지 않는다.

## 3. 물리 object store 설계

DB 이름은 현재 `travel-app`을 유지하는 안이다. 기존 v1의 `trips`는 변환 검증 전까지 그대로 보존하고, 새 여행 헤더는 **`trip_headers`**에 둔다. 아래는 새 구조의 목표 store이며 실제 Dexie 버전 선언은 아직 작성하지 않았다.

표의 복합 키는 순서 있는 배열이다. 모든 업무 키는 spaceId로 시작한다. 인덱스의 `unique`는 여행/계획 범위 중복 금지다. boolean·객체를 인덱스 키로 쓰지 않고 status/kind 문자열과 scalar ID를 사용한다. 긴 본문·바이트·임의 JSON은 인덱싱하지 않는다.

| ID | store → 논리 대응 | 기본 키 | 주요 보조 인덱스·규칙 |
|---|---|---|---|
| S-01 | workspace_meta → 제어 | id=`workspace` | activeSpaceId, writeSeq, dbContractVersion, mode. 업무 시작/복원 전환 기준 |
| S-02 | trip_headers → D-01 | [spaceId, tripId] | [spaceId, startDate]. 이름/기간/기본 시간대, domainRevision, currentPlanVersionId |
| S-03 | content_heads → D-02 | [spaceId, tripId, kind, entityId] | [spaceId, tripId, kind, status]. revisionId, status=active/inactive |
| S-04 | content_revisions → D-03~08/14/15/17/18 | [spaceId, tripId, kind, entityId, revisionId] | [spaceId, tripId, kind], [spaceId, tripId, commitSeq]. kind별 payload 검증, 공통 출처/저장 주체/previousRevisionId |
| S-05 | plan_versions → D-09 | [spaceId, tripId, planVersionId] | unique [spaceId, tripId, number], [spaceId, tripId, commitSeq]. 부모·이유·고정 contextRefs·자식 수/해시 |
| S-06 | plan_days → D-10 | [spaceId, tripId, planVersionId, dayId] | unique [spaceId, tripId, planVersionId, ordinal], 날짜 조회 인덱스 |
| S-07 | plan_items → D-11 | [spaceId, tripId, planVersionId, activityId] | unique [spaceId, tripId, planVersionId, dayId, order] |
| S-08 | plan_legs → D-12 | [spaceId, tripId, planVersionId, legId] | [spaceId, tripId, planVersionId, dayId]. 해당 버전의 출발/도착 활동 검사 |
| S-09 | plan_stays → D-13 | [spaceId, tripId, planVersionId, stayId] | [spaceId, tripId, planVersionId, regionId]. 계획 숙박과 예약 revision 구분 |
| S-10 | field_records → D-16 | [spaceId, tripId, recordId] | [spaceId, tripId, kind, recordedAt], [spaceId, tripId, targetKind, targetId], [spaceId, tripId, commitSeq], unique [spaceId, tripId, supersedes] |
| S-11 | import_packages → D-19의 반영 근거 | [spaceId, tripId, packageId] | [spaceId, tripId, packageDigest]. 반영한 패키지/manifest/보고서 불변. 진행 상태는 S-18 |
| S-12 | import_heads → D-20의 현재 기준 | [spaceId, tripId, lineageId, sourceKind, sourceKey] | 현재 mappingRevisionId. lineageId는 원본 계보이며 commit이 바뀌어도 유지 |
| S-13 | import_mappings → D-20의 불변 기준 B | [spaceId, tripId, mappingRevisionId] | [spaceId, tripId, lineageId], [spaceId, tripId, commitSeq]. 대상 ID/필드, 실제 정규화 B 값·어댑터/규칙 버전·출처 |
| S-14 | proposal_heads → D-21의 현재 상태 | [spaceId, tripId, proposalId] | [spaceId, tripId, status]. proposalRevisionId, proposalRevision 숫자 |
| S-15 | proposal_revisions → D-21의 불변 초안/결정 | [spaceId, tripId, proposalId, proposalRevisionId] | [spaceId, tripId, commitSeq]. baseDomainRevision, operations, 상태·결정·결과. 이전 초안/결정 보존 |
| S-16 | command_receipts → D-22 | [spaceId, tripId, requestId] | [spaceId, tripId, commitSeq]. fingerprintVersion, fingerprint, kind, resultRefs, completedAt |
| S-17 | asset_blobs → D-23 | [spaceId, tripId, sha256] | [spaceId, tripId]. Blob·byteLength·검증 상태. 해시가 같은 검증된 바이트를 덮어쓰지 않음 |
| S-18 | transfer_jobs → 준비/가져오기/복원 제어 | jobId | spaceId, 대상 tripId, mode, expected 기준, packageDigest, 상태·검증 보고·첨부 pin. 백업에서 제외 |
| S-19 | staged_rows → 미공개 입력 | [jobId, collection, rowKey] | jobId. rowKey는 중첩 배열 키가 아닌 검증된 canonical key 문자열. 현재 화면에서 읽지 않음 |
| S-20 | snapshot_jobs → 백업 시점·보존 제어 | snapshotId | spaceId, cutSeq, 고정 여행 헤더·heads, 첨부 보존 참조·상태. 백업에서 제외 |

`supersedes`가 없는 기록은 해당 인덱스 필드를 생략하며 null/빈 문자열을 대입하지 않는다. 정정은 같은 여행·kind의 현재 유효 기록만 가리키고 순환/분기를 금지한다. task-state는 task definition revision과 meaningFingerprint를 담아 작업 의미가 달라졌을 때 완료를 자동 승계하지 않는다. legacy-state는 actual과 별도 조회하며 방문 시각을 발명하지 않는다.

S-04는 물리 store를 통합해도 region/place/guide/fact/evidence/asset/booking/task/phrase/map의 **각 kind 스키마를 구분**한다. payload의 허용 필드와 D-03~18 대응은 유지한다. 새로운 문서 종류를 임의 JSON으로 우회하지 않는다. 현재 포인터로 최신 본문을 조회하고 과거 contextRefs는 Fact/Evidence/Booking/Asset의 revision·해시까지 고정한다.

### 주요 읽기 단위

- 여행 목록: S-02의 헤더만. 하루 일정: 현재/선택 planVersion의 S-06~09만. 장소 목록: place head 및 해당 revision의 요약. 상세 본문·첨부는 열 때 읽는다.
- 예약/작업: 현재 booking/task revision과 유효 field record를 합성한다. 과거 계획 조회는 당시 고정 revision을 사용한다.
- 실제 타임라인: field_records의 actual·정정 체인과 별도 날짜/미상 영역. 최신 계획의 활동 목록에 존재해야만 보이는 구조를 금지한다.
- 전문 검색 색인·오프라인 준비 목록은 재생성 가능한 읽기 모델이다. 초기 핵심 조건은 이름/지역/종류 탐색이며 전체 본문 검색의 제품 범위는 미정이다.
- 읽기 도중 head/계획이 바뀌면 작은 readonly 트랜잭션으로 일관되게 읽거나 불변 root를 잡는다. 과거/현재를 서로 다른 시점의 head로 섞지 않는다.

## 4. 저장 명령 계약

공통 envelope는 `commandVersion=2, tripId, requestId, kind, expectedDomainRevision?, expectedProposalRevision?, payload`다. requestId는 호출자가 발급해 같은 저장 재시도에 유지한다. create/import-new도 대상 tripId를 먼저 정한다. 논리 ID와 명시적 입력으로 fingerprint를 계산하며 spaceId·처리 시각·내부 staging job ID는 제외한다. 준비 작업은 packageDigest/검증된 manifest digest로 묶는다.

fingerprint v2는 검증된 JSON 객체의 키를 재귀 정렬하고 배열 순서는 유지한 UTF-8 canonical JSON의 SHA-256이다. undefined/NaN/Infinity는 허용하지 않고 선택 필드는 생략, null은 계약에 있는 의미에만 허용한다. 문자열 본문을 임의 trim/Unicode 정규화하지 않는다. 정규화 규칙 버전도 입력에 포함한다. JSON의 중복 객체 키와 중복 레코드 키는 파싱 단계에서 거부한다. 기본 JSON.parse만으로 중복 객체 키를 검출할 수 없으므로 외부 파일의 엄격한 토큰 검사를 입력 경계에 구현한다. revision/순서/크기 등 정수는 안전한 정수 범위로 제한한다.

| ID | 명령 | 필수 기준·주요 저장 | domainRevision |
|---|---|---|---|
| C-01 | CreateTrip / ImportNewTrip | 없는 tripId, 준비된 패키지 digest. 헤더·초기 콘텐츠/계획·이행 근거·영수증 생성 | 초기 0, 이후 의미 변경마다 +1 |
| C-02 | EditContentSection / UpdateContent | expectedDomainRevision + 대상 revisionId. 새 kind별 revision·head·영수증 | +1 |
| C-03 | ChangePlan | expectedDomainRevision + currentPlanVersionId. 새 계획 스냅샷·현재 포인터·영수증 | +1 |
| C-04 | RecordActual / CorrectActual / AddNote | expectedDomainRevision, 정정 시 supersedes. 당시 요약/contextRefs와 불변 기록 | +1 |
| C-05 | SetBookingState / SetTaskState | expectedDomainRevision, booking/task 기준 revision. 예약은 새 revision, 작업 상태는 field record | +1 |
| C-06 | SaveProposal | baseDomainRevision, 초안 생성/수정 기준 proposalRevision. 현재 계획·콘텐츠 변경 없음 | 유지 |
| C-07 | DecideProposal(apply/reject) | expectedProposalRevision, pending. apply는 baseDomainRevision 재검사·허용 연산·최종 사용자 확인 | apply만 +1 |
| C-08 | ApplyReimport | expectedDomainRevision + 검토 digest + 원본 계보/패키지. 승인한 도메인 변경·mapping B·package·결과를 함께 반영 | +1 |
| C-09 | UpdateTripMetadata / DeactivateContent | expectedDomainRevision + 대상 기준. 새 메타 또는 inactive head, 이력/기록은 보존 | +1 |

SaveProposal은 현재와 다른 기준의 늦은 결과도 ‘오래된 초안’으로 보존할 수 있지만 적용 가능으로 표시하지 않는다. 초안 연산은 kind별 스키마로 검사하며 현재 상태에 대한 적용 검증은 별개다. AI의 허용 연산은 계획 변경으로 시작하고 실제 기록 정정·예약 업체 실행·키 변경·임의 DB 명령은 허용하지 않는다. 본문 작성 AI 확대는 후속 범위다.

### 공통 실행 순서

1. 트랜잭션 밖에서 파일·문법·해시·TimeSpec과 큰 입력을 검사하고 결과 후보를 준비한다. 공간 부족/깨진 첨부/지원 불가 버전은 현재 데이터 변경 전에 반환한다.
2. repository의 업무 트랜잭션이 S-01·S-02·S-16 및 명령별 대상 store를 포함한다. activeSpaceId와 동일 요청 영수증을 먼저 확인한다. 같은 fingerprint의 성공 요청이면 기준 revision이 지금 낡았어도 **기존 resultRefs를 반환**한다. 같은 requestId의 다른 입력은 거부한다.
3. 새 요청만 domainRevision·proposalRevision·pending·기준 head와 참조를 재검사한다. 사전 계산한 후보는 여기에 사용한 모든 기준이 같을 때만 채택한다. 바뀌면 입력을 보존하고 충돌을 반환한다. 자동 재기준·마지막 쓰기 우선을 사용하지 않는다.
4. 한 commitSeq를 발급해 새 불변 행·heads·현재 계획·사용자 결정·mapping B·영수증 및 필요한 domainRevision을 함께 저장한다. 계획 자식 전체와 부모를 함께 저장해 부분 버전을 노출하지 않는다. 해당 명령 외 업무 영역을 임의로 변경하지 않는다.
5. 성공은 트랜잭션 완료 후 알린다. 실패하면 업무 변경/영수증은 전부 취소한다. 첨부 staging은 남을 수 있으나 활성 참조와 준비 완료 표시는 생기지 않는다.

결과는 `status=applied|replayed`, requestId, domainRevision, commitSeq, resultRefs다. 오류는 `INVALID_INPUT, UNSUPPORTED_VERSION, CONFLICT, NOT_PENDING, REQUEST_ID_REUSED, BROKEN_REFERENCE, MISSING_ASSET, LIMIT_EXCEEDED, STORAGE_FULL, RESTORE_REQUIRES_EMPTY` 등 코드와 필드 경로를 포함한다. 실패를 성공 영수증으로 남기지 않으며 재시도 가능한 오류와 사용자 판단이 필요한 충돌을 구분한다.

### 처음 가져오기·큰 첨부·재가져오기

ZIP/첨부/레코드는 S-18~19 및 S-17에 staging한다. 업무 참조 없는 Blob은 화면에 노출하지 않는다. 이미 활성 참조가 있는 같은 해시 파일을 실패한 새 작업의 임시 파일로 취급해 삭제하지 않는다. 취소/재시작 정리는 현재/과거 콘텐츠·snapshot job·다른 transfer job의 참조가 없는 자료만 대상으로 한다.

새 여행/기존 여행 갱신은 구조 레코드를 최종 한 트랜잭션으로 반영한다. 첨부 바이트는 여기서 다시 복사하지 않고 검증된 해시·크기·존재를 확인한다. 최초 기술 한도를 넘는 업무 변경은 거부하고 크기와 이유를 보고한다. 임의로 쪼개 부분 성공시키지 않는다. 한도를 넘는 전체 최초 적재 방식은 대표 구간 실측 후 별도 설계한다.

재가져오기 lineageId는 원본 계보를 식별하고 sourceKey는 원천 ID/필드/본문 섹션을 식별한다. commit·파일 경로만 바뀌었다고 새 장소로 만들지 않는다. 안정 키가 없으면 수동 대응을 요구한다. B/L/R 비교 후 해결된 하나의 묶음을 적용한다. 원본 반영을 승인한 단위만 B=R로 바꾸고 앱 유지·거부·보류 단위는 B를 유지한다. L=R인 단위의 기준만 갱신하는 경우도 명시적 검토를 거친다. 새 앱의 actual/note/task-state를 원본 상태로 교체하지 않는다.

## 5. 파일 계약

### 형식·버전·경로

| 용도 | format / version | 필수 내용 |
|---|---|---|
| Python→TS 중간 추출 | travel-app-source-extract / 1 | sourceRepository/commit, adapter/extractorVersion, 원천 manifest, sourceKind/key/locator/rawValue, 처리 상태·미해결 목록. 앱이 직접 활성화하는 파일 아님 |
| 여행 이행/가져오기 | travel-app-package / 2 | packageId, purpose=migration 또는 trip-transfer, domainSchemaVersion=2, source/계보·규칙 버전, 여행/레코드/첨부 목록·해시, 대응·손실/미해결 보고 |
| 전체 백업 | travel-app-backup / 2 | snapshotId, cutSeq, domainSchemaVersion=2, 고정 여행 헤더·heads, 모든 보존 대상 이력/근거/B/영수증·첨부, 검증용 개수/해시 |
| 저장 명령 | travel-app-command / 2 | 위 envelope. AI 컨텍스트/응답 계약과 별도 version |

버전은 **이번 설계의 제안 번호**다. 기존 파일의 schemaVersion=1을 덮어쓰거나 새 의미로 재해석하지 않는다. IndexedDB의 물리 version 번호와 파일 format/version도 독립이다. 알 수 없는 format/major version/collection/kind는 조용히 무시하지 않고 거부한다.

ZIP 구조는 `manifest.json`, `records/<collection>.ndjson`, `assets/sha256/<64자리 해시>`, `reports/import-report.json`을 기본으로 한다. metadata/heads도 records에 포함하며 허용 collection은 S-02~16의 교환 대응 이름이다. S-01의 공간 설정·S-17의 Blob 바이트 필드는 직접 내보내지 않고 manifest/첨부로 표현한다. S-18~20과 캐시·키·서버 작업은 제외한다.

manifest의 각 파일 entry는 path, role, byteLength, sha256, 선택적 collection/recordCount다. manifest 자신은 entry에 넣지 않으며 packageDigest는 manifest.json의 정확한 바이트에 대한 SHA-256이다. 레코드 파일은 UTF-8·한 줄당 JSON 객체·LF이며 BOM은 쓰지 않는다. 해시는 실제 저장 바이트 기준이다. asset metadata의 hash/크기와 첨부 entry를 교차 검사한다. 파일 전체 해시의 일치가 출처 사실의 진실성·출판 권리를 검증해 주는 것은 아니다.

절대/드라이브/상위 이동 경로·역슬래시·중복 ZIP entry·대소문자 충돌·심볼릭 링크·manifest에 없는 파일은 거부한다. 외부 URL로 빠진 첨부를 자동 다운로드해 완전한 백업으로 만들지 않는다. 화면은 검증된 assetId→hash→Blob 연결을 열며 ZIP 경로를 임의 실행 경로로 사용하지 않는다.

### 기본 기술 한도 — 대표 구간에서 조정할 검토값

| 항목 | 초기 검토 한도 |
|---|---|
| ZIP 입력 / 압축 해제 총량 | 256 MiB / 512 MiB |
| ZIP 파일 수 / manifest 크기 | 10,000개 / 4 MiB |
| 단일 첨부 / 단일 JSON 레코드 | 64 MiB / UTF-8 512 KiB |
| 총 레코드 수 | 100,000개 |
| 한 업무 명령으로 활성화할 구조 변경 | 10,000개 행 / UTF-8 32 MiB, 첨부 바이트 제외 |

이는 원천 전체가 이 크기 안에 들어온다는 조사 결과나 휴대폰의 처리 보장이 아니다. 압축 크기만 믿지 않고 읽으면서 실제 해제 총량·파일 수·개별 크기를 확인해 즉시 중단한다. 메모리 사용은 전체 ZIP/모든 본문을 한 번에 모으는 구현을 피하고 실측한다. 한도를 넘는 원본은 크기·항목을 보고해 분할 계약을 설계하며 잘라 버리지 않는다. 누락 첨부가 있는 자료는 전체 백업 성공으로 저장하지 않는다.

### ID·참조·미해결 값

최초 이행은 sourceKey↔새 ID 대응을 패키지/검증 계획에 고정한다. 같은 패키지를 다시 검토할 때 ID가 무작위로 달라지지 않게 대응을 보존한다. 다른 여행으로 복사할 때에는 여행별 독립 사본과 모든 내부 참조를 함께 재작성하고 기존 여행을 수정하지 않는다. 초기 trip-transfer는 승인된 현재 콘텐츠·계획의 복사형 패키지로 한정하는 안이다. 과거 실제 기록·변경안·영수증을 새 여행의 업무 이력으로 옮기지 않으며 그런 레코드가 있으면 조용히 버리지 않고 지원 범위 오류를 반환한다. 원래 출처는 복사 근거로 남기되 원래 여행의 B를 새 여행의 적용 기준으로 자동 승계하지 않는다. 전체 이력 보존·이동은 원래 논리 ID와 영수증을 유지하는 빈 저장소 전체 백업 복원으로 제공한다.

출처 범위·행/셀/AST 위치·원문·정규화 규칙·처리 판정은 import report에 남긴다. 필수 참조·본문 토큰·첨부 누락은 적용 차단이다. 단순 미상 날짜/위치 등은 허용된 미상 variant로 저장할 수 있으나 경고와 원문을 남긴다. 처리 판정은 direct/transformed/derived/retained-source/excluded-by-decision/unresolved이며 미해결 자료를 원문 보관만으로 기능 이행 완료라고 세지 않는다.

## 6. 백업 스냅샷·전체 복원·DB 업그레이드

### 일관된 백업

1. 짧은 트랜잭션으로 activeSpaceId, workspace.writeSeq=`cutSeq`, 모든 여행 헤더·content/import/proposal heads를 고정하고 snapshot_jobs에 보존한다. 본문/첨부 바이트 전체를 이 트랜잭션에서 읽지 않는다.
2. 고정 여행 범위의 불변 행 중 commitSeq≤cutSeq를 페이지로 읽는다. 계획 자식은 선택된 불변 planVersion에 종속된다. 새 편집은 새 commitSeq가 되어 섞이지 않는다. 포인터는 캡처한 값만 사용한다.
3. 과거 계획·기록·모든 보존 revision·B·영수증·초안/결정의 참조 폐쇄를 검사한다. 필요한 첨부 해시를 pin하고 바이트를 읽어 내보낸다. 진행 중/실패한 transfer job의 미공개 자료를 포함하지 않는다.
4. 개수·관계·파일 해시·첨부 완전성을 검증한 파일만 ‘전체 백업 생성 완료’로 표시한다. 생성 완료와 사용자가 파일을 외부 위치에 안전하게 보관했는지는 구분한다. 실패·취소 시 현재 여행은 불변이고 snapshot pin을 정리한다.

전체 백업에는 초안/거절·적용 결정과 명령 fingerprint/resultRefs도 포함한다. 서버 실행 중인 AI job은 복원하지 않는다. 브라우저 pending proposal이 남아 있어도 원래 기준이 달라졌으면 적용을 막는다. 현재나 과거의 업무 revision을 삭제하지 않는 초기 정책과 snapshot pin을 함께 사용해 내보내는 동안 자료가 사라지지 않게 한다.

### 빈 저장소 전체 복원

백업 검증→새 비활성 spaceId에 묶음 적재→모든 참조/해시/영수증 재검증→**한 트랜잭션에서 빈 현재 저장소와 시작 기준을 재확인하고 activeSpaceId 전환** 순서다. 기존 여행이 있거나 준비 중 새 여행이 생겼으면 전환을 거부한다. 이전 데이터와 자동 병합하지 않는다.

logical ID·domainRevision·불변 revision·과거 fingerprint/resultRefs는 유지한다. 물리 키의 spaceId만 바꾼다. workspace.writeSeq는 현재 값과 복원 cutSeq보다 큰 값으로 이어 가며 이후 저장이 과거 경계에 들어가지 않게 한다. 같은 복원 job 재시도는 완료 결과를 조회하며 두 번째 복원을 실행하지 않는다. 실패/중단된 비활성 공간은 재개 또는 명시적 정리 대상으로 남고 사용자 조회에는 나타나지 않는다.

### 기존 프로토타입 v1 보호

물리 version 업그레이드에서는 새 store/인덱스를 추가하고 기존 `trips`를 삭제하지 않는다. 변환은 별도 준비 작업으로 수행해 원본 aggregate를 검증한 뒤 새 구조와 대조한다. 변환 전 앱은 legacy 모드로 읽으며 자동으로 빈 새 DB를 활성화하지 않는다. 전환 시 이전 입력의 fingerprint와 열린 탭의 쓰기 중단을 확인한다. 원본 aggregate·백업·변환 보고서는 보존한다.

v1에는 전체 본문/근거/첨부가 없고 receipt에 완전한 resultRefs가 없다. 없는 값을 만들어 내지 않는다. 기존 receipt는 `fingerprintVersion=prototype-v1`로 보존하고 같은 requestId의 새 쓰기를 차단한다. 복원된 v2 명령의 정확한 replay와 구분하며, v1 재시도의 결과를 복원할 수 없으면 `LEGACY_RECEIPT_UNSUPPORTED`로 안전하게 거부한다. 과거 데이터 이력을 보고 새 요청으로 의도적으로 처리할 수 있어야 한다. 새 v2 백업은 v2 영수증의 정확한 replay를 검증한다.

## 7. 검증과 다음 작업

대표 범위·구현 순서·실행 후 증거는 [대표 이행 계획](pilot-migration-plan.md)에 정의한다. 이 문서는 설계 검토만 수행하며 앱/DB/파일 구현 테스트 결과가 아니다. 외부 AI 호출·호스팅·공개 배포·자동 동기화는 이 저장 계약의 구현 완료와 별도로 관리한다.
