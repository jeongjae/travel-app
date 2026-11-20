# Codex 독립 검토 — T-M1 시험 실행 정리

## 검토 (2026-11-20 13:40) — 판정: **통과, main 병합. 사용자 화면 확인 없음(화면 변경 없음)**

대상 `codex/m01-test-cleanup` `491e610`(main `29f3e41` 기준). [지시서](claude-task-m01-cleanup.md) · [결과](claude-task-m01-result.md).

| 확인 | 결과 |
|---|---|
| 데이터 경계 4경로·`.github` diff | 0건 |
| 바뀐 것 | `vite.config.ts`(시험 시간 한도), 시험 6파일(한도 숫자만), `scripts/e2e-all.mjs`(새 파일)·`package.json`(명령 1줄), `AGENTS.md`·`handoff.md`(명령 안내). **앱 코드(`src/`) 변경 0건** |
| CI(`8852906`, 코드 포함 push) | **성공** — `static` 58초, E2E 4작업 통과 |
| Codex 정독 | diff 전체 |

- **M1-1**: 원인은 지시서가 짐작한 `jobs.json` rename 경쟁이 아니라 **시험 시간 한도**였다(Claude 확인: 다른 작업과 CPU를 나눠 쓰면 vitest 기본 5초·`vi.waitFor` 1초에 걸림. 동시에 3개 돌려 41건 실패를 재현, 고친 뒤 모두 통과). 한도만 올렸고 단언은 그대로다. PC 연속 5회 `pnpm run check` 통과(Claude 보고, 37~40초). CL-36 해소로 본다.
- **M1-2**: `pnpm run test:e2e:all` — 빌드 뒤 CI와 같은 4묶음을 순서대로, 실패해도 끝까지, 묶음별 수를 모아 보인다. PC 실행 결과(Claude 보고): 93·91·89·4 통과, 실패 0, 약 17분. 메모리 부족은 시험이 아니라 다른 작업과 동시에 돌린 탓으로 확인됐다.
- 알고 넘어가는 것: 묶음 정의가 `checks.yml`과 `e2e-all.mjs` 두 곳에 있다 — CI 조각을 바꾸면 둘 다 고친다. 한도를 올렸으므로 정말 멈춘 시험은 60초 뒤에야 끊긴다.
- Codex가 직접 돌려 보지 않은 것: PC 연속 5회와 `test:e2e:all` 실행(Claude 보고와 CI로 판단).
