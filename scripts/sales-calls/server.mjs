#!/usr/bin/env node
// Sales Calls — Mac Mini helper.
// Runs on the Mac Mini via launchd, bound to the Tailscale IP.
//
// iPhone Shortcut posts a call transcript (and optional audio) to /api/ingest.
// A second Shortcut posts Jason's post-call thoughts audio to /api/thoughts/:id;
// the server transcribes locally with whisper.cpp and appends to the record.
// Apex App page reads records via /api/records and /api/records/:id and pushes
// completed records into NPE via /api/records/:id/push-to-npe (stubbed for now).
//
// Each record lives in a folder at data/sales-calls/<id>/ with:
//   meta.json       { id, doctorName, createdAt, status, ... }
//   transcript.txt  Apple's auto-generated transcript
//   audio.<ext>     optional original audio
//   extracted.json  written by Claude Code "process sales calls" runbook
//   thoughts.txt    Jason's post-call thoughts (transcribed locally)
//
// Endpoints:
//   GET  /api/health
//   POST /api/ingest                       (bearer)  → { id }
//   POST /api/thoughts/:id                 (bearer)  transcribes + appends
//   GET  /api/records                      list
//   GET  /api/records/:id                  full record
//   POST /api/records/:id/extracted        save extraction JSON (bearer; Claude Code writes this)
//   POST /api/records/:id/push-to-npe      → NPE endpoint (stubbed 501 until built)

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

const HOST = process.env.SC_HOST || "100.74.13.60";
const PORT = Number(process.env.SC_PORT || 7687);
const CERT_PATH = process.env.SC_CERT;
const KEY_PATH = process.env.SC_KEY;
const WORK_DIR = process.env.SC_WORKDIR || "/Users/jasonslagel/projects/black-box";
const DATA_DIR = process.env.SC_DATA_DIR || path.join(WORK_DIR, "data", "sales-calls");
const TOKEN = process.env.SC_TOKEN || ""; // required for write endpoints

const FFMPEG_BIN = process.env.SC_FFMPEG || "/opt/homebrew/bin/ffmpeg";
const WHISPER_BIN = process.env.SC_WHISPER || "/opt/homebrew/bin/whisper-cli";
const WHISPER_MODEL =
  process.env.SC_WHISPER_MODEL ||
  "/Users/jasonslagel/.call-claude/models/ggml-small.en.bin";

const ALLOWED_ORIGINS = new Set([
  "https://black-box-orpin.vercel.app",
  "https://jasons-mac-mini-1.taile58089.ts.net:7686",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (
    ALLOWED_ORIGINS.has(origin) ||
    origin.endsWith(".vercel.app") ||
    origin.endsWith(".ts.net") ||
    origin.endsWith(".ts.net:7686")
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function authed(req) {
  if (!TOKEN) return true; // dev mode; no token set means no auth
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return false;
  return h.slice(7).trim() === TOKEN;
}

function readBodyJson(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error(`bad json: ${e.message || e}`));
      }
    });
    req.on("error", reject);
  });
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function recordDir(id) {
  return path.join(DATA_DIR, id);
}

function safeId(input) {
  // 26-char id: YYYYMMDD-<random>; never trust client ids
  const d = new Date();
  const day =
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
      d.getDate()
    ).padStart(2, "0")}`;
  return `${day}-${randomUUID().slice(0, 8)}`;
}

function slugifyDoctor(name) {
  return String(name || "")
    .trim()
    .replace(/[^A-Za-z0-9 \-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(recordDir(id), "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

function writeMeta(id, meta) {
  fs.writeFileSync(
    path.join(recordDir(id), "meta.json"),
    JSON.stringify(meta, null, 2)
  );
}

// --- handlers ---------------------------------------------------------------

function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    host: HOST,
    port: PORT,
    dataDir: DATA_DIR,
    tokenConfigured: Boolean(TOKEN),
  });
}

async function handleIngest(req, res) {
  if (!authed(req)) return sendJson(res, 401, { error: "unauthorized" });
  let payload;
  try {
    payload = await readBodyJson(req);
  } catch (e) {
    return sendJson(res, 400, { error: String(e.message || e) });
  }

  const doctorName = String(payload.doctorName || "").trim();
  const transcript = String(payload.transcript || "").trim();
  if (!doctorName) return sendJson(res, 400, { error: "doctorName required" });
  if (!transcript) return sendJson(res, 400, { error: "transcript required" });

  ensureDataDir();
  const id = safeId();
  const dir = recordDir(id);
  fs.mkdirSync(dir, { recursive: true });

  // Pin doctor name at the very top of the transcript so context never gets
  // unmoored. Apple's transcript follows.
  const header = `Doctor: ${doctorName}\n---\n\n`;
  fs.writeFileSync(path.join(dir, "transcript.txt"), header + transcript);

  let audioStored = false;
  if (payload.audioBase64) {
    try {
      const buf = Buffer.from(payload.audioBase64, "base64");
      const mime = String(payload.audioMimeType || "").toLowerCase();
      const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a"
        : mime.includes("wav") ? "wav"
        : mime.includes("mpeg") || mime.includes("mp3") ? "mp3"
        : "bin";
      fs.writeFileSync(path.join(dir, `audio.${ext}`), buf);
      audioStored = true;
    } catch (e) {
      log(`ingest: dropping bad audio for ${id}: ${e.message || e}`);
    }
  }

  const meta = {
    id,
    doctorName,
    doctorSlug: slugifyDoctor(doctorName),
    createdAt: new Date().toISOString(),
    status: "pending", // pending → extracted → pushed
    hasAudio: audioStored,
    hasThoughts: false,
  };
  writeMeta(id, meta);

  log(`ingest: ${id} doctor="${doctorName}" transcript=${transcript.length}ch audio=${audioStored}`);
  sendJson(res, 200, { id, status: "pending" });
}

async function transcribeAudio(audioPath, outDir) {
  if (!fs.existsSync(WHISPER_BIN)) {
    throw new Error(`whisper missing at ${WHISPER_BIN}`);
  }
  if (!fs.existsSync(WHISPER_MODEL)) {
    throw new Error(`whisper model missing at ${WHISPER_MODEL}`);
  }
  const id = randomUUID().slice(0, 8);
  const wavPath = path.join(os.tmpdir(), `sc-${id}.wav`);
  const txtBase = path.join(os.tmpdir(), `sc-${id}`);
  const txtPath = `${txtBase}.txt`;
  try {
    await execFileAsync(FFMPEG_BIN, [
      "-y", "-i", audioPath,
      "-ar", "16000", "-ac", "1", "-f", "wav",
      wavPath,
    ]);
    await execFileAsync(
      WHISPER_BIN,
      [
        "-m", WHISPER_MODEL,
        "-f", wavPath,
        "-nt",
        "-otxt", "-of", txtBase,
        "-l", "en",
        "--no-prints",
      ],
      { maxBuffer: 50 * 1024 * 1024 }
    );
    let text = "";
    if (fs.existsSync(txtPath)) text = fs.readFileSync(txtPath, "utf8").trim();
    return text;
  } finally {
    try { fs.unlinkSync(wavPath); } catch {}
    try { fs.unlinkSync(txtPath); } catch {}
  }
}

async function handleThoughts(req, res, id) {
  if (!authed(req)) return sendJson(res, 401, { error: "unauthorized" });
  const meta = readMeta(id);
  if (!meta) return sendJson(res, 404, { error: "record not found" });

  let payload;
  try {
    payload = await readBodyJson(req);
  } catch (e) {
    return sendJson(res, 400, { error: String(e.message || e) });
  }
  if (!payload.audioBase64) return sendJson(res, 400, { error: "audioBase64 required" });

  ensureDataDir();
  const dir = recordDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const buf = Buffer.from(payload.audioBase64, "base64");
  const mime = String(payload.audioMimeType || "").toLowerCase();
  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a"
    : mime.includes("wav") ? "wav"
    : "m4a";
  const audioPath = path.join(dir, `thoughts-audio.${ext}`);
  fs.writeFileSync(audioPath, buf);

  let text = "";
  try {
    text = await transcribeAudio(audioPath, dir);
  } catch (e) {
    log(`thoughts transcribe error ${id}: ${e.message || e}`);
    return sendJson(res, 500, { error: `transcribe failed: ${e.message || e}` });
  }

  const stamp = new Date().toISOString();
  const existing = fs.existsSync(path.join(dir, "thoughts.txt"))
    ? fs.readFileSync(path.join(dir, "thoughts.txt"), "utf8")
    : "";
  const block = `--- ${stamp} ---\n${text}\n\n`;
  fs.writeFileSync(path.join(dir, "thoughts.txt"), existing + block);

  meta.hasThoughts = true;
  meta.lastThoughtAt = stamp;
  writeMeta(id, meta);

  log(`thoughts: ${id} appended ${text.length}ch`);
  sendJson(res, 200, { ok: true, text });
}

function listRecords() {
  ensureDataDir();
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  const records = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const meta = readMeta(e.name);
    if (meta) records.push(meta);
  }
  records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return records;
}

function handleRecordsList(_req, res) {
  try {
    sendJson(res, 200, { records: listRecords() });
  } catch (e) {
    sendJson(res, 500, { error: String(e.message || e) });
  }
}

function handleRecordGet(_req, res, id) {
  const meta = readMeta(id);
  if (!meta) return sendJson(res, 404, { error: "not found" });
  const dir = recordDir(id);
  const transcript = fs.existsSync(path.join(dir, "transcript.txt"))
    ? fs.readFileSync(path.join(dir, "transcript.txt"), "utf8")
    : "";
  const extracted = fs.existsSync(path.join(dir, "extracted.json"))
    ? JSON.parse(fs.readFileSync(path.join(dir, "extracted.json"), "utf8"))
    : null;
  const thoughts = fs.existsSync(path.join(dir, "thoughts.txt"))
    ? fs.readFileSync(path.join(dir, "thoughts.txt"), "utf8")
    : "";
  sendJson(res, 200, { meta, transcript, extracted, thoughts });
}

async function handleSetExtracted(req, res, id) {
  if (!authed(req)) return sendJson(res, 401, { error: "unauthorized" });
  const meta = readMeta(id);
  if (!meta) return sendJson(res, 404, { error: "not found" });
  let payload;
  try {
    payload = await readBodyJson(req);
  } catch (e) {
    return sendJson(res, 400, { error: String(e.message || e) });
  }
  const extracted = payload.extracted;
  if (!extracted || typeof extracted !== "object") {
    return sendJson(res, 400, { error: "extracted object required" });
  }
  fs.writeFileSync(
    path.join(recordDir(id), "extracted.json"),
    JSON.stringify(extracted, null, 2)
  );
  meta.status = "extracted";
  meta.extractedAt = new Date().toISOString();
  writeMeta(id, meta);
  log(`extracted saved: ${id}`);
  sendJson(res, 200, { ok: true });
}

async function handlePushToNpe(req, res, id) {
  if (!authed(req)) return sendJson(res, 401, { error: "unauthorized" });
  const meta = readMeta(id);
  if (!meta) return sendJson(res, 404, { error: "not found" });
  if (meta.status !== "extracted") {
    return sendJson(res, 400, { error: "record not extracted yet" });
  }
  // TODO: implement when NPE endpoint exists. For now return 501 with details.
  sendJson(res, 501, {
    error: "NPE push not implemented yet",
    detail: "Build the NPE-side endpoint, then wire this up to POST the extracted JSON to it.",
  });
}

// --- routing ---------------------------------------------------------------

const handler = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  try {
    const url = (req.url || "/").split("?")[0];
    if (req.method === "GET" && url === "/api/health") return handleHealth(req, res);
    if (req.method === "POST" && url === "/api/ingest") return handleIngest(req, res);
    if (req.method === "GET" && url === "/api/records") return handleRecordsList(req, res);

    {
      const m = url.match(/^\/api\/records\/([A-Za-z0-9\-]+)$/);
      if (m && req.method === "GET") return handleRecordGet(req, res, m[1]);
    }
    {
      const m = url.match(/^\/api\/records\/([A-Za-z0-9\-]+)\/extracted$/);
      if (m && req.method === "POST") return handleSetExtracted(req, res, m[1]);
    }
    {
      const m = url.match(/^\/api\/records\/([A-Za-z0-9\-]+)\/push-to-npe$/);
      if (m && req.method === "POST") return handlePushToNpe(req, res, m[1]);
    }
    {
      const m = url.match(/^\/api\/thoughts\/([A-Za-z0-9\-]+)$/);
      if (m && req.method === "POST") return handleThoughts(req, res, m[1]);
    }

    sendJson(res, 404, { error: "not found" });
  } catch (e) {
    log(`handler error: ${e}`);
    sendJson(res, 500, { error: String(e.message || e) });
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
  log(`Sales Calls listening on ${useHttps ? "https" : "http"}://${HOST}:${PORT}`);
  log(`data dir: ${DATA_DIR}`);
  if (!TOKEN) log(`WARNING: SC_TOKEN not set — write endpoints are unauthenticated`);
});
