// 메인 게임 엔진: 입력 → 컨텍스트 조립 → AI 호출 → 저장 → 상태 추출.

import {
  appendMessages,
  appendUsage,
  getRecentMessages,
  loadSave,
  loadUsage,
  saveSave,
} from "./save";
import { ChatMessage, ExtractedUpdates, SaveData, UsageRecord } from "./types";
import {
  callResponses,
  classifyOpenAIError,
  hasApiKey,
  modelChat,
  modelSummary,
  OpenAIResult,
} from "./openai-client";
import { mockChatResponse, mockExtractResponse } from "./mock";
import { buildPrompt } from "./prompts/builder";
import { EXTRACTOR_RULES } from "./prompts/system";
import {
  appendMemory,
  createMemory,
  recentTextFromMessages,
  retrieveRelevantMemories,
} from "./memory";
import { estimateCostUSD } from "./cost";

const MAX_RECENT = parseInt(process.env.MAX_RECENT_MESSAGES || "18", 10);
const MAX_CTX_TOK = parseInt(process.env.MAX_CONTEXT_TOKENS || "8000", 10);
const MAX_OUT_TOK = parseInt(process.env.MAX_OUTPUT_TOKENS || "1500", 10);
const MONTHLY_BUDGET = parseFloat(process.env.MONTHLY_BUDGET_USD || "50");

function newMsgId(): string {
  return "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
}

export interface TurnResult {
  ok: boolean;
  reply?: string;
  error?: string;
  errorKind?: string;
  usageThisTurn?: UsageRecord[];
  saveErrorWarning?: string;
  debug?: {
    model: string;
    recentMessageCount: number;
    memoryCount: number;
    estimatedInputTokens: number;
    costEstimateUSD: number;
    monthlyTotalUSD: number;
    dailyTotalUSD: number;
  };
  budgetWarning?: string;
}

export async function processTurn(userInput: string, slot?: string): Promise<TurnResult> {
  if (!userInput.trim()) return { ok: false, error: "입력이 비어있어요." };

  const save = await loadSave(slot);
  if (!save) {
    return { ok: false, error: "세이브가 없습니다. 새 게임을 먼저 시작하세요." };
  }

  const recent = await getRecentMessages(MAX_RECENT, slot);
  const memCtx = {
    userInput,
    recentText: recentTextFromMessages(recent, 6),
    currentLocationId: save.character.current_location_id,
    presentCharacters: collectRelatedCharacters(save, recent),
    presentFactions: [save.character.affiliation.sect_id].filter(Boolean) as string[],
  };
  const memories = await retrieveRelevantMemories(memCtx, 10, slot);

  // 예산 확인
  const usage = await loadUsage(slot);
  const monthlyTotal = sumMonthly(usage);
  const dailyTotal = sumDaily(usage);
  const budgetWarn =
    monthlyTotal >= MONTHLY_BUDGET
      ? `이번 달 누적 비용 $${monthlyTotal.toFixed(4)} 가 한도 $${MONTHLY_BUDGET}를 넘었습니다.`
      : monthlyTotal >= MONTHLY_BUDGET * 0.8
      ? `주의: 이번 달 누적 $${monthlyTotal.toFixed(4)} (한도 $${MONTHLY_BUDGET}의 80% 도달).`
      : undefined;

  // 프롬프트 조립
  const built = await buildPrompt({
    save,
    recentMessages: recent,
    relevantMemories: memories,
    userInput,
    maxContextTokens: MAX_CTX_TOK,
  });

  // AI 호출
  let chatResult: OpenAIResult;
  const useMock = !hasApiKey();
  try {
    if (useMock) {
      chatResult = mockChatResponse(userInput);
    } else {
      chatResult = await callResponses({
        model: modelChat(),
        instructions: built.instructions,
        input: built.input,
        maxOutputTokens: MAX_OUT_TOK,
      });
    }
  } catch (err) {
    const info = classifyOpenAIError(err);
    console.error("[OpenAI 호출 실패]", info.kind, err);
    return { ok: false, error: info.userMessage, errorKind: info.kind };
  }

  const userMsg: ChatMessage = {
    id: newMsgId(),
    role: "user",
    content: userInput,
    createdAt: new Date().toISOString(),
  };
  const aiMsg: ChatMessage = {
    id: newMsgId(),
    role: "assistant",
    content: chatResult.text,
    createdAt: new Date().toISOString(),
  };

  // 비용 기록 (메인 응답)
  const chatCost = estimateCostUSD(chatResult.model, chatResult.usage.input_tokens, chatResult.usage.output_tokens);
  const chatUsageRec: UsageRecord = {
    id: "u_" + Date.now().toString(36),
    createdAt: new Date().toISOString(),
    requestType: "chat",
    model: chatResult.model,
    input_tokens: chatResult.usage.input_tokens,
    output_tokens: chatResult.usage.output_tokens,
    total_tokens: chatResult.usage.total_tokens,
    estimated_cost_usd: chatCost,
  };

  // 저장 (메시지·턴 증가·사용량)
  let saveErr: string | undefined;
  try {
    await appendMessages([userMsg, aiMsg], slot);
    save.turn += 1;
    await saveSave(save, slot);
    await appendUsage(chatUsageRec, slot);
  } catch (e) {
    console.error("[저장 실패]", e);
    saveErr = "메시지/세이브 저장에 실패했어요 (응답은 표시됨).";
  }

  // 상태 추출 (별도 호출). 실패해도 게임은 진행.
  let summaryUsageRec: UsageRecord | undefined;
  try {
    const extractor = useMock
      ? mockExtractResponse()
      : await callResponses({
          model: modelSummary(),
          instructions: EXTRACTOR_RULES,
          input: [
            {
              role: "user",
              content: `유저 입력:\n${userInput}\n\n게임 마스터 응답:\n${chatResult.text}`,
            },
          ],
          maxOutputTokens: 600,
        });
    summaryUsageRec = recordExtraction(extractor);
    await applyExtraction(extractor.text, save, slot);
    await appendUsage(summaryUsageRec, slot);
  } catch (e) {
    console.error("[상태 추출 실패]", e);
    saveErr = (saveErr ? saveErr + " · " : "") + "상태 추출 실패 (게임 데이터엔 영향 없음).";
  }

  const totalUsage = [chatUsageRec, ...(summaryUsageRec ? [summaryUsageRec] : [])];
  const turnCost = totalUsage.reduce((s, u) => s + u.estimated_cost_usd, 0);
  const newMonthly = monthlyTotal + turnCost;
  const newDaily = dailyTotal + turnCost;

  // 콘솔 로그 (민감정보 제외)
  console.log("[엔진]", {
    model: chatResult.model,
    recentMessageCount: built.debug.recentMessageCount,
    memoryCount: memories.length,
    estimatedInputTokens: built.debug.estimatedInputTokens,
    actualInputTokens: chatResult.usage.input_tokens,
    actualOutputTokens: chatResult.usage.output_tokens,
    turnCostUSD: turnCost.toFixed(6),
    monthlyUSD: newMonthly.toFixed(4),
  });

  return {
    ok: true,
    reply: chatResult.text,
    usageThisTurn: totalUsage,
    saveErrorWarning: saveErr,
    budgetWarning: budgetWarn,
    debug: {
      model: chatResult.model,
      recentMessageCount: built.debug.recentMessageCount,
      memoryCount: memories.length,
      estimatedInputTokens: built.debug.estimatedInputTokens,
      costEstimateUSD: turnCost,
      monthlyTotalUSD: newMonthly,
      dailyTotalUSD: newDaily,
    },
  };
}

function recordExtraction(result: OpenAIResult): UsageRecord {
  const cost = estimateCostUSD(result.model, result.usage.input_tokens, result.usage.output_tokens);
  return {
    id: "u_" + Date.now().toString(36) + "_s",
    createdAt: new Date().toISOString(),
    requestType: "summary",
    model: result.model,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
    total_tokens: result.usage.total_tokens,
    estimated_cost_usd: cost,
  };
}

async function applyExtraction(rawText: string, save: SaveData, slot?: string) {
  let parsed: ExtractedUpdates | null = null;
  try {
    const cleaned = stripCodeFences(rawText);
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn("[상태 추출 JSON 파싱 실패]", rawText.slice(0, 300));
    return;
  }
  if (!parsed) return;

  // NPC 관계 업데이트
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

  // 인벤토리
  for (const inv of parsed.inventoryUpdates || []) {
    if (inv.action === "add") {
      save.character.inventory.items.push(inv.item);
    } else if (inv.action === "remove") {
      save.character.inventory.items = save.character.inventory.items.filter((x) => x !== inv.item);
    }
  }

  // 플레이어 필드 (안전한 화이트리스트만)
  for (const p of parsed.playerUpdates || []) {
    applyPlayerField(save, p.field, p.value);
  }

  // 일대기 요약 갱신
  if (parsed.summary) {
    save.character.biography_summary =
      (save.character.biography_summary ? save.character.biography_summary + " | " : "") +
      parsed.summary;
    // 너무 길어지면 꼬리만 유지
    if (save.character.biography_summary.length > 2000) {
      save.character.biography_summary = "…" + save.character.biography_summary.slice(-1800);
    }
  }

  // 이벤트 로그 → 장기기억
  for (const ev of parsed.eventLogs || []) {
    await appendMemory(
      createMemory("event_log", ev.title, ev.content, {
        importance: ev.importance || 5,
        relatedCharacters: [],
        relatedFactions: [],
        relatedLocations: save.character.current_location_id ? [save.character.current_location_id] : [],
      }),
      slot
    );
  }
  for (const t of parsed.unresolvedThreads || []) {
    await appendMemory(
      createMemory("unresolved_threads", t.title, t.content, { importance: t.importance || 6 }),
      slot
    );
  }
  for (const f of parsed.factionUpdates || []) {
    await appendMemory(
      createMemory("faction_memory", f.faction_id, f.note, {
        importance: 5,
        relatedFactions: [f.faction_id],
      }),
      slot
    );
  }
  for (const l of parsed.locationUpdates || []) {
    await appendMemory(
      createMemory("location_memory", l.location_id, l.note, {
        importance: 5,
        relatedLocations: [l.location_id],
      }),
      slot
    );
  }

  await saveSave(save, slot);
}

function applyPlayerField(save: SaveData, field: string, value: unknown) {
  // 안전한 필드만 허용
  const allowed: Record<string, (v: any) => void> = {
    "identity.name": (v) => (save.character.identity.name = String(v)),
    "identity.age": (v) => (save.character.identity.age = Number(v)),
    "identity.appearance": (v) => (save.character.identity.appearance = String(v)),
    "current_location_id": (v) => (save.character.current_location_id = String(v)),
    "affiliation.sect_id": (v) => (save.character.affiliation.sect_id = v ? String(v) : null),
    "affiliation.rank": (v) => (save.character.affiliation.rank = v ? String(v) : null),
    "civilian_or_martial": (v) =>
      (save.character.civilian_or_martial = v === "martial" ? "martial" : "civilian"),
    "realm.current_realm": (v) => (save.character.realm.current_realm = String(v)),
    "realm.current_stage": (v) => (save.character.realm.current_stage = String(v)),
    "realm.internal_energy": (v) => (save.character.realm.internal_energy = Number(v)),
    "vitals.hp_current": (v) => (save.character.vitals.hp_current = Number(v)),
    "vitals.internal_injury": (v) => (save.character.vitals.internal_injury = Number(v)),
    "vitals.external_injury": (v) => (save.character.vitals.external_injury = Number(v)),
    "inventory.silver_taels": (v) => (save.character.inventory.silver_taels = Number(v)),
  };
  const fn = allowed[field];
  if (fn) {
    try {
      fn(value);
    } catch {
      // ignore
    }
  }
}

function stripCodeFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "");
  }
  return t;
}

function collectRelatedCharacters(save: SaveData, recent: ChatMessage[]): string[] {
  const names = new Set<string>();
  for (const r of Object.values(save.relationships)) {
    names.add(r.name);
  }
  return Array.from(names);
}

function sumMonthly(records: UsageRecord[]): number {
  const now = new Date();
  return records
    .filter((r) => {
      const d = new Date(r.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((s, r) => s + r.estimated_cost_usd, 0);
}
function sumDaily(records: UsageRecord[]): number {
  const today = new Date().toDateString();
  return records
    .filter((r) => new Date(r.createdAt).toDateString() === today)
    .reduce((s, r) => s + r.estimated_cost_usd, 0);
}
