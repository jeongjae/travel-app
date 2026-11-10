# Worker 운영 절차 (travel-app-ai)

T-D4 C1 작성. 아래 명령은 사용자 PC의 `worker/` 폴더에서 실행한다. 비밀값은 터미널 입력으로만 넣고 채팅·문서·커밋에 붙이지 않는다.

## 1. 배포

1. 로그인: `pnpm exec wrangler login` (사용자, 1회).
2. 비밀값 3종(사용자): `pnpm exec wrangler secret put OPENAI_API_KEY --env production`, 같은 방식으로 `TOKEN_SECRET`(32자 이상 무작위), `REGISTRATION_CODE`(16자 이상 무작위).
3. 점검만: `pnpm exec wrangler deploy --env production --dry-run --outdir <임시폴더>` (업로드하지 않는다).
4. 배포: `pnpm exec wrangler deploy --env production`. 기본 환경(`--env` 없음)은 로컬 `wrangler dev` 전용이라 배포하지 않는다.
5. 운영 값(`worker/wrangler.toml`의 `[env.production.vars]`): `RP_ID=jeongjae.github.io`, `ALLOWED_ORIGINS=https://jeongjae.github.io`, `OPENAI_MODEL=gpt-5.4-mini`, `DAILY_LIMIT=5`(T-D4 기간). `E2E_RESET`은 쓰지 않으며 운영 RP ID에서는 값을 줘도 `/__test/*`가 404다.
6. 환경은 `[vars]`·DO 바인딩·마이그레이션을 상속하지 않는다. 항목을 바꿀 때 기본 환경과 `env.production` 양쪽을 맞춘다.

## 2. 일일 한도

`DAILY_LIMIT`(1~20 정수, 비우면 20, 잘못된 값이면 1). T-D5 전에 `worker/wrangler.toml`의 값을 20으로 되돌리거나 항목을 지우고 다시 배포한다. 화면의 "오늘 남은 요청 N/M"은 서버 status 값이다.

## 3. 비밀값 교체

`pnpm exec wrangler secret put <이름> --env production`. 다시 배포하지 않아도 새 값이 적용된다. `TOKEN_SECRET`을 바꾸면 발급된 토큰이 모두 무효가 되어 다시 로그인해야 한다. `OPENAI_API_KEY`는 OpenAI 프로젝트에서 새 키를 만든 뒤 교체하고 옛 키를 폐기한다.

## 4. 등록 잠금 해제 (CL-34)

틀린 등록 코드가 누적 5회면 등록이 잠기고(423 `registration_locked`) 맞는 코드도 거절한다. 해제는 **등록 코드를 바꾸는 것뿐**이다.

1. 새 코드를 만든다(16자 이상 무작위, 이전 값과 달라야 함).
2. `pnpm exec wrangler secret put REGISTRATION_CODE --env production`.
3. 다음 `/auth/state` 또는 등록 요청에서 Worker가 코드 지문(SHA-256)이 달라진 것을 보고 잠금·실패 횟수를 지운다. 별도 관리 경로·DO 조작은 없다.
   같은 값을 다시 넣으면 풀리지 않는다. 이미 패스키가 등록된 뒤에는 등록 경로 자체가 닫혀 있어 영향이 없다.

## 5. 로그와 CPU

`pnpm exec wrangler tail --env production --format pretty`. 요청 경로·상태 코드·예외만 보며, 요청 본문·키·토큰은 출력되지 않는다. 대시보드 Workers → travel-app-ai → Metrics에서 CPU 시간(요청별 p50/p99)을 본다. Free 요금제의 10ms CPU 한도에 가까우면 기록한다(CL-32).

## 6. 배포 점검 5항목 (G2 전)

Worker 주소를 `$W`라 하면: `GET $W/api/ai/v2/status` 무인증 → 401 · 같은 요청에 `Origin: https://evil.example` → 403 · `POST $W/__test/reset` → 404 · `GET $W/auth/state` → `{"registered":false,"locked":false}` · 잘못된 등록 코드 1회 → 403(5회 시도하지 말 것).

## 7. 사고 대응

비밀값이 노출됐다고 의심되면 해당 비밀값을 즉시 교체하고(OpenAI 키는 폐기), 사용량 대시보드를 확인한 뒤 보고한다.
