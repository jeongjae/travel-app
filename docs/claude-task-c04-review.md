# C-04〔T-C5〕Codex 독립 검토

2026-10-30 · 코드 `f2b9d31`·`61629b5`, 보고 `4336961` · **지정 범위 독립 검토 통과 / 사용자 검토 준비**

## 결과

예정 외 기록의 장소 선택/없음, 새 장소 선행 저장과 입력 복귀, 추가식 정정 체인·당시 장소 조회가 연결됐다.
저장 guard는 새 장소의 활성/current revision 고정과 다른 여행 거부, 정정의 계획/활동 연결·sourceRefs 보존을 검사한다.
actualPayload가 편집하지 않은 time.end·정밀도/offset/instant·기존 장소·당시 맥락을 유지하고,
폼 ID/같은 입력의 requestId를 재사용하는 경로를 검토했다. 기록 저장은 계획 버전을 만들거나 기존 기록을 덮어쓰지 않는다.
새 장소 작성과 실제 기록은 별도 저장이며, 기존 정정에는 새 장소 선행 작성 버튼을 노출하지 않아 원본 연결을 잃는 복귀를 만들지 않는다.

## 독립 검사

| 검사 | 결과 |
|---|---|
| `pnpm exec vitest run tests/field-records.test.ts tests/content-repository.test.ts tests/authoring-plan.test.ts` | 3파일·22검사 통과, exit 0, 13:25:19, 3.46초 |
| `pnpm run build` | 타입/빌드/PWA 생성 통과, exit 0 |
| `pnpm run test:e2e tests/e2e/field-records.spec.ts` | desktop 6·mobile 6, 총 12검사 통과, exit 0, 49.7초 |

단위에서 잘못된/비활성/다른 여행 장소·stale·중복 정정·replay·당시 맥락/무관한 값 보존·계획 불변을 확인했다.
화면에서 장소 있음/없음, 새 장소 저장/취소 후 입력 복귀, 2회 정정·이름/본문 변경 뒤 당시 내용,
계획 항목 제거 후 기록 보존·메모 조회·두 탭 충돌/입력 보존·오프라인·전체 백업/빈 공간 복원·여행 격리를 확인했다.

UI는 가상 입력·별도 브라우저 저장소, 프로젝트 Playwright와 로컬 preview의 허용된 실행 경로를 사용했다.
Browser plugin/browser 스킬 미제공으로 기존 회귀 도구를 사용했다. 모바일은 Pixel 7 에뮬레이션으로 iPhone 확인이 아니다.
Claude 전체 검사 `.cache/verification/2026-10-30T03-31-55-674Z/results.json`에서 check/E2E/pilot exit 0을 확인했다.
전체 회귀·원격 CI를 이번 독립 검사로 보고하지 않는다. 사용자 DB·실제 ZIP·main·배포·API 변경 없음.

## 잔여·다음

필수 보완 요청은 없다. 종료 시각 편집 UI 없음(기존 값 보존), 원문/정정본의 시각이 다를 때 시간 그룹이 나뉨은
Claude 보고의 표시/편의 한계로 [후속 목록](change-log.md)에 남긴다. 시간 범위의 모든 경계를 새로 검증한 것은 아니며 CL-08은 유지한다.
‘기록 당시 내용’이 무관한 첫 장소를 열던 동작은 직접/계획 연결 장소만 열도록 수정됐다.

다음은 C-05〔T-C6〕날짜별 당시 계획·실제·정정·변경 이유를 이어 읽는 회고 조회다.
사용자 상태는 **검토 준비**이며 C 전체·B/G2/G2′·실기기·공개 배포·실제 사본 적용은 각각 별도 대기다.
