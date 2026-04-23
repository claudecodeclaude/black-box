import { CATALOG, CatalogItem, Frequency } from "./tasks";

export const ANCHOR_MONDAY_ISO = "2026-04-13";
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = MS_PER_DAY * 7;

export type WeekInfo = {
  mondayISO: string;
  monday: Date;
  year: number;
  month: number;
  cycleWeek: number;
  weeksSinceAnchor: number;
  isFirstCycleWeekOccurrenceInYear: (week: number) => boolean;
};

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function mondayOf(d: Date): Date {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diff);
  return utc;
}

export function weekInfoFor(date: Date): WeekInfo {
  const anchor = parseISODate(ANCHOR_MONDAY_ISO);
  const monday = mondayOf(date);
  const weeksSinceAnchor = Math.floor((monday.getTime() - anchor.getTime()) / MS_PER_WEEK);
  const cycleWeek = ((weeksSinceAnchor % 5) + 5) % 5 + 1;
  const year = monday.getUTCFullYear();
  const month = monday.getUTCMonth() + 1;

  const isFirstCycleWeekOccurrenceInYear = (targetWeek: number) => {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    let m = mondayOf(yearStart);
    if (m.getTime() < yearStart.getTime()) {
      m = new Date(m.getTime() + MS_PER_WEEK);
    }
    for (let i = 0; i < 10; i++) {
      const w = weekInfoFor(m);
      if (w.cycleWeek === targetWeek) {
        return w.mondayISO === toISODate(monday);
      }
      m = new Date(m.getTime() + MS_PER_WEEK);
    }
    return false;
  };

  return {
    mondayISO: toISODate(monday),
    monday,
    year,
    month,
    cycleWeek,
    weeksSinceAnchor,
    isFirstCycleWeekOccurrenceInYear,
  };
}

export function isDue(freq: Frequency, wk: WeekInfo): boolean {
  switch (freq.kind) {
    case "everyWeek":
      return true;
    case "cycleWeeks":
      return freq.weeks.includes(wk.cycleWeek);
    case "onceInCycle":
      return freq.week === wk.cycleWeek;
    case "monthly":
      return freq.months.includes(wk.month) && freq.week === wk.cycleWeek;
    case "yearly": {
      if (freq.week !== wk.cycleWeek) return false;
      if (wk.year < freq.startYear) return false;
      if ((wk.year - freq.startYear) % freq.intervalYears !== 0) return false;
      return wk.isFirstCycleWeekOccurrenceInYear(freq.week);
    }
  }
}

export function dueItems(wk: WeekInfo, catalog: CatalogItem[] = CATALOG): CatalogItem[] {
  return catalog.filter((it) => isDue(it.frequency, wk));
}

export function addWeeks(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return toISODate(d);
}

export function prevMondayISO(iso: string): string {
  return addWeeks(iso, -1);
}

export function nextMondayISO(iso: string): string {
  return addWeeks(iso, 1);
}

export function personForWeek(weeksSinceAnchor: number): "jodi" | "cody" {
  return ((weeksSinceAnchor % 2) + 2) % 2 === 0 ? "jodi" : "cody";
}

export { toISODate, parseISODate };
