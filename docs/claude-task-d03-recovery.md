# Claude Sonnet T-D3 · 모의 통합·복구

2026-11-10 · 기준: main `e423d88` 이후(T-D2 종결 커밋 포함) · **작성 완료 / 전달 가능 / 착수 전**

> [계획 §8](phase-d-plan.md) T-D3: T-D1+T-D2를 **가짜 OpenAI만으로** 통합하고, 응답 유실·중복·취소·결과 불명·Worker 재시작·브라우저 종료·저장 실패·stale·두 여행 격리를 **재현 시험으로 고정**한다. 실제 외부 호출·배포·계정 작업 0. 근거: [설계 §7·§8](phase-d-design.md), [T-D0 결과](claude-task-d00-result.md) "T-D3" 권고(ACK 단순화), [T-D2 검토](claude-task-d02-review.md) §3~§5, [결정 11/10](decisions.md).
> `main`에서 `codex/d03-recovery`를 만들어 시작한다. 자율 수행·결과 문서 `docs/claude-task-d03-result.md`(요약 20줄). §6 멈춤 조건 외에는 확인을 요구하지 않는다.

## 0. 착수 전
- `git fetch`; `main` = `origin/main` 확인(지시서 커밋이 더해져 있을 수 있다 — T-D2 §0과 같은 판단). 작업 트리 깨끗한지 확인. `codex/ui-resume`은 건드리지 않는다.
- 의존성 추가가 있으면 별도 첫 커밋.

## 1. 확정 결정 (2026-11-10 사용자)

| ID | 결정 |
|---|---|
| U-D2-1 | **허용** — 실행 중 요청 원문·조사 본문을 DO 저장소에 임시 저장한다. 작업이 끝(awaiting-decision·failed·cancelled·unknown·expired)나는 즉시 삭제한다. |
| U-D2-2 | 토큰 1시간 · 일일 20회 유지 |
| U-D2-3 | 등록 코드 전달 방식은 T-D4 |
| T-D2 | 사용자 확인 완료(11/10 10:11) |

## 2. 고칠 것

### A. 실행 중 원문 임시 저장과 재시작 복구 (CL-31, U-D2-1)
결과 상태:
- DO 표 `inflight(job_id PK, input TEXT, research TEXT NULL, repair TEXT)`를 둔다. `create()`가 작업 행과 **같은 동기 구간**에 쓴다. `researchDone`이 research를 갱신한다.
- 작업이 끝나는 모든 경로(`finish`·`planningDone` 성공·`cancel`·`expire`·`prune`)에서 같은 동기 구간에 `inflight` 행을 **삭제**한다. 끝난 작업의 `inflight` 행이 남는 경로가 없음을 시험으로 고정한다.
- `tick()`은 메모리에 없는 실행 중 작업을 `inflight`에서 복원해 이어간다. `interrupted`는 `inflight` 행도 없을 때만(이전 형식 작업) 쓴다.
- `inflight`는 `GET` 응답·백업·내보내기 어디에도 나가지 않는다. `toStoredJob`은 바뀌지 않는다.
- 결과 문서 §저장 필드 표에 `inflight`를 추가하고 "실행 중에만, 종료 즉시 삭제"를 명시한다. T-D1 R3(a)의 예외로 `decisions.md` 11/10 결정을 인용한다.

시험: 재시작(아래 §C의 `/__test/restart`) 뒤 `queued`·`researching`·`planning` 각 상태에서 이어가서 `awaiting-decision`에 도달 · 끝난 뒤 `inflight` 0행 · 만료·prune 뒤 0행.

### B. 복구 시나리오 (설계 §8 139행·§7) — 각각 E2E 또는 Worker 하네스 시험 1건 이상
| # | 시나리오 | 결과 상태 |
|---|---|---|
| B1 | 전송 성공 직후 202 응답 유실(브라우저가 못 받음) | 같은 요청 ID·같은 내용 재전송 → 기존 작업 반환, 일일 횟수 **추가 소모 없음**, 외부 호출 1회만 |
| B2 | 전송 뒤 브라우저 종료 → 재방문 | `localStorage`의 작업 ID로 재회수. 로그인 만료면 재로그인 뒤 같은 작업으로 복귀 |
| B3 | 변경안 저장(Stage) 실패 — 저장소 한도·stale | 서버 결과 유지, 화면에 원인과 "다시 저장" 제공. 자동 재요청 없음 |
| B4 | **저장 뒤 ACK** — T-D0 권고대로 별도 프로토콜 없이 `POST /api/ai/v2/jobs/{id}/ack`: 브라우저가 Stage 성공 직후 호출 → 서버는 `result.output`을 지우고 상태 `acknowledged`(비내용 필드·usage·sources 유지). ACK가 유실되면 24h 보존이 지운다 | ACK 뒤 GET에 output 없음. ACK 전 Stage 실패면 output 유지(B3) |
| B5 | 실제 기록 추가 뒤 stale(`baseDomainRevision` 불일치) | Stage 거부·"계획이 바뀌어 적용할 수 없음 — 새 요청" 안내. 서버 결과는 24h 안 재회수 가능 |
| B6 | 취소 경합 — `calling` 중 취소, 폴링 중 취소 | 다음 alarm이 OpenAI 취소 1회, 재호출 0, 상태 `cancelled` 고정 |
| B7 | 결과 불명(`unknown`) → 사용자가 다시 요청 | 새 요청 ID로 생성, 이전 작업은 그대로 `unknown`, 일일 횟수 1 소모 |
| B8 | 응답 회수 실패 — OpenAI `GET` 404(보관 만료)·5xx 반복 | 404 → `failed`(lostResponseMessage), 5xx는 작업 시간 상한(15분)까지 재시도 뒤 `failed` |
| B9 | **두 여행 격리** | 여행 A의 작업 결과를 여행 B 공간에서 Stage 시도 → `scope.tripId` 불일치 거부. 여행 B 화면에 A의 작업이 보이지 않음 |
| B10 | 오프라인 유지 | 오프라인에서 저장된 변경안 조회·적용/거절 가능. 폴링은 멈추고 "오프라인" 표시, 온라인 복귀 시 재개. 전송 단추 비활성 |

### C. Worker 내성 (T-D2 검토 N1, 위험 5)
- `tick()`은 작업별 try/catch로 한 작업의 예외가 다른 작업과 재예약을 막지 않는다. 예외는 그 작업을 `failed`(내부 오류 문구, 입력 비노출)로 끝낸다. 시험: 한 작업이 던져도 다른 작업 진행·alarm 재예약.
- `daily_counts` 토큰 합계와 작업 행 쓰기는 같은 동기 구간에 있음을 코드 구조로 보장하고(한 함수 안, await 없음), 재회수 경로에서 **중복 가산이 없음**을 시험으로 고정(같은 응답을 두 번 처리해도 합계 1회).
- 시험 전용 `/__test/restart`(메모리 비움, 저장소 유지)를 `/__test/reset`과 같은 게이트(`E2E_RESET=1` + `RP_ID=localhost`)로 추가.

### D. 등록 코드 보호 (CL-30, T-D4 전 필수 — 지금 함)
- `REGISTRATION_CODE` 16자 미만이면 등록 경로 503(`not_configured`).
- 코드 불일치 5회 누적 시 등록 잠금(`settings.registration_locked`), 해제는 비밀값 교체 + 설정 초기화만. 잠금 상태는 `/auth/state`에 `locked: true`로 노출(코드 자체는 노출 안 함).

### E. 가짜 OpenAI 고장 주입
- `scripts/fake-openai.ts`에 시나리오 스위치(요청 헤더 또는 제어 경로): 생성 지연·생성 후 연결 끊김·GET 404·GET 5xx N회·`incomplete`·거절. E2E가 B1~B8을 이것으로 재현한다. 실제 API 형식은 바꾸지 않는다.

## 3. 범위 밖
배포·키·계정(T-D4) · 실제 OpenAI 호출 · Node 서버 삭제(T-D4 뒤 결정) · UI 후속 CL-23·25·26(별도 UI 지시) · workerd CPU 실측 CL-32(T-D4 전, `wrangler dev` 실측은 결과 문서에 **참고값**으로만 기재 가능) · iPhone 실기기.

## 4. 시험·검사
- 데이터 경계 4경로 변경 0건. `src/ai-v2-contract.ts`에 상태 `acknowledged`·ACK 경로 타입 추가는 허용(계약 **추가**만, 의미 검증 규칙 불변).
- 단위: §A 복원 3상태·삭제 전수, §C 예외 격리·중복 가산 0, §D 길이·잠금.
- E2E(가짜 OpenAI + 가상 패스키 + `/__test/restart`): B1~B10 각 1건 이상. 기존 T-D1·T-D2 E2E 전부 통과.
- canary 시험 유지(전송 집합 동일성·DO 행 표식 없음) + `inflight` 행은 종료 뒤 0.
- `pnpm run check` exit 0, 원격 CI `travel-app checks` 성공. 스크린샷 `docs/design/ui-d03/`: 재로그인 복귀·저장 실패·stale·오프라인·불명 (모바일·데스크톱).

## 5. 결과 문서 `docs/claude-task-d03-result.md`
요약 20줄 → 상태 기계 그림(`acknowledged` 포함) → §A~E 결과 상태 대조("했다/안 했다/다르게 했다") → 저장 필드 표(`inflight` 포함, 삭제 시점) → B1~B10 시험 색인 → 미검증 → Codex가 먼저 볼 위험 → 사용자 결정 필요.

## 6. 멈추고 보고하는 조건
- 계약의 **기존 필드**나 의미 검증 규칙을 바꿔야 할 때. 데이터 경계 4경로를 건드려야 할 때.
- ACK 뒤 output 삭제가 기존 재회수 E2E와 충돌해 설계 변경이 필요할 때(변경안만 제시).
- 실제 외부 호출·배포가 필요해 보일 때 — 하지 않고 보고.

## 7. 완료 보고 형식
상태(자체 검사 / Codex 검토 / 사용자 확인) → 커밋 목록 → §A~E 대조 → B1~B10 시험 색인(수정 전 실패 기록 포함) → 저장 필드 표 → 데이터 경계 diff → CI → Codex가 먼저 볼 위험 → 미검증 → 다음 단계.
