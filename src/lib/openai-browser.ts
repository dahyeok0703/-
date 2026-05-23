// 브라우저에서 직접 OpenAI 호출 (dangerouslyAllowBrowser).
// 개인용·로컬 전용. 링크/배포를 하지 않는다는 전제.

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

export async function callResponses(args: {
  apiKey: string;
  model: string;
  instructions: string;
  input: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxOutputTokens: number;
}): Promise<CallResult> {
  const client = getClient(args.apiKey);
  const response: any = await client.responses.create({
    model: args.model,
    instructions: args.instructions,
    input: args.input as any,
    max_output_tokens: args.maxOutputTokens,
  });

  const text = response.output_text ?? extractText(response);
  const usage = response.usage || {};
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

function extractText(response: any): string {
  try {
    const out = response.output;
    if (Array.isArray(out)) {
      const parts: string[] = [];
      for (const item of out) {
        if (Array.isArray(item?.content)) {
          for (const c of item.content) {
            if (typeof c === "string") parts.push(c);
            else if (c?.text) parts.push(c.text);
          }
        } else if (typeof item?.content === "string") {
          parts.push(item.content);
        }
      }
      return parts.join("");
    }
  } catch {
    /* ignore */
  }
  return "";
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
