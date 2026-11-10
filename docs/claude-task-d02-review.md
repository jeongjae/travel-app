# T-D2 검토 · Codex 역할 독립 검토 · 2026-11-09 19:30

대상 `codex/d02-worker-auth` head `e45e887`(코드 head `1b39a84`). 기준 main `6173a22`. 지시 [T-D2](claude-task-d02-worker-auth.md), 결과 [claude-task-d02-result.md](claude-task-d02-result.md).
검토자: Codex 역할(Claude 대화 세션, 구현 세션과 별개 컨텍스트). 결과 문서 요약 → 위험 diff(인증·라우터·상태 기계·저장소·클라이언트) 정독 → CI 직접 확인 순. 시험 재실행은 하지 않았다.

## 판정: **통과** — 병합. 후속 CL-30~33 기록, 사용자 결정 3건은 병합과 무관.

배포가 없는 로컬 전용 단계이므로 "배포 전 필수" 항목(CL-30·32)은 T-D4 관문으로 보낸다. 데이터·동의·전송 경계 규칙은 Node 경로와 동일함이 시험으로 단언된다.

## 1. 절차

| 절차 | 결과 |
|---|---|
| CI | `b0d5d02`·`e45e887` `travel-app checks` success(gh 직접 확인). 이 워크플로 1개가 check·check:pilot·test:e2e를 순차 실행하므로 지시서의 "3종"은 충족. Pages는 main push에만 돌아 브랜치에서 안 뜨는 것이 정상 |
| 데이터 경계 | `git diff origin/main e45e887 --stat -- src/contracts src/storage src/transfer src/repository.ts` = 0건 **직접 확인** |
| 커밋 분리 | 의존성(`ae757e6`) → CL-28(`860c3c5`) → Worker 본체(`b0d5d02`) → 앱·E2E(`1b39a84`) → 문서(`e45e887`) ✔ |
| §0 정리 | `codex/ui-resume` `afe5b68` 커밋·push ✔. origin/main이 지시서의 `34b9dfc`가 아닌 `6173a22`(지시서 자체 커밋 2개)였던 것을 확인 뒤 진행 — **판단 타당**(멈춤 조건 아님) |
| 변경 규모 | 43파일 +3,476/−336(문서·lock 제외). 신규 `worker/` 7파일, `src/ai-v2-jobs-core.ts`·`ai-v2-openai.ts` 공통화, Node 서버는 공통 모듈을 쓰도록 축소 |

## 2. 결과 상태 대조 (§A~F)

| 항목 | 판정 | 확인 |
|---|---|---|
| A 프록시 | ✔ | `worker/src/app.ts` 라우터: Origin 허용 목록 밖 403을 인증 전에, OPTIONS 204, Content-Type 415, 본문 512 KiB 스트리밍 상한(Content-Length 없어도 셈), v1 경로 없음. `wrangler.toml`은 `workers_dev = false`·로컬 vars만. `.dev.vars.example`만 커밋. Vite 프록시에 `/auth` 추가 |
| A2 공통화 | ✔ | 계약·의미 검증 파일 수정 없음(`ai-v2-contract.ts`는 상수·상태·타입 **추가**만). `aiV2JobLimits`를 `aiV2Limits`와 분리한 이유(동의 지문 불변)는 타당 — 지시서 C6와 다르게 한 것을 수용 |
| B 인증 | ✔ | `auth.ts`: 등록은 자격 0개 + `registration_closed` 미설정 + 코드 일치(상수 시간 비교)일 때만, 확인 뒤 재검사. 로그인은 `expectedOrigin`·`expectedRPID` 고정 비교, UV 필수, counter 갱신. 토큰 HMAC-SHA256, `TOKEN_SECRET` 32자 미만이면 503, 만료 코드 `token_expired` 분리, jti 해지 목록. 챌린지 1회 소비·5분 수명. `/api/ai/v2/*` 전부 `verify` 선행(status 포함) |
| C 저장소·상태 기계 | ✔ | `jobs.ts`: `calling` 선기록 → 쓰기 실패 시 미호출. 재진입 `calling`+responseId 없음 → `unknown`, 재호출 0. 네트워크 오류 → `unknown`, HTTP 오류 → `failed`. 응답 수신 → 사용량·상태를 한 문장으로 저장(`putJob` UPSERT) → 검증·전이. 취소 경합 처리(호출 중 취소면 responseId만 붙여 다음 alarm이 OpenAI 취소). 24h 후 `expired`(SQL에서 거름), 200건 prune(만료→끝난 순). 작업 15분 상한 |
| C1 저장 필드 | ✔ | `jobs.data` = `toStoredJob` 결과 JSON + 열 `fingerprint`·`response_id`. canary 시험이 Worker 경로의 조사·작성 본문이 Node 경로와 **동일 집합**이고 DO 행에 표식이 없음을 단언 |
| D 상한·잔여 | ✔ | 일일 20회(Asia/Seoul 날짜, `Intl.DateTimeFormat`), 429 `daily_limit`, status에 `remainingToday`·`usageToday`. 화면 "오늘 남은 요청 N/20", 작업별 토큰. 금액 없음 |
| E 폴링·화면 | ✔ | `ai-client.ts` 1·2·4·8·16초 백오프 → "연결 끊김", 401 `token_expired` → 재로그인. 토큰 메모리+sessionStorage(실패 시 메모리만). 라벨 `expired`/`unknown` 추가 |
| F CL-28 | ✔ | 자정 넘는 낮 구간 → 출발 시각 승격. 수정 전 실패(`expected null to be '22:30'`) 기록 |
| 시험 러너 | 수용 | `@cloudflare/vitest-pool-workers`가 vitest 4 전용이라 미사용. 로직은 `node:sqlite` 하네스, workerd 동작은 `wrangler dev` E2E(등록→전송→19/20→거절→만료 재로그인→unknown→expired, `background:true`·`store:false` 전수, 표식 부재) — **타당한 분리** |

## 3. Claude가 지목한 위험 5건과 이 검토의 판단

| # | 내용 | 판단 | 처리 |
|---|---|---|---|
| 1 | 실행 중 요청 원문이 DO 메모리에만 있어 DO 퇴거 시 `interrupted`. 조사 호출 뒤 끊기면 그 비용 낭비 | 설계상 R3(a)를 지킨 결과. 노출 창을 "실행 중(분 단위)·완료 시 삭제"로 한정한 임시 저장은 R3(a)의 취지(무기한 보관 금지)와 충돌하지 않는다고 본다 | **사용자 결정 U-D2-1** → 허용 시 T-D3(복구 훈련)에서 구현. **CL-31** |
| 2 | `/__test/reset`·`/__test/clock`은 `E2E_RESET=1` **그리고** `RP_ID=localhost`일 때만 | `context.ts`에서 확인. 운영 RP ID에서는 닫힘 | 수용. T-D4 배포 설정 점검 항목에 "E2E_RESET 미설정" 추가 |
| 3 | Origin 헤더 없는 요청 허용(Bearer 필수) | 같은 출처 GET·비브라우저 클라이언트에 Origin이 없으므로 필요. 쿠키가 없어 CSRF 벡터 없음 | 수용·기록 **CL-33** |
| 4 | 등록 코드 시도 횟수 제한 없음 | 로컬 전용 단계에서는 무해. 공개 Worker에서는 무차별 대입 가능 | **CL-30**: 배포 전 필수 — 코드 최소 길이 검증 + 실패 N회 후 등록 잠금(해제는 비밀값 교체) |
| 5 | 요청 처리 CPU Node 근사 6ms, Free 한도 10ms | workerd 실측 아님. 인증 검증(HMAC + WebAuthn은 로그인 때만) 포함인지 결과 문서 확인 필요 | **CL-32**: T-D4 전 `wrangler dev` 실측. 초과 시 Paid($5) 결정은 11/06 결정대로 |

## 4. 이 검토에서 추가로 본 것

| # | 내용 | 심각도 | 처리 |
|---|---|---|---|
| N1 | `tick()`에서 한 작업의 `advance`가 예외를 던지면 뒤 작업과 재예약이 건너뛰어진다. DO alarm은 예외 시 재시도하므로 체인은 살아남지만, 한 작업의 반복 예외가 다른 작업을 굶길 수 있다 | 낮음 | T-D3 복구 훈련 시나리오에 포함(작업별 try/catch + 재예약 보장) |
| N2 | 일일 횟수는 `create()`에서 바로 1 증가 — 호출 전에 실패(`interrupted`·검증 거부)해도 소모된다 | 정보 | 보수적 동작. 기록만 |
| N3 | Pages 빌드에는 `VITE_AI_API_BASE`가 없어 배포 앱은 이전과 같이 AI 비활성("기준 주소 없음") | 정보 | 의도대로. T-D4에서 설정 |
| N4 | Node 서버(`server/`)는 공통 모듈을 쓰도록 바뀌었고 v1은 기본 비활성. 기존 Node E2E가 Worker 경로로 전환돼 Node 경로 E2E는 줄었다(단위 시험은 유지) | 정보 | T-D3에서 Node 서버 정리 시 함께 판단 |

## 5. 사용자 결정 (병합 뒤, T-D3 전)

| ID | 질문 | 기본값(미응답 시) |
|---|---|---|
| U-D2-1 | 실행 중 요청 원문·조사 본문을 DO 저장소에 **임시 저장**(완료·실패·만료 시 즉시 삭제)해 Worker 재시작에도 작업을 이어가게 할지 | 허용 권고. T-D3에서 구현 |
| U-D2-2 | 토큰 수명 1시간 · 일일 20회 유지 여부 | 유지 |
| U-D2-3 | 1회 등록 코드 전달 방식 — 로컬은 `.dev.vars`에 본인이 기입. 배포 시 `wrangler secret put REGISTRATION_CODE`를 본인이 실행 | T-D4 결정 |

## 6. 미검증 (이월)
실제 Cloudflare 환경(workerd CPU·DO 지속성·alarm) · iOS 패스키와 교차 출처(Pages→Worker) · 실제 OpenAI background 조합 · 이 세션의 시험 재실행.

## 7. 병합
main fast-forward → Pages·checks 확인 → `decisions.md`(T-D2 가정 4개를 "가정, 사용자 확인 대기"로 기록) · `change-log.md`(CL-30~33) · `handoff.md` 갱신. 사용자 확인 상태: **확인 완료(2026-11-10 10:11)**. 결정 U-D2-1 허용·U-D2-2 유지·U-D2-3 T-D4 → [decisions](decisions.md) 11/10. T-D2 종결.
