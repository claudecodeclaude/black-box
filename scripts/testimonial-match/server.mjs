#!/usr/bin/env node
// Testimonial Matcher — Mac Mini helper.
// Runs on the Mac Mini via launchd, bound to the Tailscale IP.
//
// - GET  /api/health      { ok }
// - POST /api/match       { notes, testimonials: [{number, text}] }
//                         → { matches: [{ number, reason } × 4] }
//
// Spawns `claude -p` per request; each match is one-shot, no session state.

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HOST = process.env.TM_HOST || "100.74.13.60";
const PORT = Number(process.env.TM_PORT || 7685);
const CLAUDE_BIN = process.env.TM_CLAUDE || "/Users/jasonslagel/.local/bin/claude";
const WORK_DIR = process.env.TM_WORKDIR || "/Users/jasonslagel/projects/black-box";
const CERT_PATH = process.env.TM_CERT;
const KEY_PATH = process.env.TM_KEY;

// Allow the Black Box Vercel deploy + any localhost origin to hit this.
const ALLOWED_ORIGINS = new Set([
  "https://black-box-orpin.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin) || origin.endsWith(".vercel.app")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.setEncoding("utf8");
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(chunks.join("")));
    req.on("error", reject);
  });
}

function buildPrompt(notes, testimonials) {
  const list = testimonials
    .map((t) => `#${t.number}:\n${String(t.text).trim()}`)
    .join("\n\n---\n\n");

  return `You are helping a chiropractor match a new patient to prior patient testimonials that will resonate with them emotionally and strategically, so the new patient is more likely to commit to care.

Here are the existing testimonials. Each has a unique number:

${list}

Here are the phone consult notes for the new patient:

${notes}

Pick the 4 testimonials most likely to resonate with this patient — weighing similar conditions, similar life circumstances, similar emotional tone, and similar concerns the patient expressed.

Output ONLY a single JSON object. No markdown, no code fences, no explanation outside the JSON. The exact shape:

{"matches": [{"number": <int>, "reason": "<one short sentence, under 20 words>"}, {"number": <int>, "reason": "..."}, {"number": <int>, "reason": "..."}, {"number": <int>, "reason": "..."}]}

Exactly 4 items. Order them from most to least relevant. "reason" is a short human-readable explanation of why that testimonial fits this patient.`;
}

function extractJson(s) {
  // Be tolerant: find the first { ... last } block, ignoring code fences.
  const cleaned = s.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function handleMatch(req, res) {
  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    return sendJson(res, 400, { error: `bad json: ${e.message || e}` });
  }

  const notes = String(payload.notes || "").trim();
  const testimonials = Array.isArray(payload.testimonials) ? payload.testimonials : [];
  if (!notes) return sendJson(res, 400, { error: "notes required" });
  if (testimonials.length < 4) {
    return sendJson(res, 400, { error: "need at least 4 testimonials" });
  }

  const prompt = buildPrompt(notes, testimonials);
  log(`match request: ${testimonials.length} testimonials, ${notes.length}ch notes`);

  try {
    const t0 = Date.now();
    const { stdout } = await execFileAsync(
      CLAUDE_BIN,
      [
        "-p",
        "--output-format", "json",
        "--permission-mode", "bypassPermissions",
        prompt,
      ],
      {
        cwd: WORK_DIR,
        env: { ...process.env, TERM: "dumb" },
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    const ms = Date.now() - t0;

    let wrapper;
    try {
      wrapper = JSON.parse(stdout);
    } catch (e) {
      log(`claude output not JSON: ${stdout.slice(0, 200)}`);
      return sendJson(res, 500, { error: "claude output not JSON" });
    }
    const text = wrapper.result || wrapper.content || "";
    const parsed = extractJson(typeof text === "string" ? text : JSON.stringify(text));
    if (!parsed || !Array.isArray(parsed.matches)) {
      log(`match payload malformed: ${String(text).slice(0, 200)}`);
      return sendJson(res, 500, { error: "matcher returned unexpected shape" });
    }

    const validNumbers = new Set(testimonials.map((t) => Number(t.number)));
    const matches = parsed.matches
      .map((m) => ({ number: Number(m.number), reason: String(m.reason || "").trim() }))
      .filter((m) => validNumbers.has(m.number))
      .slice(0, 4);

    if (matches.length < 4) {
      log(`only ${matches.length} valid matches returned`);
    }

    log(`match done in ${ms}ms: [${matches.map((m) => m.number).join(", ")}]`);
    sendJson(res, 200, { matches });
  } catch (e) {
    log(`match error: ${e.message || e}`);
    sendJson(res, 500, { error: String(e.message || e) });
  }
}

function handleHealth(_req, res) {
  sendJson(res, 200, { ok: true, host: HOST, port: PORT });
}

const handler = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  try {
    const url = (req.url || "/").split("?")[0];
    if (req.method === "POST" && url === "/api/match") return handleMatch(req, res);
    if (req.method === "GET"  && url === "/api/health") return handleHealth(req, res);
    sendJson(res, 404, { error: "not found" });
  } catch (e) {
    log(`handler error: ${e}`);
    sendJson(res, 500, { error: String(e) });
  }
};

const useHttps = CERT_PATH && KEY_PATH && fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);

const server = useHttps
  ? https.createServer(
      { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) },
      handler
    )
  : http.createServer(handler);

server.listen(PORT, HOST, () => {
  log(`Testimonial Matcher listening on ${useHttps ? "https" : "http"}://${HOST}:${PORT}`);
});
