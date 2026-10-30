# C-03〔T-C4〕Codex 독립 검토

2026-10-30 · 코드 `8e5d04e`·`e4198f9`, 보고 `ad116dd` · **지정 범위 독립 검토 통과 / 사용자 검토 준비**

## 결과

지역 가이드 생성·지역 소유 연결, 여행 공통 preparation/trip 가이드, 제목/섹션 수정과 지역/장소 기본정보 수정이 연결됐다.
읽기 목록은 수동 가이드를 노출하고 기존 가져온 준비 문서 분류를 유지한다. 새 가이드에 원천 ID를 흉내 내는 우회는 없다.
UpdateContent guard와 편집 폼의 이전 payload 보존, expectedDomainRevision/expectedRevisionId·고정 요청 재시도 경로를 검토했다.
기존 지역/장소 소유 연결·본문 구조/Fact/첨부를 제목·기본정보 수정으로 바꾸지 않도록 제한하며 C-01 연결 보호를 유지한다.

## 독립 검사

| 검사 | 결과 |
|---|---|
| `pnpm exec vitest run tests/guide-authoring.test.ts tests/guide-rules.test.ts tests/content-batch.test.ts tests/authoring-plan.test.ts` | 4파일·40검사 통과, exit 0, 11:59:02, 2.90초 |
| `pnpm run build` | 타입/빌드/PWA 생성 통과, exit 0 |
| `pnpm run test:e2e tests/e2e/guides.spec.ts` | desktop 5·mobile 5, 총 10검사 통과, exit 0, 45.0초 |

단위 검사에서 가이드/소유자 원자 저장·거부/롤백·stale/replay·본문 Fact 바인딩/출처 보존·과거 context 불변을 확인했다.
화면 검사에서 지역의 여러 가이드, 준비 화면의 여행 가이드, 기본정보→검색/상세/연결 일정 재조회와 당시 값,
입력 오류 보존·오프라인 작성/수정/재실행·두 여행 전체 백업/빈 브라우저 복원을 확인했다.

프로젝트 Playwright와 가상 입력·별도 브라우저 저장소만 사용했다. Browser plugin/browser 스킬 미제공으로 기존 회귀 도구를 사용했다.
로컬 preview/브라우저는 허용된 실행 경로에서 시작했다. 모바일은 Pixel 7 에뮬레이션으로 실제 iPhone 확인이 아니다.
Claude 전체 검사 `.cache/verification/2026-10-30T02-02-53-850Z/results.json`의 check/E2E/pilot exit 0을 확인했다.
전체 회귀·원격 CI를 이번에 독립 반복/확인하지 않았다. 사용자 DB·실제 ZIP·main·배포·API 변경은 없다.

## 잔여·다음

새로운 필수 보완 요청은 없다. CL-06 기본정보 UI는 해결, CL-07의 지역/여행 가이드 UI는 해결이며 세부 relation 선택은 남는다.
Claude 보고의 기존 가이드 섹션 추가/삭제/정렬 미지원, 이름 변경 후 가이드 제목 비동기, 과거 활동 링크의 현재 이름 라벨은
편의/표시 후속 항목으로 [후속 목록](change-log.md)에 기록한다. 저장 손실/소유 연결 훼손으로 관찰한 것은 아니다.

작성 가이드 식별에 sourceRefs 유무를 쓰는 현재 기술 선택을 확인했다. 출처를 추가하는 기능을 도입할 때 분류/편집 가능성 회귀를 재검토해야 한다.
제목/언어와 섹션 편집의 현재 제한을 사용자 정책으로 확정하지 않는다. 사용자 확인 상태는 **검토 준비**다.
다음은 C-04〔T-C5〕현장 기록·정정이며, T-C6 회고는 T-C5 뒤 진행한다. C 전체·B/G2/G2′·실기기 확인은 미완료를 유지한다.
