#!/usr/bin/env node
// Black Box helper server — runs on the Mac Mini via launchd.
// Listens on the Tailscale IP so only tailnet devices can reach it.
//
// Endpoints:
//   POST /run-update       Fire "update reddit ads" into tmux claude session
//   POST /sync-approvals   { approved: [{term, category}], rejected: [term, ...] }
//                          Write to data/keywords-overlay.json for the next scan
//   GET  /health           { ok, tmuxAlive }
//
// Mixed-content note: the Vercel-hosted UI is HTTPS; this server is HTTP on a
// tailnet IP. Browsers block HTTPS→HTTP fetches, so the UI fire-and-forgets
// and falls back to localStorage if the POST is blocked. To enable the real
// auto-sync flow, enable MagicDNS + run `tailscale cert <hostname>` and swap
// this to HTTPS. See CLAUDE.md.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const HOST = process.env.HELPER_HOST || "100.74.13.60";
const PORT = Number(process.env.HELPER_PORT || 7682);
const REPO_DIR = process.env.HELPER_REPO || "/Users/jasonslagel/projects/black-box";
const TMUX_SESSION = process.env.HELPER_TMUX_SESSION || "claude";
const TMUX_BIN = "/opt/homebrew/bin/tmux";
const UPDATE_COMMAND = "update reddit ads";

// ---------- helpers ----------------------------------------------------------

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function send(res, status, body) {
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

async function tmuxAlive() {
  try {
    await exec(TMUX_BIN, ["has-session", "-t", TMUX_SESSION]);
    return true;
  } catch {
    return false;
  }
}

// ---------- handlers ---------------------------------------------------------

async function handleRunUpdate(_req, res) {
  if (!(await tmuxAlive())) {
    return send(res, 503, {
      ok: false,
      error: `tmux session '${TMUX_SESSION}' not running`,
    });
  }
  try {
    await exec(TMUX_BIN, [
      "send-keys",
      "-t",
      TMUX_SESSION,
      UPDATE_COMMAND,
      "Enter",
    ]);
    log("fired update command into tmux");
    return send(res, 200, { ok: true, command: UPDATE_COMMAND });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e) });
  }
}

async function handleSyncApprovals(req, res) {
  const raw = await readBody(req);
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return send(res, 400, { ok: false, error: "invalid JSON" });
  }
  const approved = Array.isArray(payload.approved) ? payload.approved : [];
  const rejected = Array.isArray(payload.rejected) ? payload.rejected : [];

  for (const a of approved) {
    if (typeof a?.term !== "string" || typeof a?.category !== "string") {
      return send(res, 400, {
        ok: false,
        error: "approved items must be {term, category}",
      });
    }
  }
  for (const t of rejected) {
    if (typeof t !== "string") {
      return send(res, 400, { ok: false, error: "rejected must be string[]" });
    }
  }

  const overlay = {
    approved,
    rejected,
    updatedAt: new Date().toISOString(),
  };

  const overlayPath = path.join(REPO_DIR, "data/keywords-overlay.json");
  fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
  fs.writeFileSync(overlayPath, JSON.stringify(overlay, null, 2));

  log(`synced approvals: ${approved.length} approved, ${rejected.length} rejected`);
  return send(res, 200, {
    ok: true,
    approved: approved.length,
    rejected: rejected.length,
  });
}

async function handleHealth(_req, res) {
  const alive = await tmuxAlive();
  return send(res, 200, {
    ok: true,
    tmuxAlive: alive,
    tmuxSession: TMUX_SESSION,
    host: HOST,
    port: PORT,
  });
}

// ---------- server ----------------------------------------------------------

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = req.url || "/";
    if (req.method === "POST" && url === "/run-update") {
      await handleRunUpdate(req, res);
    } else if (req.method === "POST" && url === "/sync-approvals") {
      await handleSyncApprovals(req, res);
    } else if (req.method === "GET" && url === "/health") {
      await handleHealth(req, res);
    } else {
      send(res, 404, { error: "not found" });
    }
  } catch (e) {
    log(`error: ${e}`);
    send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, HOST, () => {
  log(`Black Box helper listening on http://${HOST}:${PORT}`);
});
