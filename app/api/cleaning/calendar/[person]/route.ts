import { NextRequest, NextResponse } from "next/server";
import { CATALOG } from "../../../../cleaning/tasks";
import {
  addWeeks,
  dueItems,
  parseISODate,
  personForWeek,
  weekInfoFor,
} from "../../../../cleaning/schedule";
import { getGlobal, getWeek } from "../../../../cleaning/kv-store";

export const dynamic = "force-dynamic";

type Person = "jodi" | "cody";

const PERSON_NAMES: Record<Person, string> = {
  jodi: "Jodi",
  cody: "Cody",
};

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function formatDateICS(date: Date, hour: number, minute: number): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}00`;
}

function formatUTCStamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ person: string }> }
) {
  const { person: personParam } = await params;
  const person = personParam.toLowerCase() as Person;
  if (person !== "jodi" && person !== "cody") {
    return NextResponse.json({ error: "unknown person" }, { status: 404 });
  }

  const global = await getGlobal();
  const now = new Date();
  const thisMondayISO = weekInfoFor(now).mondayISO;

  const events: string[] = [];
  const dtstamp = formatUTCStamp(now);

  const HORIZON_WEEKS = 26;
  for (let i = 0; i < HORIZON_WEEKS; i++) {
    const mondayISO = addWeeks(thisMondayISO, i);
    const wk = weekInfoFor(parseISODate(mondayISO));
    const whose = personForWeek(wk.weeksSinceAnchor);
    if (whose !== person) continue;

    const allDue = [
      ...dueItems(wk),
      ...global.customItems
        .filter((it) => !global.removedIds.includes(it.id))
        .filter((it) => {
          const freq = global.overrides[it.id]?.frequency ?? it.frequency;
          return dueItems(wk, [{ ...it, frequency: freq }]).length > 0;
        }),
    ].filter((it) => !global.removedIds.includes(it.id));

    const weekState = i === 0 ? await getWeek(mondayISO) : { states: {} };
    const undoneCount = allDue.filter(
      (it) => weekState.states[it.id] !== "checked" && weekState.states[it.id] !== "skipped"
    ).length;

    const mondayDate = parseISODate(mondayISO);
    const thursdayPrev = new Date(mondayDate.getTime() - 3 * 86_400_000);

    const thursdaySummary =
      i === 0
        ? `Heads up ${PERSON_NAMES[person]} — your cleaning week starts Monday.`
        : `Heads up ${PERSON_NAMES[person]} — your cleaning week starts next Monday.`;

    const mondaySummary =
      i === 0
        ? `${PERSON_NAMES[person]}'s cleaning week. ${undoneCount} item${undoneCount === 1 ? "" : "s"} on the list.`
        : `${PERSON_NAMES[person]}'s cleaning week starts today.`;

    const appURL = "https://black-box-orpin.vercel.app/cleaning";

    events.push(
      [
        "BEGIN:VEVENT",
        `UID:cleaning-thu-${mondayISO}-${person}@black-box`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=America/Chicago:${formatDateICS(thursdayPrev, 17, 0)}`,
        `DTEND;TZID=America/Chicago:${formatDateICS(thursdayPrev, 17, 15)}`,
        `SUMMARY:${icsEscape(`Cleaning week reminder (${PERSON_NAMES[person]})`)}`,
        `DESCRIPTION:${icsEscape(`${thursdaySummary}\n\nOpen: ${appURL}`)}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Cleaning week reminder",
        "TRIGGER:PT0M",
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n")
    );

    events.push(
      [
        "BEGIN:VEVENT",
        `UID:cleaning-mon-${mondayISO}-${person}@black-box`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=America/Chicago:${formatDateICS(mondayDate, 8, 0)}`,
        `DTEND;TZID=America/Chicago:${formatDateICS(mondayDate, 8, 15)}`,
        `SUMMARY:${icsEscape(`Cleaning week — ${PERSON_NAMES[person]}`)}`,
        `DESCRIPTION:${icsEscape(`${mondaySummary}\n\nOpen: ${appURL}`)}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Cleaning week starts today",
        "TRIGGER:PT0M",
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n")
    );
  }

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Black Box//Cleaning//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Cleaning — ${PERSON_NAMES[person]}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "BEGIN:VTIMEZONE",
    "TZID:America/Chicago",
    "BEGIN:STANDARD",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0600",
    "TZNAME:CST",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "TZOFFSETFROM:-0600",
    "TZOFFSETTO:-0500",
    "TZNAME:CDT",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Disposition": `inline; filename="cleaning-${person}.ics"`,
    },
  });
}

