# Claude Sonnet T-D0 · D단계 기준 고정·공백 재현·Worker 이식 조사

2026-11-06 · 기준: main `e0c4013`(C-15 배포) · **작성 완료 / 전달 가능 / 착수 전**

> D단계 첫 작업이다. **제품 코드를 바꾸지 않는다.** 조사·모의 재현·문서만 만든다. 근거: [D 설계 §12](phase-d-design.md)·[D 계획 §8](phase-d-plan.md)·[결정 11/06](decisions.md).
> `main`에서 `codex/d00-baseline`을 만들어 시작한다. Sonnet이 조사→재현→문서→커밋/push까지 자율 수행하고, 결과 문서 첫머리에 20줄/2,000자 요약과 증거 색인을 둔다.

## 0. 사용자 결정(11/06, 다시 묻지 않음)

- AI는 **기존 일정의 항목 단위 조사·근거·검증 보조**. 전체 일정 생성은 범위 밖.
- 개인용 기준 단순화: 본인 1명 인증, 비용은 OpenAI 예산 한도 + 요청당 상한 + 앱 사용량 표시.
- 운영: **앱은 GitHub Pages 그대로, AI는 Cloudflare Worker 프록시**(앱 주소 불변).
- iPhone 실기기는 D 후반. 지금은 에뮬레이션.

## 1. 할 일

### A. 현 AI 경로 대조·공백 재현 (모의만)
1. 대상: `server/ai-v2.ts`·`server/ai-v2-jobs.ts`·`server/index.ts`, v1 `server/ai.ts`·`server/jobs.ts`, `src/ai-v2-context.ts`, `src/AiPlanner.tsx`·`src/content/AiPlanner.tsx`, 시험 `tests/ai-v2*.test.ts`·`tests/e2e/ai-v2.spec.ts`.
2. C-01~C-15 이후에도 AI v2 모의 흐름(요청→조사/초안→Stage→Decide)이 동작하는지 기존 시험으로 확인. 깨졌으면 원인만 기록(고치지 않음).
3. 설계 §5 전송 표와 실제 전송 내용 대조: 가상 여행으로 모의 provider가 받은 body·검색 입력을 캡처해 **보내지 말아야 할 값**(기록·메모·예약·숙소 상세·다른 날짜·원천 경로)이 섞이는지 표로. BM-2(도착/출발 시각·고정 활동 제약)가 지금 들어가는지.
4. C단계에서 새로 생긴 데이터(현장 기록·회고·stay/leg·날짜 사진·가이드)가 AI 컨텍스트에 어떻게 들어가거나 빠지는지.
5. `tests/ai-v2.test.ts` 간헐 실패(C-15 보고: 시간 초과·`expected validating to be failed`) 재현 시도와 원인 추정. 고치지 않는다.

### B. Cloudflare Worker 이식 조사
1. 현 서버의 Node 의존(파일 `jobs.json`, `node:` 모듈, 프로세스 상주 작업 관리자, polling)을 목록화하고 Worker에서 대체할 방법을 표로.
2. 작업 저장소 후보 비교(KV·D1·Durable Objects 등): 일관성, 중복 방지(같은 requestId), 결과 보관·삭제, 무료/유료 한도. **공식 문서 링크·확인 날짜**를 붙인다.
3. 웹 검색 포함 OpenAI 호출이 Worker 실행 시간·요청 제한 안에 끝나는지, 안 되면 비동기 패턴(백그라운드 응답·대기열·Durable Object 등) 제안. 근거는 공식 문서.
4. 로컬 개발 경로: Worker를 PC에서 띄워 기존 E2E·모의 provider로 시험하는 방법(예: 로컬 개발 서버). 설치가 필요하면 **`local-data/` 아래 임시 폴더**에서만 시도하고 저장소 의존성은 바꾸지 않는다.

### C. 본인 1명 인증 방식 비교 (2~3안)
- 조건: Pages(`jeongjae.github.io`) → Worker 교차 origin 호출, **OpenAI 키는 Worker 비밀값에만**, 브라우저에 장기 비밀값 저장 지양, 무인증 과금 경로 0, CSRF 방어, iPhone Chrome(WebKit)에서 동작.
- 후보 예: Cloudflare Access 앞단, 패스키(WebAuthn) 세션, 짧은 수명 토큰 등. 각각 iPhone 교차 사이트 쿠키 제약·만료/재로그인·기기 분실 시 해지·설정 난이도를 표로. 권고 1안과 이유.

### D. OpenAI 공식 문서 재확인 (호출 없음)
- 프로젝트 예산 한도가 **호출을 실제로 막는지, 알림만인지**. 막지 않으면 앱 일일 한도 필요(설계 §12).
- Responses API 웹 검색 도구·구조화 출력·`store:false` 보관 조건(설계 §9 문장이 아직 맞는지).
- 후보 모델 2~3개와 가격표 **확인 날짜**. 권고는 하되 확정은 U-D2(사용자).

## 2. 산출물

- `docs/claude-task-d00-result.md`: 요약 → A 공백 표(심각도: 데이터·비용·권한·충돌은 "차단") → B 이식 표·저장소 권고 → C 인증 비교·권고 → D 문서 확인 표(URL·날짜) → **T-D1·T-D2 범위 조정 제안**(무엇을 더하고 뺄지).
- 현/목표 구조도 1장(텍스트 또는 Mermaid).
- 모의 캡처는 가상 데이터만. 실제 여행·키·영수증은 커밋 금지.

## 3. 하지 않는 것

제품 코드·스키마·의존성 변경, Cloudflare 계정 로그인·Worker 배포, OpenAI 키 조회·설정·실제 호출, 평소 공간 데이터 변경, main 병합. 판단이 필요한 지점은 멈추지 말고 결과 문서에 선택지로 남긴다.

## 4. 검사

- `pnpm run check` exit 0(제품 변경이 없으므로 기준과 같은 결과여야 함).
- AI 관련 단위·E2E(`tests/ai-v2*`, `tests/e2e/ai-v2.spec.ts`) 실행 결과와 실패 시 원인.
- 전체 E2E는 GitHub CI로 갈음.
