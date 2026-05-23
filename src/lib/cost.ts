// 모델별 단가(2025-Q3 기준 추정). USD per 1M tokens.
// 정확한 가격은 OpenAI 가격 페이지 확인 후 수정.

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "o4-mini": { input: 1.1, output: 4.4 },
};

export function estimateCostUSD(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model];
  if (!p) {
    // 알려지지 않은 모델은 gpt-4o-mini와 동일 가정.
    const fallback = MODEL_PRICING["gpt-4o-mini"];
    return (inputTokens * fallback.input + outputTokens * fallback.output) / 1_000_000;
  }
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
