// World data validator. Run: `npm run validate:world` (uses tsx).
// 정적 데이터 + 핵심 제약(오대세가 구성, NPC 1500+, ref 무결성, id 중복)을 검사.

import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const W = path.join(ROOT, "src/data/world");

function readJSON(rel: string): any {
  const p = path.join(W, rel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`[JSON 파싱 실패] ${rel}: ${(e as Error).message}`);
    return null;
  }
}

interface Report {
  pass: boolean;
  errors: string[];
  warnings: string[];
  stats: Record<string, number | string>;
}

function err(r: Report, msg: string) { r.errors.push(msg); r.pass = false; }
function warn(r: Report, msg: string) { r.warnings.push(msg); }

function collectNpcs(body: any): any[] {
  if (!body || typeof body !== "object") return [];
  const out: any[] = [];
  for (const v of Object.values(body)) {
    if (Array.isArray(v)) for (const x of v) if (x && typeof x === "object" && (x as any).name) out.push(x);
  }
  return out;
}

function main() {
  const r: Report = { pass: true, errors: [], warnings: [], stats: {} };

  // 1) 핵심 파일 JSON 유효성
  const sects = readJSON("sects.json");
  const factions = readJSON("factions.json");
  const realms = readJSON("realms.json");
  const supreme = readJSON("supreme_ranks.json");
  const beauties = readJSON("four_beauties.json");
  const relations = readJSON("relations.json");
  const conflicts = readJSON("conflicts.json");
  for (const [name, d] of [
    ["sects.json", sects], ["factions.json", factions], ["realms.json", realms],
    ["supreme_ranks.json", supreme], ["four_beauties.json", beauties],
    ["relations.json", relations], ["conflicts.json", conflicts],
  ] as const) {
    if (!d) err(r, `필수 파일 누락/파싱 실패: ${name}`);
  }

  // 2) 오대세가 구성 — 남궁/팽가/모용/사천당가/제갈
  const sectList: any[] = sects?.sects || [];
  const oh = sectList.filter((s) => s.category === "오대세가").map((s) => s.id).sort();
  r.stats["오대세가 ids"] = oh.join(",");
  const expected = ["danga", "jegal", "moyong", "namgung", "paeng"].sort();
  if (JSON.stringify(oh) !== JSON.stringify(expected)) {
    err(r, `오대세가 구성 불일치. 현재 [${oh.join(",")}] vs 기대 [${expected.join(",")}]`);
  }
  const paeng = sectList.find((s) => s.id === "paeng");
  if (!paeng) err(r, "하북팽가(paeng) 누락");
  const hwangbo = sectList.find((s) => s.id === "hwangbo");
  if (!hwangbo) err(r, "황보세가(hwangbo) 누락 — 삭제하면 안 됨");
  else if (hwangbo.category === "오대세가") err(r, "황보세가는 오대세가에서 빠져야 함");
  else if (hwangbo.category !== "명문대가") warn(r, `황보세가 category=${hwangbo.category} (기대: 명문대가)`);

  // 3) NPC 총합 1500+
  const npcDir = path.join(W, "npcs");
  const npcFiles = fs.existsSync(npcDir) ? fs.readdirSync(npcDir).filter((f) => f.endsWith(".json")) : [];
  let totalNpcs = 0;
  const allNpcIds = new Set<string>();
  const dupNpcIds: string[] = [];
  for (const f of npcFiles) {
    const body = readJSON(`npcs/${f}`);
    if (!body) { warn(r, `${f} 읽기 실패`); continue; }
    const npcs = collectNpcs(body);
    totalNpcs += npcs.length;
    for (const n of npcs) {
      if (n.id) {
        if (allNpcIds.has(n.id)) dupNpcIds.push(n.id);
        else allNpcIds.add(n.id);
      }
    }
  }
  // supreme + beauties 도
  for (const grp of ["yukcheon", "ohwang", "palwang", "chilseong"]) {
    for (const p of (supreme as any)?.[grp] || []) {
      totalNpcs++;
      if (p.id) {
        if (allNpcIds.has(p.id)) dupNpcIds.push(p.id);
        else allNpcIds.add(p.id);
      }
    }
  }
  for (const b of beauties?.four_beauties || []) {
    totalNpcs++;
    if (b.id) {
      if (allNpcIds.has(b.id)) dupNpcIds.push(b.id);
      else allNpcIds.add(b.id);
    }
  }
  r.stats["총 NPC"] = totalNpcs;
  r.stats["중복 NPC id 수"] = dupNpcIds.length;
  if (totalNpcs < 1500) err(r, `NPC 부족: ${totalNpcs} < 1500`);
  if (dupNpcIds.length > 0) err(r, `중복 NPC id: ${dupNpcIds.slice(0, 10).join(", ")}${dupNpcIds.length > 10 ? "..." : ""}`);

  // 4) sect / faction id 중복
  const sectIds = new Set<string>();
  for (const s of sectList) {
    if (sectIds.has(s.id)) err(r, `중복 sect id: ${s.id}`);
    sectIds.add(s.id);
  }
  const facIds = new Set<string>();
  for (const f of factions?.factions || []) {
    if (facIds.has(f.id)) err(r, `중복 faction id: ${f.id}`);
    facIds.add(f.id);
  }
  // sect.faction 이 존재하는 faction id 인지
  for (const s of sectList) {
    if (s.faction && !facIds.has(s.faction)) warn(r, `sect ${s.id} 가 존재하지 않는 faction 참조: ${s.faction}`);
  }

  // 5) supreme rank holder 존재
  for (const grp of ["yukcheon", "ohwang", "palwang", "chilseong"]) {
    for (const p of (supreme as any)?.[grp] || []) {
      if (!p.id || !p.name) err(r, `supreme ${grp} 에 id/name 누락: ${JSON.stringify(p).slice(0, 80)}`);
    }
  }

  // 6) relations 무결성
  if (relations?.relations) {
    let badRefs = 0;
    for (const rel of relations.relations) {
      if (!rel.from || !rel.to || !rel.relationType) badRefs++;
    }
    r.stats["관계 수"] = relations.relations.length;
    if (badRefs > 0) warn(r, `relations 중 필드 누락 ${badRefs}개`);
  }
  // 7) conflicts
  if (conflicts?.conflicts) {
    r.stats["갈등 수"] = conflicts.conflicts.length;
    r.stats["세력 상태 수"] = (conflicts.factionStates || []).length;
  }

  // 보고
  console.log("=== 세계 데이터 검증 보고 ===");
  for (const [k, v] of Object.entries(r.stats)) console.log(`  ${k}: ${v}`);
  if (r.warnings.length) {
    console.log("\n[경고]");
    for (const w of r.warnings) console.log("  - " + w);
  }
  if (r.errors.length) {
    console.log("\n[오류]");
    for (const e of r.errors) console.log("  - " + e);
  }
  console.log("\n결과: " + (r.pass ? "PASS ✓" : "FAIL ✗"));
  if (!r.pass) process.exit(1);
}

main();
