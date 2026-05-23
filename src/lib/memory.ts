// 장기기억 검색·저장·관리

import { LongTermMemory, MemoryType, ChatMessage } from "./types";
import { loadMemories, saveMemories, addMemories } from "./save";

export function newMemoryId(): string {
  return "mem_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

export function createMemory(
  type: MemoryType,
  title: string,
  content: string,
  opts: Partial<LongTermMemory> = {}
): LongTermMemory {
  const now = new Date().toISOString();
  return {
    id: newMemoryId(),
    type,
    title,
    content,
    relatedCharacters: opts.relatedCharacters || [],
    relatedFactions: opts.relatedFactions || [],
    relatedLocations: opts.relatedLocations || [],
    importance: opts.importance ?? 5,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  };
}

// ---------- 검색: 입력 키워드 + 위치 + 최근 사건 기반 ----------
export interface RetrievalContext {
  userInput: string;
  recentText: string; // 최근 대화 일부를 합친 문자열
  currentLocationId?: string | null;
  presentCharacters?: string[];
  presentFactions?: string[];
}

export async function retrieveRelevantMemories(
  ctx: RetrievalContext,
  limit: number = 10,
  slot?: string
): Promise<LongTermMemory[]> {
  const all = await loadMemories(slot);
  if (all.length === 0) return [];

  const text = (ctx.userInput + " " + ctx.recentText).toLowerCase();

  const scored = all.map((m) => {
    let score = 0;
    // importance를 기본 점수로
    score += m.importance * 0.6;

    // 키워드 매칭 (제목+내용)
    const haystack = (m.title + " " + m.content).toLowerCase();
    // 입력 단어 일치
    const words = text.split(/\s+/).filter((w) => w.length >= 2);
    for (const w of words) {
      if (haystack.includes(w)) score += 1.2;
    }
    // 현재 위치 매칭
    if (ctx.currentLocationId && m.relatedLocations.includes(ctx.currentLocationId)) score += 4;
    // 현재 등장 인물 매칭
    if (ctx.presentCharacters) {
      for (const c of ctx.presentCharacters) {
        if (m.relatedCharacters.includes(c)) score += 3;
      }
    }
    if (ctx.presentFactions) {
      for (const f of ctx.presentFactions) {
        if (m.relatedFactions.includes(f)) score += 2;
      }
    }
    // 미해결 떡밥은 우선
    if (m.type === "unresolved_threads") score += 2;

    // 최근성 (마지막 30턴 정도)
    const ageMs = Date.now() - new Date(m.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 1) score += 1.5;
    else if (ageDays < 7) score += 0.5;

    return { mem: m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map((x) => x.mem);

  // 접근 시각 갱신
  const now = new Date().toISOString();
  const ids = new Set(top.map((m) => m.id));
  const updated = all.map((m) => (ids.has(m.id) ? { ...m, lastAccessedAt: now } : m));
  await saveMemories(updated, slot);

  return top;
}

// 메시지에서 최근 텍스트 합치기
export function recentTextFromMessages(msgs: ChatMessage[], take: number = 6): string {
  return msgs.slice(-take).map((m) => m.content).join(" ");
}

// 메모리 추가 헬퍼
export async function appendMemory(mem: LongTermMemory, slot?: string) {
  await addMemories([mem], slot);
}
