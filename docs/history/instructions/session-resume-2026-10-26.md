> 과거 지시서 보관본입니다. 현재 실행에는 [handoff](../../handoff.md)와 [개발계획](../../development-plan.md)을 사용하세요.

# 새 세션 재개 지시문

2026-10-26 · 아래 코드 블록을 새 세션의 첫 메시지로 붙여 넣는다. 현재 상태는 복제하지 않고 `handoff.md`에서 읽는다. 이 파일 작성은 새 세션 생성이나 후속 검증 실행을 뜻하지 않는다.

```text
작업공간: <프로젝트 경로>
저장소: jeongjae/travel-app (main)

AGENTS.md → docs/handoff.md → docs/development-plan.md → docs/product-requirements.md → docs/decisions.md 순서로 읽고 이어서 작업해 주세요. PROJECT_INSTRUCTIONS.md와 SESSION_HANDOFF.md는 초기 배경이며, 현재 상태·후속 결정과 혼동하지 마세요.

1. 먼저 git status/현재 브랜치/HEAD/원격과 실제 포트·프로세스를 확인하세요. pnpm·기존 데이터·백업·검토 프로필을 점검하고 개인 통합 ZIP의 크기·해시를 handoff와 대조하세요. 키 원문을 읽어 출력하거나 원본 SP-FR-guidebook·사용자 DB를 변경하지 마세요.
2. 구현·검증·사용자 확인을 구분해 현재 상태와 첫 작업을 짧게 보고하세요. G0·G1·기존 B-01은 사용자 확인 완료입니다. 전체43일 ZIP 생성과 앱 공개는 G2/G2′/G3 완료가 아닙니다. 최근 기본 자동 회귀 통과와 미검증 전체 실데이터·실기기·v2 AI 항목을 구분하세요.
3. 다음은 후속 일괄 검증입니다. docs/deferred-verification.md와 docs/phase-2-continuous-report.md를 따라 별도 검증 저장소에서 실제 전체43일의 원천→DB→화면·첨부 해시·편집/재시작·오프라인·백업/빈 공간 복원·B/L/R을 검증하세요. 기존 사용자 DB/프로필을 테스트에 재사용하거나 초기화하지 마세요. 필요한 수정은 검증 가능한 단위로 진행하세요.
4. iPhone Chrome은 https://jeongjae.github.io/travel-app/ 에서 확인합니다. docs/web-release-2026-10-25.md와 docs/phase-2-prime-runbook.md로 개인 ZIP 파일 앱 전달/선택·OPFS·오프라인·종료/복원 확인을 지원하세요. 실제 기기 접근/사용자 응답이 필요하면 필요한 항목만 요청하고, 기다리는 동안 독립적으로 할 수 있는 PC 검증을 계속하세요. 모바일 viewport나 사용자 무응답을 실기기 확인 완료로 기록하지 마세요.
5. SP-FR-guidebook의 UI/UX 경험 보존·사람이 유지보수할 수 있는 코드(I-7)·revision 충돌 방지·변경안 확인 후 적용을 유지하세요. pnpm 고정 버전과 프로젝트 캐시를 사용하고, 의미 있는 코드 변경 후 check 및 UI/저장 변경 후 빌드·E2E를 실행하세요. 기존 성공 결과를 새 변경의 증거로 재사용하지 마세요.
6. GitHub Pages는 앱 셸·가상 표본만 공개됐고 실제 여행·예약·키·백업은 공개 금지입니다. 소스 변경의 main push는 Pages 재배포를 유발할 수 있으므로 공개 대상을 점검하세요. 정적 웹의 AI 서버는 미연결이며, v2 AI 호스팅/인증·모델/예산/전송 범위를 확정하기 전 활성화·유료 호출·키 변경을 하지 마세요. 명시적 요청 없이 worktree를 만들지 마세요.
7. 작업을 검토 가능한 단위로 나눠 커밋·push하고 각 보고에 결과를 남기세요. 포맷·린트 자동 수정·구조 변경은 별도 커밋입니다. docs/handoff.md는 현재 상태만 50줄·2,500자 이내로 교체하고 상세 근거는 단계 보고에 기록하세요. 자동 검사와 사용자가 직접 보는 산출물·확인 상태를 함께 제시하고 미완료를 완료로 표시하지 마세요.
```
