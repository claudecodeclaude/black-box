"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./cleaning.css";
import { Pikachu } from "./Pikachu";
import { CATALOG, CatalogItem, Category, Frequency } from "./tasks";
import { CustomItem, GlobalState, ItemStateValue, WeekState } from "./state";
import {
  isDue,
  personForWeek,
  prevMondayISO,
  weekInfoFor,
  parseISODate,
} from "./schedule";

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
  thisWeek: WeekState,
  prevWeek: WeekState
): ViewItem[] {
  const wk = weekInfoFor(parseISODate(weekISO));
  const removed = new Set(global.removedIds);

  const allItems: (CatalogItem | CustomItem)[] = [
    ...CATALOG,
    ...global.customItems,
  ];

  const visible: ViewItem[] = [];
  const seen = new Set<string>();

  for (const it of allItems) {
    if (removed.has(it.id)) continue;
    const isCustom = !("id" in it) ? false : !CATALOG.find((c) => c.id === it.id);
    const merged = mergeOverrides(it as CatalogItem, global.overrides, isCustom);
    if (isDue(merged.effectiveFrequency, wk)) {
      visible.push(merged);
      seen.add(merged.id);
    }
  }

  // Carry-in: items pushed from previous week
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
  switch (f.kind) {
    case "everyWeek":
      return "Every week";
    case "cycleWeeks":
      return `Weeks ${f.weeks.join(", ")} of cycle`;
    case "onceInCycle":
      return `Once per cycle (week ${f.week})`;
    case "monthly": {
      const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${f.months.map((m) => monthNames[m]).join(", ")} — week ${f.week}`;
    }
    case "yearly":
      return `Every ${f.intervalYears}yr from ${f.startYear} — week ${f.week}`;
  }
}

export default function CleaningPage() {
  const [now] = useState(() => new Date());
  const wk = useMemo(() => weekInfoFor(now), [now]);
  const thisISO = wk.mondayISO;
  const prevISO = prevMondayISO(thisISO);

  const [global, setGlobalState] = useState<GlobalState | null>(null);
  const [thisWeek, setThisWeek] = useState<WeekState | null>(null);
  const [prevWeek, setPrevWeek] = useState<WeekState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [descItem, setDescItem] = useState<ViewItem | null>(null);
  const [editItem, setEditItem] = useState<ViewItem | null>(null);
  const [addCategory, setAddCategory] = useState<Category | null>(null);
  const [showCongrats, setShowCongrats] = useState(false);
  const congratsShownThisSession = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/cleaning/state?weeks=${thisISO},${prevISO}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGlobalState(data.global);
      setThisWeek(data.weeks[thisISO] ?? { states: {} });
      setPrevWeek(data.weeks[prevISO] ?? { states: {} });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [thisISO, prevISO]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (!global || !thisWeek || !prevWeek) return [];
    return computeVisible(thisISO, global, thisWeek, prevWeek);
  }, [global, thisWeek, prevWeek, thisISO]);

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
    if (allDone && !congratsShownThisSession.current) {
      congratsShownThisSession.current = true;
      setShowCongrats(true);
    }
  }, [allDone]);

  async function post(body: unknown) {
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
  }

  async function setItemState(itemId: string, value: ItemStateValue | null) {
    setThisWeek((w) => {
      if (!w) return w;
      const next = { ...w.states };
      if (value === null) delete next[itemId];
      else next[itemId] = value;
      return { states: next };
    });
    try {
      await post({ action: "setItemState", weekISO: thisISO, itemId, value });
    } catch {
      await load();
    }
  }

  async function pushNextWeek(itemId: string) {
    await setItemState(itemId, "pushed");
    setOpenMenu(null);
  }

  async function deleteItem(item: ViewItem) {
    if (!confirm(`Delete "${item.name}"? This removes it from all future weeks.`)) {
      return;
    }
    if (item.isCustom) {
      await post({ action: "deleteCustomItem", itemId: item.id });
    } else {
      await post({ action: "removeCatalogItem", itemId: item.id });
    }
    setOpenMenu(null);
  }

  const byCategory = useMemo(() => {
    const map: Record<Category, ViewItem[]> = { weekly: [], special: [], laundry: [] };
    for (const v of visible) map[v.category].push(v);
    return map;
  }, [visible]);

  if (loading) return <div className="cleaning-root"><div className="gb-loading">LOADING…</div></div>;
  if (error) return <div className="cleaning-root"><div className="gb-loading">ERROR: {error}</div></div>;

  const whose = personForWeek(wk.weeksSinceAnchor);

  return (
    <div className="cleaning-root" onClick={() => setOpenMenu(null)}>
      <Link href="/" className="gb-back-link">◀ BLACK BOX</Link>

      <div className="gb-header">
        <div className="gb-title">CLEANING</div>
        <div className="gb-subtitle">WEEK {wk.cycleWeek} OF 5</div>
        <div className="gb-week-chip">{whose.toUpperCase()}&apos;S WEEK</div>
      </div>

      {CATEGORIES.map((cat) => (
        <Section
          key={cat.id}
          title={cat.title}
          items={byCategory[cat.id]}
          thisWeek={thisWeek!}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          onCheck={(id, on) => setItemState(id, on ? "checked" : null)}
          onOpenDesc={(it) => setDescItem(it)}
          onPush={(id) => pushNextWeek(id)}
          onEdit={(it) => { setEditItem(it); setOpenMenu(null); }}
          onDelete={(it) => deleteItem(it)}
          onAdd={() => setAddCategory(cat.id)}
        />
      ))}

      {descItem && (
        <DescriptionModal
          item={descItem}
          onClose={() => setDescItem(null)}
        />
      )}

      {editItem && (
        <EditModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={async (updates) => {
            await post({
              action: "setOverride",
              itemId: editItem.id,
              override: updates,
            });
            setEditItem(null);
          }}
          onReset={async () => {
            await post({ action: "clearOverride", itemId: editItem.id });
            setEditItem(null);
          }}
        />
      )}

      {addCategory && (
        <AddItemModal
          category={addCategory}
          onClose={() => setAddCategory(null)}
          onSave={async (item) => {
            await post({ action: "addCustomItem", item });
            setAddCategory(null);
          }}
        />
      )}

      {showCongrats && (
        <CongratsOverlay onClose={() => setShowCongrats(false)} />
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
      {sorted.map((it) => {
        const state = thisWeek.states[it.id];
        const isChecked = state === "checked";
        const isSkipped = state === "skipped";
        const isPushed = state === "pushed";
        const cls = ["gb-item"];
        if (isChecked) cls.push("done");
        if (isSkipped) cls.push("skipped");
        if (isPushed) cls.push("pushed");
        return (
          <div key={it.id} className={cls.join(" ")} style={{ position: "relative" }}>
            <button
              className={`gb-checkbox ${isChecked ? "on" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onCheck(it.id, !isChecked);
              }}
              aria-label="toggle"
            >
              {isChecked ? "✓" : ""}
            </button>
            <div
              className="gb-item-name"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDesc(it);
              }}
            >
              {it.name}
              {it.isCustom && <span className="gb-tag custom">CUSTOM</span>}
              {isPushed && <span className="gb-tag">PUSHED →</span>}
            </div>
            <button
              className="gb-menu-btn"
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === it.id ? null : it.id);
              }}
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
        );
      })}
      <button className="gb-add-btn" onClick={onAdd}>+ NEW ITEM</button>
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

        <FrequencyEditor value={freq} onChange={setFreq} />

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

function FrequencyEditor({
  value,
  onChange,
}: {
  value: Frequency;
  onChange: (f: Frequency) => void;
}) {
  return (
    <>
      <label>Frequency</label>
      <select
        value={value.kind}
        onChange={(e) => {
          const k = e.target.value as Frequency["kind"];
          if (k === "everyWeek") onChange({ kind: "everyWeek" });
          else if (k === "cycleWeeks") onChange({ kind: "cycleWeeks", weeks: [1] });
          else if (k === "onceInCycle") onChange({ kind: "onceInCycle", week: 1 });
          else if (k === "monthly") onChange({ kind: "monthly", months: [1], week: 1 });
          else onChange({ kind: "yearly", intervalYears: 1, startYear: new Date().getFullYear(), week: 1 });
        }}
      >
        <option value="everyWeek">Every week</option>
        <option value="cycleWeeks">Specific weeks of 5-cycle</option>
        <option value="onceInCycle">Once per 5-week cycle</option>
        <option value="monthly">Specific months</option>
        <option value="yearly">Every N years</option>
      </select>

      {value.kind === "cycleWeeks" && (
        <WeekCheckboxes
          selected={value.weeks}
          onChange={(weeks) => onChange({ kind: "cycleWeeks", weeks })}
        />
      )}

      {value.kind === "onceInCycle" && (
        <WeekSelect
          value={value.week}
          onChange={(week) => onChange({ kind: "onceInCycle", week })}
        />
      )}

      {value.kind === "monthly" && (
        <>
          <MonthCheckboxes
            selected={value.months}
            onChange={(months) => onChange({ kind: "monthly", months, week: value.week })}
          />
          <WeekSelect
            value={value.week}
            onChange={(week) => onChange({ kind: "monthly", months: value.months, week })}
          />
        </>
      )}

      {value.kind === "yearly" && (
        <>
          <label>Interval (years)</label>
          <input
            type="number"
            min={1}
            value={value.intervalYears}
            onChange={(e) =>
              onChange({
                kind: "yearly",
                intervalYears: Math.max(1, parseInt(e.target.value) || 1),
                startYear: value.startYear,
                week: value.week,
              })
            }
          />
          <label>Start year</label>
          <input
            type="number"
            value={value.startYear}
            onChange={(e) =>
              onChange({
                kind: "yearly",
                intervalYears: value.intervalYears,
                startYear: parseInt(e.target.value) || new Date().getFullYear(),
                week: value.week,
              })
            }
          />
          <WeekSelect
            value={value.week}
            onChange={(week) =>
              onChange({
                kind: "yearly",
                intervalYears: value.intervalYears,
                startYear: value.startYear,
                week,
              })
            }
          />
        </>
      )}
    </>
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
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (
    <>
      <label>Months</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {names.map((n, i) => {
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

        <FrequencyEditor value={freq} onChange={setFreq} />

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

function CongratsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="gb-congrats-backdrop" onClick={onClose}>
      <div className="gb-congrats-title">YOU DID IT!</div>
      <Pikachu size={200} />
      <div className="gb-congrats-sub">
        Every chore for the week is done.
        <br />
        Pika pika!
      </div>
      <div style={{ marginTop: 20 }}>
        <button className="gb-btn primary" onClick={onClose}>CLOSE</button>
      </div>
    </div>
  );
}

