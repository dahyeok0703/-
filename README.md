# 무협 챗 게임

**개인용·브라우저 단독 실행**. StackBlitz 또는 로컬에서 혼자 플레이. 서버 환경변수 없이 API 키는 UI에서 직접 입력 → localStorage 보관.

## 실행

### StackBlitz
1. 저장소를 StackBlitz로 열기 (https://stackblitz.com/github/dahyeok0703/-)
2. WebContainer가 자동으로 `npm install && npm run dev` 실행
3. 우상단 **⚙ 설정** 클릭 → API 키 입력 → 저장
4. 새 게임 시작 → 플레이

### 로컬
```bash
npm install
npm run dev
# → http://localhost:3000
```

## API 키 입력 위치

화면 우상단 **⚙ 설정** 버튼 클릭 → "OpenAI API Key" 입력칸에 `sk-...` 붙여넣기 → **저장**.

- 저장된 키는 브라우저 `localStorage`에만 있음 (`wuxia:openai_api_key`).
- 새로고침 후에도 자동 로드됨.
- **삭제** 버튼으로 즉시 제거 가능.
- 코드/저장소/`.env`에는 키가 절대 들어가지 않음.

## Mock Mode

API 키가 비어있으면 자동으로 **Mock Mode**. 실제 OpenAI를 호출하지 않고 더미 응답을 출력 — UI와 흐름을 시험해볼 수 있음. 좌상단 배지가 `Mock Mode`로 표시됨.

## 모델 설정

설정 패널에서:
- **기본 진행 모델** — 프리셋(`gpt-5.4-mini`, `gpt-5-mini`) 또는 직접 입력
- **상태 추출/요약 모델** — 비우면 진행 모델과 동일

모델명을 자유롭게 변경할 수 있음. 단, 존재하지 않는 모델명을 입력하면 호출 시 404 에러가 뜸.

## 저장 데이터 초기화

설정 패널 하단:
- **게임 진행만 초기화** — 세이브·대화·기억·비용 기록 삭제. API 키와 모델 설정은 보존.
- **API 키 포함 전체 초기화** — 모든 localStorage 데이터 삭제.

둘 다 `confirm` 창을 거침.

## 실제 OpenAI 테스트 방법

1. https://platform.openai.com/api-keys 에서 키 발급 (`sk-...`)
2. 게임 우상단 ⚙ 설정 → 키 입력 → 저장
3. 모드 배지가 `OpenAI API Mode` 로 바뀜
4. 새 게임 시작 → 첫 행동 입력 ("주변을 둘러본다." 등)
5. 응답이 오면 우측 패널에 토큰·비용·디버그 정보 표시됨

비용은 우측 "비용 (개발자 패널)"에서 실시간 누적 확인.

## 디렉토리 구조

```
data/                              # 세계관 원본 (자동 변경 안 됨)
├── world/                         # 약 45개 JSON. 문파·NPC·무공·영약·비급
└── save/_templates/               # 캐릭터 템플릿 (읽기 전용)

src/
├── data/world-data.ts             # JSON 정적 import 모음
├── app/
│   ├── page.tsx                   # 메인 UI (클라이언트 컴포넌트)
│   ├── layout.tsx
│   └── globals.css
└── lib/
    ├── storage.ts                 # localStorage 래퍼
    ├── openai-browser.ts          # 브라우저 OpenAI 호출 (dangerouslyAllowBrowser)
    ├── mock.ts                    # MOCK 응답
    ├── world.ts                   # 세계관 RAG
    ├── memory.ts                  # 장기기억
    ├── prompt-builder.ts          # 프롬프트 조립
    ├── engine.ts                  # 메인 게임 엔진
    ├── prompts/system.ts          # 게임 마스터 시스템 프롬프트 (편집 가능)
    ├── cost.ts                    # 모델 단가
    ├── tokens.ts                  # 토큰 추정
    └── types.ts
```

## 흐름

```
유저 입력
 → localStorage에서 세이브·최근 18개 메시지·기억 로드
 → 입력에 등장한 NPC/문파/지역을 src/data/world-data.ts에서 키워드 검색
 → 관련 장기기억 최대 10개 선별
 → 시스템 프롬프트(고정) + 동적 컨텍스트 + 최근 대화 + 유저 입력 조립
 → 브라우저에서 OpenAI Responses API 직접 호출
 → 응답 표시 + localStorage에 메시지/사용량 저장
 → 별도 추출 호출로 상태 변화 JSON 받아 세이브 갱신
```

토큰이 한도(8000)를 넘으면 오래된 대화부터 자동으로 자름. 매 턴 세계관 전체를 보내지 않음.

## 비용 제한

월간 예산 한도는 `src/lib/engine.ts`의 `processTurn(input, { monthlyBudgetUSD: 50 })` 기본값 50달러. 한도 도달 시 UI에 경고. 강제 차단은 안 함 (개인용).

모델 단가는 `src/lib/cost.ts`의 `MODEL_PRICING`에서 직접 수정.

## 시스템 프롬프트 편집

게임 톤·규칙을 바꾸려면 `src/lib/prompts/system.ts`의 `SYSTEM_RULES` 직접 수정.

## 주의사항

- **이 앱은 개인용**. API 키가 브라우저에서 직접 OpenAI로 나감 (`dangerouslyAllowBrowser: true`).
- StackBlitz 링크/배포 페이지를 **남에게 공유하지 마세요** — 키가 같이 노출됩니다.
- `.env`는 사용하지 않음. GitHub에 키가 올라갈 위험 없음.
- 단일 슬롯만 지원 (localStorage 키 하나).
- 스트리밍 미지원. 응답은 한꺼번에 표시.
- RAG는 단순 키워드 매칭 (별호·동의어는 못 잡을 수 있음).
