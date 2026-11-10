# T-D4 · 제한된 실제 호출 — Worker 배포·키 설정·가상 여행 소액 호출

2026-11-10 · 기준: main `b09ec43`(T-D3 종결) · **작성 완료 / 전달 가능 / 착수 전** · 승인: [결정 11/10 T-D4](decisions.md)

> [계획 §8](phase-d-plan.md) T-D4: Worker를 **처음으로 공개 주소에 배포**하고 OpenAI 키를 설정해, **가상 여행**으로 승인 범위(최대 10회·추정 $2·일일 5회) 안에서만 실제 호출 → 초안 → 거절/적용까지 확인한다. 실제 여행 데이터는 쓰지 않는다. 이 문서는 **사용자 단계(U)**와 **Claude 단계(C)**를 나눠 적고, 각 관문(G)을 넘기 전에는 다음 단계를 시작하지 않는다.
> Claude는 `main`에서 `codex/d04-limited-live`를 만들어 코드·문서 작업을 하고, 배포·호출은 **관문이 열린 뒤에만** 한다. 결과 문서 `docs/claude-task-d04-result.md`. 비밀값(키·토큰 시크릿·등록 코드)은 채팅·문서·커밋·로그에 절대 나오지 않는다.

## 0. 승인값 (2026-11-10 13:27, 사용자)

| ID | 값 |
|---|---|
| U-D2-a 모델 | 조사·작성 `gpt-5.4-mini` |
| U-D2-b 월 예산 | OpenAI 프로젝트 예산 하드 리밋 **$10/월** |
| U-D2-c T-D4 호출 | 가상 여행 **최대 10회**, 추정 **$2 이내**(실측 기록) |
| U-D2-d 일일 한도 | T-D4 기간 **5회**(상수), T-D5 전 20회 복원 |
| U-D3-a 전송·보관 | T-D1~3 확정값 그대로 |
| U-D3-b 제공자 조건 | `store:false` 유지, OpenAI 기본 보관(남용 모니터링) 수용 |
| 배포-a | `*.workers.dev` 서브도메인, `workers_dev = true` |
| 배포-b | 허용 origin·RP ID `https://jeongjae.github.io` / `jeongjae.github.io` |
| 배포-c | 계정·`wrangler login`·`wrangler secret put` 3종은 **사용자**. `wrangler deploy`는 로그인된 PC에서 Claude |
| 배포-d | 등록 코드 16자 이상, 사용자 생성·설정. CL-34 해제 절차 포함 |

## 1. 단계와 관문

```
C1 코드 준비(배포 설정·일일 5회·가격 확인) ──push──▶ Codex 검토(코드만)
U1 Cloudflare 계정·wrangler login ─┐
U2 OpenAI 프로젝트·예산 $10·키 발급 ─┼──▶ U3 secret put 3종 ──▶ G1 "비밀값 설정 완료" (사용자 한 줄)
C2 wrangler deploy ──▶ C3 배포 점검(무인증 401·Origin 403·/__test 404) ──▶ G2 "배포 점검 통과" (Codex)
Codex: Pages 변수 VITE_AI_API_BASE 설정 → Pages 재배포 → 배포 앱에서 AI 패널 보임
U4 배포 앱에서 패스키 1회 등록 ──▶ G3 "등록 완료" (사용자)
C4 가상 여행 실제 호출 ≤10회(사용자가 동의 단추를 직접 누름) ──▶ 초안 → 거절/적용 ──▶ 사용량 기록
C5 결과 문서·T-D5 전 복원 항목 ──▶ Codex 검토 ──▶ 사용자 확인
```

## 2. Claude 단계

### C1. 코드 준비 (관문 전, 호출 없음)
1. `worker/wrangler.toml`: 운영 환경(`[env.production]`)을 추가 — `workers_dev = true`, `RP_ID = "jeongjae.github.io"`, `ALLOWED_ORIGINS = "https://jeongjae.github.io"`, `OPENAI_MODEL = "gpt-5.4-mini"`, `E2E_RESET` **미설정**. 로컬 기본 환경은 그대로. 비밀값은 toml에 쓰지 않는다.
2. 일일 한도 상수를 환경값으로 뺀다(`DAILY_LIMIT`, 기본 20). 운영 환경 5. 화면 "오늘 남은 요청 N/5"가 서버 값(status)에서 오는지 확인(코드 기본값 표시 금지, BM-4).
3. **가격 사전 확인**(계획 §8): OpenAI 공식 가격 페이지에서 `gpt-5.4-mini` 입력/출력/웹 검색 단가를 읽어 결과 문서 §가격에 **URL·확인 날짜·단가**를 적고, 1회 요청 추정식(조사 1 + 작성 ≤2 + 웹 검색 ≤2)으로 상한을 계산한다. 추정이 $0.20/회를 넘으면 **멈추고 보고**(10회 $2 승인 범위 초과).
4. 앱: `VITE_AI_API_BASE`가 있을 때 패스키 등록·로그인 패널이 Pages origin에서 동작하는지 로컬 빌드로 확인(`vite preview` + 가짜 base). 교차 출처(Pages → workers.dev) 요청에 `Authorization` 헤더가 붙고 쿠키가 없는지 네트워크 기록으로 확인.
5. CL-34: 등록 잠금 해제 절차를 `docs/runbook-worker.md`(신규)에 적는다 — `wrangler secret put REGISTRATION_CODE` → settings 초기화 명령(`wrangler` 콘솔 또는 DO 관리 경로; 구현이 필요하면 **운영 RP ID에서도 인증된 사용자만** 부를 수 있는 `POST /auth/registration/reset`을 추가하고 시험한다).
6. `pnpm run check`·E2E·데이터 경계 0건 → push → **Codex 코드 검토**(배포 전).

### C2~C3. 배포·점검 (G1 뒤)
1. PC에서 `wrangler deploy --env production`. 출력의 `*.workers.dev` 주소를 결과 문서에 적는다(비밀값 아님).
2. 점검(curl, 모두 결과 문서에 응답 코드 기록): `GET /api/ai/v2/status` 무인증 → 401 · Origin `https://evil.example` → 403 · `POST /__test/reset` → 404 · `GET /auth/state` → `{registered:false, locked:false}` · 잘못된 등록 코드 1회 → 403(5회 하지 말 것).
3. CPU 실측(CL-32): Cloudflare 대시보드 또는 `wrangler tail`의 CPU 시간으로 status·login 요청 각 3회 기록. 10ms 초과가 보이면 결과 문서에 적고 호출은 계속한다(판단은 Codex).
4. 보고 → Codex가 G2 판정 → Codex가 GitHub 저장소 변수 `VITE_AI_API_BASE`를 설정하고 Pages 워크플로 재실행 → 배포 앱에서 AI 패널이 "패스키 등록" 상태로 보이는지 Claude가 확인.

### C4. 가상 여행 실제 호출 (G3 뒤)
1. 자료: 시험 픽스처의 가상 여행(`tests/fixtures/ai-v2.ts` 기반 패키지 또는 `public/pilot/fixture-*`) **만**. 실제 여행 패키지(`local-data/`)·사용자 평소 공간은 열지 않는다. 배포 앱의 **별도 검토 공간**(`?workspace=content&review=d04-live`)에 가져온다.
2. 호출은 **사용자가 동의 단추를 직접 누른다**(Claude는 화면 준비·관찰·기록). 순서: ① 추가 요청 1회(조사+작성) → 초안 카드·출처 종류·확인 날짜·사유 확인 → **거절** ② 수정 요청 1회 → **적용** → 계획 버전·근거 행 확인 → ACK 뒤 GET에 output 없음 확인 ③ 예산·한도 동작: 일일 5회를 채운 뒤 6회째가 429 `daily_limit`인지(이 1회는 호출되지 않으므로 비용 0). 총 실제 생성 호출 ≤10.
3. 매 호출 뒤 status의 `usageToday`와 OpenAI 대시보드 사용량을 결과 문서 표에 적는다(요청별 토큰·웹 검색 수·추정 금액·대시보드 금액). 추정과 실측 차이를 기록한다.
4. 실제 응답에서 T-D1 검증이 거부한 사례가 있으면 거부 사유·재작성 횟수를 기록한다(수정하지 않는다 — T-D5 후속).
5. **멈춤**: 호출 중 예상 밖 과금(1회 $0.5 초과)·검증 통과 못한 응답 연속 2회·401/403 반복 → 멈추고 보고.

### C5. 마무리
- 결과 문서: 가격 표·배포 주소·점검 표·CPU 실측·호출 10회 이내 사용량 표·실제 응답 관찰(출처 종류 분포·검증 거부)·미검증·Codex가 먼저 볼 위험·T-D5 전 복원 항목(일일 20회).
- `docs/runbook-worker.md`: 배포·비밀값 교체·등록 잠금 해제·`wrangler tail` 사용법.
- 커밋 분리: C1 코드 / runbook·문서. 배포 자체는 커밋이 아니다.

## 3. 사용자 단계 (Claude가 요청하지 않고 사용자가 알릴 때까지 대기)

| 단계 | 할 일 | 비밀값 |
|---|---|---|
| U1 | Cloudflare 계정(Workers Free), PC에서 `pnpm exec wrangler login` | — |
| U2 | OpenAI 프로젝트 생성 → **예산 하드 리밋 $10/월** 설정 → 프로젝트 전용 API 키 발급(권한: Responses 최소) | 키는 PC 터미널에만 |
| U3 | PC `worker/`에서 `pnpm exec wrangler secret put OPENAI_API_KEY --env production`, `... TOKEN_SECRET`(32자 이상 무작위), `... REGISTRATION_CODE`(16자 이상 무작위) | 3종 모두 터미널 입력. 채팅에 붙이지 않는다 |
| **G1** | 사용자가 "비밀값 설정 완료"라고 알림 | |
| U4 | G2 뒤 배포 앱(`https://jeongjae.github.io/travel-app/`)에서 AI 패널 → 패스키 등록(등록 코드 입력) → 로그인 | 등록 코드는 사용자만 |
| **G3** | "등록 완료" 알림 | |
| U5 | C4의 동의 단추 직접 클릭(최대 10회) | |

## 4. 범위 밖
실제 여행 데이터 호출(T-D5/T-D7) · 모델·예산 변경 · 다중 사용자 · 커스텀 도메인 · Node 서버 삭제 · UI 후속 CL-23·25·26 · iPhone 실기기(T-D5).

## 5. 완료 조건
C1 Codex 검토 통과 · G1~G3 통과 · 배포 점검 5항목 기록 · 실제 호출 ≤10회·추정 ≤$2·대시보드 실측 기록 · 거절 1·적용 1·ACK 확인 · 429 `daily_limit` 확인 · 데이터 경계 0건 · CI 성공 · runbook 작성 · 비밀값 비노출(검색: 커밋·문서에 `sk-`·토큰·코드 문자열 0건).

## 6. 멈추고 보고하는 조건
가격 추정 $0.20/회 초과 · 1회 과금 $0.5 초과 · 배포 점검 실패 · 교차 출처에서 패스키 등록 실패(iOS/데스크톱 Chrome 모두) · CPU 10ms 초과로 요청 실패 발생 · 비밀값이 어디든 노출됐을 가능성.

## 7. 보고 형식
상태(자체 검사 / Codex 검토 / 사용자 확인) → 관문 통과 시각 → 커밋 → C1~C5 대조 → 가격·사용량 표 → 배포 점검 표 → CPU 실측 → 실제 응답 관찰 → Codex가 먼저 볼 위험 → 미검증 → T-D5 전 복원 항목.
