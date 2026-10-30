# C-06〔T-C7〕Codex 독립 검토

2026-10-30 · 시험 `c73f50a`, 대조 스크립트 `b35875f`, 보고 `49831cc` · **통합 검증 검토 통과 / 표시 CL-16 후속 / 사용자 검토 준비**

## 결과

가져온 A(계보 있음)와 앱 작성 B를 한 검토 공간에 두고 전체 백업→빈 공간 복원, 재가져오기 보존·선택 적용,
회고→적용 당시 고정 근거 본문→복귀를 묶은 통합 E2E 3개(desktop·mobile 각 3)를 검토했다. 제품 코드(`src/`) 변경은 없다.
지시서 §2~§4의 요구 항목이 시나리오-증거표에 모두 대응되고, 기존 모델 시험 인용(stale/replay/부분 실패·배열 순서·T-05 구 baseline)은
새 시험으로 대체한 것처럼 표기하지 않았다. 필수 결함은 없다.

소스에서 확인한 판정 근거:
- 비교 대상은 `src/storage/schema.ts`의 `storesV2` 20개 store 중 도메인 15개 전부다. 제외 5개는 `asset_blobs`(별도로 OPFS 바이트·sha256·크기 비교)와 복원 작업 메타 4개(`transfer_jobs`·`staged_rows`·`snapshot_jobs`·`workspace_meta`)뿐이다.
- 행 비교는 `spaceId` 한 필드만 제거하고 나머지를 `canonicalJson` 전체 비교한다. 광범위 정규화로 누락을 숨기지 않는다. 규모 하한(기록≥5·계획≥6·변경안 revision≥4·receipt>15·첨부≥2)으로 빈 비교를 막는다.
- B에 `import_heads`·`import_packages` 행이 없음을 단언해 가짜 lineage를 넣지 않았음을 확인한다.

## 독립 검사

PC VM의 `node_modules`는 Windows 심볼릭 링크·네이티브 바이너리라 Linux에서 실행되지 않았다. 공개 저장소 `codex/c06-integration`의
같은 커밋 `49831cc`를 Claude 클라우드 작업공간에 받아 `pnpm install --frozen-lockfile`(pnpm 12.14.0, Node 22)로 재현했다.

| 검사 | 결과 |
|---|---|
| `pnpm run build`(타입·빌드·PWA) | 통과, exit 0 |
| `pnpm exec vitest run` 전체 | 37파일 중 32 통과·1 skip, 6검사 실패 → 원인은 프로젝트 `.venv` 없음(`spawnSync .venv/bin/python ENOENT`) |
| `.venv` 생성(`requirements-extract.txt`) 후 해당 4파일 재실행 | 4파일·9검사 통과, exit 0 → 단위 전체 306 통과·1 skip |
| `tests/e2e/c06-integration.spec.ts` (desktop 3·mobile 3) 원본 그대로 | 재가져오기·근거 4개 통과, **복원 시험 2개 실패** — 아래 CL-16 |
| 같은 시험, 백업 파일을 경로 대신 버퍼로 전달(임시 수정, 되돌림) | desktop·mobile 복원 시험 2개 통과 → 6/6 |
| 실제 사본 대조 산출물 | `local-data/c06-real/run-3/result.json` 확인: 수량 일치·첨부 594개·`sameDomainRows`·`sameAssetBytesAndHashes`·`inputUnchanged` true. 입력 ZIP 현재 sha256 `d1832280…bbe0`·크기 84,453,766·수정 시각 10/26 그대로, 백업 sha256 `4d4fd927…4433` 보고와 일치 |

브라우저는 사전 설치 Chromium 1243을 프로젝트 Playwright 1.64.1의 기대 리비전(1248)에 연결해 사용했다. 리비전이 다르므로 아래 실패는
**환경에서 드러난 제품 동작**으로 분류하며, Claude의 PC 실행(1248, `.cache/c06-logs/e2e-11.log`)의 통과를 부정하지 않는다.
모바일은 Pixel 7 에뮬레이션이다. 사용자 DB·실제 ZIP·main·배포·API 변경 없음. 실제 사본 스크립트는 재실행하지 않았다(산출물 대조만).

## CL-16 · 파일 선택 취소가 대화상자 전체를 닫음(이번 수용 비차단)

재현: 복원 시험에서 경로 기반 `setInputFiles` 직후 대화상자가 150ms 안에 오류·이동 없이 사라졌다. 문서 이벤트를 기록하니
`cancel:INPUT:file:bubbles=true` 하나만 발생했다. 공통 `Modal`(`src/App.tsx`)의 `onCancel`이 `event.target`을 구분하지 않고
`onClose()`를 호출해, `<dialog>`로 거품 올라온 **파일 입력의 cancel**을 Esc 닫기로 처리한다.

영향: Chrome 계열은 사용자가 파일 선택 창을 취소할 때 파일 입력에서 거품 `cancel`을 발생시킨다. 따라서 `저장소·백업` 대화상자(`Recovery.tsx`
파일 입력 2곳)에서 백업 파일 선택을 취소하면 대화상자 전체가 닫힌다. 데이터 쓰기·복원 결과는 바뀌지 않는다(쓰기 전 단계). 실제 사용자 조작의
관찰이 아니라 원인 경로의 소스·이벤트 확인이다.

처리: 사용자 후속 원칙에 따라 [목록](change-log.md)에 남긴다. 수정은 `onCancel`에서 `event.target === event.currentTarget`일 때만 닫는 1줄 변경과
"파일 선택 취소 후 대화상자 유지" 회귀 1개다. 다음 C 수정 지시 또는 T-C8 결함 처리 때 함께 발행한다.
C-06 시험은 경로 업로드에 의존하므로 수정 전까지 다른 브라우저 리비전에서 같은 증상이 재발할 수 있다. 수정 시 시험은 그대로 둔다.

## 남은 증거·다음

- 경계 유지: T-C7 가상 통합 검증·실제 사본 1회 대조 검토 통과. T-04 후보 ZIP 대조·실제 사본 위 재가져오기·실제 화면(정정·회고) 확인은 미실행으로 남는다.
- 사용자 검토 준비: 결과 문서의 "사용자 확인 동작"(가상 입력)으로 두 여행 통합·빈 공간 복원·근거 복귀를 직접 볼 수 있다.
- 다음: **T-C8 사용자 시나리오**(별도 여행 준비→현장→회고→복원, G-01/02/08 증거표). 대상은 10/30 사용자 결정(삿포로 가상 여행)으로 [C-07 지시](claude-task-c07-scenario.md)에 반영했다.
- T-C7 통과를 C 전체·B/G2/G2′·배포·실제 사본 적용 승인으로 확대하지 않는다.
