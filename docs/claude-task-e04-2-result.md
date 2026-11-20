# T-E4-2 결과 — 구 화면 제거

- 브랜치 `codex/e04-2-legacy-screen`(E4-1 위, main f3b6056 병합). 상태: Claude 자체 검사 / Codex 검토 대기.
- **로컬 전체 E2E 미실행(포트 충돌), CI로 대체.** 4173 포트를 다른 프로젝트의 서버가 쓰고 있었다(사용자 지시로 그 서버는 끄지 않음). `check`·`check:pilot`은 로컬 통과, E2E는 CI 4작업 결과로 갈음한다.
- 캡처(`?workspace=legacy`)는 4173 포트가 필요해 생략했다. 이 주소는 `workspace` 값을 더 이상 읽지 않으므로 지금의 앱이 열린다.

## 1. 조사

1. **저장 공간**: 구 화면과 지금 앱은 **같은 DB**(`travel-app`, 검토 공간은 `travel-app-review-<이름>`)를 연다. 구 화면 자료는 그 안의 `trips` 표다.
2. **자료에 닿는 길**: 있다. 지금 앱은 `trips`가 비어 있지 않으면 `meta.mode='legacy'`로 열고 "기존 여행 전환 검토"(`prepareLegacy`→`activateLegacy`)로 원문을 보존한 채 v2로 전환한다. 전환 뒤에도 원문은 백업에 들어간다. → 3절 정지 조건 해당 없음.
3. **사용처**: `App.tsx`·`AiPlanner.tsx`는 `main.tsx`만 가져왔다. `content/Workflows.tsx`가 쓰는 것은 별개의 `content/AiPlanner.tsx`다. `import-export.ts`는 `App.tsx`와 시험(`domain.test.ts`)만, `ai-contract.ts`는 구 `AiPlanner.tsx`만 썼다.
4. **주소에 `workspace`가 없을 때**: 비정적 빌드(`pnpm dev`·로컬 preview)에서는 구 화면이 열렸다. 지금은 항상 지금의 앱이 열린다(배포본과 같음).

## 지운 것

| 파일 | 줄 |
|---|---|
| `src/App.tsx` | 1051 |
| `src/AiPlanner.tsx` | 262 |
| `src/import-export.ts` | 171 |
| `src/ai-contract.ts` | 64 |
| `tests/e2e/travel.spec.ts`(구 화면 E2E 7건) | 263 |

- `main.tsx`: 구 화면 분기·`workspace-nav` 제거. `ContentApp.tsx`: "기존 일정 열기" 링크 1줄 제거. `ui-u1.spec`: 그 링크가 없음을 확인하도록 바꿈.
- `domain.test.ts`: 지운 `import-export`를 시험하던 2건(일일카드 변환, 파일 미리보기)과 도우미 삭제.
- `content.spec`의 "기존 여행 전환" 시험: 구 화면으로 시드하던 것을, 같은 DB의 `trips` 표에 직접 넣는 방식으로 바꿈(전환 코드 경로는 그대로 시험됨).
- 시험 수: vitest 745 → 743(-2). E2E 구 화면 7건 삭제, 나머지는 그대로.

## 경계 안에 남긴 "구 화면 전용" 후보(변경 0건)

- `src/storage/workspace-name.ts`: `workspaceUrl(…'legacy'…)` 인자.
- `src/storage/legacy.ts`·`schema.ts`의 `mode:'legacy'`, `repository.ts`의 구 저장 명령(`TravelRepository`)과 `legacyWrite`: 전환·복구가 쓰므로 남김. `repository.ts`의 구 CRUD(`record`·`propose` 등)는 지금 앱이 쓰지 않을 가능성이 있어 다음에 확인할 목록.
- `src/domain.ts`, `src/demo.ts`: 시험·경계가 사용.
- `src/styles.css`: 구 화면 전용 규칙을 가려내지 않았다(CSS 크기 전후 동일).

## 번들 크기(JS, kB)

| | 전 | 후 |
|---|---|---|
| JS 합계 | 1366.5 | 1331.1 (-35.4) |
| 진입(index) | 42.6 | 5.1 |
| ContentApp | 421.0 | 487.3 (+66.3) |
| 구 화면 AiPlanner(chunk) | 37.0 | 37.0(content/AiPlanner, 그대로) |
| dist 디렉터리 | 1470 KB | 1434 KB |

ContentApp이 커진 이유: 구 `App`이 지금 앱과 공유하던 모듈(백업·UI 도우미 등, 이전엔 `hosting`·`backup` 별도 chunk로 나뉘어 있던 것)이 이제 ContentApp만 쓰게 되어 chunk 분할이 바뀌며 ContentApp·`ui` chunk로 합쳐졌다. 합계는 35 kB 줄었다. CSS는 변화 없음.

## 검사

- `pnpm run check`: 통과(743, 1 skip). `check:pilot`: 통과.

## CI

- run 44707188752: 첫 실행에서 `ai-v2.spec.ts:148`(mobile, 지연 fixture를 쓰는 시간 의존 시험) 1건이 실패했다. 이 변경(구 화면 삭제)과 닿는 곳이 없고 E4-1 CI에서는 통과했다. 실패 작업만 다시 돌려 success(static + E2E 4작업). 같은 시험이 다시 흔들리면 별도 안정화 대상이다.
