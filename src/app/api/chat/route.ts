import { NextRequest, NextResponse } from "next/server";
import { processTurn } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userInput: string = (body?.userInput || "").toString();
    const slot: string | undefined = body?.slot;
    if (!userInput.trim()) {
      return NextResponse.json({ ok: false, error: "입력이 비어있어요." }, { status: 400 });
    }
    const result = await processTurn(userInput, slot);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/chat] 처리 실패", err);
    return NextResponse.json(
      { ok: false, error: "서버 오류: " + (err as Error).message },
      { status: 500 }
    );
  }
}
