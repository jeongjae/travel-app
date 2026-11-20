# Codex 독립 검토 — T-E4-1 개발용 Node 서버 경로 정리

## 검토 (2026-11-20 18:00) — 판정: **통과, main 병합. 사용자 화면 확인 없음(화면 변경 없음)**

대상 `codex/e04-1-node-server` `f6d1080`(코드 `7368cdb`, main `b80e5ea` 기준). [지시서](claude-task-e04-1-node-server.md) · [결과](claude-task-e04-1-result.md).

| 확인 | 결과 |
|---|---|
| 데이터 경계 4경로·`worker/`·`.github` diff | 0건 |
| 바뀐 것 | `server/` 5파일 삭제(887줄), 시험 3파일 삭제·1파일 신설·4파일 수정, `package.json`(명령 3개·format 대상)·`run-app.mjs`·`tsconfig.json`. **`src/` 변경 0건** |
| CI(`7368cdb`) | **성공**(static + E2E 4작업) |
| PC 전체 E2E | 98·91·94·4 통과(Claude 보고) |
| Codex 정독 | 결과 문서의 조사 표, `package.json`·`tsconfig.json`·`ai-v2-send-surface.test.ts` diff, 변경 범위. 새 `ai-v2-proposal.test.ts`와 나머지 시험 diff는 읽지 않았다 |

- 조사 결과: 앱·Worker가 `server/`를 가져다 쓰는 곳 0건(`server/ai-v2*.ts`는 `src/`의 공유 코드를 다시 내보내는 껍질이었다). 멈춤 조건 해당 없음.
- 시험 처리는 지시대로다: Node 서버만의 동작(v1 API, 파일 작업 저장소, HTTP 표면) 29건은 Worker 쪽 대응 시험을 적고 삭제, 서버와 무관한 규칙(전송 컨텍스트, 변경안 의미 검증, 참조·날짜 검사) 9건은 `src` 직접 호출로 옮김. vitest 774 → 745.
- 전송 허용 목록 시험은 "Node와 같다"는 비교 대신 Worker 경로의 허용 집합을 직접 단언한다 — 기준이 사라진 비교를 절대 단언으로 바꾼 것으로 수용.
- 미검증(Claude 보고): `pnpm dev` 실제 기동은 해 보지 않았다(코드 경로는 그대로).
