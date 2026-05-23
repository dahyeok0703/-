import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import {
  ChatMessage,
  LongTermMemory,
  SaveData,
  UsageRecord,
  CharacterState,
} from "./types";
import { DEFAULT_SLOT, TEMPLATE_DIR, slotDir, slotFile, SAVE_DIR } from "./paths";

const FILES = {
  game: "game.json",
  messages: "messages.json",
  memories: "memories.json",
  usage: "usage_log.json",
} as const;

function ensureSlotDir(slot: string) {
  const dir = slotDir(slot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    const txt = await fs.readFile(file, "utf-8");
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(file: string, data: unknown) {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 원자적 쓰기: tmp에 쓰고 rename
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

// ---------- Save state ----------
export async function hasSave(slot: string = DEFAULT_SLOT): Promise<boolean> {
  return existsSync(slotFile(FILES.game, slot));
}

export async function loadSave(slot: string = DEFAULT_SLOT): Promise<SaveData | null> {
  if (!(await hasSave(slot))) return null;
  return readJSON<SaveData | null>(slotFile(FILES.game, slot), null);
}

export async function saveSave(data: SaveData, slot: string = DEFAULT_SLOT) {
  ensureSlotDir(slot);
  data.updatedAt = new Date().toISOString();
  await writeJSON(slotFile(FILES.game, slot), data);
}

export async function createNewSave(
  initialCharacter: CharacterState,
  slot: string = DEFAULT_SLOT
): Promise<SaveData> {
  ensureSlotDir(slot);
  const now = new Date().toISOString();
  const data: SaveData = {
    slot,
    createdAt: now,
    updatedAt: now,
    turn: 0,
    character: initialCharacter,
    relationships: {},
    worldStateOverrides: {
      npc_overrides: {},
      sect_overrides: {},
      global_events_caused_by_player: [],
      current_in_world_year: 0,
    },
  };
  await saveSave(data, slot);
  await writeJSON(slotFile(FILES.messages, slot), []);
  await writeJSON(slotFile(FILES.memories, slot), []);
  await writeJSON(slotFile(FILES.usage, slot), []);
  return data;
}

// ---------- Messages ----------
export async function loadMessages(slot: string = DEFAULT_SLOT): Promise<ChatMessage[]> {
  return readJSON<ChatMessage[]>(slotFile(FILES.messages, slot), []);
}

export async function appendMessages(msgs: ChatMessage[], slot: string = DEFAULT_SLOT) {
  ensureSlotDir(slot);
  const existing = await loadMessages(slot);
  existing.push(...msgs);
  await writeJSON(slotFile(FILES.messages, slot), existing);
}

export async function getRecentMessages(
  limit: number,
  slot: string = DEFAULT_SLOT
): Promise<ChatMessage[]> {
  const all = await loadMessages(slot);
  return all.slice(-limit);
}

// ---------- Memories ----------
export async function loadMemories(slot: string = DEFAULT_SLOT): Promise<LongTermMemory[]> {
  return readJSON<LongTermMemory[]>(slotFile(FILES.memories, slot), []);
}

export async function saveMemories(memories: LongTermMemory[], slot: string = DEFAULT_SLOT) {
  ensureSlotDir(slot);
  await writeJSON(slotFile(FILES.memories, slot), memories);
}

export async function addMemories(newOnes: LongTermMemory[], slot: string = DEFAULT_SLOT) {
  const all = await loadMemories(slot);
  all.push(...newOnes);
  await saveMemories(all, slot);
}

// ---------- Usage ----------
export async function loadUsage(slot: string = DEFAULT_SLOT): Promise<UsageRecord[]> {
  return readJSON<UsageRecord[]>(slotFile(FILES.usage, slot), []);
}

export async function appendUsage(rec: UsageRecord, slot: string = DEFAULT_SLOT) {
  ensureSlotDir(slot);
  const all = await loadUsage(slot);
  all.push(rec);
  await writeJSON(slotFile(FILES.usage, slot), all);
}

// ---------- 초기화 ----------
export async function resetSave(slot: string = DEFAULT_SLOT) {
  const dir = slotDir(slot);
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---------- 템플릿 ----------
export async function loadCharacterTemplate(): Promise<CharacterState> {
  const tpl = path.join(TEMPLATE_DIR, "character.template.json");
  const raw = await fs.readFile(tpl, "utf-8");
  const parsed = JSON.parse(raw);
  // 템플릿엔 메타 필드(_description 등)가 있으니 정리.
  delete parsed._description;
  delete parsed._martial_arts_format;
  delete parsed._civilian_or_martial_note;
  return parsed as CharacterState;
}

export function ensureSaveRoot() {
  if (!existsSync(SAVE_DIR)) mkdirSync(SAVE_DIR, { recursive: true });
}
