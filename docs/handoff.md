# travel-app 현재 상태

2026-10-29 · **T-04/T-05 독립 검토 통과 / T-06 전달 준비 / C 문서 R1 검토 준비**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md).
- [T-04](claude-task-04-review.md) `64a84e4`: 지역/야간 숙박 분리 대상 통과. 새 사본 사용자 DB·iPhone 미적용.
- [T-05 R2 결과](claude-task-05-r2-result.md) `568b745`·[독립 검토](claude-task-05-review.md): 구 기준 호환·추가 필드 검증·계획 UI 검토 통과. 추가 수정 지시 없음.
- [C 설계](phase-c-design.md)·[계획](phase-c-plan.md): Codex [R1 보완](phase-c-r1.md) 완료. 사용자 검토 준비·기능 미구현.
- G0·G1·기존 B-01 확인 완료. G2/G2′/G3/G4·전체 PC·T-01 사용자 확인은 대기.
- 브랜치 `codex/t05-reimport-order`, T-04/T-05 main 미병합. 최근 배포 기록 `ac09ca0`([T-02](claude-task-02-review.md)); 이번 배포 없음.
- 기존 verified ZIP·원본·백업·프로필 보존. 검토 후보 `local-data/phase2/t04-candidate/package/pilot.zip` 미적용.
- 기존 ZIP 84,453,766바이트 `d1832280…bbe0`, 후보 84,454,075바이트 `7b530968…de12`. 전체 해시는 T-04 결과에 있다.
- 미추적 `docs/status-review-2026-10-26.md`는 커밋 제외.

## 최근 검증·한계

- Codex T-05 R2: 관련 5파일·27검사·타입/빌드·계획 UI desktop 3·mobile 3 통과(exit 0). 모바일은 에뮬레이션이며 실기기 확인 아님.
- UI 최초 실행은 서버 응답 대기로 중단. 권한 검토 후 재실행 6검사 통과(13.0초). 개인 프로필 사용 없음.
- Claude R2 전체 검사 exit 0: `.cache/verification/2026-10-29T06-21-53-480Z/`. Codex는 전체 회귀·원격 CI를 반복/독립 확인하지 않았다.
- Codex T-04 대상 5파일·30검사 통과. 10/28 추가 검사·실제 ZIP 대조는 Claude 수행 기록이다.
- [실데이터 PC](full-verification-2026-10-26.md) 43일·594해시·전체 복원 증거 유지. 프로필 `local-data/phase2/user-review-full-20261026/` 보존.
- [iPhone](phase-2-prime-runbook.md): 가져오기·일정/사진/메모·오프라인·종료 후 유지·백업 저장 확인. 빈 공간 복원·재실행·해시는 대기.
- 실제 키/API·v2 활성화 없음. AI 운영/인증·모델/예산/전송 미결정.

## 다음 작업·명령

1. Sonnet에 [T-06](claude-task-06-booking-region.md) 전달: 예약 지역 배치 의존 추정(F-2) 재현·제거·검사·새 비공개 후보 대조. 아직 구현 미착수.
2. B [잔여 목록](deferred-verification.md): 지역 ZIP(F-3) 사용 여부·원천/의미·권리·별도 매체 백업·전체 PC 확인 유지.
3. T-04/T-05 main 병합·배포 시점과 새 후보 사본 적용은 별도 결정 후 진행한다. 검토 통과를 배포 승인으로 해석하지 않는다.
4. iPhone `?workspace=content&review=iphone-restore-20261027` 빈 공간 전체 복원·재실행 확인. 비어 있지 않으면 중단.
5. C 문서 R1 사용자 검토. C 기능 구현은 B 마감 뒤 별도 지시한다.
- 기존 여행 삭제 금지. pnpm12.14.0/Node24.13.1/`.venv`, 캐시 `.cache/corepack`·`.cache/ms-playwright`.
- UI `pnpm run dev:ui` 5173, 빌드 후 `preview:ui` 4173, 회귀 `check:deferred`. 포트 소유 먼저 확인.
