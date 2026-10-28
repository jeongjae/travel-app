# Claude T-04 결과 · REG-01 하루 지역·야간 숙박 변환 수정

2026-10-28 · **구현·자동 검사·실데이터 사본 대조 완료 / Codex 검토 대기 / 사용자 확인 검토 준비** · 시작 `d2dbdc5`(main) · 브랜치 `codex/t04-regions` · 코드 커밋 `64a84e4`

## 요약

- `day.regionIds`=`checkin ≤ 날짜 ≤ checkout` 숙박 지역(이동일 출발·도착, 숙박 종료일의 종료 지역), `overnightRegionId`=`checkin ≤ 날짜 < checkout`의 마지막 숙박 지역(없으면 미설정). 야간 지역은 더 이상 `regionIds.length === 1`로 추정하지 않는다. `return` 센티널·종료 숙박 폴백·활동 장소 지역 합집합은 넣지 않았다.
- 구조: 계산을 `src/transfer/spfr-stays.ts`로 분리(검증 포함), `spfr-candidate.ts`(day 지역·지역 콘텐츠 선택)와 `spfr-pilot.ts`(야간 지역)가 사용. `plan.stays` 선택과 예약 `regionId`(F-2)는 그대로.
- 식별: 어댑터 `spfr-pilot-v3`·정규화 `3`(상수 `spfrPilotAdapterVersion`). 기존 값은 provenance 표시용 문자열이라 조사 결과 거부 로직이 없다. v2 패키지 읽기·가져오기·계약 v2는 그대로.
- 실제 43일 새 사본: 영향 **9일**(day 4·7·12·13·17·18·23·27 이동일, day 42 종료일)에서만 `regionIds`가 달라졌고 그 외 모든 계획·콘텐츠·첨부·현장 상태는 동일.
- 검사: `pnpm run check:deferred` exit 0(단위 187통과·1 skip, E2E 54, pilot), `python -m unittest discover -s tests/audit` 15 통과.
- 범위 밖 발견 1건(§5 F-4): 같은 패키지를 재가져오기해도 다일 계획이 `app-only` 계획 차이로 보인다(항목 정렬 불일치). 수정하지 않았다.
- 하지 않은 것: 사용자 DB/iPhone 가져오기, 기존 verified·지역 ZIP 변경, 예약 `regionId`(F-2), 지역 ZIP 재발행(F-3), main 병합·배포.

## 증거 색인

| 항목 | 위치 |
|---|---|
| 새 통합 검토 후보 | `local-data/phase2/t04-candidate/package/pilot.zip` (84,454,075바이트, SHA-256 `7b530968…de12`, 어댑터 `spfr-pilot-v3`/`3`, 원천 `35498ad…`) |
| 후보 독립 대조(원천 기대값) | `local-data/t04/candidate-audit.json` (실패 0, exit 0) |
| 후보 대 verified 비교 | `local-data/t04/candidate-vs-verified.json` |
| 로그 | `.cache/t03-logs/t04-normalize.log`, `t04-audit.log`, `t04-deferred.log`; 전체 회귀 `.cache/verification/2026-10-28T09-05-37-462Z/` |
| 기존(불변) | verified `d1832280…`(84,453,766), c10 `3e73d4bd…` — 해시 재확인 일치 |

후보 재생성: 입력은 기존 `continuous-10/full/input`(읽기 전용)과 `full-media-03`.
```
node scripts/normalize-spfr-pilot.mjs --extract local-data/phase2/continuous-10/full/input/extract.json \
  --audit local-data/phase2/continuous-10/full/input/audit.json --media-dir local-data/phase2/full-media-03 \
  --days 1,2,...,43 --trip-id spfr-full --lineage-id spfr-full --output-dir local-data/phase2/t04-candidate/package
python scripts/audit-spfr-package.py --source local-data/phase2/full-source/source \
  --package local-data/phase2/t04-candidate/package/pilot.zip --reference local-data/phase2/verified-package-20261026/pilot.zip --out local-data/t04/candidate-audit.json
```
(출력 폴더는 비어 있어야 하고 `local-data` 아래여야 한다. 사용자 프로필·iPhone에는 넣지 않았다.)

## 1. 변경과 assertion 정리

| 파일 | 변경 | 이유 |
|---|---|---|
| `src/transfer/spfr-stays.ts`(신규) | `stayRegionsForDay`, `validateSourceStays`, 버전 상수 | 원천 값 계산을 어댑터에서 분리. 키 없음·날짜 형식 오류·`checkout<checkin`은 `숙박 원천 값이 올바르지 않습니다.`로 거부 |
| `spfr-candidate.ts` | day 지역을 helper로 계산. 지역 콘텐츠 선택은 날에 닿는 숙박(체크아웃 포함)으로 확대 | 종료일 지역 `regionIds`가 지역 콘텐츠를 참조하므로 |
| `spfr-pilot.ts` | 야간 지역을 `date < checkout` 숙박에서 도출, report 어댑터 버전 상수화 | 출발 지역이 추가되어도 야간 지역이 사라지지 않게 |
| `scripts/normalize-spfr-pilot.mjs` | 패키지 어댑터/정규화 버전에 상수 사용 | 산출물 식별 |
| `tests/spfr-move-day.test.ts` | '현 동작 관찰' 블록과 `it.todo`를 계약 단언으로 교체: day-30 `[fiction, other]`/야간 other, day-31 `[other]`/미설정 | T-03 §3 판정 반영. todo 해소 |
| `tests/spfr-return-day.test.ts` | 종료일 `regionIds` 계약 `[]`→`['other']`(야간 미설정 유지), 관찰 블록을 장소 지역 무관 계약으로 승격(unknown·explicit 모두 `['other']`) | 원천 모델과 충돌하던 기대값. 보존 검사(활동·장소·숙박 수)는 그대로 |
| `tests/spfr-reg01-source-model.test.ts` | 환경변수 gate 제거, 독립 계산 대비 7개 회귀(이동일·종료일·전체·숙박 없는 날·재방문 지역·잘못된 값·지역 콘텐츠 존재) | 일반 `check`/CI에서 실행. 실제 원천을 읽지 않음 |
| `tests/spfr-stays.test.ts`(신규) | helper 단위 8개(순서·0박·범위 밖·잘못된 값) | 입력 계약 |
| `tests/spfr-reg01-reimport.test.ts`(신규) | 구(v2) 패키지 가져오기 유지, 새 패키지 재가져오기 계획 차이 검토, 사용자 계획 편집+새 변경 충돌 | §3 호환 |
| `scripts/audit-spfr-package.py` + 가상 테스트 | 어댑터 `spfr-pilot-v3` 이상은 원천 하루 모델과 다르면 실패(exit 1), v2 이하는 `legacy-arrival-only`로 표시하고 재해석하지 않음 | 구/신 의미 구분 |

규칙 요약(문서): `content-db-mapping.md` D-10, `decisions.md`(작성자 기술 판단, 사용자 정책 아님).

## 2. 가상 회귀 결과

- 이동일: 두 지역·야간 도착 / 종료일: 종료 지역·야간 없음 / 숙박 전혀 없음: `[]`·없음 / 같은 지역 재방문: 중복 없이 숙박 순서(`['other','fiction']`), 야간은 마지막 / 잘못된 숙박 값: 변환 거부.
- 같은 날짜 checkout·checkin, 다중·반복 숙박: 위 사례와 helper 단위 시험. 원천 순서가 날짜 순서가 아니어도 야간 지역은 원천 순서의 마지막.
- 호환(`spfr-reg01-reimport`): ① 구 패키지 계획은 자동으로 바뀌지 않음 ② 사용자 편집이 없으면 계획 단위 `source-only`(권고 원본), 적용 전 저장값 불변, 적용 후 계획 버전 2개·첫 버전 불변·새 버전 day-30 `[fiction,other]` ③ 사용자가 계획을 고친 뒤에는 `conflict`·권고 `defer`, 권고 그대로 적용해도 계획·현장 기록 불변. 무확인 적용 없음.
- ZIP 왕복·빈 DB 조회: `spfr-move-day`/`spfr-return-day`의 기존 패키지·repository 왕복 시험이 새 값으로 통과. 전체 백업/복원은 기존 전체 도메인 복원 시험(E2E/단위)이 같은 코드 경로이며 이번에 의미가 바뀐 필드만 추가 단언했다.

## 3. 실제 43일 사본

원천에서 독립 계산한 하루 지역·야간 지역(`audit-spfr-package.py`)과 새 후보를 43일 모두 대조: 불일치 0, 후보 실패 0(exit 0). 같은 도구로 구 verified를 보면 `legacy-arrival-only`로 표시되고 모델과 다른 날이 정확히 `[4,7,12,13,17,18,23,27,42]`다(T-03 영향 9일 재확인, 다른 날 차이 없음).

후보 대 verified: `plan_days` 9행의 `regionIds` 필드만 변경. `plan_items`267·`plan_legs`224·`plan_stays`9·`field_records`26·콘텐츠 head3,831 동일, 콘텐츠 payload·sourceRefs 변경 0, 첨부 594개 이름·바이트 동일, 커버리지(총35,667·표시35,134·메타533) 동일. 예상 메타 변경만: manifest 어댑터/정규화 버전(`v2/2`→`v3/3`), packageId, `recordedAt`(콘텐츠 3,831), 계획 `createdAt`, 여행 이름 기본값(`--trip-name` 미지정). 실제 날짜·예약·본문은 이 문서에 쓰지 않았다.

## 4. 한계·미검증

- 새 후보를 브라우저/DB에 가져오지 않았다(지시). 후보의 재가져오기 화면 동작은 가상 시험으로만 확인했다.
- 지역 ZIP 10개는 갱신하지 않았다(F-3). 이들은 여전히 v2·이동일 도착만 의미이며 audit 도구가 `legacy`로 구분한다.
- 사용자 확인·iPhone·실제 API·Fact65/권리·렌더러 미분류는 변경 없음. G2/G2′ 종료 아님.

## 5. 후속 후보

- **F-4(새 발견, 제품 결함 후보)**: `ContentRepository.get()`은 계획 항목을 `order`만으로 정렬하고(`content-repository.ts:265`) 재가져오기 계획 비교는 순서에 민감하다(`comparable.ts`). 하루마다 `order`가 0부터 다시 시작하는 다일 계획은 사용자 편집이 없고 **같은 패키지를 재가져오기해도 `plan: app-only` 차이가 생긴다**(이번 테스트 준비 중 프로브로 확인, 단일 프로브이며 실제 사본에서는 미실행). 가상 시험은 패키지를 저장소 정렬 순서로 만들어 이를 피했다(`spfr-reg01-reimport.test.ts` 주석). 수정 후보: 비교 전 항목을 `dayId`·`order`로 정규화. 별도 지시 필요.
- F-2(예약 `regionId` 배치 의존), F-3(지역 ZIP 재발행)은 그대로 열려 있다.
