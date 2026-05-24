import { ChatMessage, LongTermMemory, SaveData } from "./types";
import { SYSTEM_RULES } from "./prompts/system";
import { regionDetail, realmDetail, sectDetail, searchWorld, worldPrimer } from "./world";
import { estimateTokens } from "./tokens";
import { formatGameTime, sichenPhase, STAT_DEFS, getXpRequiredFor, getNextStageId, nextStageRequiresEnlightenment } from "../data/world-data";

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
  extraSearchKeywords?: string[];
}): BuiltPrompt {
  const { save, recentMessages, relevantMemories, userInput, maxContextTokens, extraSearchKeywords } = args;
  const instructions = `${SYSTEM_RULES}\n\n${worldPrimer()}`;
  const recentTxt = recentMessages.slice(-4).map((m) => m.content).join(" ");
  const expanded = (extraSearchKeywords || []).join(" ");
  const hits = searchWorld(userInput, recentTxt + " " + expanded, 20);
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

  if (save.gameTime) {
    L.push("[현재 시각]");
    L.push(`${formatGameTime(save.gameTime)} (${sichenPhase(save.gameTime.sichen)})`);
    L.push("");
  }

  L.push("[플레이어 상태]");
  L.push(`이름 ${c.identity.name || "(미정)"} · ${c.identity.gender || "?"} · ${c.identity.age}세`);
  if (c.identity.family_background) L.push(`태생: ${c.identity.family_background}`);
  if (c.identity.appearance) L.push(`외양: ${c.identity.appearance}`);
  const xpCur = Math.floor(Number(c.realm.experience_in_stage) || 0);
  const xpNeed = getXpRequiredFor(c.realm.current_stage);
  const xpPct = Math.floor((xpCur / Math.max(1, xpNeed)) * 100);
  const nextId = getNextStageId(c.realm.current_stage);
  const reqEnl = nextStageRequiresEnlightenment(c.realm.current_stage);
  const stageLine = `구분: ${c.civilian_or_martial === "martial" ? "무림인" : "일반인"} · 경지 ${c.realm.current_stage} · 내공 ${c.realm.internal_energy}/${c.realm.internal_energy_cap} · 단계 진척 ${xpCur}/${xpNeed} (${xpPct}%)${nextId ? ` · 다음 ${nextId}${reqEnl ? " [깨달음 필요]" : ""}` : ""}${c.realm.awaiting_enlightenment ? " · ※깨달음 대기" : ""}`;
  L.push(stageLine);
  L.push(`생기: HP ${c.vitals.hp_current}/${c.vitals.hp_max} · 내상 ${c.vitals.internal_injury} · 외상 ${c.vitals.external_injury} · 정신 ${c.vitals.mental_state}`);
  if (c.affiliation.sect_id) L.push(`소속: ${c.affiliation.sect_id} (${c.affiliation.rank || "-"})`);
  const fame = Number((c.reputation as any)?.fame ?? 0);
  const noto = Number((c.reputation as any)?.notoriety ?? 0);
  const titles = (c.reputation as any)?.titles as string[] | undefined;
  L.push(`평판: 명성 ${fame} · 악명 ${noto}${titles && titles.length ? ` · 별호 [${titles.join(", ")}]` : ""}`);
  if (c.stats) {
    const statsStr = STAT_DEFS.map((d) => `${d.label}${c.stats?.[d.key] ?? 0}`).join(" ");
    L.push(`스탯: ${statsStr}`);
  }
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
      if (h.type === "concept" && Array.isArray(p?.members)) {
        L.push(`- 집합 :: ${h.name} — ${truncate(p.description || "", 200)}`);
        for (const m of p.members) {
          L.push(`   · ${m.name}${m.note ? " — " + truncate(m.note, 200) : ""}`);
        }
        continue;
      }
      if (h.type === "sect") {
        const parts = [
          p.faction && `세력:${p.faction}`,
          p.category,
          p.location && `위치:${p.location}`,
          p.discipline && `무공계열:${p.discipline}`,
          p.specialty && `특색:${p.specialty}`,
          p.atmosphere && `분위기:${p.atmosphere}`,
          p.membership && `구성:${p.membership}`,
        ].filter(Boolean).join(" / ");
        const arts = Array.isArray(p.signature_arts) && p.signature_arts.length
          ? ` · 대표무공: ${p.signature_arts.join(", ")}`
          : "";
        L.push(`- 문파 :: ${h.name} — ${truncate(parts, 400)}${arts}`);
        continue;
      }
      if (h.type === "art") {
        const parts = [
          p.grade && `등급:${p.grade}`,
          p.type && `종류:${p.type}`,
          p.weapon && `무기:${p.weapon}`,
          p.sect && `소속:${p.sect}`,
          p.description,
          p.side_effects && `부작용:${p.side_effects}`,
        ].filter(Boolean).join(" / ");
        L.push(`- 무공 :: ${h.name} — ${truncate(parts, 300)}`);
        continue;
      }
      if (h.type === "region" || h.type === "city") {
        const parts = [
          p.scope && `규모:${p.scope}`,
          p.atmosphere && `분위기:${p.atmosphere}`,
          Array.isArray(p.major_cities) && p.major_cities.length && `도시:${p.major_cities.join(",")}`,
        ].filter(Boolean).join(" / ");
        L.push(`- ${h.type === "region" ? "권역" : "도시"} :: ${h.name} — ${truncate(parts, 300)}`);
        continue;
      }
      // NPC 류 — 풍부한 인물 카드
      if (h.type.startsWith("npc_")) {
        const parts = [
          p.position && `직위:${p.position}`,
          p.title && `호:${p.title}`,
          p.realm && `경지:${p.realm}`,
          p.age && `${p.age}세`,
          p.personality && `성격:${p.personality}`,
          p.specialty && `특기:${p.specialty}`,
          p.location && `위치:${p.location}`,
          p.history && `내력:${p.history}`,
          p.secret && `(비밀)${p.secret}`,
        ].filter(Boolean).join(" / ");
        L.push(`- 인물 :: ${h.name} — ${truncate(parts, 400)}`);
        continue;
      }
      const summary = p.summary || p.description || p.specialty || p.personality || "";
      const meta = p.realm || p.position || p.title || p.age
        ? `[${[p.position, p.title, p.realm, p.age && p.age + "세"].filter(Boolean).join(", ")}]`
        : "";
      L.push(`- ${h.type} :: ${h.name} ${meta} ${summary ? "— " + truncate(summary, 200) : ""}`);
    }
  }

  const cat = save.customCatalog;
  if (cat && (cat.weapons.length || cat.arts.length)) {
    L.push("\n[유저가 만든/얻은 고유 무기·무공] (스펙 일관 유지)");
    for (const w of cat.weapons) {
      L.push(`- 무기 :: ${w.name} [${w.rarity}/${w.type}]${w.effect ? " — " + w.effect : ""}`);
    }
    for (const a of cat.arts) {
      L.push(`- 무공 :: ${a.name} [${a.grade}/${a.type}/${a.weapon}]${a.description ? " — " + a.description : ""}${a.side_effects ? " (부작용: " + a.side_effects + ")" : ""}`);
    }
  }

  if (c.biography_summary) L.push(`\n[일대기 요약] ${c.biography_summary}`);

  return L.join("\n");
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n) + "…";
}
