// 클라이언트 사이드 게임 엔진. 모든 저장은 localStorage.

import { ChatMessage, ExtractedUpdates, SaveData, UsageRecord, CharacterState } from "./types";
import {
  loadSave, saveSave, loadMessages, saveMessages,
  loadUsage, saveUsage, getApiKey, getModelChat, getModelSummary, getMaxOutputTokens,
  clearAllGameData,
} from "./storage";
import { addMemory, createMemory, recentTextFromMessages, retrieveRelevantMemories } from "./memory";
import { buildPrompt } from "./prompt-builder";
import { EXTRACTOR_RULES } from "./prompts/system";
import { callResponses, callChatStream, expandQueryToKeywords, classifyError, CallResult } from "./openai-browser";
import { mockChat, mockExtract } from "./mock";
import { estimateCostUSD } from "./cost";
import {
  CHARACTER_TEMPLATE, getStageById, artNameKR, getAllArtOptions,
  getStatBounds, clampStat, STAT_DEFS,
  getXpRequiredFor, getNextStageId, nextStageRequiresEnlightenment, getStageRank,
} from "../data/world-data";

const MAX_RECENT = 18;
const MAX_CTX_TOK = 8000;

function newMsgId(): string {
  return "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
}

// 다시하기 — 현재 게임 데이터 전체 초기화 (캐릭터 생성 폼으로 돌아감)
// API 키와 모델 설정은 보존.
export function restartGame() {
  clearAllGameData();
}

// 마지막 AI 응답을 새로 받기.
// 마지막 user 메시지를 보존, 마지막 assistant 메시지 + 그 턴의 사용량은 롤백.
// 메모리/관계 변화는 정확한 롤백이 어려워 그대로 둠.
export async function regenerateLastResponse(opts?: TurnOpts): Promise<TurnResult> {
  const messages = loadMessages<ChatMessage[]>([]);
  if (messages.length === 0) {
    return { ok: false, error: "재생성할 메시지가 없어요." };
  }

  // 끝에서부터 마지막 user 메시지 찾기
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx === -1) {
    return { ok: false, error: "이전 입력이 없어요." };
  }

  const lastUserInput = messages[lastUserIdx].content;

  // 마지막 assistant 응답 제거 + 마지막 user 메시지도 제거 (processTurn이 다시 추가함)
  const trimmed = messages.slice(0, lastUserIdx);
  saveMessages(trimmed);

  // turn 카운터도 1 되돌림
  const save = loadSave<SaveData | null>(null);
  if (save && save.turn > 0) {
    save.turn -= 1;
    saveSave(save);
  }

  // 마지막 사용량 2개(채팅+요약)도 롤백
  const usage = loadUsage<UsageRecord[]>([]);
  if (usage.length >= 2) {
    const last2 = usage.slice(-2);
    // 마지막 두 개가 동일 시점 페어면 제거
    if (last2[0].requestType === "chat" || last2[1].requestType === "summary") {
      saveUsage(usage.slice(0, -2));
    } else {
      saveUsage(usage.slice(0, -1));
    }
  } else if (usage.length === 1) {
    saveUsage([]);
  }

  // 재실행
  return processTurn(lastUserInput, opts);
}

export function hasSave(): boolean {
  const s = loadSave<SaveData | null>(null);
  return !!s && !!s.character?.identity;
}

export function getSave(): SaveData | null {
  return loadSave<SaveData | null>(null);
}

export function getMessages(): ChatMessage[] {
  return loadMessages<ChatMessage[]>([]);
}

export function getUsage(): UsageRecord[] {
  return loadUsage<UsageRecord[]>([]);
}

export interface NewGameOptions {
  name?: string;
  gender?: string;
  age?: number;
  family_background?: string;
  appearance?: string;
  civilian_or_martial?: "civilian" | "martial";
  stage_id?: string;       // 예: "hwagyeong_chuip"
  sect_id?: string | null; // 소속 문파
  rank?: string | null;
  silver_taels?: number;
  martial_arts?: Array<{ art_id: string; mastery_pct: number }>;
  weapons?: string[];
  stats?: Record<string, number>;
}

export function buildInitialCharacter(opts: NewGameOptions): CharacterState {
  const tpl = JSON.parse(JSON.stringify(CHARACTER_TEMPLATE));
  delete tpl._description;
  delete tpl._martial_arts_format;
  delete tpl._civilian_or_martial_note;

  tpl.identity = {
    ...tpl.identity,
    name: opts.name || "이름없음",
    gender: opts.gender || "남",
    age: opts.age ?? 5,
    family_background: opts.family_background || tpl.identity.family_background || "",
    appearance: opts.appearance || tpl.identity.appearance || "",
  };

  const isMartial = opts.civilian_or_martial === "martial";
  tpl.civilian_or_martial = isMartial ? "martial" : "civilian";

  if (isMartial && opts.stage_id) {
    const stage = getStageById(opts.stage_id);
    if (stage) {
      tpl.realm.current_realm = stage.realm_id;
      tpl.realm.current_stage = stage.stage_id;
      tpl.realm.tier = stage.tier;
      tpl.realm.internal_energy = stage.internal_energy_midpoint;
      tpl.realm.internal_energy_cap = stage.internal_energy_cap;
      const need = getXpRequiredFor(stage.stage_id);
      tpl.realm.experience_in_stage = Math.floor(need * 0.5);
      tpl.realm.stage_progress_pct = 50;
      tpl.realm.awaiting_enlightenment = false;
    }
  } else if (!isMartial) {
    tpl.realm.current_realm = "samryu";
    tpl.realm.current_stage = "samryu_chuip";
    tpl.realm.tier = 1;
    tpl.realm.internal_energy = 0;
    tpl.realm.internal_energy_cap = 10;
    tpl.realm.experience_in_stage = 0;
    tpl.realm.stage_progress_pct = 0;
    tpl.realm.awaiting_enlightenment = false;
  }

  // HP는 경지 tier에 비례해서 보정
  const tier = tpl.realm.tier || 1;
  const hpMax = isMartial ? 30 + (tier - 1) * 30 : 30;
  tpl.vitals.hp_max = hpMax;
  tpl.vitals.hp_current = hpMax;

  // 소속
  if (opts.sect_id) {
    tpl.affiliation.sect_id = opts.sect_id;
    tpl.affiliation.rank = opts.rank || "제자";
    tpl.affiliation.joined_at_age = Math.max(5, (opts.age ?? 5) - 5);
  }

  // 시작 자금
  if (typeof opts.silver_taels === "number") {
    tpl.inventory.silver_taels = opts.silver_taels;
  } else if (isMartial) {
    tpl.inventory.silver_taels = 5;
  }

  // 보유 무공
  if (Array.isArray(opts.martial_arts) && opts.martial_arts.length > 0) {
    tpl.martial_arts_known = opts.martial_arts
      .filter((a) => a.art_id && a.art_id.trim())
      .map((a) => ({
        art_id: a.art_id,
        mastery_pct: Math.max(0, Math.min(100, Math.floor(a.mastery_pct || 0))),
      }));
  }

  // 보유 무기
  if (Array.isArray(opts.weapons) && opts.weapons.length > 0) {
    tpl.weapons_owned = opts.weapons.map((w) => w.trim()).filter(Boolean);
  }

  // 스탯 (경지별 상·하한 클램프)
  const stageForBounds = isMartial ? opts.stage_id || "samryu_chuip" : null;
  const userStats = opts.stats || {};
  const finalStats: Record<string, number> = {};
  for (const def of STAT_DEFS) {
    const bounds = getStatBounds({ statKey: def.key, isMartial, stageId: stageForBounds });
    const raw = typeof userStats[def.key] === "number" ? userStats[def.key] : bounds.min;
    finalStats[def.key] = clampStat(raw, bounds);
  }
  tpl.stats = finalStats;

  return tpl as CharacterState;
}

export function startNewGame(opts: NewGameOptions): SaveData {
  const now = new Date().toISOString();
  const character = buildInitialCharacter(opts);
  const save: SaveData = {
    slot: "local",
    createdAt: now,
    updatedAt: now,
    turn: 0,
    character,
    relationships: {},
    gameTime: { year: 1, month: 3, day: 1, sichen: "진" },
    customCatalog: { weapons: [], arts: [] },
    upcomingEvents: [],
    worldStateOverrides: {
      npc_overrides: {},
      sect_overrides: {},
      global_events_caused_by_player: [],
      current_in_world_year: 0,
    },
  };
  saveSave(save);
  saveMessages([]);
  // memories·usage는 보존(이전 회차 기록 유지) — 환생 컨셉
  return save;
}

export interface TurnResult {
  ok: boolean;
  reply?: string;
  aborted?: boolean;
  error?: string;
  errorKind?: string;
  saveErrorWarning?: string;
  debug?: {
    model: string;
    recentMessageCount: number;
    memoryCount: number;
    worldHitsCount: number;
    estimatedInputTokens: number;
    actualInputTokens?: number;
    actualOutputTokens?: number;
    costEstimateUSD: number;
    monthlyTotalUSD: number;
    dailyTotalUSD: number;
    mock: boolean;
  };
  budgetWarning?: string;
}

export interface TurnOpts {
  monthlyBudgetUSD?: number;
  onChunk?: (delta: string) => void;
  signal?: AbortSignal;
}

export async function processTurn(userInput: string, opts?: TurnOpts): Promise<TurnResult> {
  if (!userInput.trim()) return { ok: false, error: "입력이 비어있어요." };

  const save = getSave();
  if (!save) return { ok: false, error: "세이브가 없어요. 먼저 새 게임을 시작하세요." };

  const apiKey = getApiKey();
  const useMock = !apiKey;

  const allMessages = getMessages();
  const recent = allMessages.slice(-MAX_RECENT);

  const memCtx = {
    userInput,
    recentText: recentTextFromMessages(recent, 6),
    currentLocationId: save.character.current_location_id,
    presentCharacters: Object.values(save.relationships).map((r) => r.name),
    presentFactions: [save.character.affiliation.sect_id].filter(Boolean) as string[],
  };
  const memories = retrieveRelevantMemories(memCtx, 10);

  // 질의 확장: 유저가 대충 친 말도 강호 정식 명칭들로 풀어내서 검색 매칭 강화.
  let extraSearchKeywords: string[] = [];
  let expandUsage: UsageRecord | undefined;
  if (!useMock) {
    try {
      const ex = await expandQueryToKeywords({
        apiKey,
        model: getModelSummary(),
        userInput,
        recentText: memCtx.recentText,
      });
      extraSearchKeywords = ex.keywords;
      if (ex.usage.total_tokens > 0) {
        expandUsage = {
          id: "u_" + Date.now().toString(36) + "_e",
          createdAt: new Date().toISOString(),
          requestType: "summary",
          model: ex.model,
          input_tokens: ex.usage.input_tokens,
          output_tokens: ex.usage.output_tokens,
          total_tokens: ex.usage.total_tokens,
          estimated_cost_usd: estimateCostUSD(ex.model, ex.usage.input_tokens, ex.usage.output_tokens),
        };
      }
    } catch {
      extraSearchKeywords = [];
    }
  }

  const built = buildPrompt({
    save, recentMessages: recent, relevantMemories: memories,
    userInput, maxContextTokens: MAX_CTX_TOK,
    extraSearchKeywords,
  });

  // 예산
  const allUsage = getUsage();
  const monthlyTotal = sumMonthly(allUsage);
  const dailyTotal = sumDaily(allUsage);
  const budget = opts?.monthlyBudgetUSD ?? 50;
  const budgetWarn = monthlyTotal >= budget
    ? `이번 달 누적 $${monthlyTotal.toFixed(4)} 가 한도 $${budget}를 넘었어요.`
    : monthlyTotal >= budget * 0.8
    ? `주의: 이번 달 $${monthlyTotal.toFixed(4)} (한도 $${budget}의 80%).`
    : undefined;

  // 메인 호출 (스트리밍)
  const maxOut = getMaxOutputTokens();
  let chatResult: CallResult;
  let aborted = false;
  try {
    if (useMock) {
      chatResult = mockChat(userInput);
      if (opts?.onChunk) {
        // 모의 모드도 청크 흉내
        for (const ch of chatResult.text) {
          if (opts.signal?.aborted) { aborted = true; break; }
          opts.onChunk(ch);
        }
      }
    } else {
      const streamed = await callChatStream({
        apiKey,
        model: getModelChat(),
        instructions: built.instructions,
        input: built.input,
        maxOutputTokens: maxOut,
        onChunk: opts?.onChunk,
        signal: opts?.signal,
      });
      aborted = streamed.aborted;
      chatResult = { text: streamed.text, usage: streamed.usage, model: streamed.model };
    }
  } catch (err) {
    const info = classifyError(err);
    console.error("[OpenAI 호출 실패]", info.kind, err);
    return { ok: false, error: info.userMessage, errorKind: info.kind };
  }

  // 빈 응답 (즉시 중단된 경우 등)
  if (!chatResult.text) {
    return { ok: false, error: aborted ? "출력을 중단했어요." : "응답이 비어있어요.", aborted };
  }

  const userMsg: ChatMessage = { id: newMsgId(), role: "user", content: userInput, createdAt: new Date().toISOString() };
  const aiMsg: ChatMessage = { id: newMsgId(), role: "assistant", content: chatResult.text, createdAt: new Date().toISOString() };

  const chatCost = estimateCostUSD(chatResult.model, chatResult.usage.input_tokens, chatResult.usage.output_tokens);
  const chatUsage: UsageRecord = {
    id: "u_" + Date.now().toString(36),
    createdAt: new Date().toISOString(),
    requestType: "chat",
    model: chatResult.model,
    input_tokens: chatResult.usage.input_tokens,
    output_tokens: chatResult.usage.output_tokens,
    total_tokens: chatResult.usage.total_tokens,
    estimated_cost_usd: chatCost,
  };

  let saveErr: string | undefined;
  try {
    const allMsgs = [...allMessages, userMsg, aiMsg];
    saveMessages(allMsgs);
    save.turn += 1;
    save.updatedAt = new Date().toISOString();
    saveSave(save);
    const usageBatch = expandUsage ? [expandUsage, chatUsage] : [chatUsage];
    saveUsage([...allUsage, ...usageBatch]);
  } catch (e) {
    console.error("[저장 실패]", e);
    saveErr = "메시지 저장 실패 (응답은 표시됨)";
  }

  // 상태 추출 (별도 호출) — 중단되었어도 받은 텍스트 기준으로 갱신
  let summaryUsage: UsageRecord | undefined;
  try {
    const extractor = useMock
      ? mockExtract()
      : await callResponses({
          apiKey,
          model: getModelSummary(),
          instructions: EXTRACTOR_RULES,
          input: [{ role: "user", content: `유저 입력:\n${userInput}\n\n게임 마스터 응답:\n${chatResult.text}` }],
          maxOutputTokens: 1000,
        });
    summaryUsage = {
      id: "u_" + Date.now().toString(36) + "_s",
      createdAt: new Date().toISOString(),
      requestType: "summary",
      model: extractor.model,
      input_tokens: extractor.usage.input_tokens,
      output_tokens: extractor.usage.output_tokens,
      total_tokens: extractor.usage.total_tokens,
      estimated_cost_usd: estimateCostUSD(extractor.model, extractor.usage.input_tokens, extractor.usage.output_tokens),
    };
    applyExtraction(extractor.text, save);
    saveSave(save);
    saveUsage([...getUsage(), summaryUsage]);
  } catch (e) {
    console.error("[상태 추출 실패]", e);
    saveErr = (saveErr ? saveErr + " · " : "") + "상태 추출 실패";
  }

  const turnCost = chatCost + (summaryUsage?.estimated_cost_usd || 0);
  const newMonthly = monthlyTotal + turnCost;
  const newDaily = dailyTotal + turnCost;

  console.log("[엔진]", {
    mock: useMock,
    model: chatResult.model,
    recentMessageCount: built.debug.recentMessageCount,
    memoryCount: memories.length,
    worldHitsCount: built.debug.worldHitsCount,
    estimatedInputTokens: built.debug.estimatedInputTokens,
    actualInputTokens: chatResult.usage.input_tokens,
    actualOutputTokens: chatResult.usage.output_tokens,
    turnCostUSD: turnCost.toFixed(6),
    monthlyUSD: newMonthly.toFixed(4),
  });

  return {
    ok: true,
    reply: chatResult.text,
    aborted,
    saveErrorWarning: saveErr,
    budgetWarning: budgetWarn,
    debug: {
      mock: useMock,
      model: chatResult.model,
      recentMessageCount: built.debug.recentMessageCount,
      memoryCount: memories.length,
      worldHitsCount: built.debug.worldHitsCount,
      estimatedInputTokens: built.debug.estimatedInputTokens,
      actualInputTokens: chatResult.usage.input_tokens,
      actualOutputTokens: chatResult.usage.output_tokens,
      costEstimateUSD: turnCost,
      monthlyTotalUSD: newMonthly,
      dailyTotalUSD: newDaily,
    },
  };
}

function applyExtraction(rawText: string, save: SaveData) {
  let parsed: ExtractedUpdates | null = null;
  try {
    const cleaned = stripCodeFences(rawText);
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn("[상태 추출 JSON 파싱 실패]", rawText.slice(0, 200));
    return;
  }
  if (!parsed) return;

  for (const u of parsed.npcUpdates || []) {
    const id = u.npc_id || u.name || "unknown";
    const existing = save.relationships[id] || {
      name: u.name || id,
      type: "지인",
      affinity: 0,
      trust: 0,
      last_met_age: save.character.identity.age,
      key_events: [],
      status: "alive" as const,
    };
    existing.affinity += u.affinity_delta || 0;
    existing.trust += u.trust_delta || 0;
    existing.last_met_age = save.character.identity.age;
    if (u.status) existing.status = u.status;
    if (u.note) existing.key_events.push(u.note);
    save.relationships[id] = existing;
  }

  for (const inv of parsed.inventoryUpdates || []) {
    if (inv.action === "add") save.character.inventory.items.push(inv.item);
    else if (inv.action === "remove") {
      save.character.inventory.items = save.character.inventory.items.filter((x) => x !== inv.item);
    }
  }

  for (const w of parsed.weaponUpdates || []) {
    const name = (w.weapon || "").trim();
    if (!name) continue;
    if (w.action === "add") {
      if (!save.character.weapons_owned.includes(name)) save.character.weapons_owned.push(name);
    } else if (w.action === "remove") {
      save.character.weapons_owned = save.character.weapons_owned.filter((x) => x !== name);
    }
  }

  // 플레이 중 만들거나 받은 무기를 영구 카탈로그에 등록 + 소유
  if (!save.customCatalog) save.customCatalog = { weapons: [], arts: [] };
  for (const cw of parsed.createdWeapons || []) {
    const name = (cw.name || "").trim();
    if (!name) continue;
    const exists = save.customCatalog.weapons.some((x) => x.name === name);
    if (!exists) {
      save.customCatalog.weapons.push({
        id: "uw_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 5),
        name,
        type: (cw.type || "기타").trim(),
        rarity: (cw.rarity || "흔함").trim(),
        effect: (cw.effect || "").trim(),
        origin: (cw.origin || "").trim() || undefined,
      });
    }
    if (!save.character.weapons_owned.includes(name)) save.character.weapons_owned.push(name);
  }

  // 플레이 중 만든 무공을 영구 카탈로그에 등록 + 습득
  for (const ca of parsed.createdArts || []) {
    const name = (ca.name || "").trim();
    if (!name) continue;
    const exists = save.customCatalog.arts.some((x) => x.name === name);
    let artId = "";
    if (!exists) {
      artId = "uart_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 5);
      save.customCatalog.arts.push({
        id: artId,
        name,
        grade: (ca.grade || "일류").trim(),
        type: (ca.type || "기타").trim(),
        weapon: (ca.weapon || "무관").trim(),
        description: (ca.description || "").trim(),
        side_effects: (ca.side_effects || "").trim() || undefined,
        origin: (ca.origin || "").trim() || undefined,
      });
    } else {
      artId = save.customCatalog.arts.find((x) => x.name === name)!.id;
    }
    // 보유 무공에 추가 (이름으로 식별, custom_ 인코딩 사용)
    const encId = makeCustomArtIdLocal(`${name} [${(ca.grade || "일류").trim()}]`);
    const already = save.character.martial_arts_known.some(
      (x) => x.art_id === encId || artNameOf(x.art_id) === name || artNameKR(x.art_id) === name,
    );
    if (!already) {
      save.character.martial_arts_known.push({ art_id: encId, mastery_pct: 5 });
    }
  }

  for (const a of parsed.martialArtUpdates || []) {
    applyMartialArtUpdate(save, a);
  }

  for (const r of parsed.reputationUpdates || []) {
    if (!r.field) continue;
    const cur = (save.character.reputation as any)[r.field];
    if (typeof r.value === "number") {
      (save.character.reputation as any)[r.field] = r.value;
    } else if (typeof r.delta === "number") {
      const base = typeof cur === "number" ? cur : 0;
      (save.character.reputation as any)[r.field] = base + r.delta;
    }
  }

  if (!save.character.stats) save.character.stats = {};
  for (const s of parsed.statUpdates || []) {
    if (!s.stat || !STAT_DEFS.some((d) => d.key === s.stat)) continue;
    const bounds = getStatBounds({
      statKey: s.stat,
      isMartial: save.character.civilian_or_martial === "martial",
      stageId: save.character.realm?.current_stage,
    });
    const cur = Number(save.character.stats[s.stat] ?? bounds.min);
    let next = cur;
    if (typeof s.value === "number") next = s.value;
    else if (typeof s.delta === "number") next = cur + s.delta;
    save.character.stats[s.stat] = clampStat(next, bounds);
  }
  // 경지가 올라간 경우 새 하한까지 자동 보정
  for (const def of STAT_DEFS) {
    const bounds = getStatBounds({
      statKey: def.key,
      isMartial: save.character.civilian_or_martial === "martial",
      stageId: save.character.realm?.current_stage,
    });
    const cur = Number(save.character.stats[def.key] ?? bounds.min);
    if (cur < bounds.min) save.character.stats[def.key] = bounds.min;
  }

  if (Array.isArray(parsed.titleAdds) && parsed.titleAdds.length > 0) {
    const titles = (save.character.reputation.titles as string[]) || [];
    for (const t of parsed.titleAdds) {
      const tt = String(t || "").trim();
      if (tt && !titles.includes(tt)) titles.push(tt);
    }
    save.character.reputation.titles = titles;
  }
  if (Array.isArray(parsed.titleRemoves) && parsed.titleRemoves.length > 0) {
    const titles = (save.character.reputation.titles as string[]) || [];
    save.character.reputation.titles = titles.filter((x) => !parsed!.titleRemoves!.includes(x));
  }

  for (const f of parsed.familyUpdates || []) {
    applyFamilyUpdate(save, f);
  }

  for (const p of parsed.playerUpdates || []) {
    applyPlayerField(save, p.field, p.value);
  }

  applyTimeAdvance(save, parsed.timeAdvance);
  normalizeRealmProgress(save);
  applyUpcomingEventUpdates(save, parsed.upcomingEventUpdates);

  if (parsed.summary) {
    save.character.biography_summary =
      (save.character.biography_summary ? save.character.biography_summary + " | " : "") + parsed.summary;
    if (save.character.biography_summary.length > 2000) {
      save.character.biography_summary = "…" + save.character.biography_summary.slice(-1800);
    }
  }

  for (const ev of parsed.eventLogs || []) {
    addMemory(createMemory("event_log", ev.title, ev.content, {
      importance: ev.importance || 5,
      relatedLocations: save.character.current_location_id ? [save.character.current_location_id] : [],
    }));
  }
  for (const t of parsed.unresolvedThreads || []) {
    addMemory(createMemory("unresolved_threads", t.title, t.content, { importance: t.importance || 6 }));
  }
  for (const f of parsed.factionUpdates || []) {
    addMemory(createMemory("faction_memory", f.faction_id, f.note, { importance: 5, relatedFactions: [f.faction_id] }));
  }
  for (const l of parsed.locationUpdates || []) {
    addMemory(createMemory("location_memory", l.location_id, l.note, { importance: 5, relatedLocations: [l.location_id] }));
  }
}

function applyPlayerField(save: SaveData, field: string, value: unknown) {
  const c = save.character;
  const allowed: Record<string, (v: any) => void> = {
    "identity.name": (v) => (c.identity.name = String(v)),
    "identity.age": (v) => (c.identity.age = Number(v)),
    "identity.gender": (v) => (c.identity.gender = String(v)),
    "identity.appearance": (v) => (c.identity.appearance = String(v)),
    "identity.birthplace": (v) => (c.identity.birthplace = String(v)),
    "identity.family_background": (v) => (c.identity.family_background = String(v)),

    "current_location_id": (v) => (c.current_location_id = v ? String(v) : null),
    "civilian_or_martial": (v) => (c.civilian_or_martial = v === "martial" ? "martial" : "civilian"),
    "alive": (v) => (c.alive = Boolean(v)),
    "biography_summary": (v) => (c.biography_summary = String(v)),

    "affiliation.sect_id": (v) => (c.affiliation.sect_id = v ? String(v) : null),
    "affiliation.rank": (v) => (c.affiliation.rank = v ? String(v) : null),
    "affiliation.standing": (v) => (c.affiliation.standing = Number(v)),
    "affiliation.joined_at_age": (v) => (c.affiliation.joined_at_age = v === null ? null : Number(v)),

    "realm.current_realm": (v) => (c.realm.current_realm = String(v)),
    "realm.current_stage": (v) => {
      const newStage = String(v);
      if (newStage && newStage !== c.realm.current_stage) {
        c.realm.current_stage = newStage;
        c.realm.experience_in_stage = 0;
        c.realm.stage_progress_pct = 0;
        c.realm.awaiting_enlightenment = false;
      }
    },
    "realm.tier": (v) => (c.realm.tier = Number(v)),
    "realm.internal_energy": (v) => (c.realm.internal_energy = Number(v)),
    "realm.internal_energy_cap": (v) => (c.realm.internal_energy_cap = Number(v)),
    "realm.stage_progress_pct": (v) => (c.realm.stage_progress_pct = Math.max(0, Math.min(100, Number(v)))),
    "realm.experience_in_stage": (v) => (c.realm.experience_in_stage = Math.max(0, Number(v) || 0)),
    "realm.awaiting_enlightenment": (v) => (c.realm.awaiting_enlightenment = Boolean(v)),

    "vitals.hp_current": (v) => (c.vitals.hp_current = Number(v)),
    "vitals.hp_max": (v) => (c.vitals.hp_max = Number(v)),
    "vitals.internal_injury": (v) => (c.vitals.internal_injury = Number(v)),
    "vitals.external_injury": (v) => (c.vitals.external_injury = Number(v)),
    "vitals.mental_state": (v) => (c.vitals.mental_state = String(v)),
    "vitals.status_effects": (v) => {
      if (Array.isArray(v)) c.vitals.status_effects = v.map((x) => String(x));
    },

    "inventory.silver_taels": (v) => (c.inventory.silver_taels = Number(v)),
    "inventory.gold_taels": (v) => (c.inventory.gold_taels = Number(v)),
  };
  const fn = allowed[field];
  if (fn) try { fn(value); } catch { /* ignore */ }
}

function applyMartialArtUpdate(
  save: SaveData,
  a: { action: "add" | "remove" | "change"; name?: string; art_id?: string; mastery_pct?: number; mastery_delta?: number },
) {
  const list = save.character.martial_arts_known;
  let explicitId = (a.art_id || "").trim();
  const name = (a.name || "").trim();

  // 이름으로 강호의 표준 무공 id 역추적
  if (!explicitId && name) {
    const hit = getAllArtOptions().find((o) => o.name === name);
    if (hit) explicitId = hit.id;
  }
  const resolvedId = explicitId || (name ? makeCustomArtIdLocal(name) : "");
  if (!resolvedId && !name) return;

  const matchesArt = (artId: string): boolean => {
    if (artId === resolvedId) return true;
    if (name && (artNameKR(artId) === name || artNameOf(artId) === name)) return true;
    return false;
  };

  if (a.action === "remove") {
    save.character.martial_arts_known = list.filter((x) => !matchesArt(x.art_id));
    return;
  }

  const existing = list.find((x) => matchesArt(x.art_id));

  if (a.action === "add") {
    if (existing) {
      if (typeof a.mastery_pct === "number") existing.mastery_pct = clampPct(a.mastery_pct);
      else if (typeof a.mastery_delta === "number") existing.mastery_pct = clampPct(existing.mastery_pct + a.mastery_delta);
    } else {
      list.push({ art_id: resolvedId, mastery_pct: clampPct(a.mastery_pct ?? 10) });
    }
    return;
  }

  // action=change
  if (existing) {
    if (typeof a.mastery_pct === "number") existing.mastery_pct = clampPct(a.mastery_pct);
    else if (typeof a.mastery_delta === "number") existing.mastery_pct = clampPct(existing.mastery_pct + a.mastery_delta);
  } else {
    // 본문에 처음 등장했고 change 로 들어왔어도 등록.
    list.push({ art_id: resolvedId, mastery_pct: clampPct(a.mastery_pct ?? Math.max(0, a.mastery_delta ?? 0)) });
  }
}

function applyFamilyUpdate(
  save: SaveData,
  f: { field: string; action?: "set" | "add" | "remove"; value?: unknown },
) {
  const fs = save.character.family_status;
  const v = f.value;
  switch (f.field) {
    case "spouse":
      fs.spouse = v == null || v === "" ? null : String(v);
      break;
    case "father_alive":
      fs.father_alive = Boolean(v);
      break;
    case "mother_alive":
      fs.mother_alive = Boolean(v);
      break;
    case "siblings":
    case "concubines":
    case "children": {
      const arr = (fs as any)[f.field] as string[];
      if (f.action === "remove") {
        (fs as any)[f.field] = arr.filter((x) => x !== String(v));
      } else if (f.action === "set" && Array.isArray(v)) {
        (fs as any)[f.field] = (v as unknown[]).map((x) => String(x));
      } else {
        // add (default)
        const name = String(v || "").trim();
        if (name && !arr.includes(name)) arr.push(name);
      }
      break;
    }
  }
}

function normalizeRealmProgress(save: SaveData) {
  const r = save.character.realm;
  if (!r) return;
  const stageId = r.current_stage;
  const need = getXpRequiredFor(stageId);
  const cur = Math.max(0, Math.floor(Number(r.experience_in_stage) || 0));

  // 단계가 바뀌어 (AI 가 깨달음 묘사와 함께 current_stage 갱신) 진척이 정의되어 있지 않다면 0 으로
  if (cur > need) {
    const requiresEnl = nextStageRequiresEnlightenment(stageId);
    if (requiresEnl) {
      // 깨달음 대기 — XP 는 필요량으로 캡, 진척 100%, awaiting 플래그 ON
      r.experience_in_stage = need;
      r.stage_progress_pct = 100;
      r.awaiting_enlightenment = true;
    } else {
      // 자동 진급 — 다음 단계로 이동, 남은 XP 이월
      const nextId = getNextStageId(stageId);
      if (nextId) {
        const nextStage = getStageById(nextId);
        if (nextStage) {
          r.current_stage = nextStage.stage_id;
          r.current_realm = nextStage.realm_id;
          r.tier = nextStage.tier;
          r.internal_energy_cap = nextStage.internal_energy_cap;
          if (r.internal_energy < nextStage.internal_energy_midpoint * 0.5) {
            r.internal_energy = nextStage.internal_energy_midpoint;
          }
          const carry = cur - need;
          const newNeed = getXpRequiredFor(nextStage.stage_id);
          r.experience_in_stage = Math.min(carry, newNeed);
          r.stage_progress_pct = Math.floor((r.experience_in_stage / Math.max(1, newNeed)) * 100);
          r.awaiting_enlightenment = false;
          return normalizeRealmProgress(save); // 연쇄 진급 가능
        }
      }
      r.experience_in_stage = need;
      r.stage_progress_pct = 100;
    }
  } else {
    r.experience_in_stage = cur;
    r.stage_progress_pct = Math.floor((cur / Math.max(1, need)) * 100);
    // XP 가 가득 찼는데 깨달음 필요 단계라면 플래그
    if (cur >= need && nextStageRequiresEnlightenment(stageId)) {
      r.awaiting_enlightenment = true;
    } else if (cur < need) {
      r.awaiting_enlightenment = false;
    }
  }
}

function applyUpcomingEventUpdates(save: SaveData, updates: ExtractedUpdates["upcomingEventUpdates"]) {
  if (!save.upcomingEvents) save.upcomingEvents = [];
  const list = save.upcomingEvents;
  const now = save.gameTime;

  for (const u of updates || []) {
    if (u.action === "remove") {
      if (u.id) save.upcomingEvents = list.filter((e) => e.id !== u.id);
      else if (u.title) save.upcomingEvents = list.filter((e) => e.title !== u.title);
      continue;
    }
    // add / update — id 또는 제목으로 기존 항목 찾기
    let ev = u.id ? list.find((e) => e.id === u.id) : list.find((e) => e.title === u.title);
    if (!ev) {
      if (!u.title) continue;
      ev = {
        id: "ev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 5),
        title: u.title,
        description: "",
        date: { year: now?.year || 1, month: now?.month || 1, day: now?.day || 1 },
        importance: 5,
        status: "scheduled",
      };
      list.push(ev);
    }
    if (u.title) ev.title = u.title;
    if (typeof u.description === "string") ev.description = u.description;
    if (typeof u.year === "number") ev.date.year = Math.max(1, Math.floor(u.year));
    if (typeof u.month === "number") ev.date.month = clamp(Math.floor(u.month), 1, 12);
    if (typeof u.day === "number") ev.date.day = clamp(Math.floor(u.day), 1, 30);
    if (typeof u.location === "string") ev.location = u.location;
    if (typeof u.importance === "number") ev.importance = clamp(Math.floor(u.importance), 1, 10);
    if (u.status) ev.status = u.status;
  }

  // 5년(1800일) 넘게 지난 done/cancelled 정리 + 너무 많으면 컷
  const nowAbs = now ? now.year * 360 + now.month * 30 + now.day : 0;
  save.upcomingEvents = save.upcomingEvents.filter((e) => {
    const evAbs = e.date.year * 360 + e.date.month * 30 + e.date.day;
    if ((e.status === "done" || e.status === "cancelled") && nowAbs - evAbs > 180) return false;
    return true;
  });
  // 날짜순 정렬, 최대 30개
  save.upcomingEvents.sort((a, b) => {
    const aa = a.date.year * 360 + a.date.month * 30 + a.date.day;
    const bb = b.date.year * 360 + b.date.month * 30 + b.date.day;
    return aa - bb;
  });
  if (save.upcomingEvents.length > 30) save.upcomingEvents = save.upcomingEvents.slice(0, 30);
}

function clampPct(n: number): number {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function makeCustomArtIdLocal(name: string): string {
  try {
    return "custom_" + btoa(unescape(encodeURIComponent(name.trim())));
  } catch {
    return "custom_" + encodeURIComponent(name.trim());
  }
}

function artNameOf(artId: string): string {
  if (!artId) return "";
  if (artId.startsWith("custom_")) {
    try {
      return decodeURIComponent(escape(atob(artId.slice(7))));
    } catch {
      return artId;
    }
  }
  return artId;
}

const SICHEN_ORDER = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];

function applyTimeAdvance(save: SaveData, raw: any) {
  if (!save.gameTime) {
    save.gameTime = { year: 1, month: 3, day: 1, sichen: "진" };
  }
  if (!raw || typeof raw !== "object") return;

  const t = save.gameTime;

  if (typeof raw.set_year === "number") t.year = Math.max(1, Math.floor(raw.set_year));
  if (typeof raw.set_month === "number") t.month = clamp(Math.floor(raw.set_month), 1, 12);
  if (typeof raw.set_day === "number") t.day = clamp(Math.floor(raw.set_day), 1, 30);
  if (typeof raw.set_sichen === "string" && SICHEN_ORDER.includes(raw.set_sichen)) {
    t.sichen = raw.set_sichen;
  }

  const sichenDelta = Number(raw.sichen_delta) || 0;
  const dayDelta = Number(raw.day_delta) || 0;
  const monthDelta = Number(raw.month_delta) || 0;
  const yearDelta = Number(raw.year_delta) || 0;

  if (sichenDelta) {
    let idx = SICHEN_ORDER.indexOf(t.sichen);
    if (idx < 0) idx = 4;
    const total = idx + sichenDelta;
    const dayShift = Math.floor(total / 12);
    const newIdx = ((total % 12) + 12) % 12;
    t.sichen = SICHEN_ORDER[newIdx];
    t.day += dayShift;
  }

  t.day += dayDelta;
  while (t.day > 30) { t.day -= 30; t.month += 1; }
  while (t.day < 1) { t.day += 30; t.month -= 1; }

  t.month += monthDelta;
  while (t.month > 12) { t.month -= 12; t.year += 1; }
  while (t.month < 1) { t.month += 12; t.year -= 1; }

  t.year = Math.max(1, t.year + yearDelta);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function stripCodeFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) return t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "");
  return t;
}

function sumMonthly(records: UsageRecord[]): number {
  const now = new Date();
  return records.filter((r) => {
    const d = new Date(r.createdAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).reduce((s, r) => s + r.estimated_cost_usd, 0);
}
function sumDaily(records: UsageRecord[]): number {
  const today = new Date().toDateString();
  return records.filter((r) => new Date(r.createdAt).toDateString() === today)
    .reduce((s, r) => s + r.estimated_cost_usd, 0);
}
