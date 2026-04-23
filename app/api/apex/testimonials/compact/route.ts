import { NextResponse } from "next/server";
import { getState, setState } from "../../../../apex/testimonials/kv-store";

export const dynamic = "force-dynamic";

// Renumber testimonials contiguously starting at 1, preserving order by
// existing number. Heals any gaps left over from pre-fix deletes.
export async function POST() {
  const state = await getState();
  const sorted = [...state.testimonials].sort((a, b) => a.number - b.number);
  const renumbered = sorted.map((t, i) => ({ ...t, number: i + 1 }));
  const changed = renumbered.some((t, i) => t.number !== sorted[i].number);
  const next = {
    testimonials: renumbered,
    nextNumber: renumbered.length + 1,
  };
  if (changed || state.nextNumber !== next.nextNumber) {
    await setState(next);
  }
  return NextResponse.json({ ok: true, state: next, changed });
}
