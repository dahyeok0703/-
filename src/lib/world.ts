// 세계관 데이터(data/world/*.json) 로딩 + 키워드 기반 RAG.
// 큰 파일 전체를 매 턴마다 API에 보내지 않기 위함.

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { NPC_DIR, WORLD_DIR } from "./paths";

// 인메모리 캐시 (서버 프로세스 내 1회 로드).
type Json = any;
let cache: {
  factions: Json;
  realms: Json;
  regions: Json;
  lore: Json;
  society: Json;
  sects: Json;
  supreme: Json;
  beauties: Json;
  arts: Json;
  manuals: Json;
  elixirs: Json;
  weapons: Json;
  npcsBySect: Record<string, Json>;
  nextGen: Json;
  courtesans: Json;
  commoners: Json;
  legendary: Json;
  // 검색용 인덱스
  nameIndex: Array<{ name: string; type: string; payload: Json }>;
} | null = null;

async function readJSON<T = Json>(file: string): Promise<T> {
  const txt = await fs.readFile(file, "utf-8");
  return JSON.parse(txt) as T;
}

async function tryRead(file: string, fallback: Json = {}): Promise<Json> {
  try {
    return await readJSON<Json>(file);
  } catch {
    return fallback;
  }
}

export async function loadWorld() {
  if (cache) return cache;

  const factions = await tryRead(path.join(WORLD_DIR, "factions.json"), {});
  const realms = await tryRead(path.join(WORLD_DIR, "realms.json"), {});
  const regions = await tryRead(path.join(WORLD_DIR, "regions.json"), {});
  const lore = await tryRead(path.join(WORLD_DIR, "lore.json"), {});
  const society = await tryRead(path.join(WORLD_DIR, "society.json"), {});
  const sects = await tryRead(path.join(WORLD_DIR, "sects.json"), {});
  const supreme = await tryRead(path.join(WORLD_DIR, "supreme_ranks.json"), {});
  const beauties = await tryRead(path.join(WORLD_DIR, "four_beauties.json"), {});
  const arts = await tryRead(path.join(WORLD_DIR, "martial_arts.json"), {});
  const manuals = await tryRead(path.join(WORLD_DIR, "manuals.json"), {});
  const elixirs = await tryRead(path.join(WORLD_DIR, "elixirs.json"), {});
  const weapons = await tryRead(path.join(WORLD_DIR, "weapons.json"), {});

  const npcsBySect: Record<string, Json> = {};
  if (existsSync(NPC_DIR)) {
    const files = await fs.readdir(NPC_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const id = f.replace(".json", "");
      npcsBySect[id] = await tryRead(path.join(NPC_DIR, f), {});
    }
  }
  const nextGen = npcsBySect["next_generation"] || {};
  const courtesans = npcsBySect["courtesans"] || {};
  const commoners = npcsBySect["commoners"] || {};
  const legendary = npcsBySect["legendary_dead"] || {};

  // 이름 인덱스 구성 — 텍스트 매칭용
  const nameIndex: Array<{ name: string; type: string; payload: Json }> = [];

  // 문파
  if (sects?.sects) {
    for (const s of sects.sects) {
      if (s.name) nameIndex.push({ name: s.name, type: "sect", payload: s });
      if (s.id) nameIndex.push({ name: s.id, type: "sect", payload: s });
    }
  }

  // 지역
  if (regions?.regions) {
    for (const r of regions.regions) {
      if (r.name) nameIndex.push({ name: r.name, type: "region", payload: r });
      if (r.major_cities) {
        for (const c of r.major_cities) {
          nameIndex.push({ name: c, type: "city", payload: { region: r.name, city: c } });
        }
      }
    }
  }

  // 세력
  if (factions?.factions) {
    for (const f of factions.factions) {
      nameIndex.push({ name: f.name, type: "faction", payload: f });
    }
  }

  // 천하 정점 26인
  const supremeAll: Json[] = [
    ...(supreme?.yukcheon || []),
    ...(supreme?.ohwang || []),
    ...(supreme?.palwang || []),
    ...(supreme?.chilseong || []),
  ];
  for (const p of supremeAll) {
    nameIndex.push({ name: p.name, type: "npc_supreme", payload: p });
  }

  // 중원사화
  if (beauties?.four_beauties) {
    for (const b of beauties.four_beauties) {
      nameIndex.push({ name: b.name, type: "npc_beauty", payload: b });
    }
  }

  // 각 문파 NPC
  for (const [sectId, body] of Object.entries(npcsBySect)) {
    if (["next_generation", "courtesans", "commoners", "legendary_dead"].includes(sectId)) continue;
    const all = collectNPCs(body);
    for (const n of all) {
      if (n.name) nameIndex.push({ name: n.name, type: `npc_${sectId}`, payload: n });
    }
  }
  // 후기지수·기녀·전대
  for (const block of [nextGen, courtesans, legendary, commoners]) {
    const collected = collectNPCs(block);
    for (const n of collected) {
      if (n.name) nameIndex.push({ name: n.name, type: "npc_other", payload: n });
    }
  }

  // 무공
  if (arts) {
    for (const [key, list] of Object.entries(arts)) {
      if (Array.isArray(list)) {
        for (const a of list as Json[]) {
          if (a?.name) nameIndex.push({ name: a.name, type: "art", payload: a });
        }
      }
    }
  }

  cache = {
    factions,
    realms,
    regions,
    lore,
    society,
    sects,
    supreme,
    beauties,
    arts,
    manuals,
    elixirs,
    weapons,
    npcsBySect,
    nextGen,
    courtesans,
    commoners,
    legendary,
    nameIndex,
  };
  return cache;
}

function collectNPCs(body: Json): Json[] {
  if (!body || typeof body !== "object") return [];
  const out: Json[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && (item as Json).name) {
          out.push(item);
        }
      }
    }
  }
  return out;
}

// ---------- RAG 검색 ----------

export interface WorldHit {
  name: string;
  type: string;
  payload: Json;
  score: number;
}

export async function searchWorld(
  query: string,
  recentText: string = "",
  limit: number = 15
): Promise<WorldHit[]> {
  const w = await loadWorld();
  const text = (query + " " + recentText).toLowerCase();
  const hits: WorldHit[] = [];
  const seen = new Set<string>();

  for (const entry of w.nameIndex) {
    const key = entry.type + ":" + entry.name;
    if (seen.has(key)) continue;
    const lower = entry.name.toLowerCase();
    // 이름 부분일치
    if (lower && text.includes(lower)) {
      // 너무 짧은 이름(2자 이하)은 오탐 위험 → 길이 가중
      const score = lower.length >= 2 ? lower.length : 0;
      if (score > 0) {
        hits.push({ ...entry, score });
        seen.add(key);
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

// ---------- 게임 시작 시 세계관 프라이머 ----------

export async function worldPrimer(): Promise<string> {
  const w = await loadWorld();
  const factions = (w.factions?.factions || []) as Json[];
  const era = w.lore?.current_era;

  let lines: string[] = [];
  lines.push("[강호 개요]");
  if (era) {
    lines.push(`현재 시점: ${era.name} — ${era.summary}`);
  }
  lines.push("\n[삼분지세]");
  for (const f of factions) {
    lines.push(`- ${f.name} (${f.alignment}): ${f.summary} 본거지 ${f.headquarters || "?"}`);
  }
  lines.push("\n[경지 체계]");
  lines.push("삼류·이류·일류·절정·초절정·화경·현경. 각 경지마다 초입·완숙·극 3단계.");
  lines.push("절정 이상은 천하 2% 미만. 화경은 한 세대에 십수 명. 현경은 한 시대 한둘.");
  lines.push("\n[정점]");
  lines.push("육천(6명, 현경) / 오황(5명, 화경, 별호에 帝) / 팔왕(8명, 화경~초절정, 별호에 王) / 칠성(7명, 화경~초절정).");
  lines.push("\n[현재 5대 긴장]");
  for (const t of (w.lore?.ongoing_tensions || []) as Json[]) {
    lines.push(`- ${t.name}: ${t.description}`);
  }
  return lines.join("\n");
}

// 특정 위치 상세 — 현재 위치 컨텍스트에 사용
export async function regionDetail(regionOrCity: string | null): Promise<string> {
  if (!regionOrCity) return "";
  const w = await loadWorld();
  const lower = regionOrCity.toLowerCase();
  for (const r of (w.regions?.regions || []) as Json[]) {
    if (r.name?.toLowerCase().includes(lower) || r.id === regionOrCity) {
      return `[현재 권역] ${r.name} (${r.scope})\n기후: ${r.climate}\n분위기: ${r.atmosphere}\n주요 도시: ${(r.major_cities || []).join(", ")}`;
    }
    if ((r.major_cities || []).some((c: string) => c.toLowerCase().includes(lower))) {
      return `[현재 도시] ${regionOrCity} (속한 권역: ${r.name})\n분위기: ${r.atmosphere}`;
    }
  }
  return "";
}

// 캐릭터 식별자(소속 sect, 경지 등)로 보강 데이터
export async function getRealmDetail(stageId: string | null): Promise<string> {
  if (!stageId) return "";
  const w = await loadWorld();
  for (const r of (w.realms?.realms || []) as Json[]) {
    for (const s of r.stages || []) {
      if (s.id === stageId) {
        return `[현 경지] ${s.name} — ${s.notes} (내공 범위 ${s.internal_energy_range?.join("-")})`;
      }
    }
  }
  return "";
}

export async function getSectDetail(sectId: string | null): Promise<string> {
  if (!sectId) return "";
  const w = await loadWorld();
  for (const s of (w.sects?.sects || []) as Json[]) {
    if (s.id === sectId) {
      return `[소속 문파] ${s.name} (${s.faction}) — ${s.specialty}. 분위기: ${s.atmosphere}`;
    }
  }
  return "";
}
