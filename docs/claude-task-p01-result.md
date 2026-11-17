# T-P1 결과 보고 (C1 가이드 변환기)

2026-11-17 · 브랜치 `codex/p01-guide-select` · 작성: Claude

## 상태

C1 구현·단위 시험 완료. **Codex 검토 대기.** C2~C4는 시작하지 않았다. 사용자 확인(G-P1) 없음.

## 한 일

- `src/guide-import/` 신설: `parseGuide(text)` → `GuideResult`(`accepted` true면 `destination`·`referenceDate?`·`items[]`·`issues[]`·`notImported[]`, false면 `rejection?`·`issues[]`).
- 항목 `{ key, kind, name, area, description, durationText, needsCheck, line }`. `key` = 본문 지문(FNV-1a 32비트) + 항목 순번.
- 규격 §3대로 오류가 하나라도 있으면 가이드 전체를 받지 않고, 오류는 줄 번호·이유로 모두 모은다. 중복(종류+이름+지역)은 경고만 하고 둘 다 남긴다.
- 거부 코드: `too-large` · `not-guide` · `ambiguous` · `format-version` · `is-plan`.
- 고정 자료 `docs/p0-results/g1-guide-hakodate.md`를 `tests/fixtures/guide-format/hakodate.md`로 복사. `.prettierignore`에 해당 폴더 추가.

## `src/plan-import/`를 고친 부분 (Codex가 먼저 볼 것)

1. `input-text.ts`: `selectBody`의 본문을 `selectFormattedBody(lines, spec)`으로 꺼내고 `selectBody`는 계획 양식 값으로 이를 부른다. `FormatSpec { format, example, mismatch? }` 추가. 계획 쪽 거부 코드·문구는 그대로다(문구의 양식 예시 문자열만 spec에서 만들며 결과 문자열은 같다).
2. `types.ts`: `RejectionCode`에 `'is-plan'` 추가(가이드 쪽 `mismatch`가 쓴다. 계획 변환기는 이 코드를 만들지 않는다).
3. 그 외(`table.ts`·`time-cell.ts`의 `splitTableRow`·`readRawTable`·`mapColumns`·`isRealDate`, `splitSourceLines`)는 수정 없이 재사용했다.
- 계획 변환기의 기존 시험은 고치지 않았고 모두 통과한다.

## 시험 (Claude 자체 검사)

| 항목 | 결과 |
|---|---|
| `tests/guide-import.test.ts` 신규 | 통과 |
| `tests/plan-import-*.test.ts` 기존 | 통과(합계 160건 = 신규 포함, 단독 실행) |
| 고정 자료 | 34항목, 지역 4·볼거리 15·먹거리 8·체험 4·코스 3, 오류 0, 기준일 2026-11-16 |
| 입력 변형 | 코드 블록·앞뒤 설명문·CRLF·BOM에서 같은 항목 목록 |
| 거부·오류 | 양식 줄 없음·두 번·다른 값, 계획 글(`is-plan`), 모르는 종류, 열 개수 불일치, 이름 빈 칸(오류 모두 수집), 필수 열 없음, 구역·표·항목 없음, 목적지 없음, 201줄, 글 상한 |
| 경고·읽기 | 중복 경고(지역이 다르면 중복 아님), 열 순서 바뀜, 모르는 열·구역·머리 줄 → 가져오지 않음, 기준일 형식 오류 경고, `\|` |
| typecheck · prettier · eslint | 통과 |
| 데이터 경계 4경로 diff | 0건 (`src/contracts`·`src/storage`·`src/transfer`·`src/repository.ts`) |

## 미검증·주의

- 전체 `vitest run`은 실행할 때마다 다른 파일(`ai-v2-job-retention`·`source-preflight`·`transfer` 등, 이번 변경과 무관)이 실패했다. `ai-v2-job-retention`은 단독 실행에서 14건 모두 통과해 부하로 인한 흔들림으로 보이나, 원인은 확인하지 않았다. CI에서 확인 필요.
- E2E는 이 단계에서 해당 없음(화면 없음).
- 계획 쪽 붙여넣기에 가이드 글이 들어왔을 때 "이것은 가이드입니다"로 안내하는 것(규격 §1 "반대도 같다")은 계획 변환기 동작을 바꾸므로 하지 않았다. C2에서 계획 쪽 화면을 고칠지 지시가 필요하다.
- 사용자 확인: 없음.
