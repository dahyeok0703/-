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
