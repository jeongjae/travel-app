# C-15 결과 — 파리 여행 읽기 화면 정리

2026-11-05 · 브랜치 `codex/c15-paris-reading`(main `18bb853` 기준) · 상태: **구현 / Codex 조건부 통과 · R1 반영 / 사용자 지시로 main 병합·배포 / 사용자 화면 확인 대기**
표시만 바꿨다. 저장 데이터·스키마·저장 명령·어댑터·패키지 변경 0건. 

## 변경 요약

| ID | 변경 | 위치 |
|---|---|---|
| Q1 | 여행 메모 대화상자 제목에 `tripDisplayName` | `ContentApp.tsx` |
| Q2 | 준비·회화를 `여행 전체` + 지역 절(일정 첫 등장일 순)로 묶음. 절 안 지역 접두 제거, 순서 고정 | `prep-groups.ts`, `ContentApp.tsx` |
| Q2 | `Commercial Guide Module` → 표시 이름 `지역 상세 안내` | `display-names.ts` |
| Q2 | 가이드 상세: 제목 → 본문 `##`/`###` 목차 → 본문. 편집은 `⋯ 편집` 메뉴 하나, 원천 속성·경로는 맨 아래 `원천 정보` 접기, 준비·회화에서 왔으면 위·아래 `준비·회화로` | `Guide.tsx`, `guide-view.ts`, `ActionMenu.tsx` |
| Q2 | 지역·장소 화면도 같은 구조(`기본정보 수정`·`지역 가이드 작성`도 메뉴로) | `Guide.tsx` |
| Q3 | 대표 사진 순위, `사진 N장` 띠, 활동 카드 56px 썸네일·장소 이름, 사진 없는 날 `사진 없음` | `day-photos.ts`, `DayDetails.tsx`, `ContentApp.tsx` |

## 판단이 필요한 항목

1. **`지역 상세 안내` 이름**: 지시서 예시는 `상점·영업 안내`였으나, 본문 9건을 대표 표본(Paris)으로 읽으면 핵심 판단·일정·숙소·이동·먹거리를 담은 지역 장(章)이라 예시를 따르지 않았다. 사용자가 승인했다.
2. **대표 사진 순위**: 지시서 순서를 그대로 쓰면 일정 문구에 이름이 나오는 빵집이 관광 장소를 이긴다. 그래서 관광 장소를 먼저 두었다. ① 이름 전체가 나오는 관광 장소 ② 고유한 낱말만 나오는 관광 장소(흔한 낱말·도시 이름 제외) ③ 그 밖의 관광 장소 ④ 이름 전체가 나오는 이동·식사·숙소 ⑤ 나머지. 같은 순위는 저장 순서.
3. **결정 반영(사용자, 2026-11-05)**: `지역 상세 안내` 이름 승인. 대표 사진과 `사진 N장` 띠를 활동 목록 위로 옮겼다.
4. **`사진 N장` 띠**: 사진이 2장 이상일 때만 보인다. 1장인 날은 대표 사진만 보인다.

## Q1 전수 확인

| 지점 | 처리 |
|---|---|
| `ContentApp.tsx` `<title>`·머리 단추·여행 목록·미리보기 | C-14에서 적용됨 |
| 여행 메모 대화상자 제목 | 이번에 적용 |
| 여행 메뉴의 전체 이름(`.trip-full-name`)·목록 `title` 속성 | 전체 이름을 일부러 유지 |
| 회고·백업·복구·알림 문구 | `header.name` 사용 없음(`grep` 확인) |
| 옛 작업공간 `src/App.tsx` | 범위 밖이라 변경 안 함 |

메모 목록의 `원천 대상 stay:Nice · 앱 예약 연결 미확정`은 어댑터가 **저장 본문**에 넣은 글(`spfr-field-state.ts:97`)이라 손대지 않았다. 고치려면 어댑터 v5와 재가져오기가 필요하다.

## 검사

| 실행 | 소스 | 결과 |
|---|---|---|
| `pnpm run check` | 최종(R1 포함) | 통과. 단위 342건 통과, 1건 건너뜀. 새 시험 `tests/c15-reading.test.ts` 13건 |
| `ui-c15`·`guides`·`content` E2E + 실제 패키지 대조 2건 | 최종(R1 포함) | 44건 통과, 실패 0 |
| 실제 패키지 대조, 개발 서버 5173(StrictMode, 모바일) | 최종(R1 포함) | 통과 |
| `check:deferred` `07-35-26` | 대표 사진 이동 뒤, R1 직전 | exit 0. E2E 171건 통과, 5건 건너뜀, 실패 0 |

R1 뒤 전체 E2E는 Codex 지시대로 GitHub CI 결과로 갈음한다. 이전 메모리 부족 중단(`06-54-52`, 워커 비정상 종료 23건)은 메모리를 확보한 재실행으로 해소됐다.

기존 시험 변경:
- 편집 단추가 메뉴로 들어가 `guideMenu` 도우미로 메뉴 열기 단계를 추가: `guides`·`content`·`field-records`·`retrospective`·`c07-sapporo`·`ui-u3`. 단언 자체는 그대로다.
- **규칙이 바뀌어 단언을 바꾼 곳 3건**: `c14-display-names`의 `Commercial Guide Module` 라벨 2줄, `ui-c14` P3(단추 이름 전역 유일 → 지역 절이 서로 다르고 단추는 `지역 상세 안내`), `ui-c14` 실제 패키지 시험(전역 유일 → 절 안 유일). 지역 접두를 빼라는 지시의 결과이므로 Codex 검토 때 함께 확인 바람.

## Codex 검토 R1 반영

- **R1-a 한국어 역 이름**: `역\b`는 한글 뒤에서 일치하지 않았다. `역(?![가-힣])`로 고쳤다. `삿포로역`·`오타루역 앞`·`JR 삿포로역 남쪽 출구`는 이동, `역사 박물관`은 관광 장소(단위 시험).
- **R1-b 목차 이동 대상**: 렌더 중 세던 번호와 정규식 추출을 없앴다. 목차와 머리말 id를 모두 같은 `remark` 해석 결과에서 얻는다. id는 해석 단계 플러그인(`remarkHeadingIds`)이 붙이므로 렌더 횟수와 무관하고, 인용·목록 안 머리말과 밑줄식 머리말도 같은 순서로 센다. 이미 번들에 있던 `remark-parse`·`unified`를 직접 의존성으로 올렸다.
- **R1-b 확인**: 실제 패키지 지역 가이드 9개 전부에서 목차 단추마다 대상 머리말이 있고 글자가 같다(Barcelona 13·Girona 14·Nice 13·Verdon 5·Aix 14·Luberon 12·Avignon 13·Lyon 13·Paris 10). 개발 서버(StrictMode)에서는 수동 대신 같은 시험을 `C15_BASE_URL`로 돌려 확인했다.
- **R1-c 스크린샷**: `docs/design/ui-c15/` 6장을 최종 빌드로 다시 찍었다. 가상 표본의 사진은 1×1 흰색 이미지라 사진 자리가 비어 보인다. 실제 사진은 커밋하지 않는 `local-data/c15-real/q3-*.png`에서 확인했다.

## 실제 패키지 대조 (읽기 전용)

`local-data/phase2/c09-candidate/package/pilot.zip`을 검토 공간에 가져와 확인. 산출물 `local-data/c15-real/`(커밋 안 함). 재현: `C15_REAL_PACKAGE=<경로> pnpm run test:e2e tests/e2e/ui-c15.spec.ts -g 실제`.

- 준비·회화: 절 10개(여행 전체 + Barcelona → Girona · Empordà → Nice · Côte d'Azur → Verdon · Moustiers → Aix-en-Provence → Luberon → Avignon · Alpilles → Lyon → Paris), 단추 45개 유지. 지역 절은 모두 `지역 가이드 / 지역 상세 안내 / 생활·도착·귀가 안내 / 교통권과 이용 안내`.
- Aix 지역 가이드: 제목 `Aix-en-Provence · 지역 가이드`, 목차 14개.
- 43일 중 대표 사진 변경 19일. 화면 대표와 규칙 계산값이 43일 모두 일치(시험에서 단언).
- 수정 전 첫 대표였던 출발역 `Nice-Ville`(9/6~9/9)은 모두 관광 장소로 바뀌었다.

### 43일 대조표

장소 이름만 적었다. 이전 대표는 저장된 첫 사진이다.

| 날짜 | 이전 대표 | 새 대표 | 사진 | 고른 이유 · 비고 |
|---|---|---|---|---|
| 08/29 | 사진 없음 | (같음) | 0 | 사진 없음 |
| 08/30 | Sant Pau Recinte Modernista | (같음) | 4 | 일정 문구에 이름이 나오는 관광 장소 |
| 08/31 | Mercat de la Concepció | MACBA | 5 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/01 | Barcelona Sants | Cau Ferrat | 3 | 관광 장소 |
| 09/02 | Collioure | (같음) | 1 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/03 | Pals | Peratallada | 2 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/04 | Promenade des Anglais | (같음) | 1 | 관광 장소 |
| 09/05 | Cours Saleya | Colline du Château | 4 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/06 | Nice-Ville | Cannes | 4 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/07 | Nice-Ville | Le Rocher | 4 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/08 | Nice-Ville | Villa Ephrussi de Rothschild | 3 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/09 | Nice-Ville | Point Sublime | 5 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/10 | Moustiers-Sainte-Marie | Route des Crêtes | 5 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/11 | Vieux-Port de Marseille | Le Panier (마르세유 구시가지) | 5 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/12 | Aix 시장 — Place Richelme · 목요 확장 구역 | (같음) | 4 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/13 | Lourmarin | (같음) | 1 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/14 | Roussillon · Sentier des Ocres | (같음) | 2 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/15 | Gordes | (같음) | 3 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/16 | Saint-Rémy-de-Provence | (같음) | 2 | 관광 장소 |
| 09/17 | Uzès Place aux Herbes · 구시가지 | Pont du Gard | 2 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/18 | Arènes d'Arles | (같음) | 5 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/19 | Les Halles d'Avignon | Palais des Papes | 5 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/20 | Bellecour | (같음) | 2 | 관광 장소 |
| 09/21 | Fourvière | (같음) | 3 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/22 | Croix-Rousse | Parc de la Tête d'Or | 3 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/23 | Annecy 구시가지 · 호수 | (같음) | 2 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/24 | Le Relais du 15ème | (같음) | 1 | 식사 · **어색함**: 그날 사진이 식당 1장뿐 |
| 09/25 | Boulangerie Pichard | Grand Palais | 3 | 관광 장소 |
| 09/26 | Boulangerie Pichard | (같음) | 2 | 숙소 · **어색함**: 사진이 빵집·식당 2장뿐. Sainte-Chapelle·Conciergerie는 패키지에 사진 없음. `숙소` 판정은 빵집이 `오전 생활 일정 · 숙소 휴식`(hotel) 활동에 연결된 탓 |
| 09/27 | Marché Convention | Musée Picasso Paris | 4 | 일정 문구에 이름이 나오는 관광 장소 |
| 09/28 | Musée Gustave Moreau | (같음) | 4 | 관광 장소 |
| 09/29 | Versailles | (같음) | 3 | 관광 장소 |
| 09/30 | Musée de l'Orangerie | (같음) | 4 | 관광 장소 |
| 10/01 | Musée d'Orsay | (같음) | 4 | 관광 장소 |
| 10/02 | Boulangerie Pichard | Musée du Louvre | 3 | 일정 문구에 이름이 나오는 관광 장소 |
| 10/03 | Boulangerie Pichard | Musée Marmottan Monet | 3 | 관광 장소 |
| 10/04 | Breizh Café Charles Michels | (같음) | 1 | 식사 · **어색함**: 그날 사진이 식당 1장뿐. 경마 대회 장소 연결 없음 |
| 10/05 | Musée Jacquemart-André | (같음) | 2 | 관광 장소 |
| 10/06 | Marché Convention | Musée d'Orsay | 4 | 일정 문구에 이름이 나오는 관광 장소 |
| 10/07 | Bourse de Commerce — Pinault Collection | (같음) | 4 | 관광 장소 |
| 10/08 | Les Marches | Musée d’Art Moderne de Paris | 3 | 관광 장소 |
| 10/09 | Café du Commerce | (같음) | 1 | 식사 · **어색함**: 그날 사진이 카페 1장뿐(귀국일) |
| 10/10 | 사진 없음 | (같음) | 0 | 사진 없음 |

어색한 4일(9/24·9/26·10/4·10/9)은 그날 사진이 식사·빵집뿐이라 표시 규칙으로 고칠 수 없다. 원인은 패키지에 해당 관광 장소 사진이 없거나 활동이 장소에 연결되지 않은 것이므로 어댑터 v5·사진 보강 후보로만 기록한다. 8/29·10/10은 `사진 없음`으로 보인다.

## 미검증·남은 후보

- 미검증: 실기기, 사용자의 평소 공간 화면. 실제 패키지 확인은 검토 공간에서 한 것이다.
- 어댑터 v5 후보: 메모 본문의 원천 키, 빵집을 숙소 활동에 연결한 경우(9/26), 관광 장소 사진 없음.
- 불안정 시험: `tests/ai-v2.test.ts`가 전체 실행 중 간헐 실패했다(시간 초과 1회, `expected validating to be failed` 1회). 단독·재실행은 통과. C-15가 건드리지 않은 파일이라 수정하지 않았다.
