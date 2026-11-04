# travel-app 현재 상태

2026-11-04 · **U3(C-12) 검토 통과 / C-13〔U4〕지시 발행 / U4 재수행(Q-U2·Q-U3·S6-d) 대기 / D 설계·계획 검토 준비**

## 현재 기준

- [실행계획](development-plan.md) → [범위](product-requirements.md) → [결정](decisions.md). 이전 상세는 [history](history/handoff-2026-11-04-before-c12-review.md).
- [UI 정리 계획](ui-polish-plan.md): U1 확인 완료, U2 [검토 통과](claude-task-c10-review.md), U3 [검토 통과](claude-task-c12-review.md)(`5b44859`), U4 [지시](claude-task-c13-ui-u4.md).
- 브랜치 `codex/c12-ui-u3`(c08~c12 포함). T-04/T-05/C-01~12 main 미병합. 최근 배포 `ac09ca0`, 이번 배포 없음.
- [D 설계](phase-d-design.md)·[D 계획](phase-d-plan.md) v0.2(벤치마킹 반영): 사용자 검토 대기, 구현·유료 호출 미착수.
- REG-02 수정(C-09): 후보 `local-data/phase2/c09-candidate/package/pilot.zip` `712369b3…` 평소 공간 적용은 사용자 결정 대기.
- REG-03 해소(C-11), CL-14·16~19·21 해소. 남은 후속은 [변경 기록](change-log.md).
- 기존 verified ZIP `d1832280…bbe0`·원본·백업·프로필 보존. 미추적 `docs/status-review-2026-10-26.md`·`research_notes/` 커밋 제외.

## 최근 검증·한계

- Codex C-12: 데이터 경계(contracts·storage·transfer·repository) 불변, `pnpm run check` 321/1 skip, 전체 E2E 151/0/1 skip(클라우드, 파일 입력 임시 치환 후 되돌림).
- 후속 R1(기록 날짜 머리가 상단 바 뒤로 숨음)·R2(다른 날로 정정된 기록 배지에 날짜 없음)는 차단 아님 → C-13.
- 모바일은 에뮬레이션. 실기기(iPhone) 빈 공간 복원·재실행·해시 확인은 대기.
- 실제 키/API·v2 AI 실행 없음. AI 운영/인증·모델/예산/전송 미결정.

## 다음 작업·확인 관문

1. 사용자: `git push origin codex/c12-ui-u3`.
2. Claude: [C-13〔U4〕](claude-task-c13-ui-u4.md) 수행(`codex/c13-ui-u4`) → Codex 검토.
3. 사용자: U4 대본 v2 축약 재수행(약 30분, `review=sapporo-u4`) → Q-U2·Q-U3·S6-d·CL-20 확인.
4. 사용자 결정: C-09 후보 패키지 적용, main 병합·배포, D 설계 검토.
- 기존 여행 삭제 금지. pnpm 12.14.0/Node 24.13.1, 캐시 `.cache/corepack`·`.cache/ms-playwright`.
- UI `pnpm run dev:ui` 5173, `pnpm run build; if ($?) { pnpm run preview:ui }` 4173, 회귀 `check:deferred`.
