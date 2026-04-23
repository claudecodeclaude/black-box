"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./cleaning.css";
import { PikachuDancing, PikachuWithBubble } from "./Pikachu";
import { CATALOG, CatalogItem, Category, Frequency } from "./tasks";
import { CustomItem, GlobalState, ItemStateValue, WeekState } from "./state";
import {
  addWeeks,
  isDue,
  personForWeek,
  prevMondayISO,
  weekInfoFor,
  parseISODate,
} from "./schedule";
import { AFFIRMATIONS, PIKACHU_QUOTES, dayOfYear, hashString } from "./affirmations";

type ViewItem = CatalogItem & {
  isCustom: boolean;
  effectiveFrequency: Frequency;
};

const CATEGORIES: { id: Category; title: string }[] = [
  { id: "weekly", title: "WEEKLY CLEANING" },
  { id: "special", title: "SPECIAL CLEANING" },
  { id: "laundry", title: "LAUNDRY" },
];

function mergeOverrides(
  base: CatalogItem | CustomItem,
  overrides: GlobalState["overrides"],
  isCustom: boolean
): ViewItem {
  const o = overrides[base.id] ?? {};
  return {
    id: base.id,
    name: o.name ?? base.name,
    description: o.description ?? base.description,
    category: o.category ?? base.category,
    frequency: o.frequency ?? base.frequency,
    isCustom,
    effectiveFrequency: o.frequency ?? base.frequency,
  };
}

function computeVisible(
  weekISO: string,
  global: GlobalState,
  prevWeek: WeekState
): ViewItem[] {
  const wk = weekInfoFor(parseISODate(weekISO));
  const removed = new Set(global.removedIds);
  const allItems: (CatalogItem | CustomItem)[] = [...CATALOG, ...global.customItems];

  const visible: ViewItem[] = [];
  const seen = new Set<string>();

  for (const it of allItems) {
    if (removed.has(it.id)) continue;
    const isCustom = !CATALOG.find((c) => c.id === it.id);
    const merged = mergeOverrides(it, global.overrides, isCustom);
    if (isDue(merged.effectiveFrequency, wk)) {
      visible.push(merged);
      seen.add(merged.id);
    }
  }

  for (const [itemId, state] of Object.entries(prevWeek.states)) {
    if (state !== "pushed") continue;
    if (seen.has(itemId)) continue;
    if (removed.has(itemId)) continue;
    const base = CATALOG.find((c) => c.id === itemId) ?? global.customItems.find((c) => c.id === itemId);
    if (!base) continue;
    const isCustom = !CATALOG.find((c) => c.id === itemId);
    visible.push(mergeOverrides(base, global.overrides, isCustom));
    seen.add(itemId);
  }

  return visible;
}

function frequencySummary(f: Frequency): string {
  const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  switch (f.kind) {
    case "everyWeek": return "Every week";
    case "cycleWeeks": return `Weeks ${f.weeks.join(", ")} of cycle`;
    case "onceInCycle": return `Once per cycle (week ${f.week})`;
    case "monthly": return `${f.months.map((m) => monthNames[m]).join(", ")} — week ${f.week}`;
    case "yearly": return `Every ${f.intervalYears}yr from ${f.startYear} — week ${f.week}`;
  }
}

const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMondayLabel(iso: string): string {
  const d = parseISODate(iso);
  return `${MONTH_NAMES_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function mondaysInMonth(year: number, month0: number): string[] {
  const out: string[] = [];
  const first = new Date(Date.UTC(year, month0, 1));
  const day = first.getUTCDay();
  const offset = day === 0 ? 1 : (8 - day) % 7;
  const firstMonday = new Date(first);
  firstMonday.setUTCDate(1 + offset);
  while (firstMonday.getUTCMonth() === month0) {
    const y = firstMonday.getUTCFullYear();
    const m = String(firstMonday.getUTCMonth() + 1).padStart(2, "0");
    const d = String(firstMonday.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    firstMonday.setUTCDate(firstMonday.getUTCDate() + 7);
  }
  return out;
}

export default function CleaningPage() {
  const [now] = useState(() => new Date());
  const currentWk = useMemo(() => weekInfoFor(now), [now]);
  const currentISO = currentWk.mondayISO;

  const [viewISO, setViewISO] = useState<string>(currentISO);
  const [futureMenuOpen, setFutureMenuOpen] = useState(false);

  const viewWk = useMemo(() => weekInfoFor(parseISODate(viewISO)), [viewISO]);
  const prevISO = useMemo(() => prevMondayISO(viewISO), [viewISO]);
  const isCurrentWeek = viewISO === currentISO;

  const [global, setGlobalState] = useState<GlobalState | null>(null);
  const [thisWeek, setThisWeek] = useState<WeekState | null>(null);
  const [prevWeek, setPrevWeek] = useState<WeekState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [descItem, setDescItem] = useState<ViewItem | null>(null);
  const [editItem, setEditItem] = useState<ViewItem | null>(null);
  const [addCategory, setAddCategory] = useState<Category | null>(null);
  const [deleteItem, setDeleteItem] = useState<ViewItem | null>(null);
  const [showCongrats, setShowCongrats] = useState(false);
  const [mysteryPopVisible, setMysteryPopVisible] = useState(false);
  const congratsShownThisSession = useRef(false);
  const prevCheckedRef = useRef<Set<string>>(new Set());
  const writeInFlightRef = useRef(0);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/cleaning/state?weeks=${viewISO},${prevISO}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGlobalState(data.global);
      setThisWeek(data.weeks[viewISO] ?? { states: {} });
      setPrevWeek(data.weeks[prevISO] ?? { states: {} });
      prevCheckedRef.current = new Set(
        Object.entries(data.weeks[viewISO]?.states ?? {})
          .filter(([, v]) => v === "checked")
          .map(([k]) => k)
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [viewISO, prevISO]);

  useEffect(() => {
    load();
    window.scrollTo(0, 0);
    congratsShownThisSession.current = false;
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (document.hidden) return;
      if (writeInFlightRef.current > 0) return;
      load({ silent: true });
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(tick, 5000);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        load({ silent: true });
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  const visible = useMemo(() => {
    if (!global || !prevWeek) return [];
    return computeVisible(viewISO, global, prevWeek);
  }, [global, prevWeek, viewISO]);

  const activeVisible = useMemo(
    () => visible.filter((v) => thisWeek?.states[v.id] !== "pushed"),
    [visible, thisWeek]
  );

  const allDone = useMemo(() => {
    if (activeVisible.length === 0) return false;
    return activeVisible.every((v) => {
      const s = thisWeek?.states[v.id];
      return s === "checked" || s === "skipped";
    });
  }, [activeVisible, thisWeek]);

  useEffect(() => {
    if (allDone && isCurrentWeek && !congratsShownThisSession.current) {
      congratsShownThisSession.current = true;
      setShowCongrats(true);
    }
  }, [allDone, isCurrentWeek]);

  const mysteryItemId = useMemo(() => {
    if (activeVisible.length === 0) return null;
    const seed = hashString(`mystery:${viewISO}`);
    return activeVisible[seed % activeVisible.length]?.id ?? null;
  }, [activeVisible, viewISO]);

  const affirmation = useMemo(() => {
    if (activeVisible.length === 0) return null;
    const seed = isCurrentWeek
      ? dayOfYear(now)
      : hashString(`aff:${viewISO}`);
    const text = AFFIRMATIONS[seed % AFFIRMATIONS.length];
    const sectionOrder: Category[] = ["weekly", "special", "laundry"];
    const sectionsWithItems = sectionOrder.filter(
      (c) => visible.some((v) => v.category === c)
    );
    const section = sectionsWithItems[seed % sectionsWithItems.length] ?? "weekly";
    const itemsInSection = visible.filter((v) => v.category === section).length;
    const position = itemsInSection === 0 ? 0 : seed % itemsInSection;
    return { text, section, position };
  }, [activeVisible.length, isCurrentWeek, now, viewISO, visible]);

  async function post(body: unknown) {
    writeInFlightRef.current++;
    try {
      const res = await fetch("/api/cleaning/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      if (data.global) setGlobalState(data.global);
      if (data.week) setThisWeek(data.week);
      return data;
    } finally {
      writeInFlightRef.current = Math.max(0, writeInFlightRef.current - 1);
    }
  }

  async function setItemState(itemId: string, value: ItemStateValue | null) {
    const wasChecked = prevCheckedRef.current.has(itemId);
    setThisWeek((w) => {
      if (!w) return w;
      const next = { ...w.states };
      if (value === null) delete next[itemId];
      else next[itemId] = value;
      return { states: next };
    });
    if (value === "checked" && !wasChecked && itemId === mysteryItemId) {
      setMysteryPopVisible(true);
      setTimeout(() => setMysteryPopVisible(false), 2000);
    }
    if (value === "checked") prevCheckedRef.current.add(itemId);
    else prevCheckedRef.current.delete(itemId);

    try {
      await post({ action: "setItemState", weekISO: viewISO, itemId, value });
    } catch {
      await load();
    }
  }

  async function pushNextWeek(itemId: string) {
    await setItemState(itemId, "pushed");
    setOpenMenu(null);
  }

  const byCategory = useMemo(() => {
    const map: Record<Category, ViewItem[]> = { weekly: [], special: [], laundry: [] };
    for (const v of visible) map[v.category].push(v);
    return map;
  }, [visible]);

  if (loading || !global || !thisWeek) {
    return <div className="cleaning-root"><div className="gb-loading">LOADING…</div></div>;
  }
  if (error) return <div className="cleaning-root"><div className="gb-loading">ERROR: {error}</div></div>;

  const whose = personForWeek(viewWk.weeksSinceAnchor);

  return (
    <div className="cleaning-root" onClick={() => setOpenMenu(null)}>
      {!isCurrentWeek && (
        <button
          className="gb-back-link"
          onClick={(e) => { e.stopPropagation(); setViewISO(currentISO); }}
        >
          ◀ BACK TO THIS WEEK
        </button>
      )}

      <div className="gb-header">
        <div className="gb-title">CLEANING</div>
        <div className="gb-subtitle">
          {isCurrentWeek ? "THIS WEEK" : `WEEK OF ${formatMondayLabel(viewISO)}`} —{" "}
          WEEK {viewWk.cycleWeek} OF 5
        </div>
        <div className="gb-week-chip">{whose.toUpperCase()}&apos;S WEEK</div>
        <div style={{ fontSize: 7, color: "#999", marginTop: 8, letterSpacing: 1 }}>
          build v5 · today {now.toISOString().slice(0, 10)} · mon {currentISO}
        </div>
      </div>

      {CATEGORIES.map((cat) => (
        <Section
          key={cat.id}
          title={cat.title}
          items={byCategory[cat.id]}
          thisWeek={thisWeek}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          onCheck={(id, on) => setItemState(id, on ? "checked" : null)}
          onOpenDesc={(it) => setDescItem(it)}
          onPush={(id) => pushNextWeek(id)}
          onEdit={(it) => { setEditItem(it); setOpenMenu(null); }}
          onDelete={(it) => { setDeleteItem(it); setOpenMenu(null); }}
          onAdd={() => setAddCategory(cat.id)}
          affirmation={affirmation && affirmation.section === cat.id ? affirmation : null}
        />
      ))}

      <button className="gb-future-btn" onClick={() => setFutureMenuOpen(true)}>
        ▶ FUTURE WEEKS
      </button>

      {descItem && (
        <DescriptionModal item={descItem} onClose={() => setDescItem(null)} />
      )}

      {editItem && (
        <EditModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={async (updates) => {
            setEditItem(null);
            try { await post({ action: "setOverride", itemId: editItem.id, override: updates }); }
            catch { await load(); }
          }}
          onReset={async () => {
            setEditItem(null);
            try { await post({ action: "clearOverride", itemId: editItem.id }); }
            catch { await load(); }
          }}
        />
      )}

      {addCategory && (
        <AddItemModal
          category={addCategory}
          onClose={() => setAddCategory(null)}
          onSave={async (item) => {
            setAddCategory(null);
            try { await post({ action: "addCustomItem", item }); }
            catch { await load(); }
          }}
        />
      )}

      {deleteItem && (
        <DeleteModal
          item={deleteItem}
          onClose={() => setDeleteItem(null)}
          onDeleteThisWeek={async () => {
            const item = deleteItem;
            setDeleteItem(null);
            await setItemState(item.id, "skipped");
          }}
          onDeleteForever={async () => {
            const item = deleteItem;
            setDeleteItem(null);
            try {
              if (item.isCustom) await post({ action: "deleteCustomItem", itemId: item.id });
              else await post({ action: "removeCatalogItem", itemId: item.id });
            } catch { await load(); }
          }}
        />
      )}

      {futureMenuOpen && (
        <FutureWeeksModal
          currentISO={currentISO}
          onPickWeek={(iso) => {
            setFutureMenuOpen(false);
            setViewISO(iso);
          }}
          onClose={() => setFutureMenuOpen(false)}
        />
      )}

      {showCongrats && (
        <CongratsOverlay onClose={() => setShowCongrats(false)} />
      )}

      {mysteryPopVisible && (
        <div className="gb-mystery-pop">
          <PikachuDancing size={180} />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  thisWeek,
  openMenu,
  setOpenMenu,
  onCheck,
  onOpenDesc,
  onPush,
  onEdit,
  onDelete,
  onAdd,
  affirmation,
}: {
  title: string;
  items: ViewItem[];
  thisWeek: WeekState;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  onCheck: (itemId: string, on: boolean) => void;
  onOpenDesc: (item: ViewItem) => void;
  onPush: (itemId: string) => void;
  onEdit: (item: ViewItem) => void;
  onDelete: (item: ViewItem) => void;
  onAdd: () => void;
  affirmation: { text: string; position: number } | null;
}) {
  const sorted = [...items].sort((a, b) => {
    const aState = thisWeek.states[a.id];
    const bState = thisWeek.states[b.id];
    const rank = (s: ItemStateValue | undefined) =>
      s === "checked" ? 2 : s === "skipped" ? 3 : s === "pushed" ? 4 : 1;
    return rank(aState) - rank(bState);
  });

  return (
    <div className="gb-section">
      <div className="gb-section-head">{title}</div>
      {sorted.length === 0 && <div className="gb-empty">NOTHING THIS WEEK</div>}
      {sorted.map((it, idx) => {
        const state = thisWeek.states[it.id];
        const isChecked = state === "checked";
        const isSkipped = state === "skipped";
        const isPushed = state === "pushed";
        const cls = ["gb-item"];
        if (isChecked) cls.push("done");
        if (isSkipped) cls.push("skipped");
        if (isPushed) cls.push("pushed");
        return (
          <div key={it.id}>
            {affirmation && idx === affirmation.position && (
              <AffirmationRow text={affirmation.text} />
            )}
            <div className={cls.join(" ")} style={{ position: "relative" }}>
              <button
                className={`gb-checkbox ${isChecked ? "on" : ""}`}
                onClick={(e) => { e.stopPropagation(); onCheck(it.id, !isChecked); }}
                aria-label="toggle"
              >
                {isChecked ? "✓" : ""}
              </button>
              <div
                className="gb-item-name"
                onClick={(e) => { e.stopPropagation(); onOpenDesc(it); }}
              >
                {it.name}
                {it.isCustom && <span className="gb-tag custom">CUSTOM</span>}
                {isPushed && <span className="gb-tag">PUSHED →</span>}
              </div>
              <button
                className="gb-menu-btn"
                onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === it.id ? null : it.id); }}
                aria-label="menu"
              >
                ⋮
              </button>
              {openMenu === it.id && (
                <div className="gb-menu" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onPush(it.id)}>PUSH ONE WEEK</button>
                  <button onClick={() => onEdit(it)}>EDIT FREQUENCY</button>
                  <button className="danger" onClick={() => onDelete(it)}>DELETE</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {affirmation && affirmation.position >= sorted.length && (
        <AffirmationRow text={affirmation.text} />
      )}
      <button className="gb-add-btn" onClick={onAdd}>+ NEW ITEM</button>
    </div>
  );
}

function AffirmationRow({ text }: { text: string }) {
  return (
    <div className="gb-affirmation">
      <span className="gb-affirmation-star" aria-hidden>✨</span>
      <span>{text}</span>
    </div>
  );
}

function DescriptionModal({ item, onClose }: { item: ViewItem; onClose: () => void }) {
  return (
    <div className="gb-modal-backdrop" onClick={onClose}>
      <div className="gb-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{item.name}</h2>
        <p>{item.description}</p>
        <p style={{ color: "var(--gb-muted)", fontSize: 9 }}>
          {frequencySummary(item.effectiveFrequency)}
        </p>
        <div style={{ marginTop: 12 }}>
          <button className="gb-btn" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({
  item,
  onClose,
  onDeleteThisWeek,
  onDeleteForever,
}: {
  item: ViewItem;
  onClose: () => void;
  onDeleteThisWeek: () => Promise<void>;
  onDeleteForever: () => Promise<void>;
}) {
  return (
    <div className="gb-modal-backdrop" onClick={onClose}>
      <div className="gb-modal" onClick={(e) => e.stopPropagation()}>
        <h2>DELETE {item.name}?</h2>
        <p>Do you want to remove it just for this week, or remove it from all future weeks?</p>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="gb-btn" onClick={onDeleteThisWeek}>JUST THIS WEEK</button>
          <button className="gb-btn primary" onClick={onDeleteForever}>ALL FUTURE WEEKS</button>
          <button className="gb-btn" onClick={onClose}>CANCEL</button>
        </div>
      </div>
    </div>
  );
}

function EditModal({
  item,
  onClose,
  onSave,
  onReset,
}: {
  item: ViewItem;
  onClose: () => void;
  onSave: (o: Partial<{ name: string; description: string; frequency: Frequency; category: Category }>) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);
  const [category, setCategory] = useState<Category>(item.category);
  const [freq, setFreq] = useState<Frequency>(item.effectiveFrequency);

  return (
    <div className="gb-modal-backdrop" onClick={onClose}>
      <div className="gb-modal" onClick={(e) => e.stopPropagation()}>
        <h2>EDIT ITEM</h2>

        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />

        <label>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />

        <label>Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          <option value="weekly">Weekly Cleaning</option>
          <option value="special">Special Cleaning</option>
          <option value="laundry">Laundry</option>
        </select>

        <FrequencyPicker value={freq} onChange={setFreq} />

        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            className="gb-btn primary"
            onClick={() => onSave({ name, description, category, frequency: freq })}
          >
            SAVE
          </button>
          <button className="gb-btn" onClick={onReset}>RESET</button>
          <button className="gb-btn" onClick={onClose}>CANCEL</button>
        </div>
      </div>
    </div>
  );
}

function FrequencyPicker({
  value,
  onChange,
}: {
  value: Frequency;
  onChange: (f: Frequency) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);

  function matchesPreset(preset: string): boolean {
    if (preset === "everyWeek") return value.kind === "everyWeek";
    if (preset === "everyOther") {
      return value.kind === "cycleWeeks" && value.weeks.length === 2 &&
        value.weeks.includes(1) && value.weeks.includes(3);
    }
    if (preset === "monthly") return value.kind === "onceInCycle";
    if (preset === "custom") {
      return value.kind === "monthly" || value.kind === "yearly" ||
        (value.kind === "cycleWeeks" && !(value.weeks.length === 2 && value.weeks.includes(1) && value.weeks.includes(3)));
    }
    return false;
  }

  return (
    <>
      <label>Frequency</label>
      <div className="gb-freq-preset">
        <button
          type="button"
          className={matchesPreset("everyWeek") ? "on" : ""}
          onClick={() => onChange({ kind: "everyWeek" })}
        >
          EVERY WEEK
        </button>
        <button
          type="button"
          className={matchesPreset("everyOther") ? "on" : ""}
          onClick={() => onChange({ kind: "cycleWeeks", weeks: [1, 3] })}
        >
          EVERY OTHER
        </button>
        <button
          type="button"
          className={matchesPreset("monthly") ? "on" : ""}
          onClick={() => onChange({ kind: "onceInCycle", week: 1 })}
        >
          ONCE A MONTH
        </button>
        <button
          type="button"
          className={matchesPreset("custom") ? "on" : ""}
          onClick={() => setCustomOpen(true)}
        >
          CUSTOM…
        </button>
      </div>
      <div style={{ fontSize: 9, color: "var(--gb-muted)", marginBottom: 8 }}>
        {frequencySummary(value)}
      </div>

      {customOpen && (
        <CustomFrequencyModal
          initial={value}
          onSave={(f) => { onChange(f); setCustomOpen(false); }}
          onClose={() => setCustomOpen(false)}
        />
      )}
    </>
  );
}

function CustomFrequencyModal({
  initial,
  onSave,
  onClose,
}: {
  initial: Frequency;
  onSave: (f: Frequency) => void;
  onClose: () => void;
}) {
  const [freq, setFreq] = useState<Frequency>(initial);

  return (
    <div className="gb-modal-backdrop" onClick={onClose}>
      <div className="gb-modal" onClick={(e) => e.stopPropagation()}>
        <h2>CUSTOM FREQUENCY</h2>

        <label>Kind</label>
        <select
          value={freq.kind}
          onChange={(e) => {
            const k = e.target.value as Frequency["kind"];
            if (k === "everyWeek") setFreq({ kind: "everyWeek" });
            else if (k === "cycleWeeks") setFreq({ kind: "cycleWeeks", weeks: [1] });
            else if (k === "onceInCycle") setFreq({ kind: "onceInCycle", week: 1 });
            else if (k === "monthly") setFreq({ kind: "monthly", months: [1], week: 1 });
            else setFreq({ kind: "yearly", intervalYears: 1, startYear: new Date().getFullYear(), week: 1 });
          }}
        >
          <option value="everyWeek">Every week</option>
          <option value="cycleWeeks">Specific weeks of 5-cycle</option>
          <option value="onceInCycle">Once per 5-week cycle</option>
          <option value="monthly">Specific months</option>
          <option value="yearly">Every N years</option>
        </select>

        {freq.kind === "cycleWeeks" && (
          <WeekCheckboxes
            selected={freq.weeks}
            onChange={(weeks) => setFreq({ kind: "cycleWeeks", weeks })}
          />
        )}

        {freq.kind === "onceInCycle" && (
          <WeekSelect
            value={freq.week}
            onChange={(week) => setFreq({ kind: "onceInCycle", week })}
          />
        )}

        {freq.kind === "monthly" && (
          <>
            <MonthCheckboxes
              selected={freq.months}
              onChange={(months) => setFreq({ kind: "monthly", months, week: freq.week })}
            />
            <WeekSelect
              value={freq.week}
              onChange={(week) => setFreq({ kind: "monthly", months: freq.months, week })}
            />
          </>
        )}

        {freq.kind === "yearly" && (
          <>
            <label>Interval (years)</label>
            <input
              type="number"
              min={1}
              value={freq.intervalYears}
              onChange={(e) =>
                setFreq({
                  kind: "yearly",
                  intervalYears: Math.max(1, parseInt(e.target.value) || 1),
                  startYear: freq.startYear,
                  week: freq.week,
                })
              }
            />
            <label>Start year</label>
            <input
              type="number"
              value={freq.startYear}
              onChange={(e) =>
                setFreq({
                  kind: "yearly",
                  intervalYears: freq.intervalYears,
                  startYear: parseInt(e.target.value) || new Date().getFullYear(),
                  week: freq.week,
                })
              }
            />
            <WeekSelect
              value={freq.week}
              onChange={(week) =>
                setFreq({ kind: "yearly", intervalYears: freq.intervalYears, startYear: freq.startYear, week })
              }
            />
          </>
        )}

        <div style={{ marginTop: 14 }}>
          <button className="gb-btn primary" onClick={() => onSave(freq)}>SAVE</button>
          <button className="gb-btn" onClick={onClose}>CANCEL</button>
        </div>
      </div>
    </div>
  );
}

function WeekSelect({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  return (
    <>
      <label>Cycle week</label>
      <select value={value} onChange={(e) => onChange(parseInt(e.target.value))}>
        {[1, 2, 3, 4, 5].map((w) => (
          <option key={w} value={w}>Week {w}</option>
        ))}
      </select>
    </>
  );
}

function WeekCheckboxes({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (weeks: number[]) => void;
}) {
  return (
    <>
      <label>Cycle weeks</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[1, 2, 3, 4, 5].map((w) => (
          <label key={w} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9 }}>
            <input
              type="checkbox"
              checked={selected.includes(w)}
              onChange={(e) => {
                if (e.target.checked) onChange([...selected, w].sort());
                else onChange(selected.filter((x) => x !== w));
              }}
            />
            W{w}
          </label>
        ))}
      </div>
    </>
  );
}

function MonthCheckboxes({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (months: number[]) => void;
}) {
  return (
    <>
      <label>Months</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {MONTH_NAMES_SHORT.map((n, i) => {
          const m = i + 1;
          return (
            <label key={m} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9 }}>
              <input
                type="checkbox"
                checked={selected.includes(m)}
                onChange={(e) => {
                  if (e.target.checked) onChange([...selected, m].sort((a, b) => a - b));
                  else onChange(selected.filter((x) => x !== m));
                }}
              />
              {n}
            </label>
          );
        })}
      </div>
    </>
  );
}

function AddItemModal({
  category,
  onClose,
  onSave,
}: {
  category: Category;
  onClose: () => void;
  onSave: (item: CustomItem) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [freq, setFreq] = useState<Frequency>({ kind: "everyWeek" });

  return (
    <div className="gb-modal-backdrop" onClick={onClose}>
      <div className="gb-modal" onClick={(e) => e.stopPropagation()}>
        <h2>NEW ITEM</h2>

        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />

        <label>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />

        <FrequencyPicker value={freq} onChange={setFreq} />

        <div style={{ marginTop: 14 }}>
          <button
            className="gb-btn primary"
            disabled={!name.trim()}
            onClick={() => {
              const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              onSave({
                id,
                name: name.trim(),
                description: description.trim(),
                category,
                frequency: freq,
                createdAt: new Date().toISOString(),
              });
            }}
          >
            ADD
          </button>
          <button className="gb-btn" onClick={onClose}>CANCEL</button>
        </div>
      </div>
    </div>
  );
}

type FutureNav =
  | { kind: "root" }
  | { kind: "nextFourWeeks" }
  | { kind: "months"; horizon: 6 | 12 }
  | { kind: "monthWeeks"; year: number; month0: number; horizon: 6 | 12 }
  | { kind: "custom" };

function FutureWeeksModal({
  currentISO,
  onPickWeek,
  onClose,
}: {
  currentISO: string;
  onPickWeek: (iso: string) => void;
  onClose: () => void;
}) {
  const [nav, setNav] = useState<FutureNav>({ kind: "root" });

  function weekLabel(iso: string): string {
    const wk = weekInfoFor(parseISODate(iso));
    const whose = personForWeek(wk.weeksSinceAnchor);
    return `${formatMondayLabel(iso)} — W${wk.cycleWeek} (${whose})`;
  }

  function monthsFromNow(n: number): { year: number; month0: number; label: string }[] {
    const now = new Date();
    const out: { year: number; month0: number; label: string }[] = [];
    for (let i = 0; i < n; i++) {
      const y = now.getUTCFullYear();
      const m0 = now.getUTCMonth() + i;
      const year = y + Math.floor(m0 / 12);
      const mm = ((m0 % 12) + 12) % 12;
      out.push({ year, month0: mm, label: `${MONTH_NAMES_FULL[mm]} ${year}` });
    }
    return out;
  }

  return (
    <div className="gb-modal-backdrop" onClick={onClose}>
      <div className="gb-modal" onClick={(e) => e.stopPropagation()}>
        {nav.kind === "root" && (
          <>
            <h2>FUTURE WEEKS</h2>
            <button className="gb-menu-item" onClick={() => onPickWeek(addWeeks(currentISO, 1))}>
              NEXT WEEK
            </button>
            <button className="gb-menu-item" onClick={() => setNav({ kind: "nextFourWeeks" })}>
              NEXT MONTH
            </button>
            <button className="gb-menu-item" onClick={() => setNav({ kind: "months", horizon: 6 })}>
              NEXT 6 MONTHS
            </button>
            <button className="gb-menu-item" onClick={() => setNav({ kind: "months", horizon: 12 })}>
              NEXT YEAR
            </button>
            <button className="gb-menu-item" onClick={() => setNav({ kind: "custom" })}>
              CUSTOM DATE
            </button>
            <button className="gb-menu-item back" onClick={onClose}>BACK</button>
          </>
        )}

        {nav.kind === "nextFourWeeks" && (
          <>
            <h2>NEXT 4 WEEKS</h2>
            {[1, 2, 3, 4].map((i) => {
              const iso = addWeeks(currentISO, i);
              return (
                <button key={iso} className="gb-menu-item" onClick={() => onPickWeek(iso)}>
                  {weekLabel(iso)}
                </button>
              );
            })}
            <button className="gb-menu-item back" onClick={() => setNav({ kind: "root" })}>BACK</button>
          </>
        )}

        {nav.kind === "months" && (
          <>
            <h2>PICK A MONTH</h2>
            {monthsFromNow(nav.horizon).map((m) => (
              <button
                key={`${m.year}-${m.month0}`}
                className="gb-menu-item"
                onClick={() => setNav({ kind: "monthWeeks", year: m.year, month0: m.month0, horizon: nav.horizon })}
              >
                {m.label}
              </button>
            ))}
            <button className="gb-menu-item back" onClick={() => setNav({ kind: "root" })}>BACK</button>
          </>
        )}

        {nav.kind === "monthWeeks" && (
          <>
            <h2>{MONTH_NAMES_FULL[nav.month0]} {nav.year}</h2>
            {mondaysInMonth(nav.year, nav.month0).map((iso) => (
              <button key={iso} className="gb-menu-item" onClick={() => onPickWeek(iso)}>
                {weekLabel(iso)}
              </button>
            ))}
            <button
              className="gb-menu-item back"
              onClick={() => setNav({ kind: "months", horizon: nav.horizon })}
            >
              BACK
            </button>
          </>
        )}

        {nav.kind === "custom" && <CustomDatePicker
          onPick={onPickWeek}
          onBack={() => setNav({ kind: "root" })}
        />}
      </div>
    </div>
  );
}

function CustomDatePicker({
  onPick,
  onBack,
}: {
  onPick: (iso: string) => void;
  onBack: () => void;
}) {
  const [dateStr, setDateStr] = useState("");

  function submit() {
    if (!dateStr) return;
    const picked = parseISODate(dateStr);
    const utc = new Date(Date.UTC(picked.getUTCFullYear(), picked.getUTCMonth(), picked.getUTCDate()));
    const day = utc.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    utc.setUTCDate(utc.getUTCDate() + diff);
    const y = utc.getUTCFullYear();
    const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
    const d = String(utc.getUTCDate()).padStart(2, "0");
    onPick(`${y}-${m}-${d}`);
  }

  return (
    <>
      <h2>PICK A DATE</h2>
      <p>Choose any day, month, and year. We&apos;ll jump you to the cleaning week that contains it.</p>
      <input
        className="gb-date-input"
        type="date"
        value={dateStr}
        onChange={(e) => setDateStr(e.target.value)}
      />
      <button className="gb-menu-item" disabled={!dateStr} onClick={submit}>GO</button>
      <button className="gb-menu-item back" onClick={onBack}>BACK</button>
    </>
  );
}

function CongratsOverlay({ onClose }: { onClose: () => void }) {
  const [quote] = useState(() => PIKACHU_QUOTES[Math.floor(Math.random() * PIKACHU_QUOTES.length)]);
  return (
    <div className="gb-congrats-backdrop" onClick={onClose}>
      <div className="gb-congrats-title">YOU DID IT!</div>
      <PikachuWithBubble size={180} quote={quote} />
      <div className="gb-congrats-sub" style={{ marginTop: 14 }}>
        Every chore for the week is done.
      </div>
      <div style={{ marginTop: 18 }}>
        <button className="gb-btn primary" onClick={onClose}>CLOSE</button>
      </div>
    </div>
  );
}

