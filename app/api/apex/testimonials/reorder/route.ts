import { NextRequest, NextResponse } from "next/server";
import { getState, setState } from "../../../../apex/testimonials/kv-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { number?: number; direction?: "up" | "down" };
  const n = Number(body.number);
  const dir = body.direction;
  if (!Number.isFinite(n) || (dir !== "up" && dir !== "down")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const state = await getState();
  const target = n;
  const neighbor = dir === "up" ? n - 1 : n + 1;

  const a = state.testimonials.find((t) => t.number === target);
  const b = state.testimonials.find((t) => t.number === neighbor);
  if (!a || !b) {
    // Already at the edge — no-op, not an error.
    return NextResponse.json({ ok: true, state });
  }

  const next = {
    ...state,
    testimonials: state.testimonials.map((t) => {
      if (t.number === target) return { ...t, number: neighbor };
      if (t.number === neighbor) return { ...t, number: target };
      return t;
    }),
  };
  await setState(next);
  return NextResponse.json({ ok: true, state: next });
}
