# travel-app 현재 상태

2026-10-28 · **T-04 Codex 검토 통과 · main 병합/사본 적용은 사용자 결정 대기 · C단계 설계/계획 제안**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md).
- [T-04 결과](claude-task-04-result.md) `64a84e4`/`6482020`·[Codex 검증](claude-task-04-review.md): 통과. 어댑터 v3. 새 43일 사본 9일만 변경, 미가져옴. F-4→T-05 후보.
- [C단계 설계서](phase-c-design.md)·[C단계 개발계획](phase-c-plan.md): 작성자 제안, 사용자 미확정. U-C1~U-C8 결정 필요.
- [T-01 결과](claude-task-01-result.md) `1e56c71`·[검증](claude-task-01-review.md) 통과. [T-02 검증](claude-task-02-review.md): main `ac09ca0` 반영·Pages 게이트.
- [T-03 검증](claude-task-03-review.md): R1 도구 보호 통과. 관찰(부분 패키지 `plan.stays` 조건)은 T-04 검증 §관찰 1.
- G0·G1·기존 B-01 확인 완료. G2/G2′/G3/G4·전체 PC·T-01 사용자 확인은 대기.
- [웹 앱](https://jeongjae.github.io/travel-app/): deployment.json=`ac09ca0`. 브랜치 `codex/t04-regions`는 main 미병합(병합 시 Pages 재배포).
- 개인 ZIP `local-data/phase2/verified-package-20261026/pilot.zip` 84,453,766바이트, SHA-256 `d183228064312c2a69d27018f5cfc6f5c909e262d621890f101770049274bbe0` 불변.
- 검토 후보 `local-data/phase2/t04-candidate/package/pilot.zip` 84,454,075바이트, `7b530968…de12`. 사용자 DB·iPhone 미적용.
- 원본·기존 통합본·백업·프로필 보존. 미추적 `docs/status-review-2026-10-26.md`는 커밋 제외.

## 최근 검증·한계

- Claude T-04: `check:deferred` exit 0(단위187·1 skip, E2E54, pilot), Python audit 15. 로그 `.cache/verification/2026-10-28T09-05-37-462Z/`.
- Codex T-04: Python audit 15 독립 통과, 후보/verified를 audit 도구로 독립 대조(실패0, 9일 차이 재확인), 해시 일치. vitest는 Codex 환경 미실행.
- Codex T-01/T-03 독립 검사 기록은 각 검증 보고에 있다. 전체 회귀는 반복하지 않았다.
- [실데이터 PC](full-verification-2026-10-26.md) 43일·594해시·전체 복원 증거 유지. PC 프로필 `local-data/phase2/user-review-full-20261026/` 보존.
- [iPhone](phase-2-prime-runbook.md): 가져오기·일정/사진/메모·오프라인·종료 후 유지·백업 저장 확인. 크기·빈 공간 복원·재실행·해시는 대기.
- 실제 키/API·v2 활성화 없음. AI 운영/인증·모델/예산/전송 미결정.

## 다음 작업·명령

1. 사용자 결정: ① T-04 main 병합 시점 ② t04 사본 적용 여부(권고: F-4 수정 후) ③ C단계 T-C0/T-C1 병행 착수 ④ U-C5·U-C6.
2. Codex: T-05(F-4 재가져오기 항목 정렬) 지시서 작성 → Sonnet 구현 → 검증.
3. iPhone `?workspace=content&review=iphone-restore-20261027` 빈 공간에서 전체 백업 복원·재실행 확인. 비어 있지 않으면 중단.
4. [잔여 목록](deferred-verification.md): 원천/의미·지역 ZIP(F-3)·예약 regionId(F-2)·Fact65/권리·별도 매체 백업·전체 PC 확인.
- 기존 여행 삭제 금지. pnpm12.14.0/Node24.13.1/`.venv`, 캐시 `.cache/corepack`·`.cache/ms-playwright`.
- UI `pnpm run dev:ui` 5173, 빌드 후 `preview:ui` 4173, 회귀 `check:deferred`. 포트 소유 먼저 확인.
- [배포 전 인계](history/handoff-2026-10-28-before-t02-release.md). 상세 판단·검사 근거는 Codex 검증 보고를 따른다.
