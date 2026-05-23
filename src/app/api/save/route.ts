import { NextRequest, NextResponse } from "next/server";
import {
  createNewSave,
  hasSave,
  loadCharacterTemplate,
  loadMemories,
  loadMessages,
  loadSave,
  loadUsage,
  resetSave,
  saveSave,
} from "@/lib/save";
import { hasApiKey, modelChat } from "@/lib/openai-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — 전체 상태 조회
export async function GET(req: NextRequest) {
  const slot = req.nextUrl.searchParams.get("slot") || undefined;
  const exists = await hasSave(slot);
  if (!exists) {
    return NextResponse.json({
      exists: false,
      mock: !hasApiKey(),
      model: modelChat(),
    });
  }
  const save = await loadSave(slot);
  const messages = await loadMessages(slot);
  const memories = await loadMemories(slot);
  const usage = await loadUsage(slot);
  return NextResponse.json({
    exists: true,
    mock: !hasApiKey(),
    model: modelChat(),
    save,
    messages,
    memories,
    usage,
  });
}

// POST — 새 게임 시작 또는 캐릭터 업데이트
// body: { action: "new" | "update", character?: Partial<CharacterState>, slot?: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body?.action;
    const slot: string | undefined = body?.slot;

    if (action === "new") {
      const tpl = await loadCharacterTemplate();
      const init = body?.character || {};
      // 깊은 병합 (identity·realm 등 일부 필드만 사용자가 지정)
      const merged = {
        ...tpl,
        identity: { ...tpl.identity, ...(init.identity || {}) },
      };
      const data = await createNewSave(merged as any, slot);
      return NextResponse.json({ ok: true, save: data });
    }

    if (action === "update") {
      const existing = await loadSave(slot);
      if (!existing) return NextResponse.json({ ok: false, error: "세이브 없음" }, { status: 404 });
      if (body?.character) {
        existing.character = { ...existing.character, ...body.character };
      }
      if (body?.relationships) existing.relationships = body.relationships;
      await saveSave(existing, slot);
      return NextResponse.json({ ok: true, save: existing });
    }

    return NextResponse.json({ ok: false, error: "알 수 없는 action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// DELETE — 세이브 초기화
export async function DELETE(req: NextRequest) {
  const slot = req.nextUrl.searchParams.get("slot") || undefined;
  await resetSave(slot);
  return NextResponse.json({ ok: true });
}
