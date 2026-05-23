import { LongTermMemory, MemoryType, ChatMessage } from "./types";
import { loadMemories, saveMemories } from "./storage";

function newId(): string {
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
    id: newId(),
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

export function getAllMemories(): LongTermMemory[] {
  return loadMemories<LongTermMemory[]>([]);
}

export function addMemory(mem: LongTermMemory) {
  const all = getAllMemories();
  all.push(mem);
  saveMemories(all);
}

export interface RetrievalContext {
  userInput: string;
  recentText: string;
  currentLocationId?: string | null;
  presentCharacters?: string[];
  presentFactions?: string[];
}

export function retrieveRelevantMemories(ctx: RetrievalContext, limit: number = 10): LongTermMemory[] {
  const all = getAllMemories();
  if (all.length === 0) return [];
  const text = (ctx.userInput + " " + ctx.recentText).toLowerCase();

  const scored = all.map((m) => {
    let score = m.importance * 0.6;
    const hay = (m.title + " " + m.content).toLowerCase();
    const words = text.split(/\s+/).filter((w) => w.length >= 2);
    for (const w of words) {
      if (hay.includes(w)) score += 1.2;
    }
    if (ctx.currentLocationId && m.relatedLocations.includes(ctx.currentLocationId)) score += 4;
    for (const c of ctx.presentCharacters || []) {
      if (m.relatedCharacters.includes(c)) score += 3;
    }
    for (const f of ctx.presentFactions || []) {
      if (m.relatedFactions.includes(f)) score += 2;
    }
    if (m.type === "unresolved_threads") score += 2;
    const ageH = (Date.now() - new Date(m.createdAt).getTime()) / 3600000;
    if (ageH < 24) score += 1.5;
    else if (ageH < 7 * 24) score += 0.5;
    return { mem: m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map((x) => x.mem);

  // 접근 시각 갱신
  const now = new Date().toISOString();
  const ids = new Set(top.map((m) => m.id));
  const updated = all.map((m) => (ids.has(m.id) ? { ...m, lastAccessedAt: now } : m));
  saveMemories(updated);

  return top;
}

export function recentTextFromMessages(msgs: ChatMessage[], take: number = 6): string {
  return msgs.slice(-take).map((m) => m.content).join(" ");
}
