# travel-app 현재 상태

2026-10-29 · **T-04 대상 검토 통과 / T-05 구현 작업 관찰 / C 문서 R1 검토 준비**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md).
- [T-04 결과](claude-task-04-result.md) `64a84e4`/`6482020`·[검증 기록](claude-task-04-review.md): 지역/야간 숙박 분리 대상 검토 통과. 새 사본 사용자 DB·iPhone 미적용.
- [C 설계](phase-c-design.md)·[계획](phase-c-plan.md): 사용자 요청으로 Codex가 [R1 보완](phase-c-r1.md) 완료. 생성/연결·충돌·범위·복원 의존 반영, 사용자 검토 준비·기능 미구현.
- G0·G1·기존 B-01 확인 완료. G2/G2′/G3/G4·전체 PC·T-01 사용자 확인은 대기.
- `codex/t05-reimport-order`: Claude [T-05 결과](claude-task-05-result.md) 제출(Codex 검토 대기). T-04/T-05 main 미병합. 최근 배포 기록 `ac09ca0`([T-02](claude-task-02-review.md)); 이번 배포 없음.
- 기존 verified ZIP·원본·백업·프로필 보존. 새 후보 `local-data/phase2/t04-candidate/package/pilot.zip`은 검토용.
- 기존 ZIP 84,453,766바이트 `d1832280…bbe0`, 후보 84,454,075바이트 `7b530968…de12`. 전체 해시는 T-04 결과에 있다.
- 미추적 `docs/status-review-2026-10-26.md`는 커밋 제외.

## 최근 검증·한계

- Codex 10/29: T-04 대상 vitest 5파일·30검사 통과(exit 0). F-4는 코드상 결함 후보, 이번 독립 재현은 미실행.
- Claude T-04: `check:deferred` exit 0(단위187·1 skip, E2E54, pilot), Python audit 15. 로그 `.cache/verification/2026-10-28T09-05-37-462Z/`.
- 10/28 검토·ZIP 대조는 Claude 수행이다. ‘Codex 독립’ 표기를 바로잡았다. Codex는 이번에 전체 회귀·Python·실제 ZIP 대조를 반복하지 않았다.
- [실데이터 PC](full-verification-2026-10-26.md) 43일·594해시·전체 복원 증거 유지. 프로필 `local-data/phase2/user-review-full-20261026/` 보존.
- [iPhone](phase-2-prime-runbook.md): 가져오기·일정/사진/메모·오프라인·종료 후 유지·백업 저장 확인. 빈 공간 복원·재실행·해시는 대기.
- 실제 키/API·v2 활성화 없음. AI 운영/인증·모델/예산/전송 미결정.

## 다음 작업·명령

1. [T-05](claude-task-05-reimport-order.md) 결과 Codex 독립 검토. 자체 검사 `check:deferred` exit 0, 가상 오탐 재현→제거.
2. C 문서 R1 사용자 검토. Sonnet 문서 보완 지시는 Codex 직접 보완으로 대체했다. C 기능 구현은 B 마감 뒤 별도 지시한다.
3. 결과 제출 후 Codex 독립 검토. T-04 main 병합·새 사본 적용은 별도 결정 대기이며 F-4 수정 후 검토를 권고한다.
4. iPhone `?workspace=content&review=iphone-restore-20261027` 빈 공간 전체 복원·재실행 확인. 비어 있지 않으면 중단.
5. [잔여 목록](deferred-verification.md): 지역 ZIP(F-3)·예약 regionId(F-2)·원천/의미·Fact65/권리·별도 매체 백업·전체 PC 확인.
- 기존 여행 삭제 금지. pnpm12.14.0/Node24.13.1/`.venv`, 캐시 `.cache/corepack`·`.cache/ms-playwright`.
- UI `pnpm run dev:ui` 5173, 빌드 후 `preview:ui` 4173, 회귀 `check:deferred`. 포트 소유 먼저 확인.
