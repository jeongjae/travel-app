# Claude Sonnet T-D2 · Worker 프록시·본인 인증·상한·작업 저장소

2026-11-09 · 기준: main `34b9dfc`(T-D1 종결) · **작성 완료 / 전달 가능 / 착수 전**

> [계획 §8](phase-d-plan.md) T-D2를 수행한다: AI 호출 경로를 **Cloudflare Worker(로컬 `wrangler dev`만, 배포 없음)**로 옮기고, **패스키 + 짧은 수명 Bearer 토큰** 본인 인증, **요청당 상한·일일 횟수·사용량/잔여 표시(BM-4)**, **SQLite Durable Object 작업 저장소 + OpenAI background 폴링**을 넣는다. 근거: [T-D0 결과](claude-task-d00-result.md) §B·§C·"T-D2에 추가", [T-D0 검토](claude-task-d00-review.md), [설계 §5·§7·§12](phase-d-design.md), [결정 11/06·11/09](decisions.md), [T-D1 검토](claude-task-d01-review.md) CL-24·27·28.
> `main`에서 `codex/d02-worker-auth`를 만들어 시작한다. Sonnet이 조사→구현→시험→스크린샷→커밋/push까지 자율 수행하고, 결과 문서 `docs/claude-task-d02-result.md` 첫머리에 20줄/2,000자 이내 요약을 둔다. **세부 단계마다 확인을 요구하지 않는다.** 단 §6의 멈춤 조건에 걸리면 멈추고 보고한다.

## 0. 착수 전 작업 트리 정리 (같은 세션, 먼저)

T-D1 종결 통합 지시의 4단계를 여기로 합친다. T-D2는 깨끗한 체크아웃이 필요하므로 UI 작업은 **보관 커밋**으로 치운다(이전 "커밋하지 않는다" 지시를 이 문서가 대체한다).

**11/09 13:20 PC 상태(Codex 확인)**: 체크아웃 `codex/ui-resume`(= `34b9dfc`), stash 비움, UI 4건 스테이징 완료, 공백 파일 2건 되돌려짐. 따라서 1~2는 끝났고 **3의 커밋·push부터** 한다. `docs/t-d01-closeout-plan.md`·`docs/status-review-2026-10-26.md`는 추가하지 않는다.

1. `git fetch`; `main` = `origin/main` = `34b9dfc` 확인. 다르면 멈추고 보고.
2. `docs/u4-sapporo-scenario.md`·`docs/claude-task-d00-result.md` 미커밋 변경은 공백·파일모드만이다(Codex 확인). `git checkout -- 두 파일`을 시도하고, 권한 거부되면 그대로 두고 보고한다(아래 작업에 영향 없음).
3. `main`에서 `codex/ui-resume` 생성 → `git stash pop`(handoff.md 1줄이 충돌하면 stash 쪽을 버리고 그 1줄을 결과 문서에 적는다) → 미추적 UI 4건(`docs/claude-task-ui01-day-retro.md`, `docs/design/commercial-ui-design.md`, `docs/design/commercial-ui-development-plan.md`, `docs/design/ui-review-2026-11-06/`) `git add` → 커밋 `wip(ui): UI design drafts restored from stash (not reviewed)` → push. `docs/status-review-2026-10-26.md`·Obsidian 흔적은 추가하지 않는다. 이 커밋은 검토 대상이 아니며 UI 후속 지시(CL-23·25·26)에서 다룬다.
4. `main`으로 돌아가 `codex/d02-worker-auth` 생성. 작업 트리가 깨끗한지 확인.

## 1. 확정된 결정과 가정

| 항목 | 값 | 출처 |
|---|---|---|
| 인증 | 패스키(WebAuthn) + 짧은 수명 Bearer 토큰, 쿠키 없음 | 결정 11/06 |
| background 모드 | OpenAI Responses `background: true`, 약 10분 임시 보관 수용 | 결정 11/06 |
| 요금제 | Workers Free 전제(요청당 CPU 10ms) | 결정 11/06 |
| 저장소 | SQLite Durable Object(KV·D1 비권고) | T-D0 §B-2 |
| 출력 보존 | 완료 후 24시간, 만료는 "만료" 표시 | T-D1 R5·R6 |
| 금액 원장 | **만들지 않는다.** 횟수 한도·요청당 상한만 | T-D0 §D |
| 다중 사용자 | 없음. 본인 1명 | 결정 11/06 |

**Codex 가정(사용자가 바꾸면 그 값으로)**: 토큰 수명 **1시간**(만료 시 패스키 한 번으로 재발급). 패스키 **1회 등록 코드**는 Worker 비밀값 `REGISTRATION_CODE`로 두고 첫 등록 뒤 무효. RP ID는 운영 `jeongjae.github.io`, 로컬 `localhost`(환경별 설정, 코드 분기 아님). 일일 횟수 한도 **20회**(기존 값 유지), 요청 본문 상한 **512 KiB**(T-D0 실측 112 KB의 4배).

## 2. 고칠 것

### A. Worker 프록시 (G13·G19, CL-27)
1. `worker/` 디렉터리에 Worker 코드와 `wrangler.toml`(DO 바인딩, 로컬 전용 설정). 비밀값은 `.dev.vars`(gitignore)이며 `.dev.vars.example`만 커밋한다. **`wrangler deploy`·Cloudflare 로그인·계정 작업은 하지 않는다.**
2. 기존 `src/ai-v2-*.ts`(계약·컨텍스트·의미 검증)는 **수정 없이** Worker에서 import한다(T-D0 확인: zod·canonicalJson·materialize 동작). 서버 전용 로직(`server/ai-v2-jobs.ts`의 허용 목록·동의 지문 검증·중복 ID·실행 중 1건·일일 한도·만료 규칙)은 Worker로 옮기되 **규칙은 동일**하게 유지한다. 공통화할 수 있는 부분은 `src/`로 올리고 Node 서버가 같은 함수를 쓰게 한다.
3. **v1 경로(`/api/ai/jobs`, `server/ai.ts`)는 Worker에 이식하지 않는다**(G13). Node 서버의 v1은 기본 비활성(`OPENAI_V1_ENABLED=1`일 때만).
4. 앱의 API 기준 주소를 설정으로 분리한다(G19): `VITE_AI_API_BASE`가 있으면 그 origin으로, 없으면 지금처럼 상대 경로. `staticHosting` 분기는 "기준 주소 없음"으로 바뀐다. Pages 빌드에 기준 주소를 넣는 것은 T-D4 배포 승인 뒤이므로 **이번에는 로컬 값만** 쓴다.
5. 개발 기본 경로: `pnpm dev`가 Vite 5173 + `wrangler dev` 8787(가짜 OpenAI는 `OPENAI_BASE`로 주입)을 띄운다. Node 서버(`server/`)는 **삭제하지 않고** `pnpm dev:node`로 남긴다(T-D3에서 정리). `jobs.json`은 Node 경로에서만 쓰이므로 CL-27(rename EPERM)은 Worker 경로에서 해당 없음으로 기록한다.

### B. 본인 인증 (G12, CL-24)
1. 패스키 등록: `POST /auth/register/options` → `POST /auth/register`. 등록 코드가 맞고 **자격 행이 0개**일 때만 성공. 성공하면 등록 코드는 무효.
2. 로그인: `POST /auth/login/options` → `POST /auth/login` → `{ token, expiresAt }`. 검증은 `@simplewebauthn/server`로 `origin`·`rpId`를 **고정 비교**. 토큰은 Worker 비밀값으로 서명한 짧은 수명 토큰(1시간). 해지: `POST /auth/revoke`(현재 토큰), 서명 키 교체로 전체 해지.
3. **`/api/ai/v2/*` 전부**(status 포함)가 `Authorization: Bearer` 필수. 무인증 401, 만료 401(코드 구분), Origin 허용 목록 밖 403. CORS는 허용 origin만, 자격증명 헤더 없음. CSRF는 쿠키가 없으므로 Origin 검사로 충분함을 결과 문서에 근거와 함께 적는다.
4. 앱 화면: AI 탭에 "패스키 등록(1회 코드 입력)" / "로그인" / "토큰 만료 — 다시 로그인" 상태. 토큰은 메모리 + `sessionStorage`(탭 닫으면 소멸). 로그인 전에는 전송 미리보기만 가능하고 전송 단추는 비활성.

### C. 작업 저장소·background 폴링 (G9·G14·G16·G17)
1. DO SQLite 표: `jobs`(= `toStoredJob` 허용 목록 필드 + `fingerprint` + `responseId`), `credentials`, `daily_counts`. 저장 필드는 T-D1 허용 목록과 **같다**(요청 원문·고른 기록·활동 제목 없음). 동의 지문·중복 ID 재사용·실행 중 1건 규칙 유지.
2. 상태 기계: `queued → calling → researching → planning → validating → awaiting-decision | failed | cancelled | unknown | expired`. **외부 호출 전에 `calling`을 먼저 쓴다.** alarm 재진입 시 `calling`인데 `responseId`가 없으면 `unknown`으로 두고 **자동 재호출하지 않는다**(유료). `unknown`은 화면에 "결과 불명 — 다시 요청"으로 보인다.
3. OpenAI 호출은 `background: true`로 만들고 alarm으로 폴링한다(`GET /v1/responses/{id}`). 조사→작성(최대 2회) 단계마다 같은 패턴. HTTP 요청 핸들러는 외부 호출을 기다리지 않는다(Free CPU·연결 끊김 대비).
4. 저장 실패 시 결과를 버리지 않는다(G9): 응답 수신 → DO 쓰기 → 그 다음 상태 전이. 쓰기 실패면 `responseId`로 재회수 가능하게 남긴다.
5. 보관: 완료 후 24시간 지나면 출력 삭제·`expired`(T-D1 R5 규칙을 상태로 승격 — 이번에는 새 enum 값을 **허용**한다. T-D1의 "failed + 문구" 우회는 Worker 경로에서 제거). 보관 200건 초과 시 가장 오래된 만료 작업부터 삭제(G14). 삭제는 alarm 또는 다음 쓰기 때.
6. 사용량: 응답의 `usage`를 작업에 누적(T-D1과 같음)하고 응답에 포함. 폴링 간격·작업 시간 상한은 `aiV2Limits`에 상수로.

### D. 상한·잔여 표시 (G11, BM-4)
1. 요청 본문 512 KiB 초과 413. 선택 7일·활동 300·장소 300·기록 200 한도는 계약 그대로.
2. 일일 횟수 20회(DO `daily_counts`, UTC 아닌 **Asia/Seoul 날짜** 기준 — 사용자 시간대, 상수 한 곳). 초과 429(코드 `daily_limit`). 실행 중 작업 1건/여행 유지.
3. `GET /api/ai/v2/status`(인증 필요)가 `policy` + `remainingToday` + 오늘 사용 토큰 합계를 돌려준다. 앱 요청 화면에 "오늘 남은 요청 N/20"과 작업별 토큰 사용량(T-D1에서 미뤘던 표시)을 보인다. 금액은 표시하지 않는다(원장 없음).
4. 429 안내는 T-D1의 예산/속도 구분을 유지하고 `daily_limit`을 추가한다.

### E. 폴링·화면 (G16)
- 앱 폴링은 네트워크 오류·5xx에 지수 백오프(최대 30초, 5회) 후 "연결 끊김 — 다시 시도" 단추. 401이면 재로그인 안내로 전환.
- 만료(`expired`)·불명(`unknown`) 라벨을 `ai-job-label.ts`에 추가(기존 "만료" 판별 함수는 Worker 경로에서 상태로 대체, Node 경로 호환 유지).

### F. T-D1 후속 소형 항목 (CL-28)
- `deriveDayTimes`가 자정을 넘는 낮 구간(`from > to`)을 조용히 버리는 대신, 그 구간을 **"출발 시각 = from"**으로 승격해 그날의 뒤쪽을 막는다(자정 넘는 이동은 그날의 끝). 시험 1건.
- Worker 경로에서는 조회 시 만료 정리가 DO 쓰기와 함께 일어나므로 "메모리만 정리" 문제는 해당 없음을 기록.

## 3. 범위 밖 (이번에 하지 않음)
- Cloudflare 배포·계정·도메인·키 설정(T-D4). 실제 OpenAI 호출 0건(T-D4). 금액 원장(없음). 다중 사용자. iPhone 실기기(T-D5). UI 후속 CL-23 되돌리기·CL-25 사유 JSON 표시·CL-26 officialUrl 입력(UI 지시서). Node 서버 삭제(T-D3). 응답 유실·중복·두 여행 격리의 통합 시험(T-D3 — 단 §C의 상태 기계 단위 시험은 이번).

## 4. 시험·검사
- **의존성 추가는 별도 첫 커밋**: `wrangler`, `@simplewebauthn/server`, `@simplewebauthn/browser`(+ Worker 시험 러너는 Claude 선택: `@cloudflare/vitest-pool-workers` 또는 `wrangler unstable_dev`. 선택 이유를 결과 문서에).
- 단위: 허용 목록·동의 지문·중복 ID(Worker 경로에서 재통과), 패스키 등록(0개일 때만·코드 1회성)·로그인 검증(origin/rpId 불일치 거부)·토큰 만료·해지, 상태 기계(`calling` 재진입 → `unknown`, 자동 재호출 0), 저장 실패 시 결과 보존, 24시간 만료·200건 정리, 일일 한도(Asia/Seoul 날짜 경계), 본문 상한, Origin 403, 무인증 401(status 포함), 폴링 백오프, CL-28 자정 구간.
- E2E(가상, 가짜 OpenAI): Playwright `webServer`에 `wrangler dev` + 가짜 OpenAI(`OPENAI_BASE`). WebAuthn은 Playwright CDP 가상 인증기. 흐름: 등록 → 로그인 → 미리보기·동의 → 전송 → background 폴링 → 변경안 → 적용/거절 → 토큰 만료 후 재로그인 → 잔여 횟수 감소 표시. T-D1 E2E 10개가 Worker 경로에서도 통과(provider 가짜 응답 동일).
- 데이터 경계: `git diff main HEAD --stat -- src/contracts src/storage src/transfer src/repository.ts` = 0건.
- `pnpm run check` exit 0, 원격 CI 3종 성공. CI에 `wrangler dev` 기반 E2E가 들어가면 러너 `ubuntu-24.04` 고정 유지.
- 스크린샷 `docs/design/ui-d02/`: 등록·로그인·잔여 횟수·사용량·만료/불명 상태(모바일·데스크톱).
- 전송 경계 canary 시험(`ai-v2-send-surface`)을 Worker 경로의 가짜 OpenAI 수신 본문에도 적용한다(허용 집합 동일성).

## 5. 결과 문서 `docs/claude-task-d02-result.md`
요약(20줄) → 구조도(Pages origin·Worker·DO·OpenAI) → §A~F 결과 상태별 "했다/안 했다/다르게 했다" → 저장 필드 표(Worker DO) → 인증 위협 모델 한 쪽(쿠키 없음·Origin 고정·토큰 수명·해지·등록 코드) → 시험 색인 → 미검증(실제 Cloudflare 환경·실제 패스키 iOS·실제 OpenAI) → Codex가 먼저 볼 위험 → 사용자 결정 필요(토큰 수명·등록 코드 전달 방식·일일 한도 값이 가정과 다르면).

## 6. 멈추고 보고하는 조건
- `src/ai-v2-*.ts`를 Worker에서 그대로 쓸 수 없어 **계약 또는 의미 검증 규칙을 바꿔야** 할 때.
- 데이터 경계 4경로를 건드려야 할 때.
- Free CPU 10ms 안에 인증 검증 + 요청 파싱이 들어가지 않는 실측이 나올 때(`wrangler dev` 측정값 첨부).
- `@simplewebauthn/server`가 workerd에서 동작하지 않을 때(대안 제시만, 구현은 결정 뒤).
- 실제 외부 호출·배포·계정 작업이 필요해 보일 때 — **하지 않고 보고**.

## 7. 완료 보고 형식
상태(자체 검사 / Codex 검토 / 사용자 확인) → §0 정리 결과(ui-resume 커밋 해시, stash 비움, 두 파일 되돌리기 여부) → 커밋 목록(의존성 커밋 분리) → §A~F별 결과 상태 대조 → 저장 필드 표 → 시험 색인·수정 전 실패 기록 → 데이터 경계 diff → CI → Codex가 먼저 볼 위험 → 미검증 → 다음 단계. 시험 통과를 "확인 완료"로 쓰지 않는다.
