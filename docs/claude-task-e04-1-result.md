# T-E4-1 결과 — 개발용 Node 서버 경로 정리

- 브랜치 `codex/e04-1-node-server`(main b80e5ea 기준). 화면·저장 동작·배포본·데이터 경계 4경로·`worker/`·`.github/workflows` 변경 0건.
- 상태: Claude 자체 검사 / Codex 검토 대기 / 사용자 확인 없음(화면 변화 없음).

## 0. 조사

1. **앱·Worker가 `server/`를 가져다 쓰는가**: 아니오. `src/`·`worker/`에서 `server/`를 가져오는 곳 0건(문자열 언급만 `src/content/ai-client.ts`·`ai-job-label.ts`의 주석). `server/ai-v2*.ts`는 `src/ai-v2-*` 공유 코드를 다시 내보내는 얇은 껍질이다. 구 화면(`App.tsx`·`AiPlanner.tsx`·`storage/legacy.ts`)도 `server/`를 가져오지 않는다 → 3절 정지 조건 해당 없음.
2. 시험 표

| 시험 묶음 | 검증하는 것 | Node 서버만의 동작인가 | 대응 시험 | 처리 |
|---|---|---|---|---|
| `ai.test.ts` 9건 | v1 조사·작성, JobManager 재시작, v1 API 헤더 | 예(v1은 Worker에 없음) | `worker-auth` "v1 경로는 Worker에 없고" | 삭제 |
| `ai-v2.test.ts` 전송 컨텍스트 제외 | `buildAiV2Payload` 규칙(공유) | 아니오 | 없음 | **옮김** → `ai-v2-proposal.test.ts` |
| 〃 시각 유지·장소 교체·활동 ID·거부 5종(`materializeV2Proposal`) | 변경안 의미 검증(공유) | 아니오 | 없음 | **옮김**(import만 `src`로) |
| 〃 AiV2Jobs 6건(1회 조사·보정·중단·interrupted·저장 실패) | Node 파일 작업 저장소 | 예 | `worker-jobs`: 같은 ID, 보정, 취소, calling 재시작, 저장 실패 | 삭제 |
| 〃 여행·계획 참조·날짜 검사 | `checkAiV2Request`(공유 코어) | 아니오 | 없음 | **옮김**(코어 직접 호출) |
| 〃 모의 HTTP 서버(503·400·413·403·지문) | Node HTTP 표면 | 예 | `worker-auth`(413·403), `worker-jobs`(지문 409) | 삭제 |
| `ai-v2-job-retention.test.ts` 12건 | 작업 파일·무인증 조회·25시간 만료 | 예 | `worker-jobs`: 허용 필드, 24시간 만료, 200건 정리, 목록 | 삭제 |
| 〃 R6 상태 줄 라벨 | `jobStatusLabel` | 아니오 | `ai-client` 같은 단언 | 삭제(중복) |
| 〃 R7 blocked HH:MM | `aiV2PlanningDtoSchema`(공유) | 아니오 | 없음 | **옮김** |
| `ai-v2-send-surface` Node 3건 | 전송 허용 목록 | 예(Node provider 호출) | 같은 파일의 Worker 경로 | 같은 단언을 Worker 경로로 바꿔 **유지**, Node와의 비교 단언만 삭제 |
| `ai-v2-semantics` provider 시험 | 거절·길이 초과·미완성·사용량 읽기(공유 `src/ai-v2-openai`) | 아니오 | 없음 | 함수 직접 호출로 **바꿔 유지**(429는 `rateLimitMessage` 시험이 이미 있음) |
| `ai-v2-repository`, `fixtures/ai-v2` | 저장소 적용 / 형식 | 아니오 | — | import 경로만 `src`로 |

3. 스크립트·설정: `package.json`의 `ai:server`·`dev:node`·`preview:node`, `run-app.mjs`의 `node` 분기, format 대상 `server`, `tsconfig.json` include. E2E 설정은 Worker만 쓴다(변경 없음).

## 지운 것

- `server/`(index·ai·ai-v2·ai-v2-jobs·jobs, 887줄)
- 시험: `tests/ai.test.ts`, `tests/ai-v2.test.ts`(→`ai-v2-proposal.test.ts`로 축소·이름 변경), `tests/ai-v2-job-retention.test.ts`
- 명령: `ai:server`, `dev:node`, `preview:node`; `run-app.mjs`의 `node` 분기·주석; format 두 줄의 `server`; `tsconfig.json`의 `server`
- 문서: `docs/handoff.md` 30행의 `dev:node`(AGENTS.md에는 해당 문장 없음)
- 의존성: Node 서버만 쓰던 것 없음(`zod` 등은 `src`도 사용) → `package.json` 의존성·lockfile 변경 0
- T-M1 시험 한도: 지운 파일의 것(`ai`·`ai-v2`·retention)은 함께 사라짐. `vite.config.ts` 전체 한도는 그대로.

## 시험 수·시간

| | 전 | 후 |
|---|---|---|
| vitest 파일 | 66(1 skipped) | 64(1 skipped) |
| vitest 시험 | 774 통과 + 1 skip | 745 통과 + 1 skip |
| 소요 | 18.5초 | 17.2초 |

- 지운 시험 29건(ai 9 + retention 13 + ai-v2 Node 작업 6·HTTP 1). 옮긴 것 9건(ai-v2 변경안·전송 컨텍스트 8 + R7 1), 코어 직접 호출로 다시 쓴 것 1건(참조 검사), 형태만 바꿔 남긴 것 send-surface 4·semantics 1. 순감 29.
- 규칙 시험이 대응 없이 사라진 것은 없다.

## 검사

- `pnpm run check`: 통과(745). `pnpm run check:pilot`: 통과. 전체 E2E·CI는 아래 줄.
- 미검증: `pnpm dev` 실제 기동(Worker 분기 코드는 그대로이고 `dev`는 `run-app.mjs`의 같은 경로).

## 최종 검사 결과

- `pnpm run test:e2e:all`: chromium 98 / 91 / 94, webkit 4 통과, 실패·불안정 0.
- CI(코드 커밋): run 44690108890 success(static + E2E 4작업).
