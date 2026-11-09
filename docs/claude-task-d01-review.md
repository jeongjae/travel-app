# T-D1 검토 (R1~R5) — Codex 역할 독립 검토 · 2026-11-09 12:40

대상 `codex/d01-send-semantics` 코드 head `bed2e18`(문서 head `731b226`). 기준 main `c678390`.
검토자: Codex 역할(Claude 대화 세션, 구현 세션과 별개 컨텍스트). R1~R5를 구현한 세션이 아니며, 구현 세션의 자체 검토서(`731b226`)는 참고만 하고 코드·시험을 diff부터 다시 읽었다.
**검토자 한계:** PC에서 시험을 재실행하지 못했다(실행 권한 없음). 코드·시험 파일 정독과 CI 결과(gh로 직접 확인)가 근거다. 12:50 GitHub 접근 권한을 사용자 승인으로 받아 CI는 직접 확인했다.

## 판정: **조건부 통과** — R6(필수, 작음) 해소 뒤 병합. R7은 선택.

병합을 막는 데이터·보안 결함은 없다. R6는 사용자 오해를 막는 UI 라벨 1건으로, 커밋 1개 규모라 병합 전에 넣는다.

---

## 1. 절차 결과

| 절차 | 결과 | 근거 |
|---|---|---|
| 1 원격 CI | **직접 확인(12:50, gh)** — `bed2e18` run 42548045421 success, `731b226` run 42553874067 success. `travel-app checks` 1 job에 check·check:pilot·test:e2e 순차 | 이 세션 |
| 1 skip 5건 | 실제 패키지 env(`C14_REAL_PACKAGE`·`C15_REAL_PACKAGE`) 부재·모바일 전용 프로젝트 건너뜀. 개별 대응 미확인 | 구현 세션 보고 |
| 2 데이터 경계 | **직접 확인** `git diff c678390 bed2e18 --stat -- src/contracts src/storage src/transfer src/repository.ts` = 0건 | 이 세션 |
| 3 수정 전 실패 표본 | job-retention만 구현 세션이 확인(되돌리면 4 실패). 나머지는 미재실행. 대신 시험 파일의 단언 구조를 정독해 "수정 전 실패 가능성"을 판단(§2) | 이 세션 |
| C3 .gitignore | `.obsidian/`·`travel-app/`·`research_notes/` 3줄 `bed2e18` 포함 **직접 확인** | 이 세션 |

변경 범위: 31파일 +3,591/−734. 코드는 `server/ai-v2-jobs.ts`·`ai-v2.ts`·`index.ts`, `src/ai-v2-{context,contract,semantics}.ts`, `src/content/{AiPlanner,Workflows}.tsx`·`proposal-review.ts`·`content.css`. `docs/d00/send-surface.probe.ts`(338줄) 삭제 → `tests/ai-v2-send-surface.test.ts`로 정식 시험화(README에 안내).

## 2. 검토 항목

### A. 수정 결과

| # | 판정 | 확인 내용 |
|---|---|---|
| A1 R1 | **통과** | `deriveDayTimes`: 장거리 이동을 위치별로 도착(첫 활동에서 출발)/출발(마지막 활동으로 도착)/구간(그 외)으로 나눔. 창을 합치지 않음. 도착>출발이면 둘 다 null로 안전 처리. 시험 6건(오전 도착·오후 출발·낮 구간·이동 2회·이동 뒤 활동 없음·이동 없음) 모두 허용·거부 양쪽 단언 |
| A2 야간 | **통과** | `timeSpan`: 종료<시작 → +1440. 12시간 상한(`maxOvernightMinutes`) 초과 시 거부. 다음 날 도착·첫 활동·선택 범위 밖 다음 날(`followingDay`)·전날 넘어온 고정 활동 모두 검사. 저장 종료 날짜는 기존 필드로 다음 날 기록(스키마 불변). 시험 9건 |
| A3 R2 | **통과** | `displayedDayTimes`: 입력 `''`는 추정값으로 되돌아가지 않음. payload는 `...(shown.arrival ? {arrival} : {})`로 **키 자체 생략**. 시험이 `Object.keys(...).not.toContain('arrival')`과 값 부재(`JSON.stringify(...).not.toContain('14:20')`)를 단언. 채운/추정/비운 3경우 화면값=전송값 단언 |
| A4 R3 | **통과** | `toStoredJob` 허용 목록 1곳이 `persist()`(저장)·`get()`(응답)·`create()` 반환·`cancel()` 반환을 모두 지남. `init()`에서 기존 항목 재통과 후 persist. 저장 scope(`toValidationScope`)는 ID·시각·fixed만 — 제목·요약·요청·기록 없음. 목록 라우트 삭제 확인(`list()`는 내부 전용). 시험 4건 |
| A5 R4 | **통과** | `ConfirmationState = {revisionId, activityIds}`. `confirmationsFor`가 revision 불일치 시 빈 집합. 시험 3건(순서·개수 변경, revision 변경, 체크 해제). "체크 안 한 항목 적용 경로": `operationsToApply`는 `needsConfirmation && !confirmed`면 제외 — 코드상 경로 없음 |
| A6 R5 | **조건부** | (a) 저장·응답 모두 메모리 작업을 직접 바꿔 함께 제거됨 ✔. **장기 가동 서버에서 조회만 하면 정리가 돌지 않음** → R7(선택). (b) **만료된 변경안 대기 작업이 라벨 "실패"로 표시** → **R6(필수)**. (c) `ErrorText`가 `job.error` 출력 — 코드 확인, E2E 없음(기록). (d) 중단 작업 `updatedAt` 기준 타당. (e) 브라우저 무영향 시험은 구조 단언만 — 서버 코드에 브라우저 저장소 접근이 없으므로 **충분**으로 판단 |

### B. 위험

| # | 판정 | 확인 내용 |
|---|---|---|
| B1 followingDay | **통과** | `followingDayOf`: 날짜·첫 시작 시각·도착 시각만. 계약 `strictObject` + canary 시험(`allowedForPlanning` 집합 **동일성** 단언 — 보내지 않는 것까지 잡음) |
| B2 jobs 무인증 조회 | **기록** | GET은 UUID 36자 필수, 목록 없음. 24h 안 노출 필드 = `toStoredJob` 목록(ID·상태·시각·모델·attempt·sources(url/title)·usage·result(output/sources/scope/warnings)·error). 결과 문서 §R3 표와 일치. 인증은 T-D2 |
| B3 이동 구간 끄기 | **통과·기록** | `dayTimes`는 `AiPlanner` React 상태 → **새로고침·백업·복원에서 유지되지 않음**(요청 1회용 입력이라 타당). 결과 문서 §121에 추가 사실은 있으나 "유지 안 됨"은 미기재 → 문서 한 줄 추가(R6에 포함). 끄기는 `blocked`만 비우고 고정 활동 겹침 검사는 그대로 ✔ |
| B4 추정 규칙 경계 | **기록** | 2개 활동만 있는 날(출발 공항→도착 호텔)은 "첫 활동에서 출발" 분기가 우선해 도착만 생김 → 출발지 오전 활동 제안 거부. 사용자 실데이터 확인 항목(5단계) |
| B5 구형식 폐기 | **통과** | `toStoredJob`이 `result.planning` 구형식에서 output·scope만 옮김. 브라우저 저장소 접근 없음 |
| B6 두 번 저장 | **기록** | 결정대로 |

### C. 문서

| # | 판정 |
|---|---|
| C1 | 결과 문서 §정정, §R3(보존 24h·인증 T-D2) 있음 — 구현 세션 보고 기준, 이 세션은 grep으로 §R3 존재 확인 |
| C2 | 후속 5건 — 구현 세션 보고 기준 |
| C3 | ✔ 직접 확인 |

### 이 검토에서 새로 찾은 것 (구현 세션 자체 검토에 없던 항목)

| # | 내용 | 심각도 | 처리 |
|---|---|---|---|
| N1 | `outputExpiredMessage`가 `server/ai-v2-jobs.ts`에 있어 UI가 만료를 판별하려면 서버 모듈을 import해야 함 | 낮음 | R6에서 `src/ai-v2-contract.ts`로 이동 |
| N2 | 계약 `blocked[].from/to`가 `z.string()`(HH:MM 정규식 없음). `validateAiV2Output`이 `toMinutes`로 NaN을 만들면 비교가 모두 false → 구간 검사가 조용히 비활성. 클라이언트가 생성하므로 실위험 낮음 | 낮음 | R7(선택) 또는 T-D2 |
| N3 | `deriveDayTimes`가 자정을 넘는 낮 구간(`from > to`)을 조용히 버림 | 낮음 | T-D2 기록 |
| N4 | `list()`가 `toStoredJob`을 거치지 않음 — 현재 내부 전용(실행 중 작업 확인)이라 노출 없음 | 정보 | 기록만 |

## 3. 수정 지시

### R6 (필수, 병합 전) — 만료 상태 표시

결과 상태:
- `outputExpiredMessage` 상수는 `src/ai-v2-contract.ts`에 있고 서버·브라우저가 같은 값을 import한다.
- `job.error === outputExpiredMessage`인 작업은 화면 상태 줄에 **"만료"**가 보인다("실패"가 아니다). 다른 실패는 그대로 "실패".
- 만료 작업의 안내 문구는 기존 `ErrorText`로 그대로 보인다.
- 저장 스키마·`AiV2Status` enum·jobs.json 형식 변경 없음.
- 결과 문서 §R3에 "만료는 상태 failed + error 문구로 저장되고 화면은 '만료'로 표시", §이동 구간 끄기에 "요청 1회용 입력, 새로고침·백업에 유지되지 않음" 한 줄씩 추가.

시험(최소): 단위 — 만료 작업 → 라벨 "만료", 일반 실패 → "실패". (E2E 선택.)

### R7 (선택) — 조회 시 만료 정리 · blocked 시각 형식

- `get()`에서 응답 전에 `expireOutputs()`를 호출한다(타이머 아님). 시험: 25시간 지난 작업을 `create()` 없이 `get()`만 해도 출력이 없다.
- 계약 `blocked[].from/to`에 `^\d{2}:\d{2}$` 정규식. 시험: 잘못된 형식은 `aiV2PlanningDtoSchema.parse`가 거부.
- 하지 않으면 두 항목을 T-D2 지시서에 넣는다.

## 4. 미검증 (그대로 이월)

실제 OpenAI 응답 호환 · 실제 여행 데이터 필드·추정 규칙 적합성(B4) · iPhone 실기기 · 로컬 Node 서버 HTTP 경로(단위만) · 적용 중간 실패 화면(단위만) · 만료 문구 화면 표시(E2E 없음) · **이 세션의 시험 재실행**

## 5. 병합·후속

- R6 완료·push·CI 성공 → 병합. 12:50 사용자 승인으로 Codex 역할 세션이 push 권한을 얻었으므로 **병합·push·handoff 갱신은 Codex 역할 세션이 직접 수행**한다(인계 §2-5 원칙 유지).
- `decisions.md` 기록 5건: D-1 T-D2 이월 / D-2 추정 유지·leg 시각 필드 없음 / 야간 허용 12h / R3 (a) / R5 24h 보존·인증 T-D2.
- T-D2 후보: rename EPERM · jobs 조회 인증 · 부분 적용 되돌리기 · 사유 JSON 표시 · officialUrl 입력 경로 · (R7 미수행 시) 조회 시 만료 정리·blocked 형식 · N3 자정 넘는 구간 · B4 실데이터 결과.
- 사용자 확인 상태: **미확인** 유지. 시험·검토 통과는 확인 완료가 아니다.
