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
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execSync } from "node:child_process";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build version stamp for the auto-reload mechanism. Best-effort git SHA
// from the repo root; if git isn't usable, fall back to the boot timestamp
// (so a service restart still bumps the version).
const SERVER_VERSION = (() => {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: path.join(__dirname, "..", ".."),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return `boot-${Date.now()}`;
  }
})();

const HOST = process.env.CALL_CLAUDE_HOST || "100.74.13.60";
const PORT = Number(process.env.CALL_CLAUDE_PORT || 7683);
const WORK_DIR = process.env.CALL_CLAUDE_WORKDIR || "/Users/jasonslagel/projects/black-box";
const CLAUDE_BIN = process.env.CALL_CLAUDE_BIN || "/Users/jasonslagel/.local/bin/claude";
const STATE_DIR = process.env.CALL_CLAUDE_STATE || "/Users/jasonslagel/.call-claude";
const SESSION_FILE = path.join(STATE_DIR, "session-id");
const CERT_PATH = process.env.CALL_CLAUDE_CERT;
const KEY_PATH = process.env.CALL_CLAUDE_KEY;
const WHISPER_BIN = process.env.CALL_CLAUDE_WHISPER || "/opt/homebrew/bin/whisper-cli";
const WHISPER_MODEL = process.env.CALL_CLAUDE_WHISPER_MODEL || path.join(STATE_DIR, "models/ggml-small.en.bin");
const FFMPEG_BIN = process.env.CALL_CLAUDE_FFMPEG || "/opt/homebrew/bin/ffmpeg";
const SAY_BIN = process.env.CALL_CLAUDE_SAY || "/usr/bin/say";
const SAY_VOICE = process.env.CALL_CLAUDE_VOICE || "Samantha";
// Piper (neural TTS). When both binary and model exist, Piper replaces `say`.
const PIPER_BIN = process.env.CALL_CLAUDE_PIPER || "/Users/jasonslagel/.call-claude/piper-venv/bin/piper";
const PIPER_MODEL = process.env.CALL_CLAUDE_PIPER_MODEL || "/Users/jasonslagel/.call-claude/piper-voices/en_US-ryan-high.onnx";
const PIPER_AVAILABLE = fs.existsSync(PIPER_BIN) && fs.existsSync(PIPER_MODEL);
// Voice-print verification — Resemblyzer in a Python venv.
const VOICE_ID_PYTHON = process.env.CALL_CLAUDE_VOICE_PYTHON || "/Users/jasonslagel/.call-claude/voice-id-venv/bin/python";
const VOICE_ID_SCRIPT = process.env.CALL_CLAUDE_VOICE_SCRIPT || path.join(__dirname, "voice_id.py");
const VOICE_ID_REF = path.join(STATE_DIR, "voice-id", "reference.npy");
const VOICE_ID_AVAILABLE = fs.existsSync(VOICE_ID_PYTHON) && fs.existsSync(VOICE_ID_SCRIPT);

const SYSTEM_PROMPT = `You are Claude speaking with Jason hands-free while he drives. Your responses will be read aloud by text-to-speech.

Speak the way you'd talk to a friend explaining something: full natural sentences that flow into each other, contractions where they fit, no dashes or colons or bullet points or numbered lists in your final spoken answer. Avoid sentence fragments. Don't list things — describe them in flowing prose. Keep answers short (one to three sentences usually), but when more detail is needed, write it as a smooth conversational paragraph rather than chopped-up bullets.

When you're running tools, give a quick natural narration like "let me check that file" or "okay, fixing that now" — same conversational tone. Never dump file contents; summarize them in plain language. If Jason asks you to do anything destructive, confirm verbally before running it.

Open every response with a brief acknowledgment ("on it", "got it", "checking") so Jason knows you heard him before any substance follows.`;

fs.mkdirSync(STATE_DIR, { recursive: true });

function loadSession() {
  try {
    const stat = fs.statSync(SESSION_FILE);
    const today = new Date().toDateString();
    if (stat.mtime.toDateString() !== today) {
      const oldId = fs.readFileSync(SESSION_FILE, "utf8").trim();
      log(`session expired (last touched ${stat.mtime.toISOString()}); consolidating memory + starting fresh`);
      consolidateMemoriesAsync(oldId);
      clearSession();
      return null;
    }
    const id = fs.readFileSync(SESSION_FILE, "utf8").trim();
    if (id) return id;
  } catch {}
  return null;
}

// Fire-and-forget: spawn a one-off claude run on the expiring session and
// ask it to write anything memorable from the day's conversation into the
// auto-memory system before we abandon the session id. Memory files land in
// ~/.claude/projects/<encoded>/memory/, so the next-day Call Claude session
// AND any terminal Claude Code session in this project pick them up.
function consolidateMemoriesAsync(oldSessionId) {
  if (!oldSessionId) return;
  const prompt = `This Call Claude voice session is being auto-reset for cost reasons (a new calendar day started). Before it ends, look back over today's conversation and use your auto-memory system to save anything future sessions should remember — new user details, project status changes, decisions made, feedback Jason gave you, external references. Be selective per the auto-memory guidelines: skip ephemeral task details and anything derivable from the repo or already in MEMORY.md. Quality over quantity. When done, exit silently.`;
  const args = [
    "-p",
    "--resume", oldSessionId,
    "--permission-mode", "bypassPermissions",
    prompt,
  ];
  log(`spawning memory consolidation for ${oldSessionId}`);
  const child = spawn(CLAUDE_BIN, args, {
    cwd: WORK_DIR,
    env: { ...process.env, TERM: "dumb" },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
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

function readRawBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleTranscribe(req, res) {
  if (!fs.existsSync(WHISPER_MODEL)) {
    return sendJson(res, 500, { error: `whisper model missing at ${WHISPER_MODEL}` });
  }
  let audio;
  try { audio = await readRawBody(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  if (!audio.length) return sendJson(res, 400, { error: "empty body" });

  const id = randomUUID();
  const tmpDir = os.tmpdir();
  const inputExt = (req.headers["content-type"] || "").includes("webm") ? "webm" : "m4a";
  const inputPath = path.join(tmpDir, `call-claude-${id}.${inputExt}`);
  const wavPath = path.join(tmpDir, `call-claude-${id}.wav`);
  fs.writeFileSync(inputPath, audio);

  const cleanup = () => {
    for (const p of [inputPath, wavPath]) { try { fs.unlinkSync(p); } catch {} }
  };

  try {
    // Convert to 16 kHz mono WAV that whisper.cpp expects
    await execFileAsync(FFMPEG_BIN, [
      "-y", "-i", inputPath,
      "-ar", "16000", "-ac", "1", "-f", "wav",
      wavPath,
    ]);

    const t0 = Date.now();
    const { stdout } = await execFileAsync(WHISPER_BIN, [
      "-m", WHISPER_MODEL,
      "-f", wavPath,
      "-nt",           // no timestamps
      "-otxt", "-of", path.join(tmpDir, `call-claude-${id}`),
      "-l", "en",
      "--no-prints",
    ]);
    let text = "";
    const txtPath = path.join(tmpDir, `call-claude-${id}.txt`);
    if (fs.existsSync(txtPath)) {
      text = fs.readFileSync(txtPath, "utf8").trim();
      try { fs.unlinkSync(txtPath); } catch {}
    } else {
      text = stdout.trim();
    }
    const ms = Date.now() - t0;

    // Voice-print verification (only if a reference embedding has been
    // enrolled). Pass-through everything when not configured / no reference.
    let isJason = true;
    let similarity = null;
    if (VOICE_ID_AVAILABLE && fs.existsSync(VOICE_ID_REF)) {
      try {
        const { stdout: vidOut } = await execFileAsync(
          VOICE_ID_PYTHON,
          [VOICE_ID_SCRIPT, "verify", wavPath],
          { maxBuffer: 4 * 1024 * 1024 }
        );
        const j = JSON.parse(vidOut.trim());
        isJason = !!j.isJason;
        similarity = typeof j.similarity === "number" ? j.similarity : null;
      } catch (e) {
        log(`voice-id verify failed: ${e.message || e}`);
      }
    }

    log(`transcribed ${audio.length}B in ${ms}ms (jason=${isJason}, sim=${similarity?.toFixed(3) ?? "n/a"}): ${text.slice(0, 80)}`);
    sendJson(res, 200, { text, ms, isJason, similarity });
  } catch (e) {
    log(`transcribe error: ${e.message || e}`);
    sendJson(res, 500, { error: String(e.message || e) });
  } finally {
    cleanup();
  }
}

async function handleVoiceEnroll(req, res) {
  if (!VOICE_ID_AVAILABLE) {
    return sendJson(res, 500, { error: "voice-id not installed" });
  }
  let audio;
  try { audio = await readRawBody(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  if (!audio.length) return sendJson(res, 400, { error: "empty body" });

  const id = randomUUID();
  const tmpDir = os.tmpdir();
  const inputExt = (req.headers["content-type"] || "").includes("webm") ? "webm" : "m4a";
  const inputPath = path.join(tmpDir, `voice-enroll-${id}.${inputExt}`);
  const wavPath = path.join(tmpDir, `voice-enroll-${id}.wav`);
  fs.writeFileSync(inputPath, audio);
  const cleanup = () => {
    for (const p of [inputPath, wavPath]) { try { fs.unlinkSync(p); } catch {} }
  };
  try {
    await execFileAsync(FFMPEG_BIN, [
      "-y", "-i", inputPath,
      "-ar", "16000", "-ac", "1", "-f", "wav",
      wavPath,
    ]);
    const { stdout } = await execFileAsync(
      VOICE_ID_PYTHON,
      [VOICE_ID_SCRIPT, "enroll", wavPath],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    const j = JSON.parse(stdout.trim());
    if (!j.ok) return sendJson(res, 400, { error: j.error || "enroll failed" });
    log(`voice-id enrolled (audio=${audio.length}B)`);
    sendJson(res, 200, { ok: true, dim: j.embedding_dim });
  } catch (e) {
    log(`voice-id enroll error: ${e.message || e}`);
    sendJson(res, 500, { error: String(e.message || e) });
  } finally {
    cleanup();
  }
}

function handleVoiceStatus(_req, res) {
  sendJson(res, 200, {
    available: VOICE_ID_AVAILABLE,
    enrolled: fs.existsSync(VOICE_ID_REF),
  });
}

function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    sessionId: loadSession(),
    host: HOST,
    port: PORT,
  });
}

async function handleSpeak(req, res) {
  const raw = await readBody(req);
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { return sendJson(res, 400, { error: "invalid JSON" }); }
  const text = (payload.text || "").trim().slice(0, 5000);
  if (!text) return sendJson(res, 400, { error: "no text" });
  // Allow client to pick a voice per-call. Whitelist to safe characters so
  // nothing shell-y slips into the `say -v` argument.
  let voice = SAY_VOICE;
  if (typeof payload.voice === "string" && /^[A-Za-z0-9 ()_-]{1,40}$/.test(payload.voice)) {
    voice = payload.voice;
  }
  // Optional speaking rate in words-per-minute. macOS say default is ~175.
  let rate = null;
  if (typeof payload.rate === "number" && payload.rate >= 80 && payload.rate <= 300) {
    rate = Math.round(payload.rate);
  }

  const id = randomUUID();
  const tmpDir = os.tmpdir();
  const rawPath = path.join(tmpDir, `call-claude-tts-${id}.${PIPER_AVAILABLE ? "wav" : "aiff"}`);
  const m4a = path.join(tmpDir, `call-claude-tts-${id}.m4a`);
  const cleanup = () => {
    for (const p of [rawPath, m4a]) { try { fs.unlinkSync(p); } catch {} }
  };

  try {
    const t0 = Date.now();
    if (PIPER_AVAILABLE) {
      // Piper's length_scale controls speed: 1.0 default, higher = slower.
      // Translate our wpm rate (macOS `say` default ~175) to length_scale.
      const lengthScale = rate ? Math.max(0.7, Math.min(1.5, 175 / rate)) : 1.0;
      await new Promise((resolve, reject) => {
        const proc = spawn(PIPER_BIN, [
          "--model", PIPER_MODEL,
          "--output_file", rawPath,
          "--length-scale", String(lengthScale),
        ]);
        let stderr = "";
        proc.stderr.on("data", (d) => stderr += d.toString());
        proc.on("error", reject);
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`piper exit ${code}: ${stderr.slice(-400)}`));
        });
        proc.stdin.write(text);
        proc.stdin.end();
      });
    } else {
      const sayArgs = ["-v", voice];
      if (rate) sayArgs.push("-r", String(rate));
      sayArgs.push("-o", rawPath, "--", text);
      await execFileAsync(SAY_BIN, sayArgs);
    }
    await execFileAsync(FFMPEG_BIN, [
      "-y", "-i", rawPath,
      "-c:a", "aac", "-b:a", "96k",
      m4a,
    ]);
    const audio = fs.readFileSync(m4a);
    log(`tts (${PIPER_AVAILABLE ? "piper" : "say"}) ${text.length}ch → ${audio.length}B in ${Date.now() - t0}ms`);
    res.writeHead(200, {
      "Content-Type": "audio/mp4",
      "Content-Length": audio.length,
      "Cache-Control": "no-store",
    });
    res.end(audio);
  } catch (e) {
    log(`speak error: ${e.message || e}`);
    sendJson(res, 500, { error: String(e.message || e) });
  } finally {
    cleanup();
  }
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
    let body = data;
    if (ext === ".html") {
      const html = data.toString("utf8");
      const stamp = `<script>window.__BUILD_VERSION=${JSON.stringify(SERVER_VERSION)};</script>`;
      const injected = html.includes("</head>")
        ? html.replace("</head>", `${stamp}</head>`)
        : stamp + html;
      body = Buffer.from(injected, "utf8");
    }
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  });
}

const handler = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  try {
    const url = (req.url || "/").split("?")[0];
    if (req.method === "POST" && url === "/api/turn") return handleTurn(req, res);
    if (req.method === "POST" && url === "/api/reset") return handleReset(req, res);
    if (req.method === "POST" && url === "/api/transcribe") return handleTranscribe(req, res);
    if (req.method === "POST" && url === "/api/speak") return handleSpeak(req, res);
    if (req.method === "POST" && url === "/api/voice-enroll") return handleVoiceEnroll(req, res);
    if (req.method === "GET"  && url === "/api/voice-status") return handleVoiceStatus(req, res);
    if (req.method === "GET"  && url === "/api/health") return handleHealth(req, res);
    if (req.method === "GET"  && url === "/api/version") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      });
      res.end(JSON.stringify({ version: SERVER_VERSION }));
      return;
    }
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
