// 세계관 키워드 RAG. 정적 import한 데이터에서 입력 키워드와 매칭되는 항목만 추출.

import { WORLD, buildNameIndex, NameEntry } from "../data/world-data";

export interface WorldHit {
  name: string;
  type: string;
  payload: any;
  score: number;
}

export function searchWorld(query: string, recentText: string = "", limit: number = 10): WorldHit[] {
  const text = (query + " " + recentText).toLowerCase();
  const idx = buildNameIndex();
  const hits: WorldHit[] = [];
  const seen = new Set<string>();

  for (const entry of idx) {
    const key = entry.type + ":" + entry.name;
    if (seen.has(key)) continue;
    const lower = entry.name.toLowerCase();
    if (lower && lower.length >= 2 && text.includes(lower)) {
      hits.push({ ...entry, score: lower.length });
      seen.add(key);
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function worldPrimer(): string {
  const lines: string[] = [];
  const era = WORLD.lore?.current_era;
  lines.push("[강호 개요]");
  if (era) lines.push(`현재: ${era.name} — ${era.summary}`);
  lines.push("\n[삼분지세]");
  for (const f of WORLD.factions?.factions || []) {
    lines.push(`- ${f.name} (${f.alignment}): ${f.summary}`);
  }
  lines.push("\n[경지]");
  lines.push("삼류·이류·일류·절정·초절정·화경·현경. 각 경지 초입·완숙·극 3단계.");
  lines.push("절정 이상은 천하 2% 미만. 화경은 한 세대 십수 명. 현경은 한 시대 한둘.");
  lines.push("\n[정점] 육천(6, 현경) / 오황(5, 화경, 帝) / 팔왕(8, 화경~초절정, 王) / 칠성(7, 화경~초절정).");
  lines.push("\n[5대 긴장]");
  for (const t of WORLD.lore?.ongoing_tensions || []) {
    lines.push(`- ${t.name}: ${t.description}`);
  }
  return lines.join("\n");
}

export function regionDetail(regionOrCity: string | null): string {
  if (!regionOrCity) return "";
  const lower = regionOrCity.toLowerCase();
  for (const r of WORLD.regions?.regions || []) {
    if (r.name?.toLowerCase().includes(lower) || r.id === regionOrCity) {
      return `[현재 권역] ${r.name} (${r.scope})\n분위기: ${r.atmosphere}\n주요 도시: ${(r.major_cities || []).join(", ")}`;
    }
    if ((r.major_cities || []).some((c: string) => c.toLowerCase().includes(lower))) {
      return `[현재 도시] ${regionOrCity} (속한 권역: ${r.name})\n분위기: ${r.atmosphere}`;
    }
  }
  return "";
}

export function realmDetail(stageId: string | null): string {
  if (!stageId) return "";
  for (const r of WORLD.realms?.realms || []) {
    for (const s of r.stages || []) {
      if (s.id === stageId) {
        return `[현 경지] ${s.name} — ${s.notes}`;
      }
    }
  }
  return "";
}

export function sectDetail(sectId: string | null): string {
  if (!sectId) return "";
  for (const s of WORLD.sects?.sects || []) {
    if (s.id === sectId) {
      return `[소속 문파] ${s.name} (${s.faction}) — ${s.specialty}`;
    }
  }
  return "";
}
