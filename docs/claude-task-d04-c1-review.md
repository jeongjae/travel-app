# T-D4 C1 검토 · Codex 역할 · 2026-11-10 15:20

대상 `codex/d04-limited-live` head `e003dfb`(코드 `d76fdad`, cherry-pick `d01cddc`·`3ee107c`). 기준 main `88c1ae5`. 범위: 배포 전 코드 검토(지시 §C1-6). 배포·호출은 아직 없다.

## 판정: **조건부 통과 → R1 1건(한 줄) 해소 뒤 C2 진행 가능.** G1(비밀값 설정)은 사용자 단계라 병행.

## 1. 확인

| 항목 | 결과 |
|---|---|
| CI | `e003dfb` `travel-app checks` success(gh 직접 확인). 로컬 `pnpm run check` 실패는 §3 |
| 데이터 경계 | 보고 0건. 변경 14파일에 4경로 없음(stat 확인) |
| `[env.production]` | workers_dev=true, RP_ID·ALLOWED_ORIGINS `jeongjae.github.io`, 모델 `gpt-5.4-mini`, `DAILY_LIMIT="5"`, E2E_RESET 없음, DO 바인딩·마이그레이션 재선언 ✔. `--dry-run`으로 해석 확인 |
| DAILY_LIMIT | 비면 20, 1~20 정수 아니면 **1**(비용 안전 쪽). 시험 있음. 수용 |
| CORS | `X-Travel-App`이 허용 헤더에 없던 **실결함 발견·수정**. 교차 출처 E2E(`test:e2e:cross-origin`) 신설 — Authorization 부착·쿠키 없음·모든 AI 요청이 Worker origin으로 감 ✔ |
| 가격 | 결과 문서에 URL·확인일·단가(입력 $0.75/출력 $4.50 per 1M, 웹 검색 $10/1k). 1회 상한 ≈ $0.15(웹 검색 $25 가정 시 $0.18) < $0.20 ✔. 전제: 패키지 ≈25k 토큰 — **C4 전 실측 재계산**(Claude 위험 2, 수용) |
| CL-34 | 결정 D안(`3ee107c`): 등록 코드 지문을 저장해 비밀값이 바뀌면 잠금·실패 횟수 자동 초기화. 관리 경로 없음 — Codex CL-34 의도("비밀값 교체로 해제")와 일치, 공격면 추가 없음. **수용**. runbook에 절차 ✔ |
| cherry-pick 2건 | T-D3 결과 문서의 결정 기록 + 잠금 해제 D안. 사용자 결정이 Claude 세션에서 직접 이뤄짐 → `decisions.md` 11/10 15:20에 Codex가 기록 |

## 2. 수정 지시 R1 (C2 전, 필수)
- 기본 환경(`[vars]` 쪽) 스크립트 `name`을 운영과 **다르게** 둔다(예: `travel-app-ai-dev`). 지금은 둘 다 `travel-app-ai`라 누가 `--env production` 없이 `wrangler deploy`를 치면 **운영 스크립트가 localhost 설정으로 덮인다**. 운영 `name`은 그대로. runbook에 "배포는 반드시 `--env production`" 한 줄 유지.
- (선택) 기본 환경과 production의 중복 항목(Claude 위험 4)은 wrangler가 상속하지 않으므로 구조상 불가피. runbook에 "두 곳 동시 수정" 체크 항목 추가.

## 3. 로컬 `pnpm run check` 실패 (Claude 보고)
- Node 서버 시험(retention·ai-v2·ai) 6~13건이 PC에서 흔들리고, 변경 없는 main에서도 8~10건 실패. 파일 단독 실행은 14/14 통과. CI(Linux)는 `e003dfb`·main 모두 성공.
- Codex 판단: **PC(Windows) 환경 재현성 문제**로, 패턴이 CL-27(jobs.json rename EPERM, 시험 병렬 실행 시 파일 경쟁)과 같다. T-D3 시점(460 통과)과 달라진 것은 Worker 시험 추가로 병렬 부하가 늘어난 점. **C1 판정에 영향 없음**(변경 부분·CI 통과). 후속 **CL-36**: Node 서버 시험을 Windows에서 안정화(임시 디렉터리 격리 또는 Node 경로 시험 순차 실행) — Node 서버 정리(T-D5 이후)와 함께. Claude는 다음 보고에 실패 메시지 상위 3개를 첨부.

## 4. 미검증(이월)
실제 배포·workers.dev 응답·HTTPS 교차 출처·CPU 실측·과금·iOS 패스키·secret 반영 시점 — 모두 C2~C4.

## 5. 다음
R1 → push → Codex 확인(한 줄) → 사용자 G1 알림 → C2 배포.
