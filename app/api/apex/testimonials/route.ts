import { NextRequest, NextResponse } from "next/server";
import { getState, setState } from "../../../apex/testimonials/kv-store";
import { Testimonial } from "../../../apex/testimonials/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getState();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { text?: string };
  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const state = await getState();
  const t: Testimonial = {
    number: state.nextNumber,
    text,
    createdAt: new Date().toISOString(),
  };
  const next = {
    testimonials: [...state.testimonials, t],
    nextNumber: state.nextNumber + 1,
  };
  await setState(next);
  return NextResponse.json({ ok: true, testimonial: t, state: next });
}
