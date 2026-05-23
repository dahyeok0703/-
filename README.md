# 무협 챗 게임

개인 로컬용 무협 RPG 챗 게임. Next.js + OpenAI Responses API. 어린 시절부터 죽음(혹은 환생)까지 한 무림인의 일대기를 플레이.

## 빠른 시작

```bash
# 1) 의존성 설치
npm install

# 2) 환경 변수
cp .env.example .env
# .env 파일을 열어 OPENAI_API_KEY 입력 (없으면 더미 모드로 동작)

# 3) 개발 서버
npm run dev
# → http://localhost:3000
```

`OPENAI_API_KEY`가 비어있으면 **MOCK 모드**로 동작 — UI와 흐름을 실 API 호출 없이 테스트할 수 있다.

## 디렉토리 구조

```
data/
├── world/              # 세계관 원본 (절대 자동 변경되지 않음)
│   ├── factions.json, sects.json, regions.json, ...
│   └── npcs/           # 문파별 NPC 약 400명
└── save/
    ├── _templates/     # 새 게임 시작용 템플릿 (읽기 전용)
    └── slot1/          # 실제 플레이 세이브 (자동 생성)
        ├── game.json
        ├── messages.json
        ├── memories.json
        └── usage_log.json

src/
├── app/
│   ├── page.tsx        # 채팅 UI
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── chat/route.ts   # 턴 처리
│       └── save/route.ts   # 세이브 조회/생성/초기화
└── lib/
    ├── engine.ts       # 메인 게임 엔진
    ├── openai-client.ts
    ├── prompts/
    │   ├── system.ts   # 게임 마스터 시스템 프롬프트 (편집 가능)
    │   └── builder.ts  # 프롬프트 조립
    ├── world.ts        # 세계관 로더 + RAG 검색
    ├── memory.ts       # 장기기억 검색·저장
    ├── save.ts         # 파일 기반 세이브 I/O
    ├── cost.ts         # 모델 단가
    ├── mock.ts         # API 없을 때 더미
    ├── tokens.ts       # 거친 토큰 추정
    └── types.ts        # 핵심 타입
```

## 흐름

```
유저 입력
 → 세이브·최근 18턴 로드
 → 입력에 등장한 NPC/문파/지역을 data/world/에서 검색 (RAG)
 → 관련 장기기억 5~10개 선별
 → 시스템 프롬프트 + 동적 컨텍스트 + 최근 대화 + 입력 조립
 → OpenAI Responses API 호출 (MAX_OUTPUT_TOKENS 제한)
 → 응답 표시 + 저장
 → 별도 추출 호출로 상태 변화 JSON 받아 save/* 갱신
 → 비용 기록
```

토큰 한도 초과 시 오래된 대화부터 자른다. 매 턴마다 세계관 DB 전체를 보내지 않는다.

## 비용 제한

`.env`의 `MONTHLY_BUDGET_USD`. 한도를 넘으면 UI에 경고 배지가 뜬다 (강제 차단은 안 함 — 개인 사용 기준).

모델별 단가는 `src/lib/cost.ts`에서 직접 편집.

## 주요 명령

```bash
npm run dev        # 개발 서버
npm run typecheck  # TypeScript 검사
npm run build      # 프로덕션 빌드
npm start          # 프로덕션 실행 (로컬이라 보통 dev로 충분)
```

## 게임 플레이

1. 첫 진입 → 캐릭터 생성 폼 (이름·성별·출신 배경)
2. 5세부터 시작. 첫 입력은 "방을 둘러본다" "어머니께 묻는다" 같은 평범한 행동도 됨
3. 우측 패널에서 캐릭터 상태·관계·비용을 실시간 확인
4. **Ctrl/⌘+Enter** 로 전송
5. **초기화** 버튼은 확인창 거쳐서 동작

특수 입력:
- "상태창" / "인물" / "세력" / "기억" / "로그" — 저장된 데이터 요약

## 안전 장치

- API 키는 서버(`/api/*`)에서만 사용 — 브라우저로 절대 안 새어 나감
- 세계관 원본 데이터(`data/world/*`)는 자동 갱신되지 않음 — 변경 시 별도 커밋
- 세이브 폴더(`data/save/slot1/`)는 `.gitignore`로 제외 (개인 플레이 기록)
- 상태 추출 실패해도 게임 진행은 막지 않음 (응답은 표시·저장)

## 미완성·주의사항

- **단일 슬롯**만 지원. 멀티 세이브가 필요하면 `slot` 쿼리/파라미터로 분리 가능.
- **스트리밍 미지원**. 안정성 우선. 응답이 다 끝난 후 한꺼번에 표시됨.
- **상태 추출 정확도**는 모델 성능에 의존. 가끔 누락 가능 — 그 경우 다음 턴 입력에서 직접 짚어주면 보정됨.
- **RAG 검색**은 단순 키워드 매칭. 동의어/표기 차이는 못 잡는 경우 있음 (예: "한천" vs "검천"). 필요 시 `src/lib/world.ts`의 `searchWorld`를 개선.
- **토큰 추정**은 보수적 추정. 정확한 OpenAI tiktoken은 쓰지 않음.

## 시스템 프롬프트 편집

게임 톤을 바꾸고 싶으면 `src/lib/prompts/system.ts`의 `SYSTEM_RULES` 문자열을 직접 수정. 재시작하면 즉시 반영.
