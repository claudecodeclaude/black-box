import { NextRequest, NextResponse } from "next/server";
import { getGlobal, getWeek, setGlobal, setWeek } from "../../../cleaning/kv-store";
import { GlobalState, WeekState } from "../../../cleaning/state";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const weeksParam = url.searchParams.get("weeks") ?? "";
  const weekKeys = weeksParam.split(",").filter(Boolean);

  const [global, ...weekStates] = await Promise.all([
    getGlobal(),
    ...weekKeys.map((k) => getWeek(k)),
  ]);

  const weeks: Record<string, WeekState> = {};
  weekKeys.forEach((k, i) => {
    weeks[k] = weekStates[i];
  });

  return NextResponse.json({ global, weeks });
}

type PostBody =
  | { action: "setItemState"; weekISO: string; itemId: string; value: "checked" | "pushed" | "skipped" | null }
  | { action: "addCustomItem"; item: GlobalState["customItems"][number] }
  | { action: "deleteCustomItem"; itemId: string }
  | { action: "setOverride"; itemId: string; override: GlobalState["overrides"][string] }
  | { action: "clearOverride"; itemId: string }
  | { action: "removeCatalogItem"; itemId: string }
  | { action: "restoreCatalogItem"; itemId: string };

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PostBody;

  if (body.action === "setItemState") {
    const w = await getWeek(body.weekISO);
    const next: WeekState = { states: { ...w.states } };
    if (body.value === null) delete next.states[body.itemId];
    else next.states[body.itemId] = body.value;
    await setWeek(body.weekISO, next);
    return NextResponse.json({ ok: true, week: next });
  }

  const g = await getGlobal();

  if (body.action === "addCustomItem") {
    const next: GlobalState = {
      ...g,
      customItems: [...g.customItems, body.item],
    };
    await setGlobal(next);
    return NextResponse.json({ ok: true, global: next });
  }

  if (body.action === "deleteCustomItem") {
    const next: GlobalState = {
      ...g,
      customItems: g.customItems.filter((i) => i.id !== body.itemId),
    };
    await setGlobal(next);
    return NextResponse.json({ ok: true, global: next });
  }

  if (body.action === "setOverride") {
    const next: GlobalState = {
      ...g,
      overrides: { ...g.overrides, [body.itemId]: body.override },
    };
    await setGlobal(next);
    return NextResponse.json({ ok: true, global: next });
  }

  if (body.action === "clearOverride") {
    const nextOverrides = { ...g.overrides };
    delete nextOverrides[body.itemId];
    const next: GlobalState = { ...g, overrides: nextOverrides };
    await setGlobal(next);
    return NextResponse.json({ ok: true, global: next });
  }

  if (body.action === "removeCatalogItem") {
    if (g.removedIds.includes(body.itemId)) {
      return NextResponse.json({ ok: true, global: g });
    }
    const next: GlobalState = { ...g, removedIds: [...g.removedIds, body.itemId] };
    await setGlobal(next);
    return NextResponse.json({ ok: true, global: next });
  }

  if (body.action === "restoreCatalogItem") {
    const next: GlobalState = {
      ...g,
      removedIds: g.removedIds.filter((id) => id !== body.itemId),
    };
    await setGlobal(next);
    return NextResponse.json({ ok: true, global: next });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
