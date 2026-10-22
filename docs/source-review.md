# 기존 SP-FR-guidebook 조사

## 후속 조사 · 개발전략 2단계

2026-10-21: GitHub 비교에서 main과 아래 commit이 동일함을 재확인했다. 최신 항목별 조사·처리 제안·근거는 [기능·콘텐츠 이행표](migration-inventory.md)를 참조한다. 아래 표의 재사용 판단·초기 제외는 기존 프로토타입의 구현 선택이며 새 이행 범위의 사용자 합의가 아니다.

- 정적 가이드북과 현장 앱은 조회 범위가 다르다. 앱 exporter만으로 지역 장문·facts·교통/관광 자료·회화·미디어·일부 준비 정보가 모두 이행되지 않는다.
- 실제 장소 장문 로더는 `source/CURRENT/30_Places/<slug>.md`를 읽는다. 지역은 `20_Regions`와 원본 챕터·JSON의 생성/편집 책임을 함께 확인해야 한다. 오래된 정본 색인 설명을 그대로 새 설계의 기준으로 삼지 않는다.
- 장소 본문은 facts 토큰 치환과 링크 재작성에 의존하며, 예약 레코드 일부와 준비 본문은 `build/render.py` 안에 있다. 콘텐츠를 코드 밖 데이터로 옮길 대상을 포함한다.
- 기존 앱의 장소 본문 세 섹션 편집은 이행 포함으로 사용자 확정됐다. 지도는 장소·동선 목록과 외부 링크 우선이다. 별도 보존할 기기 데이터가 없어 저장소 원본만 이행한다. 저장소에 반영된 현장 상태는 조사하지만 기존 기기 snapshot·events·peerEvents 추출은 제외한다. pending NDJSON만으로 전체 백업이 안 되는 기존 제약은 새 백업 설계의 참고로 남긴다.
- 원본의 미정 시각과 장소 관계를 현재 importer가 충분히 표현하지 못한다. 파일별 전체 목록·실제 개인 상태·실제 화면·외부 연동·전체 이행 검증은 아직 수행하지 않았다.
- 정본 색인의 `docs/content-architecture-audit.md`와 state.js 주석의 `build/apply_field_edits.py` 경로는 해당 commit에서 404였다. 관련 자료·처리기의 실제 위치는 후속 확인한다.

## 이전 조사 · 첫 프로토타입 기준

확인일: 2026-10-21 · 기본 브랜치 main · 확인 HEAD `35498adc6413dad45922f2dab87781afeb04d898`

참고 저장소: https://github.com/jeongjae/SP-FR-guidebook

## 확인한 결합과 재사용 판단

| 확인 파일 | 현재 방식 | travel-app 판단 |
|---|---|---|
| app/js/db.js | `spfr_app`, snapshot/events/peerEvents/meta 저장소 | 개념 참고. 여행 ID별 트랜잭션 저장 구조 신규 구현 |
| app/js/state.js | snapshot 위 일정 구조 수정·방문 체크 이벤트 합성 | 계획 버전과 실제 기록 분리. 방문 체크를 과거 실제 기록으로 자동 변환하지 않음 |
| app/js/github.js | 고정 저장소, GitHub Contents API, IndexedDB PAT 저장 | 재사용하지 않음. GitHub는 소스 저장소, 개인 데이터 DB가 아님 |
| build/export_app_data.py | trip.json, days/day-NN.json, places/*.json, bookings.json, field-state.json | 일일카드와 trip 메타의 명시적 변환기 구현. 가져오기 전 미리보기·검증 |
| app/sw.js | 단일 여행 캐시명과 수동 셸 파일 목록, 앱 외부 캐시 재사용 | travel-app 전용 앱 셸 캐시 생성. 개인 데이터는 IndexedDB에만 저장 |
| data/daily-cards/day-01.json | 날짜·도시·stops(id,start,end,name,place_ref 등), sourceRefs, 예약 관련 텍스트 | 일정만 구조적으로 변환. 예약·사진·숙박 상세·기존 현장 저널은 초기 가져오기 제외 |
| source/CURRENT/10_Core/itinerary.json | 43일 단일 여행, start/end/stays | 날짜 구조 참고. 실제 데이터는 소스 코드에 고정하지 않음 |

기존 원본 저장소에 쓰기·빌드·배포하지 않았다. 전체 코드를 복사하지 않았고 라이선스가 확인되지 않은 콘텐츠·이미지를 재배포하지 않는다. 테스트 픽스처는 같은 구조로 새로 작성한 가상 데이터다.

## 가져오기 계약

초기 지원: travel-app 여행 JSON, travel-app 전체 백업 JSON, SP-FR `schemaVersion: "1.0"` 일일카드 JSON 묶음.
SP-FR 묶음 형식: `{ "format": "spfr-daily-cards", "name": "사용자 지정 여행명", "timeZone": "Europe/Paris", "days": [일일카드, ...] }`.
원본 파일 수집은 별도 로컬 도구로 수행할 수 있게 한다. `--time-zone`을 명시하고, 지역마다 시간대가 다르면 카드별 timeZone 매핑 또는 가져온 뒤 검토가 필요하다.
변환 시 stop의 출처 ID는 보존하되 앱 ID는 여행 범위로 분리한다. 일일카드 날짜와 현지 start/end를 조합하고 자정을 넘는 end는 다음 날짜로 해석한다. DST 모호·존재하지 않는 시각은 거부한다. 원본의 자유 텍스트 sourceRefs는 검증된 웹 사실로 승격하지 않고 가져오기 출처로 보관한다.

현재 지원하지 않음: Markdown/PDF/XLSX 임의 파싱, 지도 경로/장소 장문/예약/사진의 전체 마이그레이션, visited 체크를 실제 방문 시각으로 추정하기.
