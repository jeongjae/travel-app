# C-09〔REG-02〕 결과 · 일정일 사진을 방문 장소 기준으로

2026-11-03 · 브랜치 `codex/c09-day-photo` · 기준 `f92da97`(c08 최신) · 종료 `3d5b1be`(기능 `997a558`, 시험 `9fb9a9e`, 중간에 지시 문서 커밋 `3d5b1be` 포함)
상태: **구현 / 시험 통과 / 실제 원천 대조 통과 / 사용자 미확인**

## 1. 규칙 변경 (`src/transfer/spfr-media.ts`)
- 날짜 `assetRefs`를 원천 이미지 `usage`가 아니라 그날 활동의 `placeLinks`(relation `visit`) 순서로 채운다. 중복 장소는 1회.
- 장소 사진이 없는 날은 빈 배열. `usage` 폴백 없음. `usage`는 이미지 권리 섹션·포함 판정에만 남음.
- 캡션: `장소명 · 작성자 · 라이선스`. 화면은 `assetRefs[0]` 표시 유지(UI 변경 없음).
- 변환기 버전: `spfr-pilot-v4` / 정규화 `4`(`spfr-stays.ts`). 파일/명령 계약 v2 불변, v2·v3 패키지 읽기·가져오기 불변.

## 2. 43일 대조 (읽기 전용, 후보 dataset 대 `local-data/phase2/full-source`)
| 항목 | 값 |
|---|---|
| 대상 일수 | 43 |
| 날짜 사진이 있는 날 | 41 |
| 첫 사진 장소 ∈ 그날 `place_ref` | **41 / 41** (불일치 0) |
| 모든 사진 장소 ∈ 그날 `place_ref` | 41 / 41 |
| 사진 없는 날 | Day 1, Day 43 (두 날 모두 `place_ref` 없음 → 빈 배열이 맞음) |

목표(39/43 이상, 불일치 0) 충족. 사진·본문은 기록하지 않음.

## 3. 재가져오기 사례
`tests/spfr-day-photo.test.ts`: v3(틀린 날 사진)로 가져온 여행에 v4 패키지를 재가져오기하면 plan 단위가 `source-only`, 적용 전 저장값 불변, 적용 후 새 계획 버전에서 Day 29=1장·Day 31=0장, 과거 계획 버전 불변.

## 4. 검사
| 검사 | 결과 |
|---|---|
| `pnpm exec vitest run` | 37파일 통과(신규 4건 포함) |
| `pnpm run check:deferred` | exit 0 (check·test:e2e·check:pilot 통과; 로그 `.cache/verification/2026-11-03T06-03-23-351Z`) |
| 첫 `check:deferred` | `spfr-stays.ts` 서식 경고로 exit 1 → 서식 수정 후 재실행 통과 |
| 가상 fixture 기대값 | 변경 없음(삿포로·가상 여행 영향 없음) |

## 5. 후보 패키지 (사용자 공간에 적용하지 않음)
- 경로: `local-data/phase2/c09-candidate/package/pilot.zip` (git 제외)
- 크기 84,446,537바이트 · SHA-256 `712369b3a829ef2d06e633b21541d1a1220e88cdaab47f9a4a69bc3596ff2b0c`
- packageDigest `c1bf3a5e138cd3ac9e14574ea9461a2bc4d78346319b184dbf4e2f6045114358` · 어댑터 `spfr-pilot-v4`/`4` · 43일·267활동·594자산·coverage unmapped 0
- 생성: T-04와 같은 입력(`continuous-10/full/input`, `full-media-03`)과 명령, 출력만 `c09-candidate/package`.
- 기존 보존: verified `d1832280…`, T-04 후보 `7b530968…` 변경 없음. 이 후보는 T-04 변경(REG-01)도 포함하므로 T-04 후보를 대체한다 — 적용 결정은 사용자.

## 6. 미검증
- `audit-spfr-package.py` 독립 대조는 이번에 실행하지 않음(Codex 요청 시 실행).
- 사용자 PC 화면 확인·iPhone 반영(배포 결정과 연동)은 미실시. 사용자 확인 상태: **검토 준비**.
