import { NextRequest, NextResponse } from "next/server";
import { listTexts, markRead } from "../../../apex/office-texts/kv-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const texts = await listTexts();
  return NextResponse.json({ texts });
}

type PostBody = { action: "markRead"; id: string; read: boolean };

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PostBody;
  if (body.action === "markRead") {
    const updated = await markRead(body.id, Boolean(body.read));
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, text: updated });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
