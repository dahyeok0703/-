// 세계관 키워드 RAG. 정적 import한 데이터에서 입력 키워드와 매칭되는 항목만 추출.

import { WORLD, buildNameIndex, NameEntry, NPCS_BY_SECT } from "../data/world-data";

export interface WorldHit {
  name: string;
  type: string;
  payload: any;
  score: number;
}

// 한 항목에서 검색 가능한 키워드 목록을 뽑는다.
// 예: "아미파(峨眉派)" → ["아미파(峨眉派)", "아미파", "峨眉派"]
//     "혜광(慧光) 대사" → ["혜광(慧光) 대사", "혜광", "慧光", "대사"]
//     "무화(舞花) 화옥(花玉)" → 위 + "화옥", "花玉"
function extractSearchableTokens(fullName: string): string[] {
  if (!fullName) return [];
  const out = new Set<string>();
  out.add(fullName);
  // 괄호 안/밖 분리
  const stripped = fullName.replace(/\([^)]*\)/g, " ");
  for (const part of stripped.split(/\s+/)) {
    const t = part.trim();
    if (t.length >= 2) out.add(t);
  }
  const parenContents = fullName.match(/\(([^)]+)\)/g) || [];
  for (const p of parenContents) {
    const inner = p.slice(1, -1).trim();
    if (inner.length >= 1) out.add(inner);
  }
  // 공백으로 갈린 토큰 (별도)
  for (const part of fullName.split(/\s+/)) {
    const t = part.trim();
    if (t.length >= 2) out.add(t);
  }
  return Array.from(out);
}

export function searchWorld(query: string, recentText: string = "", limit: number = 10): WorldHit[] {
  const text = (query + " " + recentText).toLowerCase();
  const idx = buildNameIndex();
  const hits: WorldHit[] = [];
  const seen = new Set<string>();

  // 집합 개념(사화/육천/오황/팔왕/칠성) 별칭 매칭 — 묻는 즉시 정확한 멤버를 컨텍스트에 넣어준다.
  for (const concept of CONCEPT_GROUPS) {
    if (concept.aliases.some((a) => text.includes(a.toLowerCase()))) {
      const key = "concept:" + concept.key;
      if (!seen.has(key)) {
        hits.push({
          name: concept.label,
          type: "concept",
          payload: concept.build(),
          score: 1000,
        });
        seen.add(key);
      }
    }
  }

  for (const entry of idx) {
    const key = entry.type + ":" + entry.name;
    if (seen.has(key)) continue;
    const tokens = extractSearchableTokens(entry.name);
    let matchedLen = 0;
    for (const tok of tokens) {
      const low = tok.toLowerCase();
      if (low.length >= 2 && text.includes(low)) {
        if (low.length > matchedLen) matchedLen = low.length;
      }
    }
    if (matchedLen > 0) {
      hits.push({ ...entry, score: matchedLen });
      seen.add(key);
    }
  }

  // 문파(sect) 가 매칭되면 그 문파의 주요 NPC·무공도 함께 끌어온다.
  const sectHits = hits.filter((h) => h.type === "sect");
  for (const sh of sectHits) {
    const sectId = (sh.payload as any)?.id;
    if (!sectId) continue;
    // NPCs
    const body = NPCS_BY_SECT[sectId];
    if (body && typeof body === "object") {
      const npcList = collectNPCsFromBody(body).slice(0, 8);
      for (const npc of npcList) {
        const key = `npc_${sectId}:${npc.name}`;
        if (!seen.has(key) && npc.name) {
          hits.push({
            name: npc.name,
            type: `npc_${sectId}`,
            payload: npc,
            score: 500,
          });
          seen.add(key);
        }
      }
    }
    // 그 문파의 무공
    const sectArts = collectArtsBySect(sectId).slice(0, 6);
    for (const a of sectArts) {
      const key = `art:${a.name}`;
      if (!seen.has(key) && a.name) {
        hits.push({ name: a.name, type: "art", payload: a, score: 400 });
        seen.add(key);
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function collectNPCsFromBody(body: any): any[] {
  if (!body || typeof body !== "object") return [];
  const out: any[] = [];
  for (const v of Object.values(body)) {
    if (Array.isArray(v)) {
      for (const it of v) {
        if (it && typeof it === "object" && (it as any).name) out.push(it);
      }
    }
  }
  return out;
}

function collectArtsBySect(sectId: string): any[] {
  const out: any[] = [];
  for (const list of Object.values(WORLD.arts || {})) {
    if (!Array.isArray(list)) continue;
    for (const a of list as any[]) {
      if (a?.sect === sectId) out.push(a);
    }
  }
  return out;
}

interface ConceptGroup {
  key: string;
  label: string;
  aliases: string[];
  build: () => { description: string; members: Array<{ name: string; note: string }> };
}

const CONCEPT_GROUPS: ConceptGroup[] = [
  {
    key: "four_beauties",
    label: "중원사화(中原四花)",
    aliases: ["사화", "중원사화", "천하사화", "4대 미녀", "4대미녀", "사대미녀"],
    build: () => ({
      description:
        WORLD.beauties?.description ||
        "현 강호 최고의 4대 미녀. 단순 미모가 아니라 재능·신분·기품을 겸비.",
      members: (WORLD.beauties?.four_beauties || []).map((b: any) => ({
        name: b.name,
        note: [b.alias && `별칭 ${b.alias}`, b.age && `${b.age}세`, b.social_status, b.location]
          .filter(Boolean)
          .join(" · "),
      })),
    }),
  },
  {
    key: "yukcheon",
    label: "육천(六天) — 현경 6인",
    aliases: ["육천", "6천", "현경 6인", "현경 정점"],
    build: () => ({
      description: "현 시대 현경의 정점 여섯 명.",
      members: (WORLD.supreme?.yukcheon || []).map((p: any) => ({
        name: p.name,
        note: [p.title, p.position, p.realm, p.age && `${p.age}세`].filter(Boolean).join(" · "),
      })),
    }),
  },
  {
    key: "ohwang",
    label: "오황(五皇) — 화경의 제(帝)",
    aliases: ["오황", "5황", "화경 제", "화경의 제"],
    build: () => ({
      description: "화경의 정점 다섯, 각자 한 도(道)의 황제로 불린다.",
      members: (WORLD.supreme?.ohwang || []).map((p: any) => ({
        name: p.name,
        note: [p.title, p.position, p.realm, p.age && `${p.age}세`].filter(Boolean).join(" · "),
      })),
    }),
  },
  {
    key: "palwang",
    label: "팔왕(八王)",
    aliases: ["팔왕", "8왕"],
    build: () => ({
      description: "화경~초절정의 왕(王) 칭호 여덟 명.",
      members: (WORLD.supreme?.palwang || []).map((p: any) => ({
        name: p.name,
        note: [p.title, p.position, p.realm, p.age && `${p.age}세`].filter(Boolean).join(" · "),
      })),
    }),
  },
  {
    key: "chilseong",
    label: "칠성(七星)",
    aliases: ["칠성", "7성"],
    build: () => ({
      description: "화경~초절정의 일곱 별. 활약하는 영역이 다양하다.",
      members: (WORLD.supreme?.chilseong || []).map((p: any) => ({
        name: p.name,
        note: [p.title, p.position, p.realm, p.age && `${p.age}세`].filter(Boolean).join(" · "),
      })),
    }),
  },
];

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
