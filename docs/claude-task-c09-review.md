# C-09〔REG-02〕Codex 독립 검토

2026-11-03 · 기능 `997a558`, 시험 `9fb9a9e`, 보고 `1581908` · **검토 통과 / 후보 패키지 적용은 사용자 결정 대기**

## 결과

날짜 사진 규칙이 지시대로 바뀌었다: `spfr-media.ts`의 `assignDayPhotos`가 그날 활동의 `placeLinks`(relation `visit`) 순서로 장소 hero 사진을 넣고, 중복 장소는 1회, 장소 사진이 없으면 빈 배열. `usage` 폴백 없음.
변경 파일은 `src/transfer/spfr-media.ts`·`spfr-stays.ts`(어댑터 `spfr-pilot-v4`·정규화 `4`)와 시험뿐이다. `src/contracts`·`src/storage`·`src/repository.ts` 변경 0 — 파일/명령 계약 v2 불변.

## 독립 검사

| 검사 | 결과 |
|---|---|
| `pnpm run build`(클라우드, `1581908`) | exit 0 |
| `pnpm exec vitest run` | 37파일·310검사 통과·1 skip, exit 0(신규 `spfr-day-photo.test.ts` 포함) |
| 후보 패키지 해시 | `local-data/phase2/c09-candidate/package/pilot.zip` 84,446,537바이트, SHA-256 `712369b3…2b0c` — 보고와 일치. `report.json` adapterVersion `spfr-pilot-v4`, sourceCommit `35498ad` |
| 43일 대조(Codex 재계산, 후보 `dataset.json` ↔ 원천 `daily-cards`) | 사진 있는 날 41, 첫 사진 장소 ∈ 그날 `place_ref` **41/41**, 모든 사진 41/41, 불일치 0. 사진 없는 날 Day 1·43(방문 장소 없음) — 보고와 일치 |
| 기존 verified·T-04 후보 | 변경 없음(해시 유지) |

C-09 전체 E2E는 Claude의 PC `check:deferred`(exit 0, `2026-11-03T06-03-23-351Z`)에 의존한다. 변환기 변경은 가상 fixture 기반 E2E에 영향이 없다는 보고를 단위 시험 통과로 뒷받침한다.
사용자 DB·실제 ZIP·main·배포·API 변경 없음.

## 소견

- 후보 패키지는 T-04(REG-01 지역/숙박 분리)와 REG-02를 함께 담는다. 적용하면 T-04 후보를 대체한다.
- 재가져오기: 기존 공간에 새 패키지를 넣으면 plan 단위 `source-only`로 보이고 적용해야 바뀐다(시험 확인). 사용자 편집·기록은 보존.
- 적용 절차는 C-11(복원 안내)이 끝나면 더 안전하다 — 잘못된 입력에 안내가 붙기 때문.

## 다음

사용자 결정: 후보 패키지(`712369b3…`)를 평소 공간에 **재가져오기로 적용**할지. 권장: C-11 완료 뒤, 먼저 검토 공간에서 적용 결과(파리 날짜 사진)를 확인하고 평소 공간에 적용. iPhone 반영은 배포 결정과 묶임.
