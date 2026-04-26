#!/usr/bin/env node
// One-shot migration: pull testimonials + past-entries log from the legacy
// Black Box (Vercel KV) deployment and insert into Apex's SQLite. Safe to
// re-run — skips numbers that already exist.
//
// Usage: node migrate-testimonials.mjs

import {
  addTestimonial,
  addTestimonialLog,
  listTestimonials,
  listTestimonialLogs,
} from "./db.mjs";

const SOURCE = "https://black-box-orpin.vercel.app";

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
  return r.json();
}

async function main() {
  console.log(`Pulling from ${SOURCE}...`);

  // Testimonials
  const t = await fetchJson(`${SOURCE}/api/apex/testimonials`);
  const incoming = (t.testimonials || []).slice().sort((a, b) => a.number - b.number);
  const existing = listTestimonials();
  const existingNumbers = new Set(existing.map((e) => e.number));

  console.log(`  ${incoming.length} testimonials at source, ${existing.length} already in Apex`);

  let added = 0;
  for (const item of incoming) {
    if (existingNumbers.has(item.number)) continue;
    addTestimonial(item.text);
    added++;
  }
  console.log(`  added ${added} new testimonials (numbered ${existing.length + 1}..${existing.length + added})`);

  // Past entries log
  const l = await fetchJson(`${SOURCE}/api/apex/testimonials/logs`);
  const incomingLogs = (l.entries || []).slice().sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const existingLogs = listTestimonialLogs();
  const existingLogIds = new Set(existingLogs.map((e) => e.id));

  console.log(`  ${incomingLogs.length} past entries at source, ${existingLogs.length} already in Apex`);

  let logsAdded = 0;
  for (const entry of incomingLogs) {
    // Use existing id if present, but addTestimonialLog generates its own.
    if (existingLogIds.has(entry.id)) continue;
    addTestimonialLog({ notes: entry.notes, matches: entry.matches });
    logsAdded++;
  }
  console.log(`  added ${logsAdded} new log entries`);

  console.log("done");
}

main().catch((e) => {
  console.error("migration failed:", e);
  process.exit(1);
});
