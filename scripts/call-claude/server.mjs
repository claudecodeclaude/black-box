#!/usr/bin/env node
// Call Claude — hands-free voice interface to Claude Code.
// Runs on the Mac Mini via launchd; bound to the Tailscale IP.
//
// - GET  /                serves the voice web UI (public/index.html)
// - POST /api/turn        { text } — run one conversation turn, stream back
//                         NDJSON events: {type:"text",value}/{type:"done"}
// - GET  /api/health      { ok, sessionId }
// - POST /api/reset       start a fresh conversation
//
// A single "voice session" is maintained across turns by reusing --session-id
// on first call, then --resume on subsequent calls. Session id is persisted
// to a file so it survives restarts.

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = process.env.CALL_CLAUDE_HOST || "100.74.13.60";
const PORT = Number(process.env.CALL_CLAUDE_PORT || 7683);
const WORK_DIR = process.env.CALL_CLAUDE_WORKDIR || "/Users/jasonslagel/projects/black-box";
const CLAUDE_BIN = process.env.CALL_CLAUDE_BIN || "/Users/jasonslagel/.local/bin/claude";
const STATE_DIR = process.env.CALL_CLAUDE_STATE || "/Users/jasonslagel/.call-claude";
const SESSION_FILE = path.join(STATE_DIR, "session-id");
const CERT_PATH = process.env.CALL_CLAUDE_CERT;
const KEY_PATH = process.env.CALL_CLAUDE_KEY;

const SYSTEM_PROMPT = `You are Claude speaking with Jason hands-free while he drives.
Your responses will be read aloud by text-to-speech, so:
- Keep answers short and conversational (1-3 sentences unless asked for detail).
- No markdown, no code blocks, no bullet lists in your final spoken answer.
- If you're running tools, narrate briefly ("checking the file... done").
- Never dump long file contents. Summarize.
- If Jason asks you to do something destructive, confirm verbally before running it.`;

fs.mkdirSync(STATE_DIR, { recursive: true });

function loadSession() {
  try {
    const id = fs.readFileSync(SESSION_FILE, "utf8").trim();
    if (id) return id;
  } catch {}
  return null;
}
function saveSession(id) {
  fs.writeFileSync(SESSION_FILE, id);
}
function clearSession() {
  try {
    fs.unlinkSync(SESSION_FILE);
  } catch {}
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Run one conversation turn. Streams NDJSON events to res.
//   { type: "text",  value: string }   — accumulated assistant text deltas
//   { type: "tool",  name: string }    — a tool is being used (for narration)
//   { type: "done" }                   — turn complete
//   { type: "error", message: string }
async function runTurn(userText, res) {
  const existingId = loadSession();
  const sessionId = existingId || randomUUID();
  const isNew = !existingId;

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--input-format", "text",
    "--permission-mode", "bypassPermissions",
    "--append-system-prompt", SYSTEM_PROMPT,
  ];
  if (isNew) args.push("--session-id", sessionId);
  else args.push("--resume", sessionId);
  args.push(userText);

  log(`turn (${isNew ? "new" : "resume"} ${sessionId}): ${userText.slice(0, 80)}`);

  const child = spawn(CLAUDE_BIN, args, {
    cwd: WORK_DIR,
    env: { ...process.env, TERM: "dumb" },
  });

  if (isNew) saveSession(sessionId);

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  let buf = "";
  const write = (obj) => res.write(JSON.stringify(obj) + "\n");

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      handleEvent(evt, write);
    }
  });

  child.stderr.on("data", (chunk) => log(`claude stderr: ${chunk.toString().trim()}`));

  child.on("close", (code) => {
    log(`turn closed (exit ${code})`);
    write({ type: "done", exitCode: code });
    res.end();
  });

  child.on("error", (err) => {
    log(`turn spawn error: ${err}`);
    write({ type: "error", message: String(err) });
    res.end();
  });
}

function handleEvent(evt, write) {
  // stream-json format: events with { type, message: { content: [...] } } etc.
  // Emit text deltas and tool-use notifications.
  if (evt.type === "assistant" && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === "text" && block.text) {
        write({ type: "text", value: block.text });
      } else if (block.type === "tool_use" && block.name) {
        write({ type: "tool", name: block.name });
      }
    }
  } else if (evt.type === "result" && evt.result) {
    // Final consolidated result — useful as a fallback
    write({ type: "final", value: evt.result });
  }
}

// ---------- handlers ----------

async function handleTurn(req, res) {
  const raw = await readBody(req);
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { return sendJson(res, 400, { error: "invalid JSON" }); }
  const text = (payload.text || "").trim();
  if (!text) return sendJson(res, 400, { error: "missing text" });
  await runTurn(text, res);
}

function handleReset(_req, res) {
  clearSession();
  sendJson(res, 200, { ok: true });
}

function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    sessionId: loadSession(),
    host: HOST,
    port: PORT,
  });
}

function serveStatic(req, res) {
  const url = req.url || "/";
  const cleaned = url.split("?")[0];
  const filePath = cleaned === "/" ? "/index.html" : cleaned;
  const full = path.join(__dirname, "public", filePath);
  if (!full.startsWith(path.join(__dirname, "public"))) {
    return sendJson(res, 403, { error: "forbidden" });
  }
  fs.readFile(full, (err, data) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    const ext = path.extname(full).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const handler = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  try {
    const url = (req.url || "/").split("?")[0];
    if (req.method === "POST" && url === "/api/turn") return handleTurn(req, res);
    if (req.method === "POST" && url === "/api/reset") return handleReset(req, res);
    if (req.method === "GET"  && url === "/api/health") return handleHealth(req, res);
    if (req.method === "GET") return serveStatic(req, res);
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
  log(`Call Claude listening on ${useHttps ? "https" : "http"}://${HOST}:${PORT}`);
});
