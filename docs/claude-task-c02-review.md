# C-02〔T-C3.2〕Codex 독립 검토

2026-10-30 · 제출 `027a131` · 주요 코드 `3450cfa`·`8748352`·`5656afd`·`a4081c5`·`0f743b6`
**주요 기능 독립 검토 통과 / DST 특수 입력 오탐은 후속 CL-08 / 사용자 검토 준비**

## 판정·범위

숙박/이동 추가·수정·제거, 영향 날짜의 하루/야간 지역, 새 계획/과거 보존·충돌/롤백·AI 경계 분리가 적절하다.
수동 계산은 SP-FR 어댑터와 분리했고 기존 여행을 열거나 항목만 편집할 때 전체 재계산하지 않는다.
계획 날짜 ordinal 정렬은 신규 여행의 첫날 조회 결함 수정이며, 기존 데이터·과거 버전을 재작성하지 않는다.
보관함 로딩 경쟁 수정은 관련 화면을 대기 후 그리도록 범위를 제한했다. 경쟁의 결정적 재현/원격 CI는 이번 독립 확인이 아니다.

## 독립 검사

| 검사 | 결과 |
|---|---|
| `pnpm exec vitest run tests/time-zone-write.test.ts tests/manual-stays.test.ts tests/plan-stays-legs.test.ts tests/plan-day-order.test.ts` | 4파일·38검사 통과, exit 0, 10:46:14, 2.47초 |
| `pnpm run build` | 타입/빌드/PWA 생성 통과, exit 0 |
| `pnpm run test:e2e tests/e2e/stays-legs.spec.ts` | desktop 4·mobile 4, 8검사 통과, exit 0, 42.1초 |
| DST 종료 구간의 유효 instant 범위 추가 검사 | 1개 실패, exit 1, 10:47:00. CL-08로 후속 추적 |

UI는 가상 입력·별도 브라우저 저장소만 사용했고 로컬 서버/브라우저 허용 경로로 실행했다.
Browser plugin/browser 스킬 미제공으로 기존 프로젝트 Playwright 회귀를 사용했다. 모바일은 Pixel 7 에뮬레이션이며 iPhone 확인이 아니다.
Claude 전체 검사 `.cache/verification/2026-10-29T10-10-17-513Z/results.json`의 check/E2E/pilot exit 0을 확인했다.
전체 회귀·원격 CI·실자료 적용을 이번 Codex 독립 검사로 보고하지 않는다. 사용자 DB/원본/ZIP·main·배포·API 변경 없음.

## 후속 CL-08 · DST instant 범위 오탐(P2, 이번 수용 비차단)

Europe/Paris의 DST 종료일 2033-10-30, 시작 02:45 +02:00(00:45Z)→종료 02:15 +01:00(01:15Z)는
실제 경과 30분인 유효 범위다. 기존 timeRangeSchema는 허용하지만 새 timeRangeReversal이 벽시계만 비교해 역전으로 거부한다.
재현을 `.cache/c02-codex/dst-instant-range-repro.test.ts`에 보존했다(미커밋, 개인 자료 없음).

영향은 특수한 유효 입력의 저장 거부이며 잘못된 저장·과거 데이터 손상은 관찰되지 않았다.
사용자의 경미한 문제 후속 처리 원칙에 따라 지금 수정 지시를 반복하지 않는다. 단, 시간 검증이 모든 경계에서 완료됐다고 보고하지 않는다.
향후 두 끝점이 instant이면 instant 순서로 우선 비교하고 local 입력의 모호성 정책과 분리해 회귀를 추가한다.
DST 중복 시간 입력 지원/시간 검증 최종 마감 전에 처리한다. 상세 상태는 [후속 목록](change-log.md).

## 정정·다음

CL-05의 ‘미지원 시간대 이름 허용’은 Claude가 C-01에서 잘못 추론한 내용으로 C-02 회귀/소스 검토에서 반증됐다.
기존 스키마가 이미 거부했으며 새로 추가된 실질 검증은 ChangePlan 시작/종료 역전 검사다. 이 정정을 후속 목록에 반영했다.
CL-04는 로딩 경쟁 수정 제출/관련 화면 검사 통과 상태로 갱신하되 장기 비재발을 확인한 것으로 기록하지 않는다.
다음 큰 기능은 C-03〔T-C4〕지역·여행 가이드와 기본정보 편집이다. C-02 사용자 확인은 검토 준비,
C 전체·B/G2/G2′·실기기·배포/사용자 사본 적용은 각각 별도 대기다.
