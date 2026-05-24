// 브라우저에서 직접 OpenAI 호출 (dangerouslyAllowBrowser).
// 개인용·로컬 전용. 링크/배포를 하지 않는다는 전제.
// Chat Completions API 사용 — 모든 SDK 버전·모든 모델에서 호환.

import OpenAI from "openai";

let _client: OpenAI | null = null;
let _cachedKey = "";

export function getClient(apiKey: string): OpenAI {
  if (!apiKey) throw new Error("API_KEY_MISSING");
  if (_client && _cachedKey === apiKey) return _client;
  _client = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
  _cachedKey = apiKey;
  return _client;
}

export interface CallResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  model: string;
}

export async function callChat(args: {
  apiKey: string;
  model: string;
  instructions: string;
  input: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxOutputTokens: number;
}): Promise<CallResult> {
  const client = getClient(args.apiKey);

  // instructions를 첫 system 메시지로 합침
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: args.instructions },
    ...args.input.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
  ];

  const response: any = await client.chat.completions.create({
    model: args.model,
    messages: messages as any,
    max_completion_tokens: args.maxOutputTokens,
  } as any);

  const text = response?.choices?.[0]?.message?.content || "";
  const usage = response?.usage || {};
  return {
    text,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
    },
    model: args.model,
  };
}

// 하위 호환: 기존 callResponses 이름도 export
export const callResponses = callChat;

// 질의 확장 — 유저의 모호한 채팅을 강호의 정식 명칭 키워드들로 풀어낸다.
// 실패 시 빈 배열을 반환(상위에서 무시).
export async function expandQueryToKeywords(args: {
  apiKey: string;
  model: string;
  userInput: string;
  recentText: string;
}): Promise<{ keywords: string[]; usage: { input_tokens: number; output_tokens: number; total_tokens: number }; model: string }> {
  try {
    const client = getClient(args.apiKey);
    const instr = `너는 무협 챗 게임의 강호 검색 도우미다.
유저의 입력(대충 친 말·약칭·암시·은유 포함)에서 가리킬 만한 강호의 인물·문파·지역·도시·무공·물건·집단·세력의 정식 명칭 후보를 콤마로 구분해 나열하라.
규칙:
- 한국어/한자 정식 명칭으로 나열. 한자 병기는 생략.
- 유저가 직접 적은 단어가 아니어도, 맥락상 그것이 가리키는 강호의 실재 명칭이면 모두 포함.
- 동의어·별칭·축약어·유사 개념을 폭넓게 포함 (예: '사화'→'중원사화', '구파'→'소림사,무당파,화산파,...', '소림'→'소림사,달마검법,역근경,...').
- 추정 가능한 한 풍부하게 나열(최대 20개). 정말 가리킬 게 없으면 빈 줄.
- 콤마로만 구분, 다른 어떤 텍스트·설명·줄바꿈 금지.`;
    const prompt = `최근 맥락: ${args.recentText.slice(-400) || "(없음)"}
유저 입력: ${args.userInput}`;
    const resp: any = await client.chat.completions.create({
      model: args.model,
      messages: [
        { role: "system", content: instr },
        { role: "user", content: prompt },
      ] as any,
      max_completion_tokens: 200,
    } as any);
    const text: string = resp?.choices?.[0]?.message?.content || "";
    const u = resp?.usage || {};
    const keywords = text
      .split(/[,\n;|]/g)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length < 40);
    return {
      keywords,
      usage: {
        input_tokens: u.prompt_tokens || 0,
        output_tokens: u.completion_tokens || 0,
        total_tokens: u.total_tokens || 0,
      },
      model: args.model,
    };
  } catch (e) {
    console.warn("[질의 확장 실패]", e);
    return { keywords: [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: args.model };
  }
}

// 스트리밍 호출. onChunk(delta)로 토큰 단위 전달.
// AbortSignal 로 중단 가능. 중단 시 그때까지 받은 텍스트로 CallResult 반환.
export async function callChatStream(args: {
  apiKey: string;
  model: string;
  instructions: string;
  input: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxOutputTokens: number;
  signal?: AbortSignal;
  onChunk?: (delta: string) => void;
}): Promise<CallResult & { aborted: boolean }> {
  const client = getClient(args.apiKey);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: args.instructions },
    ...args.input.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
  ];

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let aborted = false;

  try {
    const stream: any = await client.chat.completions.create(
      {
        model: args.model,
        messages: messages as any,
        max_completion_tokens: args.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      } as any,
      args.signal ? { signal: args.signal } : undefined,
    );

    for await (const chunk of stream as AsyncIterable<any>) {
      if (args.signal?.aborted) {
        aborted = true;
        break;
      }
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (delta) {
        fullText += delta;
        args.onChunk?.(delta);
      }
      if (chunk?.usage) {
        inputTokens = chunk.usage.prompt_tokens || inputTokens;
        outputTokens = chunk.usage.completion_tokens || outputTokens;
        totalTokens = chunk.usage.total_tokens || totalTokens;
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError" || args.signal?.aborted) {
      aborted = true;
    } else {
      throw err;
    }
  }

  // 토큰 사용량을 못 받았으면 출력 길이로 대략 추정 (스트림 중단 케이스 등)
  if (!outputTokens && fullText) {
    outputTokens = Math.ceil(fullText.length / 3);
  }

  return {
    text: fullText,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens || inputTokens + outputTokens,
    },
    model: args.model,
    aborted,
  };
}

export function classifyError(err: unknown): { kind: string; userMessage: string } {
  const e = err as any;
  const status = e?.status || e?.response?.status;
  const msg = e?.message || String(err);

  if (msg.includes("API_KEY_MISSING")) {
    return { kind: "missing_key", userMessage: "API 키가 없어요. 우측 상단 설정에서 입력하세요." };
  }
  if (status === 401) return { kind: "auth", userMessage: "API 키가 유효하지 않아요." };
  if (status === 429) return { kind: "rate_limit", userMessage: "요청 한도 초과. 잠시 후 다시 시도하세요." };
  if (status === 404) return { kind: "model_not_found", userMessage: "모델명이 잘못됐을 가능성이 있어요: " + msg };
  if (status === 400) return { kind: "bad_request", userMessage: "요청 형식 오류: " + msg };
  if (status >= 500) return { kind: "server", userMessage: "OpenAI 서버 오류. 잠시 후 재시도." };
  if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch")) {
    return { kind: "network", userMessage: "네트워크 오류. 인터넷 연결 확인." };
  }
  return { kind: "unknown", userMessage: msg };
}
