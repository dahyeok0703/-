// OpenAI 클라이언트 + 응답 생성. Responses API 사용.

import OpenAI from "openai";

let _client: OpenAI | null = null;

export function hasApiKey(): boolean {
  return !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== "";
}

export function getClient(): OpenAI {
  if (!hasApiKey()) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.");
  }
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export function modelChat(): string {
  return process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini";
}
export function modelSummary(): string {
  return process.env.OPENAI_MODEL_SUMMARY || modelChat();
}
export function modelImportant(): string {
  return process.env.OPENAI_MODEL_IMPORTANT || modelChat();
}

export interface OpenAIResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  model: string;
}

// Responses API 호출 래퍼. 실패 시 throw.
export async function callResponses(args: {
  model: string;
  instructions: string;
  input: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxOutputTokens: number;
}): Promise<OpenAIResult> {
  const client = getClient();
  const response = await client.responses.create({
    model: args.model,
    instructions: args.instructions,
    input: args.input as any,
    max_output_tokens: args.maxOutputTokens,
  });

  const text = (response as any).output_text ?? extractText(response);
  const usage = (response as any).usage || {};
  return {
    text: text || "",
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      total_tokens: usage.total_tokens || 0,
    },
    model: args.model,
  };
}

// 일부 SDK 버전에서 output_text가 없을 때 폴백
function extractText(response: any): string {
  try {
    const out = response.output || response.choices;
    if (Array.isArray(out)) {
      const parts: string[] = [];
      for (const item of out) {
        if (item?.content) {
          if (Array.isArray(item.content)) {
            for (const c of item.content) {
              if (typeof c === "string") parts.push(c);
              else if (c?.text) parts.push(c.text);
            }
          } else if (typeof item.content === "string") {
            parts.push(item.content);
          }
        }
        if (item?.message?.content) parts.push(item.message.content);
      }
      return parts.join("");
    }
  } catch {
    // ignore
  }
  return "";
}

// 에러 분류
export function classifyOpenAIError(err: unknown): { kind: string; userMessage: string } {
  const e = err as any;
  const status = e?.status || e?.response?.status;
  const msg = e?.message || String(err);

  if (msg.includes("OPENAI_API_KEY")) {
    return { kind: "missing_key", userMessage: "API 키가 설정되지 않았어요. .env 파일을 확인하세요." };
  }
  if (status === 401) {
    return { kind: "auth", userMessage: "API 키가 유효하지 않아요." };
  }
  if (status === 429) {
    return { kind: "rate_limit", userMessage: "요청 한도 초과 (rate limit). 잠시 후 다시 시도하세요." };
  }
  if (status === 400) {
    return { kind: "bad_request", userMessage: "요청 형식 오류: " + msg };
  }
  if (status >= 500) {
    return { kind: "server", userMessage: "OpenAI 서버 오류. 잠시 후 다시 시도하세요." };
  }
  if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch")) {
    return { kind: "network", userMessage: "네트워크 오류. 인터넷 연결을 확인하세요." };
  }
  return { kind: "unknown", userMessage: "알 수 없는 오류: " + msg };
}
