// 프롬프트 조립. instructions(고정) + input(턴별 동적)으로 분리.

import { ChatMessage, LongTermMemory, SaveData } from "../types";
import { SYSTEM_RULES } from "./system";
import {
  worldPrimer,
  searchWorld,
  regionDetail,
  getRealmDetail,
  getSectDetail,
  WorldHit,
} from "../world";
import { estimateTokens } from "../tokens";

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

export async function buildPrompt(args: {
  save: SaveData;
  recentMessages: ChatMessage[];
  relevantMemories: LongTermMemory[];
  userInput: string;
  maxContextTokens: number;
}): Promise<BuiltPrompt> {
  const { save, recentMessages, relevantMemories, userInput, maxContextTokens } = args;

  // A-D 고정 시스템 규칙 + 세계관 프라이머
  const primer = await worldPrimer();
  const instructions = `${SYSTEM_RULES}\n\n${primer}`;

  // 동적 컨텍스트 블록 (E-G)
  const dynamicCtx = await buildDynamicContext(save, recentMessages, userInput, relevantMemories);

  // 입력 메시지 구성: [system(dyn ctx), ...recent, user(new input)]
  const baseRecent: BuiltPrompt["input"] = recentMessages.map((m) => ({
    role: m.role === "system" ? "system" : (m.role as "user" | "assistant"),
    content: m.content,
  }));

  // 토큰 한도 — 최근 메시지부터 잘라낸다
  const instrTokens = estimateTokens(instructions);
  const ctxTokens = estimateTokens(dynamicCtx);
  const userTokens = estimateTokens(userInput);
  let recent = [...baseRecent];
  let totalTok = instrTokens + ctxTokens + userTokens + recent.reduce((s, m) => s + estimateTokens(m.content), 0);

  while (totalTok > maxContextTokens && recent.length > 0) {
    const removed = recent.shift()!;
    totalTok -= estimateTokens(removed.content);
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
      worldHitsCount: 0, // searchWorld는 buildDynamicContext 내부에서 집계
      estimatedInputTokens: totalTok,
    },
  };
}

async function buildDynamicContext(
  save: SaveData,
  recentMessages: ChatMessage[],
  userInput: string,
  memories: LongTermMemory[]
): Promise<string> {
  const c = save.character;
  const lines: string[] = [];

  // E. 플레이어 상태
  lines.push("[플레이어 상태]");
  lines.push(
    `이름: ${c.identity.name || "(아직 미정)"} · 성별 ${c.identity.gender || "?"} · 나이 ${c.identity.age}세`
  );
  if (c.identity.family_background) lines.push(`가문/태생: ${c.identity.family_background}`);
  if (c.identity.appearance) lines.push(`외양: ${c.identity.appearance}`);
  lines.push(
    `구분: ${c.civilian_or_martial === "martial" ? "무림인" : "일반인"} · 경지 ${c.realm.current_stage} · 내공 ${c.realm.internal_energy}/${c.realm.internal_energy_cap}`
  );
  lines.push(
    `생기: HP ${c.vitals.hp_current}/${c.vitals.hp_max} · 내상 ${c.vitals.internal_injury} · 외상 ${c.vitals.external_injury} · 정신 ${c.vitals.mental_state}`
  );
  if (c.affiliation.sect_id) {
    lines.push(`소속: ${c.affiliation.sect_id} (${c.affiliation.rank || "-"})`);
  }
  if (c.martial_arts_known.length > 0) {
    lines.push(
      `익힌 무공: ${c.martial_arts_known
        .map((a) => `${a.art_id}(${a.mastery_pct}%)`)
        .join(", ")}`
    );
  }
  if (c.inventory.silver_taels || c.inventory.items.length > 0) {
    lines.push(
      `인벤: 은자 ${c.inventory.silver_taels}냥 · 물품 [${c.inventory.items.join(", ")}]`
    );
  }
  if (c.family_status.spouse) lines.push(`배우자: ${c.family_status.spouse}`);
  if (c.family_status.concubines.length) lines.push(`첩: ${c.family_status.concubines.join(", ")}`);
  if (c.family_status.children.length) lines.push(`자녀: ${c.family_status.children.join(", ")}`);

  // F. 현재 장면/위치/동행
  const locDetail = await regionDetail(c.current_location_id);
  if (locDetail) lines.push("\n" + locDetail);
  const realmDetail = await getRealmDetail(c.realm.current_stage);
  if (realmDetail) lines.push(realmDetail);
  const sectDetail = await getSectDetail(c.affiliation.sect_id);
  if (sectDetail) lines.push(sectDetail);

  // 관계 — 등장 가능성이 높은 인물 일부
  const relEntries = Object.entries(save.relationships || {}).slice(0, 8);
  if (relEntries.length) {
    lines.push("\n[주요 관계]");
    for (const [npcId, r] of relEntries) {
      lines.push(`- ${r.name || npcId} (${r.type}): 호감 ${r.affinity}, 신뢰 ${r.trust}, 상태 ${r.status}`);
    }
  }

  // G. 관련 장기기억
  if (memories.length > 0) {
    lines.push("\n[관련 기억]");
    for (const m of memories) {
      lines.push(`- (${m.type}, 중요도 ${m.importance}) ${m.title}: ${m.content}`);
    }
  }

  // 미해결 떡밥(자동 추출)
  const threads = memories.filter((m) => m.type === "unresolved_threads");
  if (threads.length === 0) {
    // 별도 검색은 retriever가 이미 우선 가중. 추가 작업 불필요.
  }

  // 세계관 RAG — 유저 입력/최근 대화에서 언급된 NPC·문파·지역·무공
  const recentTxt = recentMessages.slice(-4).map((m) => m.content).join(" ");
  const hits: WorldHit[] = await searchWorld(userInput, recentTxt, 10);
  if (hits.length > 0) {
    lines.push("\n[관련 세계관 정보]");
    for (const h of hits) {
      const p = h.payload;
      const summary =
        p.summary ||
        p.description ||
        p.specialty ||
        p.personality ||
        (typeof p === "string" ? p : "");
      const meta =
        p.realm || p.position || p.title || p.age
          ? `[${[p.position, p.title, p.realm, p.age && p.age + "세"].filter(Boolean).join(", ")}]`
          : "";
      lines.push(`- ${h.type} :: ${h.name} ${meta} ${summary ? "— " + truncate(summary, 200) : ""}`);
    }
  }

  // 직전 사건 한 줄
  if (save.character.biography_summary) {
    lines.push(`\n[지금까지의 일대기 요약] ${save.character.biography_summary}`);
  }

  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n) + "…";
}
