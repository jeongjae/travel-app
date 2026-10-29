# travel-app 현재 상태

2026-10-29 · **C-01 주요 흐름 검증 / 소유 연결 R1 보완 / 경미한 잔여 후속**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md).
- [T-04](claude-task-04-review.md) `64a84e4`: 지역/야간 숙박 분리 대상 통과. 새 사본 사용자 DB·iPhone 미적용.
- [T-05 R2 결과](claude-task-05-r2-result.md) `568b745`·[독립 검토](claude-task-05-review.md): 구 기준 호환·추가 필드 검증·계획 UI 검토 통과. 추가 수정 지시 없음.
- [C-01 결과](claude-task-c01-result.md)·[독립 검토](claude-task-c01-review.md): 주요 작성/격리/복원 통과. 기존 활성 가이드 연결 단절 저장 1건 보완 요청. 사용자 검토 준비.
- G0·G1·기존 B-01 확인 완료. G2/G2′/G3/G4·전체 PC·T-01 사용자 확인은 대기.
- 브랜치 `codex/c01-authoring`, T-04/T-05 main 미병합. 최근 배포 기록 `ac09ca0`([T-02](claude-task-02-review.md)); 이번 배포 없음.
- 기존 verified ZIP·원본·백업·프로필 보존. 검토 후보 `local-data/phase2/t04-candidate/package/pilot.zip` 미적용.
- 기존 ZIP 84,453,766바이트 `d1832280…bbe0`, 후보 84,454,075바이트 `7b530968…de12`. 전체 해시는 T-04 결과에 있다.
- 미추적 `docs/status-review-2026-10-26.md`는 커밋 제외.

## 최근 검증·한계

- Codex C-01: 4파일·35검사·타입/빌드·UI 8개(PC/모바일 6+오프라인 2) 통과. 추가 소유 연결 경계 1개 실패. 임시 증거 `.cache/c01-codex/`.
- Claude C-01 전체 검사 exit 0: `.cache/verification/2026-10-29T07-22-55-706Z/`. CI 최초 기존 화면 대기 실패→재실행 성공 보고, 원인 미규명.
- Codex T-04 대상 30개·T-05 R2 대상 27개/빌드/계획 UI 6개 통과 기록 유지. 전체 회귀·CI는 이번 독립 반복하지 않았다.
- [실데이터 PC](full-verification-2026-10-26.md) 43일·594해시·전체 복원 증거 유지. 프로필 `local-data/phase2/user-review-full-20261026/` 보존.
- [iPhone](phase-2-prime-runbook.md): 가져오기·일정/사진/메모·오프라인·종료 후 유지·백업 저장 확인. 빈 공간 복원·재실행·해시는 대기.
- 실제 키/API·v2 활성화 없음. AI 운영/인증·모델/예산/전송 미결정.

## 다음 작업·명령

1. Sonnet에 [C-01 R1](claude-task-c01-r1.md) 전달: 기존 활성 가이드 연결 제거/교체를 안전하게 거부·롤백. 저장 경계만 보완하고 재검토.
2. T-06/F-2·F-3·부분 패키지 경계는 [후속 목록](change-log.md)으로 보류. 저장/복원·충돌·격리·보안 결함은 보류하지 않는다.
3. B/G2/G2′는 미완료를 유지하며 C 착수와 분리한다. iPhone 빈 공간 복원·전체 PC 확인·운영 항목은 후속 추적한다.
4. main 병합·배포·새 후보 사용자 적용은 별도 결정 대기. 기존 여행/사용자 공간은 변경하지 않는다.
- 기존 여행 삭제 금지. pnpm12.14.0/Node24.13.1/`.venv`, 캐시 `.cache/corepack`·`.cache/ms-playwright`.
- UI `pnpm run dev:ui` 5173, 빌드 후 `preview:ui` 4173, 회귀 `check:deferred`. 포트 소유 먼저 확인.
