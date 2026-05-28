// 관계·갈등·세력상태 검색 — static JSON + runtime delta 병합.
import type { SaveData, RuntimeRelation } from "./types";
import relationsData from "../data/world/relations.json";
import conflictsData from "../data/world/conflicts.json";

const STATIC_RELATIONS: any[] = Array.isArray((relationsData as any)?.relations)
  ? (relationsData as any).relations
  : [];
const STATIC_CONFLICTS: any[] = Array.isArray((conflictsData as any)?.conflicts)
  ? (conflictsData as any).conflicts
  : [];
const STATIC_FACTION_STATES: any[] = Array.isArray((conflictsData as any)?.factionStates)
  ? (conflictsData as any).factionStates
  : [];

function entityIdsFrom(
  save: SaveData | null,
  entities: Array<{ id: string; name: string; aliases: string[] }>,
): Set<string> {
  const ids = new Set<string>();
  for (const e of entities) {
    ids.add(e.id);
    ids.add(e.name);
    for (const a of e.aliases) ids.add(a);
  }
  ids.add("player");
  if (save?.character?.identity?.name) ids.add(save.character.identity.name);
  const sectId = save?.character?.affiliation?.sect_id;
  if (sectId) ids.add(sectId);
  return ids;
}

export interface RelationHit {
  rel: RuntimeRelation;
  isRuntime: boolean;
}

export function findRelations(
  save: SaveData | null,
  entities: Array<{ id: string; name: string; aliases: string[] }>,
  limit = 20,
): RelationHit[] {
  const ids = entityIdsFrom(save, entities);
  const out: RelationHit[] = [];
  const all = [
    ...STATIC_RELATIONS.map((r) => ({ r: r as RuntimeRelation, isRuntime: false })),
    ...(save?.runtimeDelta?.generatedRelations || []).map((r) => ({ r, isRuntime: true })),
  ];
  for (const { r, isRuntime } of all) {
    if (ids.has(r.from) || ids.has(r.to)) out.push({ rel: r, isRuntime });
    if (out.length >= limit) break;
  }
  return out;
}

export interface ConflictHit {
  conflict: any;
  isRuntime: boolean;
}

export function findConflicts(
  save: SaveData | null,
  entities: Array<{ id: string; name: string; aliases: string[] }>,
  limit = 8,
): ConflictHit[] {
  const ids = entityIdsFrom(save, entities);
  const out: ConflictHit[] = [];
  const all = [
    ...STATIC_CONFLICTS.map((c) => ({ c, isRuntime: false })),
    ...((save?.runtimeDelta?.generatedConflicts || []) as any[]).map((c) => ({ c, isRuntime: true })),
  ];
  for (const { c, isRuntime } of all) {
    if (c?.active === false) continue;
    const participants = c.participants || [];
    const related = c.relatedNpcs || [];
    if (
      participants.some((p: string) => ids.has(p)) ||
      related.some((p: string) => ids.has(p))
    ) {
      out.push({ conflict: c, isRuntime });
    }
    if (out.length >= limit) break;
  }
  return out;
}

export function findFactionState(id: string): any | null {
  return STATIC_FACTION_STATES.find((f: any) => f.id === id) || null;
}
