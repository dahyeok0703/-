import { CallResult } from "./openai-browser";

const RESPONSES = [
  "장면이 천천히 펼쳐진다. 산기슭의 작은 마을, 아침 안개가 옷자락을 적신다. 아직 무공을 익히지 않은 너의 발걸음이 흙을 디딘다.\n\n(MOCK 모드 — API 키를 입력하면 실제 AI가 응답해요.)\n\n[현재] 산기슭 마을 · 동행 없음",
  "노인의 흰 눈썹이 떨린다. \"네 뜻이 그러하다면, 한 수 가르쳐보지.\" 그는 죽장을 들어 올린다. 너의 선택을 기다린다.\n\n(MOCK 모드)\n\n[현재] 마을 골목 · 노인과 대면",
  "강호의 풍문이 흘러든다. 정주에서 무림맹 장로 한 사람이 사라졌다 한다. 너의 일과는 평소처럼 흘러간다.\n\n(MOCK 모드)\n\n[현재] 동일 장소",
  "검을 쥔 손이 떨린다. 너의 경지로는 아직 검기(劍氣)는 멀다. 그러나 자세는 흐트러지지 않았다.\n\n(MOCK 모드)\n\n[현재] 수련장",
];

let i = 0;

export function mockChat(userInput: string): CallResult {
  const text = RESPONSES[i++ % RESPONSES.length];
  const inputTok = Math.ceil(userInput.length * 0.7);
  const outputTok = Math.ceil(text.length * 0.7);
  return {
    text,
    usage: { input_tokens: inputTok, output_tokens: outputTok, total_tokens: inputTok + outputTok },
    model: "mock",
  };
}

export function mockExtract(): CallResult {
  const text = JSON.stringify({
    playerUpdates: [],
    npcUpdates: [],
    factionUpdates: [],
    locationUpdates: [],
    inventoryUpdates: [],
    eventLogs: [],
    unresolvedThreads: [],
    summary: "(MOCK 모드 — 상태 추출 생략)",
  });
  return {
    text,
    usage: { input_tokens: 10, output_tokens: 30, total_tokens: 40 },
    model: "mock",
  };
}
