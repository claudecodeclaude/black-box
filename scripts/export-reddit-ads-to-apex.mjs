#!/usr/bin/env node
// Regenerate the Apex App's Reddit Ads JSON snapshots from the TS source of
// truth. Run after every bi-weekly scan that touches data.ts or keywords.ts.
//
// Usage (from repo root):
//   npx tsx scripts/export-reddit-ads-to-apex.mjs
// or
//   npm run reddit:export-apex
//
// Note: this file is .mjs but uses TS imports — invoke via tsx.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "scripts/apex-app/public/apps/reddit-ads/data");

const { report } = await import(path.join(repoRoot, "app/apex/reddit-ads/data.ts"));
const { baseKeywords, candidates, misspellings, rejected, hitCounts } =
  await import(path.join(repoRoot, "app/apex/reddit-ads/keywords.ts"));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(
  path.join(outDir, "keywords.json"),
  JSON.stringify({ baseKeywords, candidates, misspellings, rejected, hitCounts }, null, 2)
);

console.log(`wrote ${path.join(outDir, "report.json")} (${fs.statSync(path.join(outDir, "report.json")).size}B)`);
console.log(`wrote ${path.join(outDir, "keywords.json")} (${fs.statSync(path.join(outDir, "keywords.json")).size}B)`);
