# T-E3-2 결과 — 기존 장소 내용 글로 고치기 + 작은 수정

- 브랜치 `codex/e03-2-place-edit`(main 9dbb1e4 기준). 데이터 경계 4경로(`contracts`·`storage`·`transfer`·`repository.ts`) 변경 **0건**. 기존 명령 `UpdateContent`·`ChangePlan`·`CreateContentBatch`만 사용.

## A. 기존 장소 수정

- `src/plan-update/places.ts`: ID 있는 장소 줄에서 지역·설명·영업시간·링크가 현재와 다르면 `PlaceEdit` 후보(전·후, 저장할 값, 후보 시점의 기준값). 이름 칸은 보지 않고 이름만 다른 줄은 `existingLines.nameIgnored`로 센다(이전 `changed`는 이 의미로 바뀜). 빈 칸=변경 없음, `(비움)`=지움, 영업시간·지역은 설명 끝 표시나 `regionIds`(지역 이름이 맞으면 연결·표시 제거, 아니면 `[지역: …]`). 링크 http(s)만(가져오기 검사가 이미 비우므로 후보가 되지 않음). 알 수 없는 ID는 기존처럼 안내만.
- `src/content/PlaceStage.tsx`: `PlaceEditStage` — "기존 장소 수정 n건", 줄마다 체크(기본 해제), 칸별 전→후, **장소 n건 수정** 단추. 새 장소 만들기와 따로 승인. 저장 직전 장소를 다시 읽어 기준값이 달라졌으면 그 줄에서 멈춤(이미 저장한 것은 남음을 안내). 장소마다 `UpdateContent` 1회.
- `src/content/PlanPaste.tsx`: 만들기·수정이 올린 revision 구간을 하나로 이어(`bridgeOf`) 같은 글의 일정 변경이 이어서 적용된다. 그사이 다른 저장이 끼면 기존처럼 막힌다.
- `request-text.ts`: 빈 칸 채우기 문장 → "ID가 있는 장소 줄은 비어 있는 칸만 채우고 이름은 바꾸지 말아 줘." 관련 시험 문구 갱신.
- 왕복(내보내기→그대로 가져오기): 변경 0건·장소 수정 후보 0건(단위·E2E 확인).

## B. 작은 수정

- CL-48: `Recovery.tsx`에서 복원 오류 중 `not recognized`만 "전체 백업 파일이 아닙니다. travel-app-backup-…zip 파일을 고르세요."로 바꿔 보임(판정 로직 불변, 화면 쪽 변경).
- `docs/phase-4-operations.md` D절 문구 갱신.

## 시험

- 단위: 칸별 판정, `(비움)`, 이름 칸 무시, 표시 붙이기·떼기, 지역 연결, 알 수 없는 ID, 왕복 0건, 장소 본문 스키마 통과; 실제 저장소에서 `UpdateContent`+revision 상승+기준 연결 허용/미연결 시 차단. 일부만 고르기·기준 연결은 E2E.
- E2E(plan-places.spec, desktop·mobile): 설명을 고쳐 고르면 반영되고 같은 글의 메모 변경도 이어서 적용 / 고르지 않으면 그대로.

## 검증 상태

| | 결과 |
|---|---|
| `pnpm run check` | 통과(로컬) |
| 로컬 `test:e2e:all` | **미실행** — 4173 포트를 다른 node 프로세스가 점유(내가 끌 권한이 거부됨). 지시대로 CI로 판정 |
| CI(push 후) | 통과: static, chromium 1/3·2/3·3/3, webkit |
| 사용자 화면 확인 | 확인 대기 |

## 캡처(가상 여행, 별도 포트 4174 빌드)

`docs/design/e03-2/`: `place-edit-select-{pc,m}.png`(수정 선택), `place-edit-done-{pc,m}.png`(수정 완료), `restore-not-backup-pc.png`(백업 아님 안내).

## 미확인

실제 iPhone, 실제 크기 장소 수가 많은 경우의 사용성, 지역 이름이 여러 개 연결된 장소(첫 연결만 비교).
