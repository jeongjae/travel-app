# T-D4 C4 검토 · Codex 역할 · 2026-11-11 13:20

대상 `codex/d04-limited-live` head `7bc934d`(코드 `336aa15`). 보고: [T-D4 결과](claude-task-d04-result.md) C4 절. 재배포 버전 `44a528c9…`(preview_urls=false).

## 판정: **C4 통과(승인 범위 안)** · 수정 지시 **R2 1건(병합 전)** · 관찰 항목은 T-D5로.

| 승인 항목 | 결과 |
|---|---|
| 호출 ≤10회, 추정 ≤$2 | 생성 호출 5회(서버 집계), OpenAI 잔액 $5.85→$5.73 = **$0.12**. 1회 최대 $0.048. 단가 추정($0.12)과 일치 |
| 일일 5회 | 6회째 화면 문구로 거절, 서버 집계 5 유지, 비용 0 ✔ (HTTP 429 코드는 미확인 — 기록) |
| 거절 1·적용 1·ACK | ✔ 계획 2가 현재, 계획 1 보존, GET에 output 없음 |
| 비밀값 비노출 | ✔ |
| CPU(로그인) | status·jobs GET 0~1ms ✔. login/verify·POST 생성은 미측정 → CL-32 **부분 종결**(관측값 모두 10ms 미만) |

## Claude 지목 위험과 처리

| # | 내용 | Codex 판단 | 처리 |
|---|---|---|---|
| 1 | 모델이 `title=""·activityId=""`인 add를 보냄 → Worker 검증 통과(과금) → 앱 저장 거부, "다시 저장" 계속 실패 | **실결함.** `validateAiV2Output`이 add/edit의 title·summary 비어 있음을 검사하지 않음. 앱 `planItemSchema`는 `text`(비공백 필수) | **R2** 아래 |
| 2 | 5번째 호출 웹 검색 3회(max_tool_calls=2) | `web_search_call` 출력 항목 수와 과금 단위가 다를 수 있음. 대시보드 도구 호출 수와 대조 필요 | T-D5 관찰 항목 **CL-37** |
| 3 | 출처 분류가 호출마다 다름(공식 0 ↔ 2) | 설계대로 — 분류는 활동 `officialUrl` 호스트·정부 도메인으로만 정함. 가상 장소에 officialUrl이 없어 변동 | CL-26(officialUrl 입력 경로)로 수렴. 기록 |
| 4 | 근거 간 운영시간 충돌, 모델이 09:00 선택, 카드 "미확인" | **의도된 동작**(T-D1 보수적 표시) | 기록 |
| 5 | 서버 집계 5건 중 설명 안 되는 4,949토큰 작업 1건 | 조사 1회 분량. 사용자 추가 클릭 또는 작성 전 실패로 추정되나 **인증된 작업 목록 경로가 없어 확인 불가** | T-D5 **CL-38**: 인증 필수 `GET /api/ai/v2/jobs?tripId=`(toStoredJob 필드만) 복원 + 화면 "AI 작업 기록". 지금은 OpenAI 대시보드 요청 로그로 5번째 요청의 토큰·시각 대조해 결과 문서에 적는다 |

## R2 (병합 전, 코드 1커밋)
결과 상태:
- `validateAiV2Output`: `add`·`edit` 연산의 `title`과 `summary`가 공백만이면 거부한다(`remove`는 기존대로 빈 값 허용). 거부 문구는 repair 피드백에 그대로 들어가 모델이 다음 시도에서 채우게 한다.
- 작성 지시문(`src/ai-v2-openai.ts` rules)에 "add/edit: nonempty title and one-line summary" 한 문장 추가.
- 시험: 빈 title add → 거부 / 빈 summary edit → 거부 / remove 빈 값 → 허용 / 기존 시험 전부 통과. 수정 전 실패 기록.
- 이 변경은 의미 검증 규칙 **추가**이며 계약·저장 스키마 불변. 데이터 경계 0건.

## C5 (R2와 같은 사이클)
- `[env.production.vars] DAILY_LIMIT` 5 → **20** 복원 후 재배포(버전 ID 보고). T-D4 기간 종료.
- 검토 공간 `review=d04-live` 가상 데이터 삭제, Claude가 띄운 Chrome 탭은 **로그아웃 뒤 닫는다**(토큰 해지).
- 5번째 초안("확인 대기")은 거절 처리.
- 결과 문서: 가격 표·배포 주소·점검·CPU·사용량 표(5행 모두)·실제 응답 관찰(빈 title·출처 분류·충돌 처리)·CL-37·38·미검증·T-D5 전 복원 완료 표시. `docs/runbook-worker.md`에 DAILY_LIMIT 변경 절차.
- CI 성공 → Codex 최종 검토 → main 병합 → 사용자 확인.

## 미검증(이월)
HTTP 429 코드 직접 관측 · login/verify·POST CPU · iOS 패스키 · 15분 상한 작업 · 4번째 작업 정체(CL-38) · 웹 검색 과금 단위(CL-37).
