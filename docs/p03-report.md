# P-03 중간보고: 읽기 추출·정규화·패키지

2026-10-21

## 구현

- `scripts/extract-source.py`: 지정 root/선택 manifest의 Python 상수(AST), XLSX 셀/수식·캐시, JSON, Markdown, 첨부 메타데이터를 읽기 전용 중간 추출 v1로 만든다. 원천 모듈을 import/실행하지 않는다. 원천 밖 경로·중복·크기/AST 깊이/셀/해제량 제한과 읽기 전후 해시 검사를 둔다.
- `src/transfer/normalize.ts`: 공통 여행 JSON을 공유 v2 계약으로 검증하고 명시적 Python 예약 상수/neutral XLSX 예약 열 대응 규칙으로 정규화한다. 출처 locator/rawValue·direct/transformed/retained-source/unresolved와 차단 목록을 남긴다. 재가져오기 기준 B는 실제 적용할 payload로 만든다.
- `src/transfer/package.ts`: 15개 collection NDJSON·manifest·보고서·첨부 ZIP을 만들고 읽는다. UTF-8/LF·중복 JSON/행·고아 자식·엄격 schema/전체 참조·파일 해시/길이·수량·첨부 메타데이터를 검사한다. 읽는 중 실제 해제 바이트 한도/취소, symlink/암호화/중복/위험 경로/미신고 파일을 거부한다.
- `scripts/pack-source.mjs`: 추출→정규화→패키지 PC 명령. `public/pilot/*.zip`는 실제 자료가 아닌 F-01/02 가상 패키지이며 명시적으로 선택할 때만 앱에 추가한다.

## 자율 선택·근거

| 항목 | 실행한 방안 |
|---|---|
| SP-FR 전체 어댑터 | 실제 전체 이행을 앞당기지 않고 공통 계약+명시적 선택/대응 규칙을 먼저 구현했다. 실제 원천의 모든 필드·시트·미디어/권리 대응은 P-07 대조가 필요하다. 현재 neutral 어댑터를 SP-FR 전체 변환 완료로 부르지 않는다. |
| 미지원 계산식/캐시 없는 수식 | 추정 실행·재계산하지 않고 unresolved로 보고하며 기본 적용을 차단한다. 테스트의 의도된 실패 표본만 명시적으로 retained-source로 분류해 분리 검증했다. |
| XLSX 시각/상태 | 명시된 날짜 열과 ‘오후’ 원문을 각각 보존한다. 외부 예약 확정·발생 시각으로 승격하지 않는다. 다른 예약에서 행동/패스 설명을 복제하지 않는다. |
| 교환 목적 | 현재는 migration 패키지 v2만 활성화한다. trip-transfer의 새 ID 복사와 전체 백업 복원은 별도 구현 단계로 남기고 지원하는 척 받지 않는다. |
| 브라우저 검증 환경 | 8787 바인딩은 EADDRINUSE로 확인됐다. 소유를 확인할 수 없는 프로세스를 종료하지 않고 Playwright를 preview:ui(4173)+모의 AI 응답으로 분리했다. Browser plugin/runtime가 제공되지 않아 프로젝트 Playwright를 사용한다. |

사용자의 자율 진행 위임에 따른 기술 선택이며 제품 정책의 새 합의로 기록하지 않는다.

## 검증

- P-02 최종 기존 E2E: **14/14 통과**(PC 7, 모바일 7). 첫 서버 기동 실패는 위 포트 분리로 해결했다.
- 새 이행 검사 **3개 통과**: 원천 실행 없는 JSON/AST/XLSX 추출→공유 TS 정규화→예약 두 종류/패키지 왕복, 모든 레코드/첨부 해시·크기/취소·차단 미해결, 파일 변조/위험 경로/symlink 거부.
- Node 직접 가상 패키지 생성 통과. 실제 예약/원문/사진은 사용하지 않았다.
- P-04/05 완성 후 전체 check **94개·타입/빌드**, E2E **26개** 통과. Python 환경 검사 3개/native Node/별도 의존성 브라우저 번들/pip check도 통과했다.
- 원천 대응은 모든 활성 콘텐츠와 계획·여행 메타데이터를 포함해야 준비를 허용한다. 일부 mapping 누락을 원본 제거로 오해해 적용하지 않는다. 원본의 inactive 상태는 과거 행을 보존한 채 삭제 검토로 표현한다.
- CI에도 `.python-version`의 전용 venv/고정 requirements와 환경 검사를 추가했다. 공식 [setup-python v7 사용 지침](https://github.com/actions/setup-python#basic-usage)을 확인했고 Windows/Linux의 Python 실행 경로를 분리했다. **원격 CI 실행은 미검증**이며 push하지 않았다.

## 재현

```powershell
.venv/Scripts/python.exe scripts/extract-source.py --root local-data/source --spec local-data/spec.json --output local-data/extract.json --repository synthetic/example --commit fixed-source-revision
node scripts/pack-source.mjs --extract local-data/extract.json --dataset-key trip.json --root local-data/source --output local-data/trip.zip
node scripts/make-pilot-packages.mjs
```

예시 경로의 원천/선택 spec은 사용자가 실제로 준비한 자료에 맞춰야 한다. 위 명령 예시는 실제 SP-FR 자료에서 실행했다는 뜻이 아니다. 전체 원천의 전수 manifest·화면 표시 동등성·모바일 메모리 실측·전체 백업/복원은 미검증이다.
