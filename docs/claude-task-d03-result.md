# T-D3 결과 · 모의 통합·복구

2026-11-10 · 브랜치 `codex/d03-recovery` · **구현 / Claude 자체 검사 통과 / Codex 검토 대기 / 사용자 미확인**

## 요약 (20줄)

1. T-D1(앱)과 T-D2(Worker)를 **가짜 OpenAI만으로** 통합했다. 실제 OpenAI 호출, 배포, 계정 작업은 0건이다. 새 의존성도 없다.
2. U-D2-1: DO 표 `inflight(job_id, input, research, repair)`를 추가했다. 작업 생성 시 `jobs`·`daily_counts`·`inflight` 쓰기를 한 트랜잭션(`transactionSync`)으로 확정한다.
3. 작업 행은 `save()` 한 경로로만 쓴다. 끝난 상태로 쓰면 같은 트랜잭션에서 `inflight` 행을 지운다. 7개 종료 경로와 만료·prune 뒤 0행임을 시험으로 고정했다.
4. 재시작 복구: `tick()`은 메모리에 없는 작업을 `inflight`에서 복원한다. queued·researching·planning·validating에서 재시작해도 `awaiting-decision`까지 가고, 외부 생성 호출을 반복하지 않는다. `interrupted`는 `inflight` 행도 없는 이전 형식 작업에만 쓴다.
5. B4 ACK: `POST /api/ai/v2/jobs/{id}/ack`는 `awaiting-decision`일 때만 받는다. 처리하면 `result`를 지우고 상태를 `acknowledged`로 바꾼다. usage·sources는 남고, 24시간 만료 대상에서 뺀다. 화면은 Stage에 성공한 직후 부르며, ACK 실패는 무시한다(24시간 보존 기한이 지운다).
6. 계약에 추가한 것은 상태 `acknowledged`와 `aiV2AckPath()` 두 가지뿐이다. 기존 필드와 의미 검증 규칙은 그대로이고, `toStoredJob`도 바꾸지 않았다.
7. §C: `tick()`은 작업마다 try/catch로 감싸고, 다음 alarm은 finally에서 다시 잡는다. 예외가 나면 그 작업을 `failed`(내부 오류 문구)로 끝낸다. 예외 문구와 입력은 저장하지 않는다. 단 `validating`은 재회수하고, `calling`은 `unknown`으로 끝낸다(17번).
8. 사용량은 `save()` 안에서 작업 행과 같은 트랜잭션으로 더한다(await 없음). 두 alarm이 같은 응답을 동시에 처리해도, validating에서 재시작해도 합계는 한 번만 오른다.
9. §D: 등록 코드가 16자 미만이면 등록 경로는 503 `not_configured`를 돌려준다. 틀린 코드가 5회 누적되면 423 `registration_locked`로 잠그고, `/auth/state`는 `{registered, locked}`만 알린다.
10. §E 가짜 OpenAI 제어 경로를 추가했다: `createDelayMs`·`dropAfterCreate`·`getFailure{status,times}`·`incomplete`·`refuse`. 응답 형식은 실제 API와 같다.
11. 화면에 추가한 것은 아래와 같다.
    - B1: 응답을 못 받은 전송은 같은 요청 ID로 다시 보낸다.
    - B3: Stage 실패 알림과 "다시 저장" 단추.
    - B5: stale 안내 "계획이 바뀌어 적용할 수 없음 — 새 요청".
    - B10: 오프라인일 때 폴링·전송을 멈추고, 연결되면 다시 이어 간다.
    - B2: 로그아웃 상태에서도 최근 작업을 안내한다.
    - 등록 잠금 안내.
12. 시험 전용 `/__test/restart`(메모리만 비움)와 `/__test/inflight`(행 수만)는 `/__test/reset`과 같은 조건(`E2E_RESET=1` + `RP_ID=localhost`)에서만 열린다.
13. 단위 시험: Worker 50건(작업 15, 복구 24, 인증 11). `pnpm run check` exit 0, 460 통과 / 1 skip. 두 번 연속 통과했다.
14. E2E: `ai-d03-recovery.spec.ts`에 A와 B1~B10을 담았고, 데스크톱·모바일 각 10건씩 통과했다. 전체 E2E 결과는 [아래](#시험)에 적었다.
15. 수정 전 실패 기록: 새 단위 시험 35건 중 20건, 새 E2E 10건 중 10건이 이전 코드에서 실패했다. 이전 코드에서도 통과한 것은 기존 동작을 고정한 시험이다.
16. 데이터 경계 4경로(`src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts`)는 `git diff main` 기준 0줄 바뀌었다.
17. 다르게 한 것
    - stale일 때는 "다시 저장" 단추를 두지 않았다. 다시 저장해도 같은 거부가 나기 때문이다.
    - `validating`에서 난 예외는 failed로 끝내지 않고 재회수한다. 15분 상한이 끝을 정한다.
18. Codex가 먼저 볼 위험
    - `inflight`에 요청 원문이 최대 15분(작업 시간 상한) 남는다.
    - ACK가 유실되면 출력이 24시간 남는다.
    - 등록 잠금은 비밀값 교체로 풀린다(D안, 지문 비교).
19. 미검증: 실제 workerd 축출과 재시작(시험 경로가 메모리만 비우는 근사), 실제 OpenAI의 404·5xx 형식, iOS 패스키.
20. 사용자 결정(2026-11-10): 등록 잠금은 D안(비밀값 교체 시 자동 해제, 구현함), `acknowledged`는 A안(현행 유지, 200건 prune).

## 상태 기계

```
              create (jobs+daily+inflight 한 트랜잭션)
                 │
               queued ──alarm──▶ calling ──생성 성공──▶ researching ──완료──▶ calling ──▶ planning
                 │                 │  └─연결 끊김/재진입──▶ unknown           (사용량·조사 본문 함께 저장)     │
                 │                 └─거부(4xx)──▶ failed                                                   ▼
                 │                                                                              validating(사용량 먼저 저장)
  cancel ◀───────┴── 어느 실행 중 상태에서도 ──▶ cancelled (다음 alarm이 OpenAI 취소 1회)          │      │
                                                                                         검증 실패(1회)    통과
                                                                                         └▶ calling      ▼
  GET 404 ▶ failed(보관 만료) · GET 5xx ▶ 재시도 → 15분 ▶ failed(시간 상한)                    awaiting-decision
  예외 ▶ failed(내부 오류) | validating이면 재회수 | calling이면 unknown                      │ACK      │24h
  inflight 행 없음 + 실행 중 ▶ interrupted(이전 형식)                                   acknowledged  expired
  끝난 상태(awaiting-decision·acknowledged·failed·cancelled·unknown·interrupted·expired)로 쓰는 순간 inflight 삭제
```

## §A~E 결과 상태 대조

| 항목 | 결과 |
|---|---|
| A. inflight 표·같은 트랜잭션 쓰기 | **했다.** 생성 시 `atomic()`, 이후 `save()`가 사용량·원문·상태를 한 번에 확정한다. DO는 `ctx.storage.transactionSync`, 시험은 BEGIN/COMMIT. |
| A. 끝나는 모든 경로에서 삭제 | **했다.** finish·planningDone·cancel·ACK·expire가 모두 `save()`를 거친다. prune은 `deleteJob`에서 함께 지운다. 7개 경로와 만료·prune을 시험했다. |
| A. tick 복원·interrupted 조건 | **했다.** `recall()`이 메모리, 그다음 `inflight` 순으로 찾는다. 둘 다 없을 때만 `interrupted`. |
| A. GET·백업·내보내기 비노출, `toStoredJob` 불변 | **했다.** `inflight`는 `/__test/inflight`의 행 수 말고는 어떤 응답에도 나가지 않는다. 앱 백업·내보내기는 Worker 표를 읽지 않는다. |
| B1~B10 | **했다.** [시험 색인](#b1b10-시험-색인) 참고. B3/B5는 아래처럼 나눴다. |
| B3/B5 | **다르게 했다.** "다시 저장"은 저장 공간 같은 일반 실패에만 둔다. stale(`CONFLICT`)은 새 요청을 안내한다. 같은 revision으로 다시 저장하면 같은 거부가 나기 때문이다. |
| B4 ACK | **했다.** 기존 재회수 E2E와 충돌은 없었다. 재진입하면 `acknowledged`를 읽어 "저장 완료 · 변경안에 저장됨"을 보이고, 다시 Stage하지 않는다. |
| C. 작업별 try/catch·재예약 | **했다.** 단 `validating`(응답 수신·사용량 저장 완료)에서 난 예외는 failed로 끝내지 않고 같은 응답 ID로 재회수한다. T-D2의 결과 저장 실패 복구를 지키려는 것이다. `calling`(응답 ID 없음)은 `unknown`. |
| C. 사용량 중복 가산 0 | **했다.** `save()` 한 함수, 한 트랜잭션, await 없음. 동시 tick·재시작 재회수 시험이 있다. |
| C. `/__test/restart` | **했다.** reset과 같은 조건에서만 열리고, 운영 RP ID에서는 404다. |
| D. 16자 미만 503·5회 잠금·`locked` 노출 | **했다.** 잠금은 `settings.registration_locked`에 둔다. 해제는 비밀값 교체뿐이다(D안: 코드 지문이 달라지면 잠금 행을 자동으로 지운다). |
| E. 가짜 OpenAI 고장 주입 | **했다.** 제어 경로 `/__control/config`. 단위 하네스에도 같은 스위치(`createGate`·`getFailure`·`incomplete`)를 넣었다. |

## 저장 필드 (DO)

| 표 | 내용 | 삭제 시점 |
|---|---|---|
| `jobs` | `toStoredJob` 허용 목록 JSON, 지문, 응답 ID. `acknowledged`이면 `result` 없음 | 24시간 뒤 출력 삭제(`expired`). 200건 초과 시 오래된 것부터 |
| **`inflight`** | **요청 원문(`AiV2Request`)·조사 본문·수정 지시.** 실행 중에만 있다. T-D1 R3(a)의 예외로, 근거는 [결정](decisions.md) 2026-11-10 U-D2-1 | **작업이 끝나는 쓰기와 같은 트랜잭션에서 즉시.** 길어야 작업 시간 상한 15분 |
| `daily_counts` | 날짜(Asia/Seoul)별 요청 수·토큰 합 | 지우지 않음 |
| `credentials`·`challenges`·`revoked_tokens` | T-D2와 같음 | T-D2와 같음 |
| `settings` | `registration_closed`, **`registration_failures`·`registration_locked`(T-D3)** | 운영 절차로만 |

## B1~B10 시험 색인

E2E는 `tests/e2e/ai-d03-recovery.spec.ts`(데스크톱·모바일)이고, 단위는 `tests/worker-recovery.test.ts`다. "수정 전"은 소스(`worker/src`·`src`·`scripts`)만 stash하고 새 시험을 돌린 결과다. 단위 시험의 미구현 실패는 대부분 `no such table: inflight`였다.

| # | E2E | 단위 | 수정 전 |
|---|---|---|---|
| A 재시작 | `A·B4: Worker가 다시 떠도…` | `A: queued/researching/planning에서…` ×3, `C: validating에서 재시작…` | E2E `inflightCount` undefined. 단위 `no such table: inflight` |
| A 삭제 전수 | (E2E는 행 수만) | `A: …로 끝나면 같은 쓰기에서 inflight 행이 지워진다` ×7, `만료·prune`, `이전 형식만 interrupted` | 단위 실패(표 없음) |
| B1 202 유실 | `B1: 전송 응답(202)을 못 받으면…` | `B1: …같은 작업, 일일 횟수·외부 생성 추가 없음` | E2E 실패(안내 없음, 새 ID로 재전송). 단위는 통과(서버 멱등은 T-D2부터) |
| B2 브라우저 종료 | `B2: …재로그인 뒤 같은 작업으로` | — | E2E 실패(최근 작업 안내 없음) |
| B3 Stage 실패 | `B3·B4: 기기 저장이 실패하면…` | `B4: ACK 전(저장 실패)에는 출력이 남아…` | E2E 실패(알림·다시 저장 없음) |
| B4 ACK | `A·B4`, `B3·B4` | `B4: ACK는 출력만 지우고…` | 단위 `acknowledge` 없음 |
| B5 stale | `B5: …stale 안내, 서버 결과는…남는다` | — | E2E 실패(안내 문구 없음) |
| B6 취소 경합 | `B6: calling 중·폴링 중 중단…` | `B6: calling 중 중단…`, `B6: 폴링 중 중단…` | E2E 실패(이전 가짜 서버에 지연 스위치 없음). 단위 calling 실패, 폴링은 통과 |
| B7 unknown 뒤 재요청 | `B7: 결과 불명 뒤 다시 요청하면…` | `B7: …새 ID로 생성…` | E2E 실패(`dropAfterCreate` 없음). 단위 통과 |
| B8 회수 실패 | `B8: 404면 보관 만료…5xx…시간 상한` | `B8: 404면 failed`, `B8: 5xx는 상한까지…` | E2E 실패(`getFailure` 없음). 단위 통과 |
| B9 두 여행 | `B9: 여행 A의 작업은 여행 B 화면에…` | — | E2E 실패(ACK 없음 → A 저장 뒤 `acknowledged` 아님). 격리 자체는 통과 |
| B10 오프라인 | `B10: 오프라인에서는 폴링·전송을 멈추고…` | — | E2E 실패(오프라인 표시 없음) |
| C 예외 격리 | — | `C: 한 작업이 예외를 던져도…` | 단위 실패 |
| C 중복 가산 | — | `C: 같은 응답을 두 alarm이 동시에…` | 단위 통과(T-D2 상태 확인으로 이미 성립) → 이번에 고정 |
| D | — | `worker-auth`: `16자 미만 503`, `5회 누적 잠금`, `/__test/restart 게이트` | 3건 실패 |

canary는 유지했다.
- 전송 집합이 같은지 보는 시험은 T-D2 그대로다.
- `jobs` 행에 표식이 없음을 확인하고, 끝난 뒤 `inflight` 0행인지도 본다(`worker-jobs` 저장 필드 시험).
- 실행 중 `inflight` 행에도 `SYNTHETIC-PRIVATE`가 없음을 확인한다.

## 시험

- `pnpm run check`: exit 0, 460 통과 / 1 skip. 두 번 연속 통과했다.
  - 처음에는 부하가 걸리면 기존 Node 서버 시험(1초 대기)이 번갈아 실패했다.
  - 새 복구 시험이 시험마다 표본을 만들던 것을 한 번만 만들도록 바꾼 뒤 안정됐다.
  - 기준 main에서도 같은 조건이면 통과했다.
- E2E: `ai-d03-recovery` 데스크톱·모바일 20건 통과. 전체 E2E 로컬 203 통과 / 5 skip(16.7분, 기존 T-D1·T-D2 E2E 포함).
- 스크린샷 `docs/design/ui-d03/`: `relogin`(재로그인 복귀), `stage-failed`(저장 실패), `stale`, `offline`, `unknown` × desktop·mobile.
- 원격 CI `travel-app checks`: `78d5e34` 성공(push 한 워크플로 1종. 지시서의 "3종"은 확인하지 못함).

## 미검증

- 실제 workerd에서 DO가 축출된 뒤 다시 뜨는 경우. `/__test/restart`는 메모리만 비우는 근사다. 생성자 재실행과 alarm 재전달은 확인하지 않았다.
- 실제 OpenAI의 404·5xx·incomplete 응답 본문 형식. 가짜 서버로만 확인했다.
- 실제 기기의 저장 공간 부족. E2E는 IndexedDB `put`·`add`에서 `QuotaExceededError`를 던지는 방식으로 재현했다.
- iOS 패스키, 교차 출처(Pages→Worker), workerd CPU(CL-32).

## Codex가 먼저 볼 위험

1. `inflight`에 요청 원문·조사 본문이 실행 중(최대 15분) DO 디스크에 있다. 종료 경로마다 같은 트랜잭션에서 지우는 것은 시험으로 고정했다. 다만 이 경로를 거치지 않는 직접 `store.putJob` 호출이 두 곳 남아 있다: tick의 취소 정리, startCall의 중단 경합. 두 곳 모두 이미 끝난 상태의 행이라 `inflight`가 남지 않는다.
2. tick에서 `validating` 예외는 failed로 끝내지 않는다. 같은 예외가 반복되면 15분 상한까지 2초마다 GET을 다시 부른다. 생성 호출은 없다.
3. ACK가 유실되거나 Node 경로(`pnpm dev:node`, ACK 경로 없음)일 때는 출력이 24시간 남는다. T-D2와 같은 보존 규칙이다.
4. (해소) 등록 잠금은 비밀값 교체로 풀린다(D안). 남은 위험: 공격자가 하루 5회가 아니라 코드 교체 전까지 영구 잠금이므로, 본인도 교체 전에는 등록하지 못한다.
5. 화면은 `RepositoryError.code === 'CONFLICT'`이면 모두 stale로 본다. 같은 요청 ID 재저장은 `replayed`가 되므로 CONFLICT가 아니지만, 다른 원인의 CONFLICT도 같은 안내를 보인다.

## 사용자 결정 (2026-11-10 "A안대로")

- 등록 잠금 해제: D안(변경). 등록 코드의 SHA-256 지문을 DO 설정에 저장하고, 비밀값이 바뀌어 지문이 달라지면 잠금·실패 횟수를 자동으로 지운다. 별도 관리 경로 없음. 시험으로 고정(같은 값 재시작은 잠금 유지, 값 교체는 해제).
- `acknowledged` 보관: A안(현행 유지). 24시간 만료에서 빼고 200건 prune만 적용한다. 코드 변경 없음.
