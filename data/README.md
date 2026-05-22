# 무협 게임 데이터 구조

## world/ — 정적 세계관 (게임 시작 시 정해짐, 거의 안 바뀜)

| 파일 | 내용 |
|------|------|
| `factions.json` | 무림맹·사도련·천마신교 3대 세력 구조 |
| `sects.json` | 구파일방·오대세가·사도련 산하·천마신교 본단 상세 |
| `regions.json` | 중원의 지리·도시·교통로 |
| `realms.json` | 무공 경지 8단계 (삼류→생사경) |
| `martial_arts.json` | 강호의 주요 무공들 (내공·외공·검·암기·보법) |
| `items.json` | 영약·신병·비급 |
| `npcs.json` | 현존하는 천하십대고수와 주요 NPC |
| `lore.json` | 시대 배경·역사적 사건·현재의 긴장 |

## save/ — 동적 게임 상태 (턴마다 갱신)

| 파일 | 갱신 주기 |
|------|----------|
| `character.json` | 매 턴 |
| `relationships.json` | 만남·이벤트 시 |
| `memory_recent.json` | 매 턴 (최근 10턴 슬라이딩 윈도우) |
| `memory_long.json` | 10턴마다 압축 + 큰 사건 시 즉시 |
| `world_state.json` | 세계가 변하는 사건 발생 시 |
| `legacy.json` | 사망(환생) 시 캐릭터 일대기 이관 |

`_templates/`에 각 파일의 빈 템플릿이 있다. 새 환생을 시작할 때 복사해서 쓴다.

## AI 컨텍스트 조립 흐름 (턴 1회)

1. 플레이어 행동 입력
2. 행동에 관련된 `world/*` 항목 검색 → 시스템 프롬프트에 주입
3. `character.json` + 관련 `relationships` + `memory_recent` 전체 + `memory_long`의 상위 importance 항목 주입
4. AI에게 묘사 + 상태 변화(JSON)를 함께 요청
5. JSON 파싱 → `save/*` 갱신
6. 10턴마다 `memory_recent`의 오래된 항목을 AI에게 요약시켜 `memory_long`으로 이관
