# T-04 검토 및 검증 기록

2026-10-28 · 대상 코드 `64a84e4`, 보고 `6482020`(브랜치 `codex/t04-regions`, 시작 main `d2dbdc5`) · **구현 검토 통과 / main 병합·사본 적용·사용자 확인 대기** · 10/28 검토 실행: Claude 세션 · 10/29 Codex 독립 검토 추가

- 위험 diff를 읽었다. `spfr-stays.ts`의 `regionIds`(checkin≤날짜≤checkout)·`overnightRegionId`(checkin≤날짜<checkout의 마지막)는 지시서 C안과 일치한다.
  `return` 센티널·종료 숙박 폴백·활동 장소 지역 합집합은 없다. `regionIds.length === 1` 추정은 제거됐다.
- 화면 영향: `src/content/*`는 `day.regionIds`/`overnightRegionId`를 읽지 않는다(`ContentApp.tsx:601`은 `place.regionIds`). UI 변경 없음을 확인했다.
- 기대값 변경: `spfr-move-day`(day-30 `[fiction,other]`/야간 other, day-31 `[other]`/미설정)·`spfr-return-day`(`[]`→`['other']`)는 원천 모델에 맞춘 승격이며 보존 검사(활동·장소·숙박 수)는 그대로다. todo 1건 해소.
- `spfr-reg01-source-model`·`spfr-stays`·`spfr-reg01-reimport`는 `local-data`·환경변수 gate를 읽지 않는다(grep 확인).
- 문서: `decisions.md`·`content-db-mapping.md` D-10의 갱신은 작성자 기술 판단으로 표기됐다. 사용자 정책으로 승격하지 않았다.

## 10/28 Claude 추가 검사(독립 Codex 검사 아님)

| 검사 | 결과 | 증거 |
|---|---|---|
| `python -m unittest discover -s tests/audit -q` | **15 통과**(1.449초) | 이 세션 셸(PC의 Linux VM, Python 3.10) |
| 후보 ZIP 해시·크기 | `7b530968…de12`, 84,454,075바이트 — 보고와 일치 | `sha256sum` |
| verified ZIP 해시·크기 | `d1832280…bbe0`, 84,453,766바이트 — 불변 | `sha256sum` |
| `audit-spfr-package.py` 후보(v3) 추가 실행 | failures 0, exit 0. `reg01Check` `source-day-model` mismatches 0. versusReference: `plan_days` 9/9, `plan_items`·`plan_legs` 0, 콘텐츠 payload 차이 0 | `.cache/t04-codex/candidate-audit.json`·`.log` |
| 같은 도구로 verified(v2) | failures 0, exit 0. `legacy-arrival-only`로 표시되고 재해석 없음. 모델과 다른 날은 정확히 `[4,7,12,13,17,18,23,27,42]` | `.cache/t04-codex/verified-audit.json`·`.log` |
| vitest/E2E | **10/28 검토 셸에서 미실행**(이 셸은 Windows `node_modules`의 네이티브 바이너리를 쓸 수 없음). Claude 로그 `.cache/verification/2026-10-28T09-05-37-462Z/`의 check·test:e2e·check:pilot exit 0, 단위 187 통과·1 skip, E2E 54를 검토했다 | 독립 재실행 아님 |

실제 사용자 DB·iPhone·verified/지역 ZIP·원본은 변경하지 않았다. 후보는 검토용으로 남긴다.

## 10/29 Codex 독립 검토

앞 절의 10/28 실행은 Claude 자체 검토다. 당시 ‘Codex 역할/독립 검사’ 표기를 바로잡으며 실행 결과 자체는 과거 증거로 보존한다.
Codex는 현재 소스의 지역/숙박 분리·비교 배열·저장소 조회를 읽고 다음 대상 검사를 직접 실행했다.

`pnpm exec vitest run tests/spfr-stays.test.ts tests/spfr-reg01-source-model.test.ts tests/spfr-reg01-reimport.test.ts tests/spfr-return-day.test.ts tests/spfr-move-day.test.ts`

결과: **5개 파일·30개 검사 통과, exit 0**(2026-10-29 09:56, 4.05초). 전체 회귀·Python·실제 ZIP 대조는 이번 Codex 실행에서 반복하지 않았다.
T-04 지역/야간 숙박 분리는 대상 검토 통과다. F-4는 소스 구조상 타당한 결함 후보이며 이번에 직접 재현한 결과는 아니다.
[T-05](claude-task-05-reimport-order.md)에서 실패를 먼저 재현하고 수정한다. 새 후보 적용·main 병합·배포·사용자 확인은 대기다.

## 관찰 1 · 부분 패키지의 `plan.stays` 선택 조건 (비차단, F-3 범위)

`spfr-pilot.ts`의 숙박 원천 표시와 `plan.stays` 선택은 여전히 `checkin ≤ 날짜 < checkout`이다. 전체 43일에서는 모든 숙박이 포함되어 `plan_stays` 9행이 동일하므로 이번 결과에 영향이 없다.
그러나 선택 범위의 첫날이 어떤 숙박의 checkout일인 **부분(지역) 패키지**에서는 `day.regionIds`가 참조하는 지역의 숙박 행이 `plan_stays`에 없다.
지역 ZIP 재발행(F-3) 때 선택 조건을 `≤ checkout`으로 맞출지 함께 정한다. 지금 수정하지 않는다.

## 판정 · F-2/F-3/F-4 · 사본 적용

- **F-4(재가져오기 `app-only` 오탐)**는 제품 결함 후보로 인정한다. `ContentRepository.get()`이 항목을 `order`만으로 정렬하고 비교가 순서에 민감한 구조라 같은 패키지도 차이로 보인다.
  C단계의 재가져오기 보존 검사와 새 사본 적용의 전제이므로 **T-05로 별도 지시**한다(권고: 비교 전 `dayId`·`order` 정규화, 저장소 정렬도 같은 키). 실제 사본에서 재현은 아직 1회 프로브뿐이다.
- F-2(예약 `regionId` 배치 의존)·F-3(지역 ZIP 재발행)은 B 범위에서 계속 추적한다. 관찰 1은 F-3에 붙인다.
- **새 43일 사본(t04-candidate)의 사용자 DB 적용**은 사용자 결정이다. 권고: F-4 수정 전에는 적용하지 않고 verified 사본을 유지한다. 적용 시에는 재가져오기 경로(계획 차이 검토)만 쓴다.
- **main 병합**은 `src/**` 변경이라 Pages 재배포를 유발한다(T-02 게이트는 적용됨). 사용자가 iPhone 복원 검증 중이면 병합 시점을 정한 뒤 반영한다. 사용자 승인 전 병합하지 않는다.

T-04 지시 범위의 구현·회귀·사본 대조는 통과다. G2/G2′·전체 이행·사용자 화면 확인은 종료하지 않는다.
