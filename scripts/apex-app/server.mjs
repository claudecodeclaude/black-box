#!/usr/bin/env node
// Apex app — staff hub for Jason's chiropractic office.
// HIPAA-compliant: runs only on the Mac Mini, exposed only over Tailscale.
//
// This is the scaffold. Auth, MFA, DB, and RBAC come in follow-up passes.
//
// - GET  /                serves the login page (public/index.html)
// - GET  /api/health      { ok, phase }

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = process.env.APEX_HOST || "100.74.13.60";
const PORT = Number(process.env.APEX_PORT || 7686);
const CERT_PATH = process.env.APEX_CERT;
const KEY_PATH = process.env.APEX_KEY;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const url = (req.url || "/").split("?")[0];
  const filePath = url === "/" ? "/index.html" : url;
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
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
      // HIPAA-adjacent hardening — not a substitute for the real work still
      // to do (auth, audit log, encrypted DB), but cheap to set now.
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    res.end(data);
  });
}

const handler = async (req, res) => {
  try {
    const url = (req.url || "/").split("?")[0];
    if (req.method === "GET" && url === "/api/health") {
      return sendJson(res, 200, { ok: true, phase: "scaffold", host: HOST, port: PORT });
    }
    if (req.method === "GET") return serveStatic(req, res);
    sendJson(res, 405, { error: "method not allowed" });
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
  log(`Apex listening on ${useHttps ? "https" : "http"}://${HOST}:${PORT}`);
});
