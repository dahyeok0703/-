// 클라이언트 사이드 게임 엔진. 모든 저장은 localStorage.

import { ChatMessage, ExtractedUpdates, SaveData, UsageRecord, CharacterState } from "./types";
import {
  loadSave, saveSave, loadMessages, saveMessages,
  loadUsage, saveUsage, getApiKey, getModelChat, getModelSummary,
} from "./storage";
import { addMemory, createMemory, recentTextFromMessages, retrieveRelevantMemories } from "./memory";
import { buildPrompt } from "./prompt-builder";
import { EXTRACTOR_RULES } from "./prompts/system";
import { callResponses, classifyError, CallResult } from "./openai-browser";
import { mockChat, mockExtract } from "./mock";
import { estimateCostUSD } from "./cost";
import { CHARACTER_TEMPLATE, getStageById } from "../data/world-data";

const MAX_RECENT = 18;
const MAX_CTX_TOK = 8000;
const MAX_OUT_TOK = 1500;

function newMsgId(): string {
  return "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
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
      tpl.realm.stage_progress_pct = 50;
    }
  } else if (!isMartial) {
    tpl.realm.current_realm = "samryu";
    tpl.realm.current_stage = "samryu_chuip";
    tpl.realm.tier = 1;
    tpl.realm.internal_energy = 0;
    tpl.realm.internal_energy_cap = 10;
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

export async function processTurn(userInput: string, opts?: { monthlyBudgetUSD?: number }): Promise<TurnResult> {
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

  const built = buildPrompt({
    save, recentMessages: recent, relevantMemories: memories,
    userInput, maxContextTokens: MAX_CTX_TOK,
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

  // 메인 호출
  let chatResult: CallResult;
  try {
    if (useMock) {
      chatResult = mockChat(userInput);
    } else {
      chatResult = await callResponses({
        apiKey,
        model: getModelChat(),
        instructions: built.instructions,
        input: built.input,
        maxOutputTokens: MAX_OUT_TOK,
      });
    }
  } catch (err) {
    const info = classifyError(err);
    console.error("[OpenAI 호출 실패]", info.kind, err);
    return { ok: false, error: info.userMessage, errorKind: info.kind };
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
    saveUsage([...allUsage, chatUsage]);
  } catch (e) {
    console.error("[저장 실패]", e);
    saveErr = "메시지 저장 실패 (응답은 표시됨)";
  }

  // 상태 추출 (별도 호출)
  let summaryUsage: UsageRecord | undefined;
  try {
    const extractor = useMock
      ? mockExtract()
      : await callResponses({
          apiKey,
          model: getModelSummary(),
          instructions: EXTRACTOR_RULES,
          input: [{ role: "user", content: `유저 입력:\n${userInput}\n\n게임 마스터 응답:\n${chatResult.text}` }],
          maxOutputTokens: 600,
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

  for (const p of parsed.playerUpdates || []) {
    applyPlayerField(save, p.field, p.value);
  }

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
  const allowed: Record<string, (v: any) => void> = {
    "identity.name": (v) => (save.character.identity.name = String(v)),
    "identity.age": (v) => (save.character.identity.age = Number(v)),
    "identity.appearance": (v) => (save.character.identity.appearance = String(v)),
    "current_location_id": (v) => (save.character.current_location_id = String(v)),
    "affiliation.sect_id": (v) => (save.character.affiliation.sect_id = v ? String(v) : null),
    "affiliation.rank": (v) => (save.character.affiliation.rank = v ? String(v) : null),
    "civilian_or_martial": (v) => (save.character.civilian_or_martial = v === "martial" ? "martial" : "civilian"),
    "realm.current_realm": (v) => (save.character.realm.current_realm = String(v)),
    "realm.current_stage": (v) => (save.character.realm.current_stage = String(v)),
    "realm.internal_energy": (v) => (save.character.realm.internal_energy = Number(v)),
    "vitals.hp_current": (v) => (save.character.vitals.hp_current = Number(v)),
    "vitals.internal_injury": (v) => (save.character.vitals.internal_injury = Number(v)),
    "vitals.external_injury": (v) => (save.character.vitals.external_injury = Number(v)),
    "inventory.silver_taels": (v) => (save.character.inventory.silver_taels = Number(v)),
  };
  const fn = allowed[field];
  if (fn) try { fn(value); } catch { /* ignore */ }
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
