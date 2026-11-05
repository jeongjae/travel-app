# C-15 결과 — 파리 여행 읽기 화면 정리

2026-11-05 · 브랜치 `codex/c15-paris-reading`(main `18bb853` 기준) · 상태: **구현 / 최종 소스 전체 E2E 재실행 필요 / Codex 검토 대기 / 사용자 확인 대기**
표시만 바꿨다. 저장 데이터·스키마·저장 명령·어댑터·패키지 변경 0건. main 병합·배포 안 함.

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

1. **`지역 상세 안내` 이름**: 지시서 예시는 `상점·영업 안내`였으나, 본문 9건을 대표 표본(Paris)으로 읽으면 핵심 판단·일정·숙소·이동·먹거리를 담은 지역 장(章)이라 예시를 따르지 않았다. 사용자 확인 필요.
2. **대표 사진 순위**: 지시서 순서를 그대로 쓰면 일정 문구에 이름이 나오는 빵집이 관광 장소를 이긴다. 그래서 관광 장소를 먼저 두었다. ① 이름 전체가 나오는 관광 장소 ② 고유한 낱말만 나오는 관광 장소(흔한 낱말·도시 이름 제외) ③ 그 밖의 관광 장소 ④ 이름 전체가 나오는 이동·식사·숙소 ⑤ 나머지. 같은 순위는 저장 순서.
3. **`사진 N장` 띠**: 사진이 2장 이상일 때만 보인다. 1장인 날은 대표 사진만 보인다.

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

**전체 E2E는 최종 소스에서 끝까지 돌지 못했다.** 마지막 소스 수정 2건(대표 사진 캡션의 장소 이름 중복 제거, `⋯ 편집` 단추 여백)은 E2E 미검증이다.

| 실행 | 소스 | 결과 |
|---|---|---|
| `pnpm run check`(포맷·lint·단위·빌드) | 최종 | 통과. 단위 340건 통과, 1건 건너뜀. 새 시험 `tests/c15-reading.test.ts` 11건 |
| `check:deferred` `06-40-30` | 수정 2건 직전 | exit 0(check·test:e2e·check:pilot). E2E 171건 통과, 5건 건너뜀, 실패 0 |
| `check:deferred` `06-52-59` | 최종 | `check`에서 중단. `tests/ai-v2.test.ts` 1건 실패(아래 불안정 시험), E2E 미실행 |
| `check:deferred` `06-54-52` | 최종 | `check` 통과. **E2E 91건 통과, 23건 실패, 59건 미실행**, `check:pilot` 미실행. 단언 실패는 0건이고 실패 23건 모두 `worker process exited unexpectedly (code=3221225794)` 22건과 `Target crashed` 1건. 실행 중 시스템 메모리가 부족해 도구가 백그라운드 작업을 중단했다(직후 여유 2.1GB / 15.7GB) |
| 실제 패키지 대조 2건(모바일·데스크톱) | 수정 2건 직전 | 통과. 수정 2건은 대표 사진 고르기 규칙을 바꾸지 않아 대조표 값은 그대로다 |

메모리가 확보된 뒤 `pnpm run check:deferred`를 다시 돌려야 한다. `docs/design/ui-c15/` 스크린샷도 수정 2건 직전 빌드이므로 `UI_C15_SHOTS=1`로 다시 찍어야 한다.

기존 시험 변경:
- 편집 단추가 메뉴로 들어가 `guideMenu` 도우미로 메뉴 열기 단계를 추가: `guides`·`content`·`field-records`·`retrospective`·`c07-sapporo`·`ui-u3`. 단언 자체는 그대로다.
- **규칙이 바뀌어 단언을 바꾼 곳 3건**: `c14-display-names`의 `Commercial Guide Module` 라벨 2줄, `ui-c14` P3(단추 이름 전역 유일 → 지역 절이 서로 다르고 단추는 `지역 상세 안내`), `ui-c14` 실제 패키지 시험(전역 유일 → 절 안 유일). 지역 접두를 빼라는 지시의 결과이므로 Codex 검토 때 함께 확인 바람.

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
- 목차 번호는 `##`/`###` 줄 기준이다. 밑줄식 머리말(`===`)이 본문에 있으면 목차 이동 위치가 어긋날 수 있다. 실제 패키지 지역 가이드는 `#` 방식만 확인했다(Aix·Paris 표본).
- 스크린샷: `docs/design/ui-c15/`(가상 표본).
- 대표 사진 위치는 C-14까지와 같이 활동 목록 아래다. 날짜를 열면 활동 카드 썸네일이 먼저 보인다. 위로 올릴지는 사용자 확인 때 판단 바람.
- 불안정 시험: `tests/ai-v2.test.ts`가 전체 실행 중 간헐 실패했다(시간 초과 1회, `expected validating to be failed` 1회). 단독·재실행은 통과. C-15가 건드리지 않은 파일이라 수정하지 않았다.
