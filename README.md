# travel-app

## 최신 구현: P-06 완료, P-07 진행

공통 가이드 화면은 `/?workspace=content`입니다. 기존 화면은 `/?workspace=legacy`로 보존합니다. 여행 ZIP 패키지 미리보기·두 여행 선택·가이드/Fact/첨부·본문 편집·현장 기록/정정·모의 변경안 확인 적용·B/L/R 재가져오기·전체 ZIP 백업/빈 저장소 복원·첨부 복구를 구현했습니다. [P-06](docs/p06-report.md), [P-07 진행 보고](docs/p07-report.md), [pnpm 전환 검증](docs/pnpm-transition.md), [현재 인계](docs/handoff.md)를 따릅니다.

AI 서버 없이 가이드/로컬 저장 흐름을 실행하려면:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm run dev:ui
# 또는 pnpm run build 이후 pnpm run preview:ui
```

개발은 5173, 프로덕션 미리보기는 4173입니다. 같은 브라우저여도 origin별 DB는 독립입니다. ‘가상 여행 둘러보기’의 두 패키지는 실제 자료가 없는 표본이며 직접 선택한 뒤 추가합니다. 기존 데이터가 있으면 원문 보존·변환 보고를 확인한 뒤 명시적으로 전환합니다. 전환 이후 옛 화면 쓰기는 차단합니다.

새 가이드 저장소의 전체 백업/복원과 첨부 누락/손상 안내·복구는 가상 표본에서 검증했습니다. 실제 SP-FR 전수 이행·휴대폰 용량/파일 보관·실기기 검증은 남아 있습니다. P-07 실제 원천은 비공개 후보/차단 보고서까지 진행했으며 가져오기 완료가 아닙니다. 새 화면의 모의 변경안은 유료 AI 조사 완료를 뜻하지 않습니다. 아래 AI/JSON 설명은 기존 프로토타입 화면의 기능입니다.

여러 여행의 계획과 실제 기록을 분리해 보존하는 한국어 여행 앱의 첫 구현입니다.

소스 저장소: https://github.com/jeongjae/travel-app · 기존 참고 원본: https://github.com/jeongjae/SP-FR-guidebook

## 현재 범위

여행 생성·선택, 날짜별 일정과 계획 버전, 방문/건너뜀/예정 외 기록, 원본을 남기는 정정, 근거가 있는 변경안의 검토·승인·거절, revision 충돌 검사, JSON 가져오기/백업/복원, 프로덕션 앱 셸 오프라인 사용을 구현합니다.

**앱 내부 AI 조사·변경안 생성을 연결했습니다.** 변경안 화면에서 요청하면 OpenAI 웹 조사 → 구조화 변경안 작성 → 도메인 검증·제한된 자동 보정 → 초안 저장까지 수행합니다. 모든 변경안은 사용자 확인 후 현재 계획에 적용됩니다. 사용자 확정은 개인용·모바일 우선, 오프라인 조회·현장 기록·백업입니다. 공동 사용과 기기 간 자동 동기화는 첫 MVP에서 제외합니다. 현재는 로컬 개발 구현이며 휴대폰의 외부 접속을 위한 호스팅·인증·배포는 별도입니다.

AI는 서버의 `.env.local`을 사용합니다. 키를 브라우저·JSON 백업·Git에 포함하지 않습니다. 실제 키 생성·저장과 가상 여행으로 실시간 웹 조사·변경안 생성까지 확인했습니다. 이전에 저장에 실패한 첫 `Codex` 키의 Platform 폐기는 별도로 남아 있습니다.

## 전용 개발환경

- Node `24.13.1` (`.node-version`), pnpm `12.14.0` (`packageManager`)에서 확인
- TypeScript, React, Vite, Dexie/IndexedDB, Zod, Temporal, Vite PWA
- 직접 의존성은 정확 버전, 전이 의존성은 `pnpm-lock.yaml`으로 고정
- Chromium·프로젝트 임시 검사는 `.cache/`, 프로젝트 의존성은 `node_modules/`; pnpm 공유 store는 현재 사용자 설정을 유지
- 다른 프로젝트의 런타임·설정·원본 파일을 변경하지 않음
- 추출 검사: Python 3.12.7, 프로젝트 `.venv/`, 고정 `requirements-extract.txt`. `pnpm run check`에는 Python 원천 표본 검사가 포함되므로 전용 환경을 먼저 준비

```powershell
pnpm install --frozen-lockfile
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip --cache-dir .cache/pip install -r requirements-extract.txt
pnpm run dev
```

개발 주소: `http://127.0.0.1:5173`. 명령은 프런트엔드와 로컬 AI 서버(`127.0.0.1:8787`)를 함께 실행합니다. 포트가 사용 중이면 다른 프로젝트를 종료하지 않고 해당 충돌을 확인하세요. `pnpm run preview`도 AI 서버와 프로덕션 프런트엔드를 함께 실행합니다. 둘을 동시에 켜면 AI 서버 포트가 충돌하므로 하나를 선택하세요.

기본 모델은 `gpt-5.4-mini`이며 서버 환경 변수 `OPENAI_MODEL`로 변경할 수 있습니다. 키 원문을 채팅·소스 코드로 옮기지 말고 안전한 설정 절차를 사용하세요.

첫 화면에서 직접 여행을 만들거나 **예시 여행 불러오기**를 선택합니다. 두 예시 여행은 가상 데이터이며 자동 저장하지 않습니다. 파일 크기는 10 MiB 이하, 여행 기간은 367일 이내입니다.

## 검사와 프로덕션 미리보기

```powershell
pnpm run check
pnpm run browser:install
pnpm run test:e2e
pnpm run preview
```

`check`는 데이터 테스트·타입 검사·빌드입니다. `test:e2e`는 빌드 결과를 `http://127.0.0.1:4173`에서 PC와 모바일 크기로 검사합니다. PWA 오프라인은 개발 서버가 아닌 프로덕션 빌드에서 검증합니다. HTTPS 또는 localhost에서 서비스워커가 작동하며, 최초 온라인 실행·셸 설치가 필요합니다. 앱 업데이트는 편집 중 강제 재로드하지 않고 안내합니다.

AI 단위/HTTP 통합 검사와 브라우저 AI 흐름은 모의 제공자를 사용하므로 요금이 발생하지 않습니다. 로컬 HTTP 실행이 제한된 샌드박스에서는 해당 검사에 loopback 연결 권한이 필요합니다. `node scripts/smoke-ai.ts`는 실행 중인 로컬 AI 서버에 **가상 데이터로 실제 유료 요청**을 보내는 수동 검사이므로 일반 CI에는 포함하지 않습니다.

## 앱 안에서 AI 실행

1. 여행의 **변경안** 화면에서 변경 시작 날짜와 요청을 입력합니다.
2. **조사하고 변경안 만들기**를 누르면 현재 계획·장소·유효한 실제 기록·요청이 OpenAI로 전송됩니다. 과거 정정 기록·요청 영수증·이전 계획 버전은 모델 입력에서 제외합니다.
3. 조사 출처를 모으고 변경안을 작성합니다. 형식·시간대·여행 기간·참조·수정 범위를 검사하며, 오류가 있으면 작성 단계만 한 번 보정합니다. 인증·한도 오류를 자동 유료 재시도로 처리하지 않습니다.
4. 현재 revision이 같을 때 `repository.propose`로 초안을 자동 저장합니다. 다른 탭·현장 수정과 충돌하면 현재 계획을 유지하고 재요청을 안내합니다.
5. 변경 이유·이전/이후·예약 영향·미확인 조사 근거를 검토한 뒤 **확인하고 적용** 또는 **거절**을 선택합니다.

작업당 웹 조사 1단계(검색 도구 최대 2회), 작성 최대 2회, 각 요청 응답 최대 3000/4500 토큰, 모델 입력 컨텍스트 최대 60,000자입니다. 로컬 동시 작업 2개·여행별 진행 작업 1개·UTC 날짜 기준 하루 20개·보관 200개로 제한합니다. 이는 달러 기준 예산 상한이 아니며 API 요금은 별도입니다. 자동 조회·재로드는 작업 ID를 재사용하고 새 유료 작업을 만들지 않습니다.

작업 중단은 후속 저장을 막지만 이미 처리된 API 요청 요금이 취소되는 것은 아닙니다. 서버 재시작 시 진행 작업은 `interrupted`로 남으며 최신 컨텍스트로 사용자가 다시 실행합니다. 실패한 요청은 자동 재과금하지 않습니다. 완료된 초안·출처·상태는 `local-data/ai-jobs/jobs.json`에 남습니다. 이 파일에는 여행 정보가 포함될 수 있고 전체 여행 백업과 별도로 관리합니다.

로컬 API는 loopback에만 바인딩하고 Host/Origin·JSON 쓰기 헤더를 검사합니다. 공개 서비스용 인증을 구현한 것은 아닙니다. 실제 휴대폰 AI 접속을 위해서는 키를 서버에 두는 배포·인증 방식을 별도로 정해야 합니다. [OpenAI 웹 검색](https://developers.openai.com/api/docs/guides/tools-web-search)과 [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)을 사용합니다.

브라우저 DB는 origin별입니다. 개발(5173)과 미리보기(4173)의 데이터는 별도입니다. 다른 기기로 자동 동기화되지 않습니다. 브라우저 데이터 삭제 전에 백업을 다운로드하세요. 전체 복원은 빈 저장소에서만 실행합니다.

## 기존 SP-FR 가져오기

기존 저장소를 별도로 내려받은 경우 원본을 빌드하거나 수정하지 않고 일일카드만 묶습니다.

```powershell
node scripts/pack-spfr.mjs --source-dir "C:/your-path/SP-FR-guidebook/data/daily-cards" --name "스페인·프랑스 여행" --time-zone Europe/Paris
```

출력 `local-data/spfr-import.json`을 앱의 **가져오기**에서 검증·미리보기 후 추가합니다. `local-data/`는 Git에서 제외됩니다. 시차가 다른 여행은 `--zone-map`으로 `{ "2026-11-07": "Asia/Seoul", "2": "Europe/Paris" }`처럼 날짜 또는 일차별 시간대를 지정하세요. 이미 있는 출력 파일과 원본 폴더에는 쓰지 않습니다.

지원: 날짜·일정·장소 참조·메모·원본 출처. 제외: 기존 visited 저널의 실제 방문 추정, 예약/호텔 객체·사진·장소 장문·지도 경로. 가져온 sourceRefs는 미확인 근거로 보존합니다. 사용자 지정 시각이 DST에서 모호하면 가져오기를 거부하며 원본 검토 후 명시적 오프셋이 있는 travel-app JSON을 사용해야 합니다.

## AI 변경안 파일

**변경안 → AI 컨텍스트 내보내기**는 여행의 현재 revision·계획·실제 기록·입력 계약을 다운로드합니다. `proposalContract`는 채워야 하는 틀이며 빈 operations는 적용할 수 없습니다. AI가 작성할 파일 형식:

```json
{
  "format": "travel-app-proposal",
  "schemaVersion": 1,
  "proposal": {
    "id": "독립적인-변경안-ID",
    "tripId": "컨텍스트의-trip-id",
    "baseRevision": 0,
    "reason": "변경 이유",
    "reservationImpact": "영향받는 예약 또는 영향 없음",
    "evidence": [],
    "operations": [{
      "type": "upsert",
      "activity": {
        "id": "일정-ID", "title": "동네 산책",
        "start": "2026-11-07T10:00:00+01:00",
        "end": "2026-11-07T11:00:00+01:00",
        "timeZone": "Europe/Paris", "note": "사용자가 정한 일정"
      }
    }]
  }
}
```

`upsert`는 같은 ID 일정의 수정 또는 새 일정 추가, `remove`는 `{ "type": "remove", "activityId": "대상-ID" }`입니다. evidence 항목은 `id`, `source`, `claim`, `checkedAt`(ISO 시각), `appliesFrom`/`appliesTo`(날짜), `relatedActivityIds`, `status`(`verified`/`unverified`)를 가집니다. 날짜는 해당 여행 범위에 맞춰야 합니다. `verified`는 입력 작성자의 확인 표시이며 앱이 웹 사실을 독립 검증했다는 뜻이 아닙니다.

미리보기 후 가져와도 계획은 바뀌지 않습니다. **확인하고 적용** 때 최신 revision을 다시 검사하고 새 버전으로 저장합니다. 사이에 현장 기록이나 다른 탭의 편집이 있으면 최신 컨텍스트로 새 변경안을 작성해야 합니다. 앱은 예약·결제·외부 메시지·GitHub 데이터 쓰기를 실행하지 않습니다.

## 이어서 읽을 문서

- [제품 요구와 MVP](docs/product-requirements.md)
- [기존 코드 조사](docs/source-review.md)
- [데이터 모델](docs/data-model.md)
- [기술·제품 결정](docs/decisions.md)
- [개발계획](docs/development-plan.md)
- [현재 상태와 다음 작업](docs/handoff.md)

원격 공개 배포와 실제 예약·개인 데이터 커밋은 이 초기 설정에 포함하지 않습니다.
