import { NextRequest, NextResponse } from "next/server";
import { getLogs, setLogs } from "../../../../apex/testimonials/kv-store";
import { Match, PastEntry } from "../../../../apex/testimonials/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const logs = await getLogs();
  return NextResponse.json(logs);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { notes?: string; matches?: Match[] };
  const notes = (body.notes || "").trim();
  const matches = Array.isArray(body.matches) ? body.matches : [];
  if (!notes) return NextResponse.json({ error: "notes required" }, { status: 400 });
  if (matches.length === 0) {
    return NextResponse.json({ error: "matches required" }, { status: 400 });
  }

  const entry: PastEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    notes,
    matches: matches.map((m) => ({
      number: Number(m.number),
      reason: String(m.reason || "").trim(),
    })),
  };

  const current = await getLogs();
  const next = { entries: [...current.entries, entry] };
  await setLogs(next);
  return NextResponse.json({ ok: true, entry, state: next });
}
