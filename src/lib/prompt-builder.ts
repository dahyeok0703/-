import { ChatMessage, LongTermMemory, SaveData } from "./types";
import { SYSTEM_RULES } from "./prompts/system";
import { regionDetail, realmDetail, sectDetail, searchWorld, worldPrimer } from "./world";
import { estimateTokens } from "./tokens";

export interface BuiltPrompt {
  instructions: string;
  input: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  debug: {
    recentMessageCount: number;
    memoryCount: number;
    worldHitsCount: number;
    estimatedInputTokens: number;
  };
}

export function buildPrompt(args: {
  save: SaveData;
  recentMessages: ChatMessage[];
  relevantMemories: LongTermMemory[];
  userInput: string;
  maxContextTokens: number;
}): BuiltPrompt {
  const { save, recentMessages, relevantMemories, userInput, maxContextTokens } = args;
  const instructions = `${SYSTEM_RULES}\n\n${worldPrimer()}`;
  const recentTxt = recentMessages.slice(-4).map((m) => m.content).join(" ");
  const hits = searchWorld(userInput, recentTxt, 10);
  const dynamicCtx = buildDynamicContext(save, recentMessages, userInput, relevantMemories, hits);

  const baseRecent: BuiltPrompt["input"] = recentMessages.map((m) => ({
    role: (m.role === "system" ? "system" : m.role) as "user" | "assistant" | "system",
    content: m.content,
  }));

  const instrTok = estimateTokens(instructions);
  const ctxTok = estimateTokens(dynamicCtx);
  const userTok = estimateTokens(userInput);
  let recent = [...baseRecent];
  let total = instrTok + ctxTok + userTok + recent.reduce((s, m) => s + estimateTokens(m.content), 0);
  while (total > maxContextTokens && recent.length > 0) {
    const removed = recent.shift()!;
    total -= estimateTokens(removed.content);
  }

  const input: BuiltPrompt["input"] = [
    { role: "system", content: dynamicCtx },
    ...recent,
    { role: "user", content: userInput },
  ];

  return {
    instructions,
    input,
    debug: {
      recentMessageCount: recent.length,
      memoryCount: relevantMemories.length,
      worldHitsCount: hits.length,
      estimatedInputTokens: total,
    },
  };
}

function buildDynamicContext(
  save: SaveData,
  recentMessages: ChatMessage[],
  userInput: string,
  memories: LongTermMemory[],
  worldHits: Array<{ name: string; type: string; payload: any }>
): string {
  const c = save.character;
  const L: string[] = [];

  L.push("[플레이어 상태]");
  L.push(`이름 ${c.identity.name || "(미정)"} · ${c.identity.gender || "?"} · ${c.identity.age}세`);
  if (c.identity.family_background) L.push(`태생: ${c.identity.family_background}`);
  if (c.identity.appearance) L.push(`외양: ${c.identity.appearance}`);
  L.push(`구분: ${c.civilian_or_martial === "martial" ? "무림인" : "일반인"} · 경지 ${c.realm.current_stage} · 내공 ${c.realm.internal_energy}/${c.realm.internal_energy_cap}`);
  L.push(`생기: HP ${c.vitals.hp_current}/${c.vitals.hp_max} · 내상 ${c.vitals.internal_injury} · 외상 ${c.vitals.external_injury} · 정신 ${c.vitals.mental_state}`);
  if (c.affiliation.sect_id) L.push(`소속: ${c.affiliation.sect_id} (${c.affiliation.rank || "-"})`);
  if (c.martial_arts_known.length) {
    L.push(`무공: ${c.martial_arts_known.map((a) => `${a.art_id}(${a.mastery_pct}%)`).join(", ")}`);
  }
  if (c.inventory.silver_taels || c.inventory.items.length) {
    L.push(`인벤: 은자 ${c.inventory.silver_taels}냥 · [${c.inventory.items.join(", ")}]`);
  }
  if (c.family_status.spouse) L.push(`배우자: ${c.family_status.spouse}`);
  if (c.family_status.concubines.length) L.push(`첩: ${c.family_status.concubines.join(", ")}`);
  if (c.family_status.children.length) L.push(`자녀: ${c.family_status.children.join(", ")}`);

  const loc = regionDetail(c.current_location_id);
  if (loc) L.push("\n" + loc);
  const rd = realmDetail(c.realm.current_stage);
  if (rd) L.push(rd);
  const sd = sectDetail(c.affiliation.sect_id);
  if (sd) L.push(sd);

  const rels = Object.entries(save.relationships || {}).slice(0, 8);
  if (rels.length) {
    L.push("\n[주요 관계]");
    for (const [id, r] of rels) {
      L.push(`- ${r.name || id} (${r.type}): 호감 ${r.affinity}, 신뢰 ${r.trust}, ${r.status}`);
    }
  }

  if (memories.length) {
    L.push("\n[관련 기억]");
    for (const m of memories) {
      L.push(`- (${m.type}, 중요도 ${m.importance}) ${m.title}: ${m.content}`);
    }
  }

  if (worldHits.length) {
    L.push("\n[관련 세계관 정보]");
    for (const h of worldHits) {
      const p = h.payload;
      const summary = p.summary || p.description || p.specialty || p.personality || "";
      const meta = p.realm || p.position || p.title || p.age
        ? `[${[p.position, p.title, p.realm, p.age && p.age + "세"].filter(Boolean).join(", ")}]`
        : "";
      L.push(`- ${h.type} :: ${h.name} ${meta} ${summary ? "— " + truncate(summary, 200) : ""}`);
    }
  }

  if (c.biography_summary) L.push(`\n[일대기 요약] ${c.biography_summary}`);

  return L.join("\n");
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n) + "…";
}
