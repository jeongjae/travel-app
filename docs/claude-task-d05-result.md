# T-D5 결과 — iPhone 실사용·실제 여행 선별 적용

지시: [claude-task-d05-iphone-real.md](claude-task-d05-iphone-real.md) · 브랜치 `codex/d05-iphone-real`(main `e5c03cb`에서 시작)

## C1 코드 준비 (실제 호출·배포 없음)

상태: **구현·자체 검사 완료 / Codex 검토 통과 / main 병합 / 운영 배포 완료**. 실제 OpenAI 호출 0회.

배포(main `40eba25`): 2026-11-11 09:06 UTC(18:06 KST) 운영 버전 `b3720c46-7956-4605-b929-71e167d7a7f1` · 롤백용 이전 버전 `e5e62de9-dd3b-49fc-8fcb-59d774ef6bc5`(2026-11-11 04:48 UTC, `pnpm exec wrangler rollback e5e62de9-dd3b-49fc-8fcb-59d774ef6bc5 --env production`).

배포 후 확인: 2026-11-11 18:17:44 KST `wrangler tail`에 로그인 직후 `GET /auth/credentials - Ok`(Worker·DO 각 1줄, 예외 없음) → 운영 DO의 `label`·`last_used_at` 열 추가 뒤 목록 조회가 처리됨. `--format pretty`는 HTTP 상태 코드를 출력하지 않아 200 자체는 tail로 확인하지 않았다.

화면 증거(**G-D**, 사용자 답 2026-11-11): ① "패스키 관리 (2/3)" ② 18:18:51 `POST /auth/credentials`는 사용자가 PC Chrome에서 시작해 QR을 iPhone 카메라로 읽고 Face ID로 저장한 추가 ③ 변경안 탭 "AI 작업 기록"이 오류 없이 열림. 각 줄의 라벨·마지막 사용 표시와 작업 기록 건수는 답에 없다. → 운영 DO 열 추가 성공으로 판정. **G-P 중 "추가"는 완료**, iPhone Chrome 로그인은 U2에 남는다. tail(`bkzn8npq0`) 종료.

| 항목 | 구현 | 시험 |
|---|---|---|
| A. 두 번째 패스키 | `GET /auth/credentials`(라벨·등록·마지막 사용 시각, 화면용 `ref`=rowid, 자격 ID·공개키 없음) · `POST /auth/credentials/options`(`preferredAuthenticatorType: 'remoteDevice'` → hints `hybrid`, 기존 자격 exclude) · `POST /auth/credentials`(라벨 ≤40자) · `POST /auth/credentials/delete`(남는 자격 ≥1). 모두 Bearer 필수, 등록 코드 불필요, 최대 3개. DO `credentials`에 `label`·`last_used_at` 열 추가(ALTER, 중복 열 오류만 무시). 로그인 시 `last_used_at` 갱신. 화면: AI 패널 "패스키 관리"(목록·라벨·추가·2단계 삭제) | 단위: 무인증 4경로 401 · 추가 자격으로 로그인 · 4번째 409 `credential_limit` · 같은 인증기 409 · 로그인 챌린지로 추가 400 · 마지막 1개 409 `last_credential` · 지운 자격 로그인 401 · 라벨 41자 400 · 구 표 열 추가·재시작. E2E `ai-d05-passkeys`: 가상 인증기 2개(PC 제거 후 휴대폰 역할로 추가·로그인·삭제) |
| B. 작업 목록(CL-38) | `GET /api/ai/v2/jobs?tripId=`(Bearer) → 최근 50건, `toJobSummary`(id·tripId·status·시각·model·attempt·usage·sourceCount). 결과·출처·오류 문구 제외. 화면 변경안 탭 "AI 작업 기록"(시각·상태·토큰·웹 검색·도구 항목·출처 수) | 단위: 401 · 필드 목록 고정 · canary(요청 원문·변경 제목·`result`·`sources` 없음) · 다른 여행 0건 · 잘못된 tripId 400 · 55건 중 최근 50건. E2E: 목록 API 응답에 canary 프롬프트·변경 사유·`SYNTHETIC-PRIVATE` 없음 |
| C. officialUrl(CL-26) | 일정 수정 폼 "공식 사이트 주소(선택)" → 기존 `ChangePlan` `upsert-item`의 `officialUrl`(비우면 필드 삭제, 형식은 기존 스키마 `webUrl`) | E2E `c07-sapporo` S3: 저장 후 `plan_items` 1행에 주소, 이전 행 없음 |
| D. 관측 보강 | 오류 줄 아래 접힌 "오류 상세"에 `HTTP 429 · daily_limit` 형식. 사용량에 `toolCallItems`(출력 `*_call` 항목 수)·`webSearchQueries`(`web_search_call` 중 action `search`) 추가(선택 필드, 이전 작업은 없음). 작업 사용량 줄·작업 기록에 표시 | 단위: `usageOf` 3항목(search 2·open_page 1) 분리 집계 · `apiErrorDetail` 4경우. E2E: 429 응답 모양(route 대체)으로 상세 표시 |

데이터 경계 diff(`src/contracts`·`storage`·`transfer`·`repository.ts`): **0**. officialUrl은 저장 스키마에 이미 있는 필드이고 AI 전송 DTO에 들어가지 않는다.

## C2-2 iPhone 실기기 (U1~U6, [기록표](d05-iphone-script.md))

- **G-P 통과**(사용자 답): 18:28 iPhone Chrome에서 "패스키로 로그인" 성공. 추가(C2-1, 2026-11-11 18:18:51)와 합쳐 G-P 완료. U2 완료. 저장 위치·"패스키 관리" n/3·마지막 사용 표시는 답에 없다.
- U1~U6: 사용자 통과 보고(2026-11-12 10:46). 단, U3 화면 문제 위치·U4 점검용 기록 2건 처리·U5 1시간 만료 재로그인은 **보고 없음**(통과로 보지 않음).
- **G-B 통과**(2026-11-12 11:53, 사용자 답): iPhone 전체 백업 87MB를 파일 앱에 저장 → `?review=d05-restore` 복원 확인, PC 전체 백업 보유. 복원 뒤 여행·기록 수, PC 백업 크기는 답에 없다.

## C3 실제 여행 선별 호출

### 시작 전 확인표

| 항목 | 값 |
|---|---|
| G-T | 2026-11-11 15:35 확정: 스페인·프랑스 43일 여행 · 날짜 제한 없음(요청당 연속 최대 7일) · 현장 기록 미포함 · 2단계 iPhone 평소 공간 적용 |
| G-D | 2026-11-11 (C2-1 화면 증거) |
| G-P | 통과 18:28 (추가 2026-11-11 18:18:51) |
| G-B | 통과 2026-11-12 11:53 |
| OpenAI 대시보드 당일 사용액 | 보고 없음 |
| 일일 한도 잔여 | 보고 없음 |
| 한도 | 실제 여행 호출 최대 6회·$1, 1회 $0.3 초과 시 멈춤 |

### 호출 기록 (본문·장소명 없음)

| # | 단계·공간 | 종류 | 결과 처리 | 비용 | 미리보기 항목 수 | 토큰·웹 검색·도구 | 메모 |
|---|---|---|---|---|---|---|---|
| 1 | 1단계 PC `d05-real` | 추가 | 보고 없음(지시는 거절) | $0.04(사용자 답) | **미기록**(사용자: 미리보기가 지나감) | 보고 없음 | 사용자 답 "성공, 모두 정상 작동". 전송 제외 항목 확인은 기록 없음 |

| 2 | 1단계 PC `d05-real` | 수정 | **실패** · 작성 1회 · "AI 응답 형식을 처리하지 못했습니다." | 보고 없음 | 날짜 1일(조사 질문 기준) · 나머지 미기록 | 입력 16,215·출력 3,467(합 19,682) · 호출 2회(조사·작성) · 웹 검색 3(도구 항목 3·검색 동작 3) | 조사는 성공, 작성 응답에서 `readPlan`(`src/ai-v2-openai.ts:155`)의 Zod/JSON 해석 실패 → `failureText`가 일반 문구로 바꿈. 이 오류는 재작성(repair) 경로를 타지 않고 바로 실패(`worker/src/jobs.ts:459-465`). 원인 세부는 서버에 남지 않음. 별도 관찰(CL 후보): 요청 대상 활동은 10/01 일정에 있으나(사용자 확인) 자동 조사 질문·`research.places`에는 빠졌다. 장소 목록은 활동이 참조한 장소 콘텐츠만 모으므로(`src/ai-v2-context.ts:207`) 장소 연결이 없는 활동은 웹 조사 대상이 되지 않는다(추정, 데이터 미확인) |

누적: 2회(1회 실패) · 확인된 금액 $0.04 + 2회차 미확인 (한도 6회·$1).

**멈춤(§5 "코드 변경이 필요해 보이는 경우")**: 2회차 실패는 사용자 입력이 아니라 응답 해석 단계 문제로 보인다. strict JSON 스키마를 통과해도 Zod 제약(길이·형식 등)에서 걸릴 수 있고, 그 경우 재작성 없이 실패하며 원인이 기록되지 않는다. 같은 조건 재시도는 비용만 쓴다. 후보 조치(Codex 판단): ① Zod 실패를 검증 실패처럼 재작성 1회로 보냄 ② 개인 정보 없는 오류 경로·코드(예: `schema:operations.0.x`)만 작업 기록에 남김. 1단계 ② 적용과 2단계는 판단 뒤로 미룬다.

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
