# Claude C-01 R1 결과 · 기존 소유 연결 보존

2026-10-29 · **구현·자체 검사 완료 / Codex 재검토 대기 / 사용자 확인 검토 준비** · 시작 `245397c` · 브랜치 `codex/c01-authoring`

## 원인과 수정

- 원인(Codex P2): `CreateContentBatch`는 이번 배치가 만든·갱신한 행만 검사했다. 기존 P→G1(G1.owner=P)이 유효한 상태에서 새 G2를 만들며 P.guideId를 G2로 바꾸면, 활성 G1이 owner=P로 남지만 P가 G1을 가리키지 않아 양방향 관계가 깨졌다. 지역의 기존 `guideIds` 제거·교체도 같다.
- 수정(`src/storage/content-batch.ts` 한 파일): 소유자 갱신마다 이전 revision과 새 revision을 비교해, 새 revision에서 빠진 연결(장소의 이전 `guideId`, 지역의 제거된 `guideIds`)이 여전히 활성 가이드면 `CONFLICT`로 거부한다. 교체·삭제 명령이나 UI는 만들지 않았고, 기존 가이드·과거 revision·계획 pin은 삭제·비활성화하지 않는다. 이 배치가 건드리지 않은 기존 불일치는 정리하지 않는다. 전체 저장은 기존 트랜잭션이라 거부 시 데이터·head·revision·영수증이 모두 불변이다.

## 재현 전후 (`tests/content-batch.test.ts`, 3개 추가)

| 시험 | 수정 전 | 수정 후 |
|---|---|---|
| 장소 P→G1을 새 G2로 바꾸는 갱신 거부, 상태 불변 (Codex 재현 정리) | 실패(저장됨) | 통과 |
| 지역 가이드를 빼거나 바꾸는 갱신 거부·불변, 유지하며 하나 더하는 갱신 허용, 이전 revision 보존 | 실패 | 통과 |
| 장소의 다른 필드만 바꾸는 갱신은 기존 본문 연결을 유지한 채 허용 | 통과 | 통과 |

기존 14개(원자 생성·거부 7종·stale·비활성·replay·롤백·격리)는 그대로 통과(총 17).

## 검사

| 명령 | 결과 |
|---|---|
| `vitest tests/content-batch.test.ts` | 17 통과 |
| `pnpm run check:deferred` | exit 0, `.cache/verification/2026-10-29T08-18-11-701Z/`, 로그 `.cache/t03-logs/c01r1-deferred.log` |

Codex의 오프라인 시험을 `tests/e2e/offline-authoring.spec.ts`로 보존했다(desktop·mobile, 위 전체 검사에 포함되어 통과). 이름: `Codex 오프라인: 새 여행→지역·장소 작성→일정 연결·순서 변경→재실행 뒤에도 같은 내용을 읽는다`.

## 미검증·범위

- 원격 CI는 push 후 확인. 사용자 DB·iPhone·main·배포·API 없음. 시간대 공용 스키마·편집 UI·C 후속은 범위 밖.
- 새 가이드를 한 번에 교체하려면 별도 교체 명령이 필요하다(이번에는 거부만 한다).
