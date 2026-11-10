# T-D3 검토 · Codex 역할 독립 검토 · 2026-11-10 12:10

대상 `codex/d03-recovery` head `6b8e9f4`(코드 head `78d5e34`). 기준 main `5a70490`. 지시 [T-D3](claude-task-d03-recovery.md), 결과 [claude-task-d03-result.md](claude-task-d03-result.md).
검토자: Codex 역할(Claude 대화 세션). 결과 문서 요약·§A~E 대조·상태 기계 → `worker/src/jobs.ts`(save·acknowledge·tick·recall)·`store.ts`(inflight)·`app.ts`(ack 라우트·테스트 게이트)·`auth.ts`(잠금) 정독 → CI·데이터 경계 직접 확인. 시험 재실행은 하지 않았다.

## 판정: **통과** — 병합. 후속 CL-34·35 기록. 사용자 결정 신규 없음(결과 문서 20번 2건은 Codex가 아래처럼 처리).

## 1. 절차

| 절차 | 결과 |
|---|---|
| CI | `78d5e34`·`6b8e9f4` `travel-app checks` success(gh 직접 확인) |
| 데이터 경계 | `git diff origin/main 6b8e9f4 --stat -- src/contracts src/storage src/transfer src/repository.ts` = 0건 **직접 확인** |
| 계약 변경 | `src/ai-v2-contract.ts` +7: 상태 `acknowledged`, `aiV2AckPath()` — **추가만**(지시 §4 허용 범위) |
| 커밋 분리 | Worker(`a24107d`) → 앱·E2E(`78d5e34`) → 문서(`6b8e9f4`). 새 의존성 없음 |
| 변경 규모 | 18파일 +1,425/−128(문서 제외). 시험 +918(단위 35 신규 중 20 수정 전 실패, E2E 10/10 수정 전 실패) |

## 2. 결과 상태 대조

| 항목 | 판정 | 확인 |
|---|---|---|
| A inflight·같은 트랜잭션 | ✔ | `create()` `atomic()`에 jobs·daily_counts·inflight. 이후 모든 작업 행 쓰기는 `save()` 한 경로 — 끝난 상태면 같은 트랜잭션에서 `deleteInflight`, 실행 중이면 `putInflight`. prune은 `deleteJob`이 함께 삭제 |
| A 복원 | ✔ | `recall()` 메모리 → inflight 순. 둘 다 없을 때만 `interrupted`. 재시작 시험 4상태(queued·researching·planning·validating) + 종료 7경로·만료·prune 뒤 0행 |
| A 비노출 | ✔ | inflight는 `/__test/inflight`(행 수만, 게이트)에만. `toStoredJob` 불변 |
| B1~B10 | ✔ | E2E `ai-d03-recovery.spec.ts` 데스크톱·모바일 각 10건. B3/B5 분리(stale에 "다시 저장" 없음)는 **타당** — 같은 revision 재저장은 같은 거부 |
| B4 ACK | ✔ | `acknowledge()`: `awaiting-decision`만 수락(409 `not_awaiting_decision`), 이미 `acknowledged`면 멱등. result 삭제·usage·sources 유지. `notExpirable`에 포함. 라우트는 `verify` 뒤 |
| C tick 격리 | ✔ | 작업별 try/catch → `contain()`; finally에서 재예약. `validating` 예외는 재회수(응답 ID 있음, 외부 생성 없음) — T-D2 결과 저장 실패 복구 원칙과 일치, **수용**. `calling`은 `unknown` |
| C 중복 가산 0 | ✔ | `save()` 안 `addDaily` + `putJob` 한 트랜잭션, await 없음. 동시 tick·재시작 시험 |
| C `/__test/restart` | ✔ | `allowReset` 게이트(E2E_RESET + RP_ID=localhost) |
| D 등록 보호 | ✔ | 16자 미만 503 `not_configured`, 5회 423 `registration_locked`, `/auth/state` `{registered, locked}`만 |
| E 고장 주입 | ✔ | `createDelayMs`·`dropAfterCreate`·`getFailure`·`incomplete`·`refuse`. 응답 형식 불변 |

## 3. Claude가 지목한 위험·결정과 Codex 처리

| 내용 | 처리 |
|---|---|
| inflight에 요청 원문이 최대 15분(작업 시간 상한) | U-D2-1 결정 범위 안("실행 중·종료 즉시 삭제"). 15분은 `aiV2JobLimits` 상한과 같다. 기록만 |
| ACK 유실 시 출력 24h 잔존 | 설계대로(T-D0 권고). 기록만 |
| 등록 잠금 해제 운영 경로 없음 | **CL-34** T-D4: `wrangler secret put REGISTRATION_CODE` 뒤 settings 초기화 명령(또는 Worker 재배포 시 초기화) 절차 문서화 |
| `acknowledged` 보관 기간(지금은 200건 prune만) | **Codex 결정**: 내용 필드가 없으므로 prune만으로 충분. 통일성을 원하면 T-D4에서 24h 만료 대상에 넣는다. **CL-35** 기록 |

## 4. 추가로 본 것
- `tick()` 두 번째 루프(cancelled·failed의 OpenAI 취소)는 `store.putJob` 직접 호출 — 이미 끝난 작업이라 inflight 영향 없음. 정보.
- `acknowledge()`가 `expire()`를 먼저 부르므로 24h 지난 작업의 ACK는 409. 화면은 ACK 실패를 무시 — 일관.
- 등록 잠금 상태에서 `/auth/state`가 `locked`를 노출 — 공개 Worker에서 "등록 시도가 있었다"는 정보가 새지만 코드·자격 정보는 아님. 수용.

## 5. 미검증 (이월)
실제 workerd 축출·재시작(시험은 메모리 비움 근사) · 실제 OpenAI 404/5xx 형식 · iOS 패스키 · 이 세션의 시험 재실행.

## 6. 병합·다음
main fast-forward → checks·Pages 확인 → `change-log.md`(CL-34·35) · `handoff.md` 갱신. 사용자 확인 상태: **확인 대기**(`docs/design/ui-d03/` 화면). 다음은 **T-D4(제한된 실제 호출)** — 사용자 승인 4건(U-D2 모델·예산, U-D3, Worker 배포, 키 설정·호출 금액)이 선행 조건이며 지시서는 승인 뒤 발행.
