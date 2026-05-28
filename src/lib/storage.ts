// localStorage 래퍼. SSR 안전.

const PREFIX = "wuxia:";

const KEYS = {
  apiKey: PREFIX + "openai_api_key",
  modelChat: PREFIX + "model_chat",
  modelSummary: PREFIX + "model_summary",
  maxOutputTokens: PREFIX + "max_output_tokens",
  save: PREFIX + "save",
  messages: PREFIX + "messages",
  memories: PREFIX + "memories",
  usage: PREFIX + "usage",
} as const;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function get(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    console.error("[localStorage] 저장 실패", e);
  }
}
function del(key: string) {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ---------- API Key ----------
export function getApiKey(): string {
  return get(KEYS.apiKey) || "";
}
export function setApiKey(key: string) {
  if (key.trim()) set(KEYS.apiKey, key.trim());
  else del(KEYS.apiKey);
}
export function clearApiKey() {
  del(KEYS.apiKey);
}

// ---------- 모델 ----------
export function getModelChat(): string {
  return get(KEYS.modelChat) || "gpt-5.4-mini";
}
export function setModelChat(m: string) {
  if (m.trim()) set(KEYS.modelChat, m.trim());
}
export function getModelSummary(): string {
  return get(KEYS.modelSummary) || getModelChat();
}
export function setModelSummary(m: string) {
  if (m.trim()) set(KEYS.modelSummary, m.trim());
}

// 출력 길이
const DEFAULT_MAX_OUT = 1500;
export function getMaxOutputTokens(): number {
  const raw = get(KEYS.maxOutputTokens);
  if (!raw) return DEFAULT_MAX_OUT;
  const n = parseInt(raw, 10);
  if (!isFinite(n) || n < 100) return DEFAULT_MAX_OUT;
  return Math.min(n, 16000);
}
export function setMaxOutputTokens(n: number) {
  set(KEYS.maxOutputTokens, String(Math.max(100, Math.min(16000, Math.floor(n)))));
}

// ---------- 게임 데이터 ----------
function getJSON<T>(key: string, fallback: T): T {
  const raw = get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function setJSON(key: string, value: unknown) {
  set(key, JSON.stringify(value));
}

export function loadSave<T>(fallback: T): T {
  const raw = getJSON<T>(KEYS.save, fallback);
  // 마이그레이션 — 구버전 세이브 보정
  if (raw && typeof raw === "object") {
    migrateSaveInPlace(raw as any);
  }
  return raw;
}
export function saveSave(data: unknown) {
  setJSON(KEYS.save, data);
}

function migrateSaveInPlace(save: any) {
  if (!save) return;
  if (!save.gameTime) save.gameTime = { year: 1, month: 3, day: 1, sichen: "진" };
  if (!save.customCatalog) save.customCatalog = { weapons: [], arts: [] };
  if (!Array.isArray(save.upcomingEvents)) save.upcomingEvents = [];
  if (!save.runtimeDelta) {
    save.runtimeDelta = {
      generatedNpcs: [],
      generatedFactions: [],
      generatedSects: [],
      generatedRegions: [],
      generatedItems: [],
      generatedMartialArts: [],
      generatedRelations: [],
      generatedEvents: [],
      generatedConflicts: [],
      rumors: [],
      titleChanges: [],
      rankState: [],
      npcStateOverrides: [],
      playerHistory: [],
      updatedAt: new Date().toISOString(),
    };
  } else {
    const d = save.runtimeDelta;
    for (const k of [
      "generatedNpcs","generatedFactions","generatedSects","generatedRegions","generatedItems",
      "generatedMartialArts","generatedRelations","generatedEvents","generatedConflicts",
      "rumors","titleChanges","rankState","npcStateOverrides","playerHistory",
    ]) {
      if (!Array.isArray(d[k])) d[k] = [];
    }
    if (!d.updatedAt) d.updatedAt = new Date().toISOString();
  }
}

export function loadMessages<T>(fallback: T): T {
  return getJSON<T>(KEYS.messages, fallback);
}
export function saveMessages(data: unknown) {
  setJSON(KEYS.messages, data);
}

export function loadMemories<T>(fallback: T): T {
  return getJSON<T>(KEYS.memories, fallback);
}
export function saveMemories(data: unknown) {
  setJSON(KEYS.memories, data);
}

export function loadUsage<T>(fallback: T): T {
  return getJSON<T>(KEYS.usage, fallback);
}
export function saveUsage(data: unknown) {
  setJSON(KEYS.usage, data);
}

// ---------- 전체 초기화 ----------
export function clearAllGameData() {
  del(KEYS.save);
  del(KEYS.messages);
  del(KEYS.memories);
  del(KEYS.usage);
  // API 키와 모델 설정은 보존 — 따로 지우려면 clearApiKey 호출
}

export function clearEverythingIncludingKey() {
  clearAllGameData();
  del(KEYS.apiKey);
  del(KEYS.modelChat);
  del(KEYS.modelSummary);
  del(KEYS.maxOutputTokens);
}

// ---------- 백업 슬롯 ----------

const SLOTS_KEY = PREFIX + "backup_slots";

export interface BackupSlot {
  id: string;
  createdAt: string;
  label: string;
  characterName: string;
  characterAge: number;
  turn: number;
  data: {
    save: unknown;
    messages: unknown;
    memories: unknown;
    usage: unknown;
  };
}

export function listBackupSlots(): BackupSlot[] {
  return getJSON<BackupSlot[]>(SLOTS_KEY, []);
}

export function saveBackupSlot(label: string): BackupSlot {
  const slots = listBackupSlots();
  const id = "slot_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  const saveData = loadSave<any>(null);
  const messages = loadMessages<any>([]);
  const memories = loadMemories<any>([]);
  const usage = loadUsage<any>([]);
  const slot: BackupSlot = {
    id,
    createdAt: new Date().toISOString(),
    label: label || `백업 ${new Date().toLocaleString("ko-KR")}`,
    characterName: saveData?.character?.identity?.name || "?",
    characterAge: saveData?.character?.identity?.age ?? 0,
    turn: saveData?.turn ?? 0,
    data: { save: saveData, messages, memories, usage },
  };
  slots.unshift(slot);
  // 최대 20개 유지
  if (slots.length > 20) slots.length = 20;
  setJSON(SLOTS_KEY, slots);
  return slot;
}

export function loadBackupSlot(slotId: string): boolean {
  const slots = listBackupSlots();
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return false;
  if (slot.data.save) saveSave(slot.data.save);
  saveMessages(slot.data.messages || []);
  saveMemories(slot.data.memories || []);
  saveUsage(slot.data.usage || []);
  return true;
}

export function deleteBackupSlot(slotId: string) {
  const slots = listBackupSlots().filter((s) => s.id !== slotId);
  setJSON(SLOTS_KEY, slots);
}
