# 데이터 모델과 저장 경계

> 이 문서는 현재 프로토타입의 구현 구조를 설명한다. 개발전략 3단계의 새 목표 구조와 정본·편집 책임은 [target-architecture.md](target-architecture.md)에 있다. 아래 단일 aggregate, 이름만 있는 Place, 정확한 시각 필수, JSON 백업을 최종 이행 설계로 고정하지 않는다. 이 문서와 실제 코드의 구조는 이번 계획 작업에서 변경하지 않았다.

> 필드·관계·원천·화면의 구체 설계안은 [content-db-mapping.md](content-db-mapping.md)를 참조한다. 해당 논리 구조는 아직 현재 DB에 적용되지 않았다.

## 여행 단위 원자 저장

IndexedDB `travel-app` / `trips` 저장소에 여행별 aggregate를 저장한다. `id`, `revision`, `name`, `startDate`, `endDate`, `timeZone`, `places`, `versions`, `actuals`, `proposals`, `receipts`를 가진다. 초기 규모(개인 여행 수십 개)에서 여러 테이블 간 부분 저장을 피한다. 향후 서버 저장소는 같은 도메인 명령을 구현한다.

- Place: 장소 ID·이름. 일정과 방문 기록은 장소를 참조하되 같은 장소 여러 번 방문 가능.
- PlanVersion: 불변 일정 스냅샷, 버전 번호, 생성 시각, 변경 이유, 근거, 변경안 ID. 기존 버전 수정 없음.
- Activity: 독립 ID, placeId(선택), 제목, 시작/종료 ISO instant, IANA timeZone, 메모. 시각은 명시적인 오프셋을 포함하며 시간대와 일치하는지 검사한다.
- ActualRecord: 별도 ID, activityId(선택), 방문/건너뜀, 실제 시작·종료·시간대·메모, 정정 대상 supersedes(선택). 원본 계획을 삭제해도 과거 버전에 대상이 남아야 한다. 기존 실제 기록은 수정하지 않는다.
- Proposal: ID, baseRevision, 변경 이유, operation(upsert/remove), 근거 목록, 영향받는 예약 설명(없으면 명시), pending/applied/rejected 상태, 결정 시각·주체. 미승인 변경안은 현재 버전에 영향을 주지 않는다.
- 변경안은 basePlanNumber도 보관한다. 적용 뒤에도 해당 버전을 기준으로 이전/이후 비교를 표시하며 현재 계획을 이전 값으로 오인하지 않는다.
- Evidence: ID, URL 또는 로컬 출처 문자열, 주장, checkedAt, appliesFrom/appliesTo, relatedActivityIds, verified/unverified. 가져온 sourceRefs는 unverified. 미확인 근거를 검증된 사실로 표시하지 않는다.
- Receipt: 요청 ID, 명령 종류, 입력 fingerprint. 성공한 명령만 같은 트랜잭션에서 저장한다. 같은 ID/다른 내용은 오류, 같은 ID/같은 내용은 중복 저장 없이 반환.

revision은 계획뿐 아니라 실제 기록·장소 등 AI 컨텍스트의 변화 때도 증가한다. pending 초안 수신만으로는 증가하지 않는다. 승인 적용은 IndexedDB readwrite 트랜잭션에서 최신 revision·pending 상태·스키마·참조를 확인한 뒤 버전+결정+receipt를 함께 저장한다. 오래된 변경안은 자동 재기준하지 않는다.

## 시간과 조회

여행 startDate/endDate는 기본 시간대 기준 달력 날짜다. 각 활동·실제 기록은 자신의 IANA timeZone과 오프셋 포함 ISO 시각을 가진다. 날짜별 표시는 각 행의 현지 시작 날짜 기준, 실제 정렬은 instant 기준이다. 자정을 넘는 활동은 시작 날짜 아래에 표시하고 종료 날짜도 표기한다. 기기 로컬 시간대로 여행 시간을 추정하지 않는다. DST에서 중복되거나 없는 현지 시각은 명시적인 오프셋/해소가 없으면 거부한다.

초기 제한: 이동 활동 한 건의 출발·도착 시간대를 동시에 별도 표기하지 않는다. 두 시각은 activity.timeZone 기준으로 표시하고 다른 지역 방문은 각 활동의 timeZone을 지정한다. 날짜 변경선 이동은 instant 순서를 보존하지만 표시 기준은 해당 활동의 한 시간대다. 이 제한은 후속 교통 모델에서 확장한다.

## 파일·개인 데이터

`travel-app-trip` schemaVersion 1은 단일 여행 교환, `travel-app-backup` schemaVersion 1은 전체 여행과 이력 보존. 가져오기 전 크기 제한·스키마·고유 ID·참조·시간 순서를 검증한다. 같은 여행 ID로 조용히 덮어쓰지 않는다. 전체 백업 복원은 빈 저장소에서만 수행하고 기존 데이터가 있으면 거부한다.

브라우저 DB는 기기·브라우저·origin별이다. 계정 동기화나 암호화 백업이 아니다. JSON 백업은 개인 정보를 포함할 수 있으므로 다운로드로 제공하고 Git 추적 대상에 넣지 않는다. 브라우저는 근거 URL을 자동으로 열지 않으며 요청한 AI 조사는 서버의 웹 검색을 사용한다. React 텍스트 렌더링을 사용하고 HTML/Markdown을 실행하지 않는다.

## AI 실행 경계

`server/`는 로컬 개발의 OpenAI 실행기다. 브라우저가 여행 snapshot과 요청·변경 시작일·작업 UUID를 보내면 서버가 검증하고 모델 입력을 현재 계획·장소·유효한 실제 기록으로 축소한다. 이전 계획·정정 원본·영수증은 모델에 보내지 않는다. 브라우저가 외부 출처를 직접 자동 호출하지는 않지만 서버의 OpenAI 웹 검색은 외부 자료를 조회한다.

Job은 id/tripId/baseRevision/status/attempt/model/timestamps/error/sources/proposal과 입력의 SHA-256 fingerprint를 가진다. `local-data/ai-jobs/jobs.json`에 원자 저장한다. 키나 원본 여행 snapshot 전체를 작업 파일에 저장하지 않는다. 서버 재시작 때 진행 중 작업은 interrupted로 바뀌고 자동 API 재호출하지 않는다. 완료 작업 재조회와 같은 ID의 동일 요청은 기존 결과를 반환한다.

생성 초안은 revision을 확인해 IndexedDB에 저장하고, 승인 시 다시 revision을 검사한다. 조사 중 사용자 편집을 모델이 자동 덮어쓰지 않는다. 웹 수집 URL에 포함되지 않은 근거 URL, 과거 범위 수정, 잘못된 참조·일시, 실질 변경 없는 출력은 거부한다. AI 근거는 수집 시각을 보관하되 검토 전 unverified로 표시한다.
