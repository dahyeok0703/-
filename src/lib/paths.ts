import path from "path";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "data");
export const WORLD_DIR = path.join(DATA_DIR, "world");
export const NPC_DIR = path.join(WORLD_DIR, "npcs");
export const SAVE_DIR = path.join(DATA_DIR, "save");
export const TEMPLATE_DIR = path.join(SAVE_DIR, "_templates");

export const DEFAULT_SLOT = "slot1";
export function slotDir(slot: string = DEFAULT_SLOT) {
  return path.join(SAVE_DIR, slot);
}
export function slotFile(file: string, slot: string = DEFAULT_SLOT) {
  return path.join(slotDir(slot), file);
}
