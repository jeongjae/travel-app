# T-D0 Codex 독립 검토 · 기준 고정·공백 재현·Worker 이식 조사

2026-11-06 · 대상 `codex/d00-baseline` `7e0cf2a` · 판정 **통과**(조사 과제, 수정 지시 없음) · main fast-forward 병합(문서·증거만, 배포 없음)

## 1. 확인 범위와 결과

| 확인 | 결과 | 근거 |
|---|---|---|
| 제품 변경 0 | 통과 | `docs/` 밖 변경 0건. 증거·probe는 `docs/d00/`. 스파이크 설치는 `local-data/`(미커밋) |
| GitHub CI `7e0cf2a` | 성공 | checks 워크플로 |
| G1 조사 호출에 요청 원문·전체 장소 이름 | **독립 확인** | `server/ai-v2.ts` 조사 input에 `request: input.prompt`, `places: …map(({id,name}))` |
| G2·G3 제외 목록 방식·전체 장소 | **독립 확인** | `src/ai-v2-context.ts`: 활동은 `reservationText`·`executionNote`만 빼고 전개, 장소는 활성 head 전체 |
| G5 `consent: true` 고정 | **독립 확인** | `src/ai-v2-context.ts` 빌더에서 고정 |
| OpenAI hard limit·background 10분 보관·모델 이름 | 부분 확인 | 공식 spend-limits 문서·모델(`gpt-6-luna`·`gpt-6.1-terra`) 존재는 검색으로 확인. 원문 문구는 Codex도 직접 읽지 못함 → **T-D4 전 원문 재확인** 유지 |
| 간헐 실패(EPERM) | 수용(추정) | 저장소 폴더 45/3000 vs %TEMP% 0/3000 대조가 설득력 있음. 유발 프로세스 미확인 |

## 2. 판단

1. **차단 공백 G1~G13은 모두 실제 호출(T-D4) 전 해소 조건**으로 한다. 지금은 127.0.0.1 바인딩과 Pages 비활성 덕에 외부 노출이 없다.
2. Worker 권고(SQLite Durable Object + alarm + background 폴링, `calling`→`unknown`)를 수용한다. alarm 재시도와 "자동 재호출 금지"가 맞물리는 설계가 스파이크로 확인됐다.
3. 인증은 패스키 + 짧은 Bearer(쿠키 없음)를 수용한다. 막히면 TOTP로 내려가는 전환 비용이 작다. **추가 주의:** `jeongjae.github.io`는 SP-FR-guidebook 등 다른 저장소 Pages와 같은 origin이다. 그쪽에 외부 스크립트를 넣지 않는 것을 운영 규칙으로 둔다.
4. G1 해법: 사용자가 공개 질문을 따로 쓰는 대신 **조사 질문을 구조 필드(선택 활동의 장소 이름·날짜·요청 종류)로 자동 생성하고, 전송 미리보기에서 사용자가 고칠 수 있게** 한다. 자유 원문은 작성 호출에만. 모델 지시에 기대는 자동 정제는 쓰지 않는다(Claude 의견과 같음). T-D1 지시에 반영.
5. 범위 조정 제안(T-D1 추가 7건, Node `jobs.json` 수리는 T-D2로, 시험 작업 폴더 %TEMP% 이동 선행)을 수용한다.

## 3. 사용자 결정

| 결정 | 권고 | 시점 |
|---|---|---|
| 인증 수단 | 패스키 | T-D2 전 |
| OpenAI background 약 10분 보관 | 수용(전송 최소화 뒤라 보관 내용도 최소) | T-D2 전 |
| Workers 요금제 | Free 시작 | T-D4 전 |
| 모델·월 한도·일일 횟수(U-D2) | T-D4에서 luna·terra 1회씩 비교, hard limit 켬 | T-D4 전 |

## 4. 참고

- PC 작업 폴더에 별도 UI 작업(`docs/design/commercial-ui-design.md`·`ui-review-2026-11-06/`, handoff 1줄)이 미커밋 상태로 있다. T-D0와 무관하며 Codex는 건드리지 않았다. D와의 순서는 사용자 확인 필요.
