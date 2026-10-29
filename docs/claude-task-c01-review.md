# C-01 Codex 독립 검토

2026-10-29 · 코드 `b49bd16`·`8089c8f`·`143717a`·`3e1c4c9`, 보고 `f371ef5` · **R1 보완 후 C-01 독립 검토 통과 / 사용자 검토 준비**

최초 검토의 보완 요청 이력은 보존한다. 최종 판정은 마지막 R1 절을 따른다.

## 확인한 산출물

새 여행 날짜 생성→지역/장소와 본문 원자 작성→다른 화면 재조회→일정 연결/순서 수정→재실행,
두 여행 격리·입력 오류 보존·전체 백업/빈 브라우저 복원을 desktop/mobile에서 직접 검사했다.
기존 5개 탐색·과거 계획/실제 기록 보존·여행/콘텐츠 revision·receipt/트랜잭션 사용은 적절하다.
새 명령 범위도 region/place/guide 생성과 소유자 갱신으로 제한돼 있다.

## 독립 실행

| 검사 | 결과 |
|---|---|
| `pnpm exec vitest run tests/content-batch.test.ts tests/authoring-plan.test.ts tests/trip-factory.test.ts tests/reimport-legacy-baseline.test.ts` | 4파일·35검사 통과, exit 0, 16:43:02, 5.29초 |
| `pnpm run build` | 타입·빌드·PWA 생성 통과, exit 0 |
| `pnpm run test:e2e tests/e2e/authoring.spec.ts tests/e2e/zz-codex-c01-offline.spec.ts` | desktop/mobile 기존 6개+추가 오프라인 2개, 8검사 통과, exit 0, 31.4초 |
| 기존 활성 본문의 소유 연결 변경 추가 검사 | 1개 실패, exit 1, 16:43:45 |

추가 오프라인 검사는 앱을 연 뒤 통신을 끊고 지역/장소 작성·일정 연결·순서 수정·reload·본문 재조회를 수행했다.
임시 검사는 `.cache/c01-codex/`로 옮겨 보존했으며 제품/정식 회귀 코드는 수정하지 않았다.
UI는 프로젝트 Playwright와 로컬 preview를 허용된 실행 환경에서 사용했다. Browser plugin/browser 스킬 미제공,
개인 프로필/실자료 사용 없음. 모바일은 Pixel 7 에뮬레이션이며 iPhone 확인이 아니다.

Claude 전체 검사 results.json의 check/E2E/pilot exit 0을 확인했다. 전체 회귀·원격 CI는 독립 반복하지 않았다.
CI 1차 기존 화면 대기 실패→재실행 통과는 Claude 보고이며 원인 미규명이다. ‘새 코드와 무관’으로 확정하지 않는다.

## P2 · 기존 활성 가이드의 역방향 소유 연결 누락

`src/storage/content-batch.ts`는 touched 행만 확인한다. 기존 장소 P→G1과 G1.owner=P가 유효한 상태에서
새 G2(owner=P)를 만들며 updateOwners로 P.guideId를 G2로 바꾸면 저장을 허용한다.
G1은 여전히 활성이고 owner=P지만 현재 P는 G1을 가리키지 않으므로 최종 양방향 관계가 깨진다.
지역의 기존 guideIds 제거도 같은 영향 범위다. 글이 삭제된 것을 관찰한 것은 아니며 새 명령의 최종 참조 그래프 검증 누락이다.

가상 재현은 기존 content-batch fixture를 재사용했다. 기대는 명시적 처리 없는 기존 활성 연결 단절 거부·전체 상태 불변,
실제는 applied/domainRevision 증가다. `.cache/c01-codex/owner-link-repro.test.ts`의 `Codex:` 시험으로 보존했다.
현재 신규 작성 UI는 기존 본문 교체를 노출하지 않지만 C-01의 소유자 갱신 계약에 포함되므로 [R1](claude-task-c01-r1.md)로 좁혀 보완한다.

## 후속·한계

편집 메타데이터 UI·시간대 검증 공백·CI 대기는 [후속 목록](change-log.md)에 영향/재개 조건을 기록했다.
이 보완에서 전체 편집기·시간대 구조·AI·지역 ZIP을 확장하지 않는다. C-01은 소유 관계 보완 후 최종 수용한다.
사용자 화면 확인은 검토 준비이며 B/G2/G2′·실기기·배포·실자료 적용은 여전히 별도 대기다.

## R1 최종 검토 · 2026-10-29

대상 코드 `f3f7fef`, 오프라인 정식 회귀 `cad458f`, 결과 `6cec79d` · **C-01 지정 범위 독립 검토 통과**.

- 변경 diff에서 기존 장소 guideId·지역 guideIds 제거/교체가 활성 가이드의 소유 연결을 끊으면 CONFLICT로 거부함을 확인했다.
  새 교체/삭제 기능이나 기존 데이터 일괄 정리는 추가하지 않았으며 과거 콘텐츠/계획 pin은 보존한다.
- Codex 직접 실행: `pnpm exec vitest run tests/content-batch.test.ts tests/authoring-plan.test.ts`
  → **2파일·21검사 통과**, exit 0, 17:28:19, 1.34초.
  장소 본문 교체·지역 가이드 제거/교체 거부와 전체 상태 불변, 연결 유지/추가 정상 저장을 확인했다.
- 기존 검토에서 통과한 주요 작성·격리·복원·오프라인 UI 8개 증거는 해당 코드 시점의 증거로 유지한다.
  R1은 제품 UI 변경 없이 저장 경계만 보완했다. 이번에는 UI/전체 회귀를 독립 반복하지 않았다.
- Claude R1 전체 검사 `.cache/verification/2026-10-29T08-18-11-701Z/results.json`의 check/E2E/pilot exit 0을 확인했다.
  임시 오프라인 시험이 `tests/e2e/offline-authoring.spec.ts`의 정식 desktop/mobile 회귀로 보존됐음을 확인했다.
- 원격 CI·iPhone·실자료 적용은 이번 독립 검증 범위 밖이다. 공개 배포나 사용자 데이터 변경은 하지 않았다.

저장 관계 보완 요청은 해결됐고 추가 수정 지시는 없다. 경미한 잔여와 시간대 선행 검증은 후속 목록에 남긴다.
C-01 사용자 상태는 **검토 준비**다. 전체 C 완료나 B/G2/G2′·실기기 확인 완료로 확대하지 않는다.
다음 기능은 C 개발계획 T-C3.2(숙박·이동 최소 편집)이며 공용 시간대 검증(CL-05)을 함께 처리해야 한다.
