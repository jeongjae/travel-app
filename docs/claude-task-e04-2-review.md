# Codex 독립 검토 — T-E4-2 구 화면 제거

## 검토 (2026-11-20 18:40) — 판정: **통과, main 병합. 사용자 확인 대기(일괄 확인 목록)**

대상 `codex/e04-2-legacy-screen` `663457a`(main `f3b6056` 병합 포함). [지시서](claude-task-e04-2-legacy-screen.md) · [결과](claude-task-e04-2-result.md).

| 확인 | 결과 |
|---|---|
| 데이터 경계 4경로·`worker/`·`.github` diff | 0건 |
| 지운 것 | `src/App.tsx`(1,051줄)·`src/AiPlanner.tsx`(262)·`src/import-export.ts`(171)·`src/ai-contract.ts`(64), `tests/e2e/travel.spec.ts`(구 화면 E2E 7건) |
| 고친 것 | `main.tsx`(항상 지금의 앱), `ContentApp.tsx`("기존 일정 열기" 1줄), 시험 3파일 |
| CI(run 44707188752) | **성공** — 단, 첫 실행에서 `ai-v2.spec.ts:148`(mobile) 1건 실패, 실패 작업만 재실행해 통과(아래) |
| 로컬 전체 E2E | **미실행**(PC 4173 포트 충돌, 사용자 선택 A — CI로 대체) |
| 캡처 | 없음(같은 이유) |

Codex가 코드로 확인한 것:

- **예전 자료에 닿는 길이 남는다.** `storage/content-repository.ts` 151줄: `trips` 표에 자료가 있으면 작업 공간을 `mode: 'legacy'`로 연다. `ContentApp.tsx`가 `prepareLegacy` → `activateLegacy`("기존 여행 전환 검토")로 v2 전환을 제공한다. 이 경로와 `storage/legacy.ts`·`repository.ts`는 손대지 않았다. 구 화면과 지금 앱은 같은 DB(`travel-app`)를 쓴다(`repository.ts`의 `trips` 표).
- `main.tsx`는 `workspace` 값을 읽지 않고 항상 `ContentApp`을 연다. `?workspace=legacy` 주소도 지금의 앱이 열린다(코드 기준. 화면으로는 보지 못했다).
- "기존 여행 전환" E2E는 구 화면으로 자료를 만들던 것을 같은 DB의 `trips` 표에 직접 넣는 방식으로 바꿨다 — 전환 코드 경로는 그대로 시험한다.
- 번들: JS 합계 1,366.5 → 1,331.1kB(-35.4). `ContentApp` 조각이 421 → 487kB로 커진 것은 구 화면과 나눠 쓰던 모듈이 한 조각으로 합쳐진 것(Claude 설명, Codex는 합계 감소만 확인).

알고 넘어가는 것:

1. `ai-v2.spec.ts:148`(mobile)이 CI에서 한 번 실패 뒤 재실행 통과 — 이 변경과 닿는 곳이 없다는 Claude 판단을 수용하되 [CL-47](change-log.md)로 남긴다.
2. 경계 안에 "구 화면만 쓰던 것으로 보이는" 코드가 남았다(`repository.ts`의 구 CRUD 일부, `workspace-name.ts`의 `'legacy'` 인자, `styles.css`의 구 화면 규칙). 지시대로 손대지 않았다. 다음 정리 후보.
3. 로컬 개발(`pnpm dev`)에서도 이제 지금의 앱이 바로 열린다.
