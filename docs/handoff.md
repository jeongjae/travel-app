# travel-app 현재 상태

2026-10-30 · **C-03〔T-C4〕독립 검토 통과 / C-04〔T-C5〕전달 준비 / 경미한 잔여 후속**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md).
- [T-04](claude-task-04-review.md) `64a84e4`: 지역/야간 숙박 분리 대상 통과. 새 사본 사용자 DB·iPhone 미적용.
- [T-05 R2 결과](claude-task-05-r2-result.md) `568b745`·[독립 검토](claude-task-05-review.md): 구 기준 호환·추가 필드 검증·계획 UI 검토 통과. 추가 수정 지시 없음.
- [C-03 검토](claude-task-c03-review.md): 지역/여행 가이드·기본정보 수정 검토 통과. CL-06 해결·CL-07 부분 해결, 사용자 검토 준비.
- [C-02 검토](claude-task-c02-review.md): 숙박·이동/오프라인/복원 주요 검토 통과. DST 특수 입력 오탐은 CL-08 후속, 사용자 검토 준비.
- [C-01 결과](claude-task-c01-result.md)·[독립 검토](claude-task-c01-review.md): R1 소유 연결 보존 포함 통과(f3f7fef). 추가 수정 지시 없음, 사용자 검토 준비.
- G0·G1·기존 B-01 확인 완료. G2/G2′/G3/G4·전체 PC·T-01 사용자 확인은 대기.
- 브랜치 `codex/c03-guides`, T-04/T-05/C-01~03 main 미병합. 최근 배포 기록 `ac09ca0`([T-02](claude-task-02-review.md)); 이번 배포 없음.
- 기존 verified ZIP·원본·백업·프로필 보존. 검토 후보 `local-data/phase2/t04-candidate/package/pilot.zip` 미적용.
- 기존 ZIP 84,453,766바이트 `d1832280…bbe0`, 후보 84,454,075바이트 `7b530968…de12`. 전체 해시는 T-04 결과에 있다.
- 미추적 `docs/status-review-2026-10-26.md`는 커밋 제외.

## 최근 검증·한계

- Codex C-03: 4파일·40검사·타입/빌드·PC/모바일 UI 10개 통과. 생성/수정·Fact/출처·과거 보존·오프라인·복원 확인.
- Claude C-03 전체 검사 exit 0: `.cache/verification/2026-10-30T02-02-53-850Z/`. 전체 회귀·원격 CI는 이번 독립 반복하지 않았다.
- C-02 주요 38검사·빌드·UI 8개 통과 기록 유지. DST 특수 입력 오탐은 CL-08 후속이며 전체 시간 경계 완료 아님.
- C-01 R1·T-04/T-05 검토 통과 유지. 모바일은 에뮬레이션으로 사용자 확인·실기기와 구분한다.
- [실데이터 PC](full-verification-2026-10-26.md) 43일·594해시·전체 복원 증거 유지. 프로필 `local-data/phase2/user-review-full-20261026/` 보존.
- [iPhone](phase-2-prime-runbook.md): 가져오기·일정/사진/메모·오프라인·종료 후 유지·백업 저장 확인. 빈 공간 복원·재실행·해시는 대기.
- 실제 키/API·v2 활성화 없음. AI 운영/인증·모델/예산/전송 미결정.

## 다음 작업·명령

1. Sonnet에 [C-04〔T-C5〕](claude-task-c04-field-records.md) 전달: 예정 외 활동 장소 선택·추가식 정정/당시 맥락·메모/오프라인/복원 보강. 아직 구현 미착수.
2. T-06/F-2·F-3·부분 패키지 경계는 [후속 목록](change-log.md)으로 보류. 저장/복원·충돌·격리·보안 결함은 보류하지 않는다.
3. B/G2/G2′는 미완료를 유지하며 C 착수와 분리한다. iPhone 빈 공간 복원·전체 PC 확인·운영 항목은 후속 추적한다.
4. main 병합·배포·새 후보 사용자 적용은 별도 결정 대기. 기존 여행/사용자 공간은 변경하지 않는다.
- 기존 여행 삭제 금지. pnpm12.14.0/Node24.13.1/`.venv`, 캐시 `.cache/corepack`·`.cache/ms-playwright`.
- UI `pnpm run dev:ui` 5173, 빌드 후 `preview:ui` 4173, 회귀 `check:deferred`. 포트 소유 먼저 확인.
