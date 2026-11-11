# T-D5 결과 — iPhone 실사용·실제 여행 선별 적용

지시: [claude-task-d05-iphone-real.md](claude-task-d05-iphone-real.md) · 브랜치 `codex/d05-iphone-real`(main `e5c03cb`에서 시작)

## C1 코드 준비 (실제 호출·배포 없음)

상태: **구현·자체 검사 완료 / Codex 검토 대기 / 배포 전**. 실제 OpenAI 호출 0회, `wrangler deploy` 0회.

| 항목 | 구현 | 시험 |
|---|---|---|
| A. 두 번째 패스키 | `GET /auth/credentials`(라벨·등록·마지막 사용 시각, 화면용 `ref`=rowid, 자격 ID·공개키 없음) · `POST /auth/credentials/options`(`preferredAuthenticatorType: 'remoteDevice'` → hints `hybrid`, 기존 자격 exclude) · `POST /auth/credentials`(라벨 ≤40자) · `POST /auth/credentials/delete`(남는 자격 ≥1). 모두 Bearer 필수, 등록 코드 불필요, 최대 3개. DO `credentials`에 `label`·`last_used_at` 열 추가(ALTER, 중복 열 오류만 무시). 로그인 시 `last_used_at` 갱신. 화면: AI 패널 "패스키 관리"(목록·라벨·추가·2단계 삭제) | 단위: 무인증 4경로 401 · 추가 자격으로 로그인 · 4번째 409 `credential_limit` · 같은 인증기 409 · 로그인 챌린지로 추가 400 · 마지막 1개 409 `last_credential` · 지운 자격 로그인 401 · 라벨 41자 400 · 구 표 열 추가·재시작. E2E `ai-d05-passkeys`: 가상 인증기 2개(PC 제거 후 휴대폰 역할로 추가·로그인·삭제) |
| B. 작업 목록(CL-38) | `GET /api/ai/v2/jobs?tripId=`(Bearer) → 최근 50건, `toJobSummary`(id·tripId·status·시각·model·attempt·usage·sourceCount). 결과·출처·오류 문구 제외. 화면 변경안 탭 "AI 작업 기록"(시각·상태·토큰·웹 검색·도구 항목·출처 수) | 단위: 401 · 필드 목록 고정 · canary(요청 원문·변경 제목·`result`·`sources` 없음) · 다른 여행 0건 · 잘못된 tripId 400 · 55건 중 최근 50건. E2E: 목록 API 응답에 canary 프롬프트·변경 사유·`SYNTHETIC-PRIVATE` 없음 |
| C. officialUrl(CL-26) | 일정 수정 폼 "공식 사이트 주소(선택)" → 기존 `ChangePlan` `upsert-item`의 `officialUrl`(비우면 필드 삭제, 형식은 기존 스키마 `webUrl`) | E2E `c07-sapporo` S3: 저장 후 `plan_items` 1행에 주소, 이전 행 없음 |
| D. 관측 보강 | 오류 줄 아래 접힌 "오류 상세"에 `HTTP 429 · daily_limit` 형식. 사용량에 `toolCallItems`(출력 `*_call` 항목 수)·`webSearchQueries`(`web_search_call` 중 action `search`) 추가(선택 필드, 이전 작업은 없음). 작업 사용량 줄·작업 기록에 표시 | 단위: `usageOf` 3항목(search 2·open_page 1) 분리 집계 · `apiErrorDetail` 4경우. E2E: 429 응답 모양(route 대체)으로 상세 표시 |

데이터 경계 diff(`src/contracts`·`storage`·`transfer`·`repository.ts`): **0**. officialUrl은 저장 스키마에 이미 있는 필드이고 AI 전송 DTO에 들어가지 않는다.

### 검사

- `typecheck`·`lint`·`format:check`·`build`: 통과.
- 단위: 변경 파일(`worker-auth` 17, `worker-jobs` 19, `ai-client` 5) 통과. 전체 `vitest run` 2회는 Node 서버 시험(`ai.test`·`ai-v2-job-retention`)에서 매번 다른 1~4건이 시간·상태 경합으로 실패했다(CL-36 동일 양상). 두 파일만 따로 돌리면 23/23 통과. 이번 변경은 Node 서버 경로를 건드리지 않는다. CI 결과로 판정한다.
- E2E: 첫 전체 실행 197 통과·8 실패(4종×2). 원인과 조치: ① `remoteDevice`가 `cross-platform`을 요구해 내장 가상 인증기로는 추가가 멈춤 → 휴대폰 역할 인증기를 `usb` 전송으로(도우미 인자 추가) ② 접힌 "AI 작업 기록"의 상태 문구가 DOM에 중복돼 d02·ai-v2의 `getByText` strict 위반 → 펼칠 때만 읽고 그리게 변경 ③ `ui-u2` 폼 칸 순서 기대에 새 칸 추가. 이후 영향 spec 5개(d05·d02·ai-v2·ui-u2·c07) desktop·mobile **34/34 통과**.

### Codex가 먼저 볼 위험

1. DO 열 추가: `ALTER TABLE … ADD COLUMN`을 생성자마다 실행하고 `duplicate column` 오류만 삼킨다. node:sqlite와 로컬 workerd(E2E 영속 폴더)에서만 확인했고 운영 DO에서는 배포 뒤 첫 요청에서 확인된다.
2. 패스키 추가는 기존 토큰만으로 된다(재인증 없음). 토큰 유출 시 공격자 패스키 추가가 가능하다 — 토큰 수명 1시간·최대 3개·목록 표시로 완화. 추가 전 재로그인 요구는 하지 않았다.
3. `ref`는 SQLite rowid. 삭제 뒤 재사용될 수 있으나 화면은 응답 목록으로만 고른다.
4. 패스키 추가는 `authenticatorAttachment: cross-platform`(hints `hybrid`)이다. iPhone에서 로그인한 채 그 iPhone 자체에 추가하는 경로는 막힌다(지시의 QR 경로만). Windows Hello로 두 번째 PC 패스키를 만드는 것도 안 된다.
5. `addUsage`가 이제 `toolCallItems`·`webSearchQueries`를 항상 채운다(이전 작업 합산 시 0부터).

### 미검증

QR(hybrid) 경로로 실제 iPhone 패스키 생성 · iOS Safari 교차 출처 로그인 · 운영 DO 열 추가 · 실제 OpenAI 응답의 `action.type` 값 분포(CL-37) · 429 운영 직접 관측.
