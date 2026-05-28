// Canonical Entity Registry — 모든 인물·문파·세력·지역·무공·아이템에 고유 id 와 별칭(alias) 부여.
// 같은 인물의 여러 호칭("한설", "설화", "설화 한설")을 하나로 해석.

import { WORLD, NPCS_BY_SECT, NPCS_EXTRA } from "../data/world-data";
import type { SaveData, RuntimeWorldDelta, SupremeRankState } from "./types";

export type EntityKind =
  | "npc"
  | "sect"
  | "faction"
  | "region"
  | "city"
  | "art"
  | "item"
  | "concept";

export interface CanonicalEntity {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  sect?: string;
  faction?: string;
  region?: string;
  realm?: string;
  payload?: any;
  isRuntime?: boolean;
}

let _registry: CanonicalEntity[] | null = null;
let _runtimeFingerprint = "";

function pushUnique(list: CanonicalEntity[], ent: CanonicalEntity) {
  const exists = list.find((x) => x.kind === ent.kind && (x.id === ent.id || x.name === ent.name));
  if (!exists) list.push(ent);
  else {
    // 별칭 병합
    for (const a of ent.aliases) if (!exists.aliases.includes(a)) exists.aliases.push(a);
  }
}

// "한설(韓雪)" 같은 이름에서 한글·한자·별칭을 모두 뽑는다.
function expandAliases(name: string, extras: string[] = []): string[] {
  const out = new Set<string>(extras.filter(Boolean));
  if (!name) return [];
  out.add(name);
  // 괄호 안/밖 분리
  const inside = name.match(/\(([^)]+)\)/g);
  const stripped = name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (stripped && stripped !== name) out.add(stripped);
  if (inside) for (const m of inside) out.add(m.slice(1, -1).trim());
  // 공백 분리 토큰 (별호 부분, 마지막 인명 등)
  for (const tok of stripped.split(/\s+/)) {
    const t = tok.trim();
    if (t.length >= 2) out.add(t);
  }
  return Array.from(out).filter(Boolean);
}

function buildStatic(): CanonicalEntity[] {
  const list: CanonicalEntity[] = [];

  // 세력
  for (const f of WORLD.factions?.factions || []) {
    if (!f?.id || !f?.name) continue;
    pushUnique(list, {
      id: f.id,
      kind: "faction",
      name: f.name,
      aliases: expandAliases(f.name, [f.id]),
      payload: f,
    });
  }
  // 문파
  for (const s of WORLD.sects?.sects || []) {
    if (!s?.id || !s?.name) continue;
    pushUnique(list, {
      id: s.id,
      kind: "sect",
      name: s.name,
      aliases: expandAliases(s.name, [s.id]),
      faction: s.faction,
      payload: s,
    });
  }
  // 지역
  for (const r of WORLD.regions?.regions || []) {
    if (!r?.id || !r?.name) continue;
    pushUnique(list, {
      id: r.id,
      kind: "region",
      name: r.name,
      aliases: expandAliases(r.name, [r.id]),
      payload: r,
    });
    for (const c of r.major_cities || []) {
      const cid = `${r.id}__${c}`;
      pushUnique(list, {
        id: cid,
        kind: "city",
        name: c,
        aliases: expandAliases(c, [cid, c]),
        region: r.id,
        payload: { region: r.id, city: c },
      });
    }
  }
  // 무공
  for (const list2 of Object.values(WORLD.arts || {})) {
    if (!Array.isArray(list2)) continue;
    for (const a of list2 as any[]) {
      if (!a?.id || !a?.name) continue;
      pushUnique(list, {
        id: a.id,
        kind: "art",
        name: a.name,
        aliases: expandAliases(a.name, [a.id]),
        sect: a.sect || undefined,
        payload: a,
      });
    }
  }
  // 무기·영약·아이템 — items 류 (있다면)
  if (WORLD.weapons) {
    for (const [, arr] of Object.entries(WORLD.weapons as any)) {
      if (!Array.isArray(arr)) continue;
      for (const w of arr as any[]) {
        if (!w?.id || !w?.name) continue;
        pushUnique(list, { id: w.id, kind: "item", name: w.name, aliases: expandAliases(w.name, [w.id]), payload: w });
      }
    }
  }
  if (WORLD.elixirs) {
    for (const [, arr] of Object.entries(WORLD.elixirs as any)) {
      if (!Array.isArray(arr)) continue;
      for (const e of arr as any[]) {
        if (!e?.id || !e?.name) continue;
        pushUnique(list, { id: e.id, kind: "item", name: e.name, aliases: expandAliases(e.name, [e.id]), payload: e });
      }
    }
  }
  // NPC — 문파별
  for (const [sectId, body] of Object.entries(NPCS_BY_SECT)) {
    for (const npc of collectNPCs(body)) {
      if (!npc?.name) continue;
      const id = npc.id || `${sectId}__${npc.name}`;
      pushUnique(list, {
        id,
        kind: "npc",
        name: npc.name,
        aliases: expandAliases(npc.name, [
          ...(Array.isArray(npc.aliases) ? npc.aliases : []),
          npc.alias,
          npc.title,
          id,
        ].filter(Boolean) as string[]),
        sect: sectId,
        realm: npc.realm,
        payload: npc,
      });
    }
  }
  // NPC — 추가 카테고리
  for (const [, body] of Object.entries(NPCS_EXTRA)) {
    for (const npc of collectNPCs(body)) {
      if (!npc?.name) continue;
      const id = npc.id || `npc__${npc.name}`;
      pushUnique(list, {
        id,
        kind: "npc",
        name: npc.name,
        aliases: expandAliases(npc.name, [
          ...(Array.isArray(npc.aliases) ? npc.aliases : []),
          npc.alias,
          npc.title,
          id,
        ].filter(Boolean) as string[]),
        sect: npc.sect || undefined,
        faction: npc.faction || undefined,
        realm: npc.realm,
        payload: npc,
      });
    }
  }
  // 사화 / 정점들
  for (const b of WORLD.beauties?.four_beauties || []) {
    if (!b?.id || !b?.name) continue;
    pushUnique(list, { id: b.id, kind: "npc", name: b.name, aliases: expandAliases(b.name, [b.id, b.alias]), payload: b });
  }
  const supreme = WORLD.supreme || {};
  for (const groupKey of ["yukcheon", "ohwang", "palwang", "chilseong"]) {
    for (const p of (supreme as any)[groupKey] || []) {
      if (!p?.id || !p?.name) continue;
      pushUnique(list, {
        id: p.id,
        kind: "npc",
        name: p.name,
        aliases: expandAliases(p.name, [p.id, p.title, p.alias]),
        realm: p.realm,
        payload: p,
      });
    }
  }

  return list;
}

function collectNPCs(body: any): any[] {
  if (!body || typeof body !== "object") return [];
  const out: any[] = [];
  for (const v of Object.values(body)) {
    if (Array.isArray(v)) for (const x of v) if (x && typeof x === "object" && (x as any).name) out.push(x);
  }
  return out;
}

export function getRegistry(): CanonicalEntity[] {
  if (!_registry) _registry = buildStatic();
  return _registry!;
}

export function rebuildRegistry() {
  _registry = null;
  _runtimeFingerprint = "";
}

// 런타임 델타까지 포함한 확장 레지스트리. SaveData 가 바뀌면 다시 계산.
export function getResolvedRegistry(save: SaveData | null): CanonicalEntity[] {
  const base = getRegistry();
  const delta = save?.runtimeDelta;
  if (!delta) return base;
  const fp = String(save?.turn ?? 0) + "@" + (delta.updatedAt || "");
  if (fp === _runtimeFingerprint && (base as any)._withRuntime) return base;

  const out = base.slice();
  for (const n of delta.generatedNpcs || []) {
    pushUnique(out, {
      id: n.id,
      kind: "npc",
      name: n.name,
      aliases: expandAliases(n.name, [n.id, ...(n.aliases || [])]),
      sect: n.sect,
      faction: n.faction,
      region: n.region,
      realm: n.realm,
      isRuntime: true,
      payload: n,
    });
  }
  for (const f of delta.generatedFactions || []) {
    pushUnique(out, { id: f.id, kind: "faction", name: f.name, aliases: expandAliases(f.name, [f.id]), isRuntime: true, payload: f });
  }
  for (const s of delta.generatedSects || []) {
    pushUnique(out, { id: s.id, kind: "sect", name: s.name, aliases: expandAliases(s.name, [s.id]), faction: s.faction, isRuntime: true, payload: s });
  }
  for (const r of delta.generatedRegions || []) {
    pushUnique(out, { id: r.id, kind: "region", name: r.name, aliases: expandAliases(r.name, [r.id]), isRuntime: true, payload: r });
  }
  for (const a of delta.generatedMartialArts || []) {
    pushUnique(out, { id: a.id, kind: "art", name: a.name, aliases: expandAliases(a.name, [a.id]), isRuntime: true, payload: a });
  }
  for (const i of delta.generatedItems || []) {
    pushUnique(out, { id: i.id, kind: "item", name: i.name, aliases: expandAliases(i.name, [i.id]), isRuntime: true, payload: i });
  }
  return out;
}

// 임의 호칭/별호로 가장 일치하는 엔티티 찾기 (정확 일치 > 토큰 포함).
export function resolveEntity(query: string, save: SaveData | null = null): CanonicalEntity | null {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  const list = getResolvedRegistry(save);
  // 정확 일치
  for (const e of list) if (e.id.toLowerCase() === q || e.name.toLowerCase() === q) return e;
  for (const e of list) for (const a of e.aliases) if (a && a.toLowerCase() === q) return e;
  // 부분 포함 (alias 가 q 에 포함되거나 그 반대)
  let best: { e: CanonicalEntity; score: number } | null = null;
  for (const e of list) {
    let s = 0;
    for (const a of e.aliases) {
      if (!a || a.length < 2) continue;
      const la = a.toLowerCase();
      if (q.includes(la)) s = Math.max(s, la.length);
      else if (la.includes(q) && q.length >= 2) s = Math.max(s, q.length);
    }
    if (s > (best?.score || 0)) best = { e, score: s };
  }
  return best?.e || null;
}

// 텍스트 안의 모든 엔티티를 alias 매칭으로 찾는다. RAG 용.
export function findEntitiesInText(text: string, save: SaveData | null = null, limit = 25): CanonicalEntity[] {
  const t = (text || "").toLowerCase();
  if (!t) return [];
  const list = getResolvedRegistry(save);
  const seen = new Set<string>();
  const hits: Array<{ e: CanonicalEntity; score: number }> = [];
  for (const e of list) {
    let best = 0;
    for (const a of e.aliases) {
      if (!a || a.length < 2) continue;
      const la = a.toLowerCase();
      if (t.includes(la) && la.length > best) best = la.length;
    }
    if (best > 0) {
      const k = e.kind + ":" + e.id;
      if (!seen.has(k)) {
        hits.push({ e, score: best });
        seen.add(k);
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map((h) => h.e);
}

// supreme rank 병합 (static + runtime delta)
export interface ResolvedSupremeMember {
  group: "yukcheon" | "ohwang" | "palwang" | "chilseong";
  slotId: string;
  holderId: string;
  holderName?: string;
  title?: string;
  contested?: boolean;
  legitimacy?: number;
  isPlayer?: boolean;
}

export function getResolvedSupremeRanks(save: SaveData | null): ResolvedSupremeMember[] {
  const supreme = WORLD.supreme || {};
  const out: ResolvedSupremeMember[] = [];
  const groups: Array<["yukcheon" | "ohwang" | "palwang" | "chilseong", string]> = [
    ["yukcheon", "yukcheon"],
    ["ohwang", "ohwang"],
    ["palwang", "palwang"],
    ["chilseong", "chilseong"],
  ];
  for (const [g, key] of groups) {
    for (const p of ((supreme as any)[key] || []) as any[]) {
      out.push({
        group: g,
        slotId: p.id,
        holderId: p.id,
        holderName: p.name,
        title: p.title || p.name,
      });
    }
  }
  // 런타임 델타 적용
  const playerId = "player";
  const playerName = save?.character?.identity?.name;
  for (const ch of save?.runtimeDelta?.rankState || []) {
    const member = out.find((m) => m.group === ch.group && m.slotId === ch.slotId);
    const isPlayer = ch.currentHolderId === playerId;
    if (member) {
      member.holderId = ch.currentHolderId;
      member.title = ch.title || member.title;
      member.contested = ch.contested;
      member.legitimacy = ch.legitimacy;
      member.isPlayer = isPlayer;
      if (isPlayer && playerName) member.holderName = playerName;
    } else {
      out.push({
        group: ch.group,
        slotId: ch.slotId,
        holderId: ch.currentHolderId,
        holderName: isPlayer && playerName ? playerName : ch.currentHolderId,
        title: ch.title,
        contested: ch.contested,
        legitimacy: ch.legitimacy,
        isPlayer,
      });
    }
  }
  return out;
}

export function getPlayerSupremeRankStatus(save: SaveData | null): ResolvedSupremeMember[] {
  return getResolvedSupremeRanks(save).filter((m) => m.isPlayer);
}

export function emptyRuntimeDelta(): RuntimeWorldDelta {
  return {
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
    playerHistory: [],
    updatedAt: new Date().toISOString(),
  };
}

// supreme rank 승급/탈락 적용.
export function promoteEntityToSupremeRank(
  save: SaveData,
  group: SupremeRankState["group"],
  slotId: string,
  newHolderId: string,
  opts?: { title?: string; reason?: string; contested?: boolean; legitimacy?: number },
) {
  if (!save.runtimeDelta) save.runtimeDelta = emptyRuntimeDelta();
  const rs = save.runtimeDelta.rankState;
  let entry = rs.find((r) => r.group === group && r.slotId === slotId);
  if (!entry) {
    entry = {
      group,
      slotId,
      currentHolderId: newHolderId,
      previousHolderIds: [],
      title: opts?.title,
      legitimacy: opts?.legitimacy ?? 50,
      contested: opts?.contested ?? true,
      changedAtTurn: save.turn,
      reason: opts?.reason,
    };
    rs.push(entry);
  } else {
    if (entry.currentHolderId && entry.currentHolderId !== newHolderId) {
      entry.previousHolderIds.push(entry.currentHolderId);
    }
    entry.currentHolderId = newHolderId;
    if (opts?.title) entry.title = opts.title;
    if (typeof opts?.legitimacy === "number") entry.legitimacy = opts.legitimacy;
    if (typeof opts?.contested === "boolean") entry.contested = opts.contested;
    entry.changedAtTurn = save.turn;
    entry.reason = opts?.reason;
  }
  save.runtimeDelta.updatedAt = new Date().toISOString();
}

export function demoteSupremeRankHolder(
  save: SaveData,
  group: SupremeRankState["group"],
  slotId: string,
  reason?: string,
) {
  if (!save.runtimeDelta) return;
  const rs = save.runtimeDelta.rankState;
  const entry = rs.find((r) => r.group === group && r.slotId === slotId);
  if (!entry) return;
  entry.previousHolderIds.push(entry.currentHolderId);
  entry.currentHolderId = "vacant";
  entry.changedAtTurn = save.turn;
  entry.reason = reason;
  save.runtimeDelta.updatedAt = new Date().toISOString();
}
