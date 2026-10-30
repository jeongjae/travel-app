# 문서 안내

현재 실행 기준은 [handoff](handoff.md) → [개발계획](development-plan.md) → [요구사항](product-requirements.md) → [결정](decisions.md) 순서다.

## 진행 중인 작업

- [C-04〔T-C5〕결과](claude-task-c04-result.md)·[독립 검토](claude-task-c04-review.md): 22검사·빌드·UI 12개 통과, 사용자 검토 준비. 다음 C-05〔T-C6〕.
- [C-03〔T-C4〕결과](claude-task-c03-result.md)·[독립 검토](claude-task-c03-review.md): 40검사·빌드·UI 10개 통과, 사용자 검토 준비. 다음 C-04〔T-C5〕.
- [C-02〔T-C3.2〕결과](claude-task-c02-result.md)·[독립 검토](claude-task-c02-review.md): 38검사·빌드·UI 8개 통과, DST 경계는 CL-08 후속. 다음 C-03〔T-C4〕.
- [C-01 결과](claude-task-c01-result.md)·[독립 검토](claude-task-c01-review.md): 소유 연결 R1 포함 독립 검토 통과, 사용자 검토 준비. 다음은 T-C3.2 숙박·이동 편집.
- [후속 변경 목록](change-log.md): T-06/F-2·F-3 등 보류 항목과 재개 조건, 별도 확인 관문.
- [T-04 결과](claude-task-04-result.md)·[검증 기록](claude-task-04-review.md): Codex 대상 30개 통과. main 병합·사본 적용 대기.
- [T-05 R2 결과](claude-task-05-r2-result.md)·[독립 검토](claude-task-05-review.md): 27검사·빌드·계획 UI PC/모바일 6검사 통과. main 병합·적용·사용자 확인 대기.
- [C단계 설계서](phase-c-design.md)·[C단계 개발계획](phase-c-plan.md): 별도 여행 작성·현장 기록·회고. Claude 초안을 Codex가 [검토](phase-c-review.md)·[R1 보완](phase-c-r1.md) 완료. 사용자 미확인. C-01 구현/검토 상태는 위 결과·검토 기록을 따른다.
- [T-03 결과](claude-task-03-result.md)·[Codex 검증](claude-task-03-review.md): 원천/지역 ZIP 대조와 도구 보호 보완.
- [이행 잔여 목록](deferred-verification.md): REG-01·원천 콘텐츠·실기기·사용자 확인.
- [iPhone 확인 절차](phase-2-prime-runbook.md): 백업 파일 재선택·빈 공간 복원 등.

## 계약과 증거

- [저장/교환 계약](storage-and-exchange-contracts.md), [원천 대응](content-db-mapping.md), [최종 목표](goal-and-migration-criteria.md).
- [실데이터 PC 증거](full-verification-2026-10-26.md), [T-02 배포 검증](claude-task-02-review.md).
- 기존 단계 보고서는 해당 당시의 증거다. 현재 단계나 새 코드의 검사 결과로 재사용하지 않는다.

## 과거 기록

사용을 마친 지시서는 [history/instructions](history/instructions/), 과거 계획·인계는 [history](history/)에 보관한다.
초기 PROJECT_INSTRUCTIONS.md·SESSION_HANDOFF.md는 프로젝트 배경이므로 유지한다.
2026-10-28에 과거 구현 시작/재개 지시문과 T-01/T-02 최초 지시서 총4개를 보관 위치로 옮기고 링크를 갱신했다.
실제 데이터·백업·릴리스 자산·소스 코드·Git 이력은 정리 대상으로 삭제하지 않았다.
