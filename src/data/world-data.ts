// 모든 세계관 JSON을 정적 import로 모으는 모듈.
// 클라이언트 번들에 포함된다(개인용·로컬·StackBlitz 가정).
// 원본 데이터는 src/data/world/, src/data/save/_templates/ 에서 import.

import factions from "./world/factions.json";
import realms from "./world/realms.json";
import regions from "./world/regions.json";
import lore from "./world/lore.json";
import society from "./world/society.json";
import sects from "./world/sects.json";
import supreme from "./world/supreme_ranks.json";
import beauties from "./world/four_beauties.json";
import arts from "./world/martial_arts.json";
import manuals from "./world/manuals.json";
import elixirs from "./world/elixirs.json";
import weapons from "./world/weapons.json";

// 문파별 NPC
import shaolin from "./world/npcs/shaolin.json";
import wudang from "./world/npcs/wudang.json";
import huashan from "./world/npcs/huashan.json";
import jongnam from "./world/npcs/jongnam.json";
import emei from "./world/npcs/emei.json";
import qingcheng from "./world/npcs/qingcheng.json";
import kunlun from "./world/npcs/kunlun.json";
import jeomchang from "./world/npcs/jeomchang.json";
import kongdong from "./world/npcs/kongdong.json";
import gaebang from "./world/npcs/gaebang.json";
import namgung from "./world/npcs/namgung.json";
import hwangbo from "./world/npcs/hwangbo.json";
import moyong from "./world/npcs/moyong.json";
import danga from "./world/npcs/danga.json";
import jegal from "./world/npcs/jegal.json";
import noklim from "./world/npcs/noklim.json";
import jangang from "./world/npcs/jangang.json";
import salmun from "./world/npcs/salmun.json";
import haomun from "./world/npcs/haomun.json";
import cheonma from "./world/npcs/cheonma.json";
import nextGen from "./world/npcs/next_generation.json";
import courtesans from "./world/npcs/courtesans.json";
import commoners from "./world/npcs/commoners.json";
import legendary from "./world/npcs/legendary_dead.json";

import characterTemplate from "./save/_templates/character.template.json";

export const WORLD = {
  factions: factions as any,
  realms: realms as any,
  regions: regions as any,
  lore: lore as any,
  society: society as any,
  sects: sects as any,
  supreme: supreme as any,
  beauties: beauties as any,
  arts: arts as any,
  manuals: manuals as any,
  elixirs: elixirs as any,
  weapons: weapons as any,
} as const;

export const NPCS_BY_SECT: Record<string, any> = {
  shaolin, wudang, huashan, jongnam, emei, qingcheng, kunlun, jeomchang,
  kongdong, gaebang, namgung, hwangbo, moyong, danga, jegal,
  noklim, jangang, salmun, haomun, cheonma,
};

export const NPCS_EXTRA: Record<string, any> = {
  next_generation: nextGen,
  courtesans,
  commoners,
  legendary_dead: legendary,
};

export const CHARACTER_TEMPLATE: any = characterTemplate;

// ---------- 이름 인덱스 생성 (RAG 검색용) ----------

export interface NameEntry {
  name: string;
  type: string;
  payload: any;
}

let _index: NameEntry[] | null = null;

function collectNPCs(body: any): any[] {
  if (!body || typeof body !== "object") return [];
  const out: any[] = [];
  for (const v of Object.values(body)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && (item as any).name) {
          out.push(item);
        }
      }
    }
  }
  return out;
}

export function buildNameIndex(): NameEntry[] {
  if (_index) return _index;
  const idx: NameEntry[] = [];

  for (const s of WORLD.sects?.sects || []) {
    if (s.name) idx.push({ name: s.name, type: "sect", payload: s });
  }
  for (const r of WORLD.regions?.regions || []) {
    if (r.name) idx.push({ name: r.name, type: "region", payload: r });
    for (const c of r.major_cities || []) {
      idx.push({ name: c, type: "city", payload: { region: r.name, city: c } });
    }
  }
  for (const f of WORLD.factions?.factions || []) {
    if (f.name) idx.push({ name: f.name, type: "faction", payload: f });
  }
  const supremeAll = [
    ...(WORLD.supreme?.yukcheon || []),
    ...(WORLD.supreme?.ohwang || []),
    ...(WORLD.supreme?.palwang || []),
    ...(WORLD.supreme?.chilseong || []),
  ];
  for (const p of supremeAll) if (p.name) idx.push({ name: p.name, type: "npc_supreme", payload: p });
  for (const b of WORLD.beauties?.four_beauties || []) {
    if (b.name) idx.push({ name: b.name, type: "npc_beauty", payload: b });
  }
  for (const [sectId, body] of Object.entries(NPCS_BY_SECT)) {
    for (const n of collectNPCs(body)) {
      if (n.name) idx.push({ name: n.name, type: `npc_${sectId}`, payload: n });
    }
  }
  for (const body of Object.values(NPCS_EXTRA)) {
    for (const n of collectNPCs(body)) {
      if (n.name) idx.push({ name: n.name, type: "npc_other", payload: n });
    }
  }
  for (const list of Object.values(WORLD.arts || {})) {
    if (Array.isArray(list)) {
      for (const a of list as any[]) {
        if (a?.name) idx.push({ name: a.name, type: "art", payload: a });
      }
    }
  }

  _index = idx;
  return idx;
}

// ---------- UI 헬퍼: 경지 단계 / 문파 목록 ----------

export interface StageOption {
  stage_id: string;
  stage_name: string;
  realm_id: string;
  realm_name: string;
  tier: number;
  internal_energy_cap: number;
  internal_energy_midpoint: number;
  notes: string;
}

export function getAllStageOptions(): StageOption[] {
  const out: StageOption[] = [];
  for (const r of WORLD.realms?.realms || []) {
    for (const s of r.stages || []) {
      const range = s.internal_energy_range || [0, 0];
      out.push({
        stage_id: s.id,
        stage_name: s.name,
        realm_id: r.id,
        realm_name: r.name,
        tier: r.tier,
        internal_energy_cap: range[1] || 30,
        internal_energy_midpoint: Math.floor(((range[0] || 0) + (range[1] || 30)) / 2),
        notes: s.notes || "",
      });
    }
  }
  return out;
}

export interface SectOption {
  id: string;
  name: string;
  faction: string;
  category: string;
}

export function getAllSectOptions(): SectOption[] {
  const out: SectOption[] = [];
  for (const s of WORLD.sects?.sects || []) {
    out.push({
      id: s.id,
      name: s.name,
      faction: s.faction || "",
      category: s.category || "",
    });
  }
  return out;
}

export function getStageById(stageId: string): StageOption | null {
  return getAllStageOptions().find((s) => s.stage_id === stageId) || null;
}

export function stageNameKR(stageId: string | null | undefined): string {
  if (!stageId) return "(미정)";
  const s = getStageById(stageId);
  return s ? s.stage_name : stageId;
}

export function sectNameKR(sectId: string | null | undefined): string {
  if (!sectId) return "무소속";
  const s = getAllSectOptions().find((x) => x.id === sectId);
  return s ? s.name : sectId;
}

export function artNameKR(artId: string | null | undefined): string {
  if (!artId) return "";
  if (artId.startsWith("custom:")) return artId.slice(7);
  for (const list of Object.values(WORLD.arts || {})) {
    if (Array.isArray(list)) {
      for (const a of list as any[]) {
        if (a?.id === artId) return a.name || artId;
      }
    }
  }
  return artId;
}

export interface ArtOption {
  id: string;
  name: string;
  sect: string | null;
  grade: string;
  type: string;
  weapon: string;
  description: string;
  category: string;
}

let _artOptions: ArtOption[] | null = null;
export function getAllArtOptions(): ArtOption[] {
  if (_artOptions) return _artOptions;
  const out: ArtOption[] = [];
  for (const [cat, list] of Object.entries(WORLD.arts || {})) {
    if (!Array.isArray(list)) continue;
    for (const a of list as any[]) {
      if (!a?.id || !a?.name) continue;
      out.push({
        id: a.id,
        name: a.name,
        sect: a.sect ?? null,
        grade: a.grade || "",
        type: a.type || "",
        weapon: a.weapon || "",
        description: a.description || "",
        category: cat,
      });
    }
  }
  _artOptions = out;
  return out;
}

// ---------- 강호력 시간 ----------

const SIJIN_NAMES = ["자시", "축시", "인시", "묘시", "진시", "사시", "오시", "미시", "신시", "유시", "술시", "해시"];
const MONTH_NAMES = ["정월", "이월", "삼월", "사월", "오월", "유월", "칠월", "팔월", "구월", "시월", "동월", "섣달"];

export function sijinName(hour: number): string {
  // 자시 23~01, 축시 01~03, ...
  const idx = Math.floor(((hour + 1) % 24) / 2);
  return SIJIN_NAMES[idx];
}

export function monthName(month: number): string {
  return MONTH_NAMES[(month - 1 + 12) % 12] || `${month}월`;
}

export function seasonName(month: number): string {
  if (month >= 2 && month <= 4) return "봄";
  if (month >= 5 && month <= 7) return "여름";
  if (month >= 8 && month <= 10) return "가을";
  return "겨울";
}

export function formatWorldTime(t: { year: number; month: number; day: number; hour: number; minute: number } | null | undefined): string {
  if (!t) return "(시간 미정)";
  const hh = String(t.hour).padStart(2, "0");
  const mm = String(t.minute).padStart(2, "0");
  return `강호력 ${t.year}년 ${seasonName(t.month)} ${monthName(t.month)} ${t.day}일 · ${sijinName(t.hour)} (${hh}:${mm})`;
}

export function advanceWorldTime(
  t: { year: number; month: number; day: number; hour: number; minute: number },
  addMinutes: number
): { year: number; month: number; day: number; hour: number; minute: number } {
  let { year, month, day, hour, minute } = t;
  minute += addMinutes;
  while (minute < 0) { minute += 60; hour -= 1; }
  while (minute >= 60) { minute -= 60; hour += 1; }
  while (hour < 0) { hour += 24; day -= 1; }
  while (hour >= 24) { hour -= 24; day += 1; }
  while (day < 1) { day += 30; month -= 1; }
  while (day > 30) { day -= 30; month += 1; }
  while (month < 1) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }
  if (year < 1) year = 1;
  return { year, month, day, hour, minute };
}

