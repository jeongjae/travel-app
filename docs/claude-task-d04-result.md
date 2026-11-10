# T-D4 결과 — C1 코드 준비 (배포·실제 호출 없음)

2026-11-10 · 브랜치 `codex/d04-limited-live` · 상태: **C1 자체 검사 완료 / Codex 코드 검토 대기 / 사용자 단계(U1~U3) 대기**. 배포·OpenAI 호출·계정 작업은 하지 않았다.

## 요약

1. `worker/wrangler.toml`에 `[env.production]` 추가: `workers_dev=true`, `RP_ID=jeongjae.github.io`, `ALLOWED_ORIGINS=https://jeongjae.github.io`, `OPENAI_MODEL=gpt-5.4-mini`, `DAILY_LIMIT=5`. `E2E_RESET` 없음. 비밀값은 toml에 없다. `wrangler deploy --env production --dry-run`으로 설정이 해석되는 것만 확인했다(업로드 없음).
2. 일일 한도를 `DAILY_LIMIT` 환경값으로 뺐다(기본 20, 1~20 정수만, 잘못된 값은 1 — 비용 쪽 안전). status의 `dailyJobLimit`·`remainingToday`와 429 문구가 모두 이 값을 쓴다. 화면(`AiPlanner`)은 원래 서버 값을 표시하므로 코드 기본값 표시는 없다(BM-4).
3. **교차 출처 결함 발견·수정**: 앱이 모든 요청에 `X-Travel-App`을 붙이는데 Worker의 `Access-Control-Allow-Headers`에 없어, 다른 origin(Pages)에서는 사전 요청이 막혀 AI 패널이 "연결하지 못했습니다"로 떨어졌다. 허용 헤더에 추가하고 단위 시험으로 고정했다. 같은 origin(Vite 프록시)인 기존 E2E는 이 결함을 잡지 못했다.
4. 교차 출처 E2E 신설(`pnpm run test:e2e:cross-origin`): `VITE_AI_API_BASE=http://127.0.0.1:8787`로 따로 빌드한 앱(`localhost:4173`)에서 패스키 등록→로그아웃→로그인. 모든 `/api`·`/auth` 요청이 Worker origin으로 가고, `/api/ai/v2/*`에 `Authorization: Bearer`가 붙고, 요청에 `Cookie` 헤더와 브라우저 쿠키가 없음을 확인. 수정 전에는 "AI 서버에 연결하지 못했습니다"로 실패, 수정 후 desktop·mobile 통과.
5. CL-34: 사용자 결정 1(D안)에 따라 해제는 `REGISTRATION_CODE` 교체뿐이므로 `POST /auth/registration/reset` 같은 관리 경로를 **추가하지 않았다**(지시서 5번의 "구현이 필요하면" 조건 불필요). 절차는 `docs/runbook-worker.md` §4. D안 커밋 2개(`a12a54c`, `7415256`)는 `main`에 없어 이 브랜치에 cherry-pick했다.

## 가격 (계획 §8 사전 확인)

- 출처: https://developers.openai.com/api/docs/pricing (`platform.openai.com/docs/pricing`에서 301), 확인 2026-11-10. WebFetch 요약본 기준이며 원문 화면 대조는 아니다.
- `gpt-5.4-mini` Standard(1M 토큰당): 입력 $0.75 · 캐시 입력 $0.075 · 출력 $4.50. 웹 검색 도구 호출 1,000회당 $10(페이지가 이 모델에 적용되는지 명시하지 않음; "other models" 구형 미리보기 요율은 $25). 검색 콘텐츠 토큰은 모델 토큰 단가로 과금되는 것으로 보인다(명시 없음).
- 추정식(요청 1건 = 조사 1 + 작성 ≤2 + 웹 검색 ≤2, 코드의 `max_output_tokens` 조사 3,000·작성 4,500, 추론 토큰 포함 상한). 가정: 보내는 패키지 약 25k 토큰, 검색 콘텐츠 2회 약 16k 토큰, 조사 지시문 2k, 작성 입력은 패키지+조사 결과 약 30k.

| 단계          | 입력            | 출력              | 검색                          | 금액                |
| ------------- | --------------- | ----------------- | ----------------------------- | ------------------- |
| 조사 1회      | 43k → $0.0323   | 3,000 → $0.0135   | 2회 $0.02($25 요율이면 $0.05) | $0.066 ($0.096)     |
| 작성 최대 2회 | 30k×2 → $0.0450 | 4,500×2 → $0.0405 | —                             | $0.0855             |
| **1건 상한**  |                 |                   |                               | **$0.151 ($0.181)** |

- 결론: 가정 안에서 1건 상한은 $0.20 미만이라 **멈추지 않는다**. 10건 상한 약 $1.5(최악 $1.8)로 $2 범위 안. 작성 1회로 끝나면 $0.11. 다만 여유가 작다: 패키지가 약 40k 토큰을 넘으면 $0.20에 닿는다(요청 본문 상한 512KB면 훨씬 넘을 수 있음). C4의 가상 여행 패키지 크기를 실제로 재서 다시 계산한다. 시험 픽스처 패키지는 2.4KB다.
- 실측(대시보드)은 C4에서 기록한다.

## 검사 (자체)

| 항목                                                                    | 결과                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker 단위(auth·jobs·recovery)                                         | 51 통과 (DAILY_LIMIT 시험, X-Travel-App 사전 요청 시험 추가)                                                                                                                                                                                                                                                         |
| 교차 출처 E2E                                                           | desktop·mobile 2 통과                                                                                                                                                                                                                                                                                                |
| 복구 E2E(`importTrip` 공용화 뒤, d03 spec)                              | 20 통과 (desktop·mobile)                                                                                                                                                                                                                                                                                             |
| format·lint·build                                                       | 통과                                                                                                                                                                                                                                                                                                                 |
| 데이터 경계 diff (`src/contracts`·`storage`·`transfer`·`repository.ts`) | 0                                                                                                                                                                                                                                                                                                                    |
| `pnpm run check` 전체                                                   | **실패, 이 변경과 무관**: Node 서버 시험(`ai-v2-job-retention`·`ai-v2`·`ai`·`source-preflight`·`transfer`)이 부하에서 흔들려 6~13건 실패. 같은 시험이 `main`(변경 전)에서도 8~10건 실패해 변경 전후가 같다. 파일 단독 실행은 통과(retention 14/14). T-D3 때 460/1로 통과했던 때와 달리 지금 PC에서 더 자주 실패한다. |

## Codex가 먼저 볼 위험

1. **교차 출처 결함은 실제 배포라면 AI 패널이 열리지 않았을 것**이다. 수정은 허용 헤더 한 줄이지만, Pages→workers.dev 실환경(HTTPS, 실제 origin)은 아직 확인하지 못했다.
2. `DAILY_LIMIT`은 잘못된 값을 1로 떨어뜨린다. 오타가 나면 조용히 하루 1회가 된다(비용 안전 쪽 선택). 대안은 시작 거부인데 Worker에는 시작 단계가 없다.
3. 가격 추정은 패키지 25k 토큰 가정에 의존한다. 웹 검색 단가·검색 콘텐츠 과금은 페이지가 이 모델에 적용되는지 명시하지 않았다.
4. 환경이 `vars`·바인딩·마이그레이션을 상속하지 않아 기본 환경과 `env.production`에 같은 항목이 두 번 있다. 하나만 고치면 어긋난다(runbook §1.6).
5. 첫 배포의 DO 마이그레이션 `v1`이 `env.production`에서도 실제로 적용되는지는 dry-run으로 확인하지 못했다(C2에서 확인).

## 미검증

실제 배포·workers.dev 응답·HTTPS 교차 출처·CPU 실측(CL-32)·OpenAI 실제 응답·실제 과금·iOS 패스키·`wrangler secret put` 후 즉시 반영 여부. 모두 C2 이후다.

## 다음

Codex 코드 검토 → 사용자 U1~U3(Cloudflare 로그인, OpenAI 프로젝트·예산·키, secret 3종) → G1 "비밀값 설정 완료" 알림 후 C2.

---

# C2~C3 — 배포·점검 (2026-11-10, G1 통과 뒤)

## 배포

- 계정 확인: `wrangler whoami` 로그인됨(OAuth). 비밀값 이름만 확인: `OPENAI_API_KEY`·`REGISTRATION_CODE`·`TOKEN_SECRET` 3종(값은 보지 않음).
- 명령: `wrangler deploy --env production`(브랜치 `codex/d04-limited-live` `0b4c4f4`, 작업 트리 깨끗). 바인딩: `AI_STORE`(DO), `RP_ID=jeongjae.github.io`, `ALLOWED_ORIGINS=https://jeongjae.github.io`, `OPENAI_MODEL=gpt-5.4-mini`, `DAILY_LIMIT=5`. `E2E_RESET` 없음.
- **배포 주소: `https://travel-app-ai.jeongjae-kim.workers.dev`** · 버전 `0c118824-2fd4-4fe8-9a15-87aa395aa4fd` · 업로드 1841.69 KiB(gzip 331.76).
- 경고: `preview_urls` 설정이 없어 **Preview URL이 기본으로 켜졌다**(wrangler 경고). 같은 Worker·비밀값을 가리키는 추가 공개 주소가 생긴다. Origin 허용 목록과 인증은 같지만 표면이 늘어난다. 끄려면 `[env.production]`에 `preview_urls = false`를 넣고 재배포(미수행, Codex 판단 요청).

## 점검 5항목

| #   | 요청                                           | 기대                              | 결과                                                                                                                                              |
| --- | ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /api/ai/v2/status` 무인증                 | 401                               | **401**                                                                                                                                           |
| 2   | 같은 요청 + `Origin: https://evil.example`     | 403                               | **403** `origin_forbidden`                                                                                                                        |
| 3   | `POST /__test/reset`                           | 404                               | JSON 본문 없이는 **415**, `Content-Type: application/json`을 붙이면 **404**. `/__test/restart`·`/__test/clock` POST, `/__test/inflight` GET도 404 |
| 4   | `GET /auth/state`                              | `{registered:false,locked:false}` | **200** `{"registered":false,"locked":false}`                                                                                                     |
| 5   | 잘못된 등록 코드 1회(`/auth/register/options`) | 403                               | **403** `bad_registration_code`. 직후 `/auth/state` 그대로(locked:false). 실패 횟수는 1/5                                                         |

- #3 해설: 이 Worker는 JSON이 아닌 모든 POST에 라우팅보다 먼저 415를 준다(`/nope`도 415). `/__test/*` 자체는 닫혀 있다(404). 지시서의 "404"는 JSON 요청으로 충족된다.
- 추가: Pages origin 사전 요청(`OPTIONS`, `Origin: https://jeongjae.github.io`, 요청 헤더 `authorization,x-travel-app`) → **204**, `Access-Control-Allow-Origin: https://jeongjae.github.io`, `Allow-Headers: Authorization, Content-Type, X-Travel-App`. C1에서 고친 결함이 실환경에서도 해소됐다.

## CPU 실측 (CL-32, `wrangler tail --format json`의 `cpuTime`·`wallTime`, ms)

| 요청                            | 응답                 | CPU 3회               | wall              |
| ------------------------------- | -------------------- | --------------------- | ----------------- |
| `GET /api/ai/v2/status`(무인증) | 401                  | 9(첫 요청·콜드), 0, 0 | 577, 1~2, 173~183 |
| `POST /auth/login/options`      | 409 `not_registered` | 1, 0, 0               | 2, 1, 174~188     |

- tail에 요청당 이벤트가 2건씩(예: 9/0/0/0/0/0) 찍혀 3회 요청이 6행으로 보였다. 두 행의 CPU를 모두 적었고 모든 행이 10ms 미만이다. 짝 이벤트의 정체(DO 호출 등)는 확인하지 못했다.
- **한계**: 패스키가 없어 `login/options`는 서명 검증 전 단계에서 409로 끝난다. 인증된 `status`(DO 조회)와 실제 로그인 검증(`login/verify`, 서명 계산)의 CPU는 측정하지 못했다. 등록·로그인·OpenAI 호출은 이번 범위 밖이라 하지 않았다. U4 등록 뒤 다시 측정해야 CL-32를 닫을 수 있다.
- 10ms 초과 요청 없음. 단 첫 요청 9ms는 한도에 가깝다(콜드 스타트).

## 남은 일

G2 판정(Codex) → Codex가 `VITE_AI_API_BASE=https://travel-app-ai.jeongjae-kim.workers.dev`를 저장소 변수로 설정하고 Pages 재배포 → 배포 앱에서 AI 패널 "패스키 등록" 상태 확인(Claude) → U4.
