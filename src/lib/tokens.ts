// 매우 거친 토큰 추정. 정확하지 않지만 한도 안전장치용으로는 충분.
// 한국어/한자가 섞인 문서는 영어보다 토큰당 문자가 적음 → 보수적 추정.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 한글/한자 약 1 토큰 ≈ 1-1.5자, 영어 약 1 토큰 ≈ 4자.
  // 보수적으로 문자수의 0.7배.
  return Math.ceil(text.length * 0.7);
}

export function totalTokens(texts: string[]): number {
  return texts.reduce((sum, t) => sum + estimateTokens(t), 0);
}
