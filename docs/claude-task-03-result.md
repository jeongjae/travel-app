# Claude T-03 결과 · 이행 잔여 원천·의미·지역 ZIP 대조

2026-10-28 · **구현·자동 검사·실데이터 대조 완료(읽기 전용) / Codex 검토 대기 / 사용자 확인 검토 준비** · 제품 코드·데이터 변경 없음 · G2/G2′ 종료 아님

## 요약

- 시작 `898e927`(main) · 브랜치 `codex/t03-source-audit`. 읽기 도구 2개(`scripts/audit-spfr-source.py`, `scripts/audit-spfr-package.py`)와 환경변수 게이트 재현 테스트 1개(`tests/spfr-reg01-source-model.test.ts`)를 추가했다. 일반 `check`/CI는 개인 자료를 탐색하지 않는다(명시 인자 필요).
- 지역별 ZIP 10개·구 통합본·최종 통합본 2개(총 13개)를 원천에서 독립 계산한 기대값과 대조했다. 컨테이너·일차/활동/이동·숙박·참조·첨부·카드 필드 **실패 0**. 도구가 훼손을 잡는지 변조 사본으로 확인했다(실패 5건 탐지).
- **REG-01: 원천 자신의 하루 모델이 확인됐다.** SP-FR `build/model.py::load_days`는 `regions = checkin ≤ 날짜 ≤ checkout`(이동일은 출발·도착 둘), `region = 그날 밤 자는 곳`이다. 변환은 `날짜 < checkout`만 써서 이동일 출발 지역과 숙박 종료일 지역이 `day.regionIds`에서 빠진다(43일 중 9일). 가상 재현 2건 실패. 권고는 §3, 적용은 하지 않았다.
- 이전 보고와 다른 점 3건: ① 지역별 ZIP은 최종 통합본보다 오래된 시점(콘텐츠 -52: 실행 지도 첨부 24·근거 24·가이드 4 없음) ② 지역 ZIP 지도 대상 89개에 좌표 없음 ③ 19개 Paris 예약의 `regionId`가 단일 지역 배치에서만 부여됨(§2).
- 미처리 후보 목록은 §1(렌더러·미선택 원천), 다음 수정 지시 초안은 §4(최대 3건).
- 미검증: Fact65·권리, 렌더러 238개 문구 전수 수작업 분류, 실기기, 브라우저 복원(같은 코드라 반복 안 함).

## 증거 색인(Git 제외 로컬)

| 항목 | 위치 |
|---|---|
| 원천 범위·미선택 70파일(해시 포함) | `local-data/t03/scope.json` |
| 렌더러·빌드 코드 문구 대 패키지 | `local-data/t03/renderer.json` |
| 13개 패키지 독립 대조·REG-01 행 | `local-data/t03/packages.json` |
| 변조 탐지 확인 | `local-data/t03/mutation-check.json` |
| 로그 | `.cache/t03-logs/` (`reg01-repro.log`, `check.log`) |

공개 문서에는 일차 번호·수량·ID만 쓴다. 값·위치·날짜는 위 JSON에 있다.

사람이 실행할 명령(모두 읽기 전용, 출력은 원천 밖):

```
python scripts/audit-spfr-source.py scope --source <원천사본> --selection <selection-spec.json> --out <출력.json>
python scripts/audit-spfr-source.py renderer --source <원천사본> --package <zip> --out <출력.json> build/render.py ...
python scripts/audit-spfr-package.py --source <원천사본> --package <zip> [--package ...] [--reference <통합 zip>] --out <출력.json>
T03_REG01_REPRO=1 pnpm exec vitest run tests/spfr-reg01-source-model.test.ts   # 가상 재현(2 실패 예상)
```

## 1. T-03a · 범위와 잔여 콘텐츠

**범위 고정**: 원천 `35498ad…` 313파일/4,015,944바이트(결합 SHA-256 `1ce2938c…c862`, 10/26 manifest 일치 근거 유지). 선택 추출 243파일·2,787항목·leaf 35,667(표시 35,134·메타 533·보류 0·미대응 0). 이는 **선택 입력에 대한 미대응 0**이며 **원천 전체 처리 0이 아니다**. 기존 독립 대조(JSON56·MD184·XLSX2,539셀)는 그대로 인정하고 이번 검증과 섞지 않았다.

| 미선택 원천 70파일 | 수 | 내용 | 제안 | 차단 | 다음 | 담당 |
|---|---:|---|---|---|---|---|
| `build/*.py` 도구·검증 | 54 | 검증·빌드·승격 스크립트(한글 문구 931 중 720개가 패키지에 없음 — 검증 메시지·정규식·주석성 문구가 대부분) | 제외 제안(일반 UI/알고리즘) | 아니오 | 시드 이력 값 34개(`seed_place_facts`) vs 현 Fact 대조 | Claude→Codex 승인 |
| `daily-cards/routes/*-osrm.json` 경로 geometry | 11 | 4개는 카드 `map.routeCache`가 가리킴(day 4·5·6·7), 7개는 가리키는 카드 없음 | **보류**(DB 필드/첨부/제외 미결정) | 아니오(표시 전용) | 지도 기능 범위 결정 | 사용자·Codex |
| `daily-cards/schema.json` | 1 | 카드 스키마 | 제외 제안 | 아니오 | 승인 | Codex |
| `00_Governance` 편집 표준 | 4 | 집필 규칙 문서 | 제외 제안 | 아니오 | 승인 | 사용자·Codex |

미승인 제외는 완료로 분류하지 않았다(위는 모두 제안).

**렌더러(`render.py`) 잔여 조사**: 이전 audit은 함수 75개를 "검토 대기"로 남겼다. 이번에 docstring을 뺀 한글 문구 488개 중 250개는 패키지에 있고 238개(34개 함수)는 없다. 함수 이름 기준 분류: UI·PWA·오프라인·검색·리다이렉트·크레딧 문구 다수 → 제외 제안. **수작업으로 읽은 후보 5개 함수**만 "공통 안내 판정 필요"로 분류했다: `tourist_map_block`(관광 지도 설명 3), `build_sources`(출처 정책 16), `build_travel_french`(회화 안내 제목 22), `build_prepare`·`build_paris_museum_booking`(예약 안내/라벨 55). 나머지 29개 함수는 이름 기준 분류이며 전수 수작업이 아니다(미검증). 판정 전에 DB에 넣지 않았다.

**카드 필드 독립 확인**(43일 전체): 숙소 이름/주소·좌표·활동 좌표 267·공식 URL 109·실행 메모 129·카드 `sourceRefs` 171이 모두 패키지에 있다(Markdown 이스케이프 해제 후). 이전 coverage 주장과 일치.

**유지 항목**: Fact65개 근거·이미지/지도 권리는 원천 보존 검사와 별개이며 이번 조사로 승격하지 않았다.

## 2. T-03b · 지역별 ZIP 독립 검사

원천에서 일차·날짜·도시·제목·유형·활동(순서·이름·요약·메뉴·예약·시각·장소 연결)·이동 구간·숙박 경계를 독립 계산해 비교했고, 첨부는 manifest 해시/길이와 실제 바이트, 자산 콘텐츠→blob 연결로 확인했다.

| 패키지 | 바이트 | SHA-256(앞12) | 일/활동/이동 | 콘텐츠 | 첨부 | 실패 |
|---|---:|---|---|---:|---:|---:|
| barcelona | 6,842,018 | 5ee56555a32a | 3/17/14 | 390 | 54 | 0 |
| girona | 12,070,197 | 330d95392f8f | 3/17/14 | 649 | 90 | 0 |
| nice | 11,738,033 | 5e9037c1dd0b | 5/38/33 | 525 | 71 | 0 |
| verdon | 20,584,860 | 2b3f5303a023 | 1/8/7 | 868 | 126 | 0 |
| aix | 18,668,264 | fe373e73ccc0 | 4/30/26 | 711 | 113 | 0 |
| luberon | 8,702,268 | 66f56463c7fe | 1/8/7 | 290 | 48 | 0 |
| avignon | 20,345,086 | 8b88f3377838 | 5/37/32 | 804 | 117 | 0 |
| lyon | 6,825,202 | f377a430053d | 4/24/20 | 359 | 45 | 0 |
| paris | 22,372,787 | 10431c8645c8 | 15/81/66 | 978 | 164 | 0 |
| unassigned(귀국 42~43) | 17,514,303 | 68c0f6b7573f | 2/7/5 | 793 | 125 | 0 |
| 구 통합본(c08) | 84,401,787 | 8bfd24ea8569 | 43/267/224 | 3,779 | 570 | 0 |
| 최종 통합본(c10) | 84,453,758 | 3e73d4bdd5e9 | 43/267/224 | 3,831 | 594 | 0 |
| 수정 통합본(verified) | 84,453,766 | d18322806431 | 43/267/224 | 3,831 | 594 | 0 |

보고된 지역별 수량(콘텐츠·활동·첨부)은 파일에서 모두 일치했다. 일차 범위는 `batch-results.json`과 같다. 경로: 지역 10개 `local-data/phase2/continuous-08/<배치>/package/pilot.zip`, 나머지는 위 이름 그대로 `continuous-10/full/…`, `verified-package-20261026/pilot.zip`.

**실패 0이 말하지 않는 것과 새로 확인한 차이**(통합본과 비교, 일차 `ordinal`은 배치 상대값이라 제외):
1. **오래된 시점**: 지역 ZIP은 10/23 `continuous-08` 산출물이다. 최종 통합본에는 이후 52개가 추가됐다(실행 지도 자산 24·근거 24·가이드 4). 지역 ZIP에는 이 24개 첨부와 연결이 없다. 세 ZIP의 `adapterVersion/normalizationVersion`이 모두 `spfr-pilot-v2`/`2`로 같아서 **버전 표기로는 구분할 수 없고 해시로만 구분**된다.
2. **좌표 없음**: 지역 ZIP의 지도 대상 89개에 위도·경도가 없다(통합본에는 있음). 좌표가 다른 일차의 활동에서 오기 때문에 배치 범위 밖 장소는 비는 것으로 보이며, 단독 사용 시 핀이 없다. 손실이 아니라 범위 차이로 분류하되 사용 전 확인 필요.
3. **`regionId` 배치 의존**: 단일 지역 배치(paris)에서는 예약 19건 모두 `regionId=paris`가 붙고(`spfr-candidate.ts:509`) 통합본에서는 비어 있다. 원천 예약 레코드(`PARIS_MUSEUM_BOOKINGS`)에는 지역 필드가 없고 일차 번호만 있다. 배치에 따라 값이 달라지는 추정이다.
4. 나머지 차이는 배치 범위의 결과로 분류했다(회화 추천의 일차/장소유형, 가이드 절 번호, 대응표 자산 해시). 정확한 경로별 집계는 `packages.json`의 `versusReference`.

## 3. REG-01 · 원천 근거와 권고

**원천이 말하는 것**(SP-FR `build/model.py:288-331`, `load_days`:674-): `Day.region`="그날 밤 자는 지역(정본)", `Day.regions`="이동일이면 둘", `is_transfer = len(regions) > 1`. 계산은 `here = checkin ≤ 날짜 ≤ checkout`, `sleeping = checkin ≤ 날짜 < checkout`, `region = (sleeping or here)[-1]`, 숙박이 전혀 없으면 센티널 `return`. 카드에 지역 필드는 없고 장소 frontmatter 지역은 하루 필드가 아니라 지역 콘텐츠 선택에 쓰인다(`spfr-candidate.ts:111`).

**실제 43일 대조**(값은 `packages.json:reg01`): 이동일 8일(day 4·7·12·13·17·18·23·27)은 원천 `regions`=출발+도착이고 DB `regionIds`=도착뿐이다. day 42는 원천 `regions`=[paris], DB=[]. day 1은 도착만이라 같다. day 43은 숙박이 닿지 않아 원천 `return`, DB=[]로 일치(센티널은 지역이 아님). 장소 frontmatter 지역은 이동일 stops에서 출발/도착 외 지역(day 12는 3곳)도 보이므로 그것을 `regionIds`에 넣는 B안과 원천 모델은 다르다.

| | 원천 모델 | 현 변환 | A(숙박 전용) | B(활동 장소 지역 합집합) |
|---|---|---|---|---|
| 이동일 | 출발+도착 | 도착 | 도착 | 출발 외 지역까지 |
| 숙박 종료일 | 종료 숙박 | 없음 | 없음 | 장소 지역 |
| 야간 지역 | 자는 곳 | 자는 곳 | 자는 곳 | 자는 곳 |

**권고(원천 근거 있음, 적용 안 함)**: **C. 원천 모델 채택** — `regionIds`=`checkin ≤ 날짜 ≤ checkout` 숙박 key(원천 `Day.regions`와 동일), `overnightRegionId`=`checkin ≤ 날짜 < checkout`의 마지막 key(없으면 미설정). 원천 `region` 폴백(숙박 종료일에 종료 숙박 지역을 `region`으로 쓰는 것)과 `return` 센티널은 채택하지 않는다. 이유: 원천 필드 설명과 계산이 있고, 숙박 없는 날 지역을 만들지 않는 결정(`decisions.md:22`)과 충돌하지 않으며, A처럼 원천 정보를 버리지도 B처럼 원천에 없는 합집합을 만들지도 않는다.
- 코드: `spfr-candidate.ts:182-186` 지역 계산 `date < checkout`→`≤`, `spfr-pilot.ts:232-233` 야간 지역을 `regionIds.length===1`이 아니라 `date < checkout`인 숙박에서 직접 도출(그대로 두면 이동일 야간 지역이 사라지는 회귀). 스키마 변경 없음(배열 복수 허용), 정규화/어댑터 버전 갱신 필요.
- 호환: 기존 패키지·DB는 유효. 과거 계획 버전은 불변. 영향 일차는 43일 중 9일(8 이동일+day 42).
- 재가져오기: 새 패키지는 계획이 원자 단위로 달라져 보인다. 사용자가 계획을 직접 고쳤으면 양쪽 수정 충돌 검토가 열린다. 적용 전에 변경 전/후 diff를 사용자에게 보인다.
- T-01 단위 테스트 영향: `spfr-return-day`의 미상 변형은 숙박 종료일 `regionIds=[]`를 **계약**으로 단언한다. 원천 모델과 충돌하므로 판정 시 관찰 블록으로 옮기거나 `['other']`로 바꿔야 한다(이번에 수정하지 않았다).
- 한계: 원천의 `region` 폴백은 의도(귀국 이동일에 지역 표시)가 있었을 수 있다. 사용자/Codex가 채택 범위를 정해야 한다. 이 권고를 요구 확정으로 기록하지 않는다. 필요한 향후 질의("그날 관련 지역")는 장소 연결을 거쳐 조인하면 된다.

가상 재현: `T03_REG01_REPRO=1 …` → 이동일 `['other']`≠`['fiction','other']`, 종료일 `[]`≠`['other']` 실패 2건, 야간 지역 보호선 1건 통과(`.cache/t03-logs/reg01-repro.log`).

## 4. T-03c · 회귀와 다음 수정 지시 초안

추가한 회귀: ① 이동일 복수 지역, ② 숙박 종료일 지역(둘 다 환경변수 게이트, 현재 실패 = 결함 재현) ③ 야간 지역 보호선(통과). 기존 충분한 검사는 재사용: 숙박 없는 귀국일·이동일 연결은 `spfr-return-day`/`spfr-move-day`, 패키지 무결성은 위 도구.

| 초안 | 내용 | 파일 | 필요 검사 | 선행 |
|---|---|---|---|---|
| F-1 | REG-01 판정 후 `regionIds`/`overnightRegionId` 변환 수정(권고 C) + 어댑터 버전 + T-01 단언 정리 + 재현 테스트 게이트 해제 | `spfr-candidate.ts`, `spfr-pilot.ts`, 두 T-01 테스트 | `check`, 이행·재가져오기 단위, 통합본 재생성 후 `audit-spfr-package.py` | 사용자/Codex 판정 |
| F-2 | 배치 의존 `regionId` 추정 제거 또는 예약 일차→숙박 지역 도출 | `spfr-candidate.ts:509` | 지역 배치 vs 통합본 예약 `regionId` 일치 | F-1과 같은 이행에서 |
| F-3 | 지역 ZIP을 계속 쓸 경우 최종 어댑터로 재생성하고 버전 표기를 구분 가능하게(어댑터/정규화 버전) | 재생성 실행 + 버전 정책 | 위 도구로 재대조, 해시 기록 | 지역 ZIP 사용 여부 결정 |

기존 통합본·G1/B-01·백업은 덮어쓰지 않았고 재생성·재가져오기도 하지 않았다.

## 5. 검사와 상태

- 도구: 13개 패키지 실패 0, 변조 사본에서 5건 탐지(제목 변경·활동 누락·파일 해시/길이·레코드 수·첨부 누락). Python 도구는 `pnpm run check` 대상이 아니다(포맷/린트 미적용).
- 재현 테스트: 기본 실행 skip, 환경변수 실행 2 실패·1 통과.
- `pnpm run check` 결과는 `.cache/t03-logs/check.log`와 커밋 보고에 기재.
- 구분: 구현·자동 검사·실데이터 대조(읽기 전용) 완료 / Codex 검토 **대기** / 사용자 확인 **검토 준비**. 원격 CI는 push 후 별도 기재.

---

## R1 · 읽기 검증 도구 보호 보완 (2026-10-28, 위 T-03 결과는 그대로 보존)

상태: 구현·가상 검사·실데이터 재검사 완료 / Codex 검토 **대기** / 사용자 확인 **검토 준비**. 제품 변환·REG-01 계약·개인 ZIP·workflow·의존성 변경 없음.

**R1-1 실패 신호**: `audit-spfr-package.py`는 보고서를 저장한 뒤 어느 패키지든 `failureCount>0`이면 exit 1. 종료 코드: **0** 통과 / **1** 검증 실패(보고서 저장) / **2** 입력 오류·출력 경로 거부(아무것도 쓰지 않음). `audit-spfr-source.py scope`는 선택 목록 파일이 원천에 없으면 1. 미선택 파일·REG-01 행·렌더러 미분류는 보고서의 관찰이며 실패가 아니다(기대값 약화 없음).

**R1-2 입력 보호**: 공용 `scripts/audit_paths.py`. 쓰기 전에 출력 경로를 `realpath`+`normcase`로 정규화해 ① 원천 폴더 안/동일 ② 읽을 입력 파일(입력·참조 ZIP, selection, 렌더러 파일 인자)과 같은 파일(존재하면 `samefile`로 하드 링크 포함)을 거부하고, 출력 폴더 없음·디렉터리도 거부한다. 렌더러 파일 인자는 원천 밖(`..`·심볼릭 링크 탈출)이면 거부. 제약: 링크 생성에는 환경에 따라 권한이 필요하며, 이 PC에서는 하드 링크·심볼릭 링크 시험이 모두 실행됐다(권한 없는 환경에서는 skip).

**가상 검사**: `tests/audit/test_audit_tools.py`(임시 가상 원천·ZIP만 사용, subprocess 종료 코드와 `failureCount` 및 입력 해시 전후 비교). 정상 0, 변조 1+보고서, 혼합 실행 1, 입력 없음 2, 입력/참조/selection/원천 내부 덮어쓰기 2, `..`·대소문자(Windows)·하드/심볼릭 별칭 2, 실패 후 입력 보존, 렌더러 탈출 2.

| 검사 | 명령 | 결과 |
|---|---|---|
| 가상 도구 검사 | `python -m unittest discover -s tests/audit -v` | 14개 통과, skip 0 (`.cache/t03-logs/r1-unittest.log`) |
| verified ZIP 재검사 | `audit-spfr-package.py … --out local-data/t03-r1/valid.json` | exit 0, 실패 0 |
| 변조 사본 재검사 | 같은 명령, 새 출력 `tampered.json` | **exit 1**, 실패 5 (이전엔 exit 0) |
| 입력 덮어쓰기 시도 | `--out <verified ZIP>` | exit 2, 거부 |

원본 보존: verified `d1832280…bd3e`(= 문서 값), 지역 lyon `f377a430…8cc3`, 변조 사본 `c6f4ff6a…0e76`이 실행 전후 동일. 로그 `.cache/t03-logs/r1-real.log`, 새 출력 `local-data/t03-r1/`(Git 제외). 제품 코드·TS는 변경이 없어 `pnpm run check`와 UI/전체 회귀는 반복하지 않았다.

**자동 검사 연결 제안(이번에 변경 안 함)**: 가상 데이터만 쓰므로 CI의 기존 Python 단계(`.venv/bin/python`) 뒤에 `python -m unittest discover -s tests/audit`를 한 줄 추가하면 된다. workflow 변경이라 Codex 지시 후에.
