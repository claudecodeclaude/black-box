import { NextRequest, NextResponse } from "next/server";
import { getState, setState } from "../../../../apex/testimonials/kv-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ number: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { number: nStr } = await ctx.params;
  const n = Number(nStr);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "bad number" }, { status: 400 });
  }
  const body = (await req.json()) as { text?: string };
  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const state = await getState();
  const idx = state.testimonials.findIndex((t) => t.number === n);
  if (idx === -1) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const next = {
    ...state,
    testimonials: state.testimonials.map((t, i) =>
      i === idx ? { ...t, text } : t
    ),
  };
  await setState(next);
  return NextResponse.json({ ok: true, state: next });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { number: nStr } = await ctx.params;
  const n = Number(nStr);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "bad number" }, { status: 400 });
  }
  const state = await getState();
  // Remove the entry, then renumber everything above it down by one so the
  // sequence stays contiguous (1..N). nextNumber becomes N+1.
  const remaining = state.testimonials
    .filter((t) => t.number !== n)
    .sort((a, b) => a.number - b.number)
    .map((t, i) => ({ ...t, number: i + 1 }));
  const next = {
    testimonials: remaining,
    nextNumber: remaining.length + 1,
  };
  await setState(next);
  return NextResponse.json({ ok: true, state: next });
}
