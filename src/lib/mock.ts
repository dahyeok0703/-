// API 키 없을 때 사용하는 더미 응답. UI/플로우 테스트용.

import { OpenAIResult } from "./openai-client";

const MOCK_RESPONSES = [
  "장면이 천천히 펼쳐진다. 산기슭의 작은 마을, 아침 안개가 옷자락을 적신다. 아직 무공을 익히지 않은 너의 발걸음이 흙을 디딘다.\n\n(이것은 더미 응답입니다 — OPENAI_API_KEY를 설정하면 실제 AI 응답을 받습니다.)\n\n[현재] 산기슭 마을 · 동행 없음",
  "노인의 흰 눈썹이 떨린다. \"네 뜻이 그러하다면, 한 수 가르쳐보지.\" 그는 죽장을 들어 올린다. 너의 선택을 기다린다.\n\n(더미 응답)\n\n[현재] 마을 골목 · 노인과 대면 중",
  "강호의 풍문이 흘러든다. 정주에서 무림맹 장로 한 사람이 사라졌다 한다. 누구도 그 행방을 모른다. 너의 일과는 평소처럼 흘러간다.\n\n(더미 응답)\n\n[현재] 동일 장소",
];

let counter = 0;

export function mockChatResponse(userInput: string): OpenAIResult {
  const text = MOCK_RESPONSES[counter % MOCK_RESPONSES.length];
  counter++;
  // 대략적인 토큰 추정값
  const inputTok = Math.ceil(userInput.length * 0.7);
  const outputTok = Math.ceil(text.length * 0.7);
  return {
    text,
    usage: { input_tokens: inputTok, output_tokens: outputTok, total_tokens: inputTok + outputTok },
    model: "mock",
  };
}

export function mockExtractResponse(): OpenAIResult {
  const text = JSON.stringify({
    playerUpdates: [],
    npcUpdates: [],
    factionUpdates: [],
    locationUpdates: [],
    inventoryUpdates: [],
    eventLogs: [],
    unresolvedThreads: [],
    summary: "(더미 모드 — 상태 추출 생략)",
  });
  return {
    text,
    usage: { input_tokens: 10, output_tokens: 30, total_tokens: 40 },
    model: "mock",
  };
}
