# 무협 게임 데이터 구조

## world/ — 정적 세계관

### 기본 시스템
| 파일 | 내용 |
|------|------|
| `factions.json` | 무림맹·사도련·천마신교 3대 세력 |
| `realms.json` | 무공 경지 7단계 × 3소단계 = 21단계 |
| `regions.json` | 중원의 지리·도시 |
| `lore.json` | 시대 배경·역사적 사건 |
| `society.json` | 일반인 사회 구조 (무림인:일반인 1:1), 기녀 문화, 연애·혼인 |

### 문파·세가
| 파일 | 내용 |
|------|------|
| `sects.json` | 20개 문파/조직 개요 |

### NPC (약 400명)
| 파일 | 내용 |
|------|------|
| `supreme_ranks.json` | **육천오황팔왕칠성** 26인 (천하 정점) |
| `four_beauties.json` | 중원사화(中原四花) — 4대 미녀 |
| `npcs.json` | NPC 인덱스 |
| `npcs/shaolin.json` ~ `npcs/cheonma.json` | 문파별 NPC (20개 파일) |
| `npcs/next_generation.json` | 후기지수 |
| `npcs/courtesans.json` | 기녀와 기루 |
| `npcs/commoners.json` | 일반인 샘플 (즉석 생성 참고) |
| `npcs/legendary_dead.json` | 전대 인물 |

### 무공·물품
| 파일 | 내용 |
|------|------|
| `martial_arts.json` | 무공 ~140종 |
| `manuals.json` | 비급 ~90종 |
| `elixirs.json` | 영약·내단·약초·독·해독제 ~130종 |
| `weapons.json` | 무기·암기·갑옷 ~120종 |
| `items.json` | 물품 인덱스 + 기타 잡화 |

## save/ — 동적 게임 상태

| 파일 | 갱신 주기 |
|------|----------|
| `character.json` | 매 턴 |
| `relationships.json` | 만남·이벤트 시 |
| `memory_recent.json` | 매 턴 (최근 10턴) |
| `memory_long.json` | 10턴마다 압축 + 큰 사건 |
| `world_state.json` | 세계가 변하는 사건 시 |
| `legacy.json` | 사망(환생) 시 |

`_templates/`에 빈 템플릿. 새 환생 시작 시 복사.

## 경지 체계

```
1. 삼류  - 초입 / 완숙 / 극
2. 이류  - 초입 / 완숙 / 극
3. 일류  - 초입 / 완숙 / 극
4. 절정  - 초입 / 완숙 / 극     (구파 장로·세가 가주급)
5. 초절정 - 초입 / 완숙 / 극   (문파 최고수)
6. 화경  - 초입 / 완숙 / 극     (오황·일부 팔왕)
7. 현경  - 초입 / 완숙 / 극     (육천)
```

## 강호 정점 — 육천오황팔왕칠성

- **육천(六天)** 6인 — 현경. 별호에 '천(天)'.
- **오황(五皇)** 5인 — 화경. 별호에 '제(帝)'.
- **팔왕(八王)** 8인 — 화경~초절정. 별호에 '왕(王)'.
- **칠성(七星)** 7인 — 화경~초절정.

## AI 컨텍스트 조립 흐름

1. 플레이어 행동 입력
2. 관련 `world/*` 항목 검색 (RAG) → 시스템 프롬프트 주입
3. `character.json` + 관련 `relationships` + `memory_recent` + `memory_long` 주입
4. AI에게 묘사 + 상태 변화(JSON) 요청
5. JSON 파싱 → `save/*` 갱신
6. 10턴마다 `memory_recent` 압축 → `memory_long`으로 이관
