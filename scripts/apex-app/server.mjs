#!/usr/bin/env node
// Apex App — staff hub for Jason's chiropractic office.
// HIPAA-compliant: runs only on the Mac Mini, exposed only over Tailscale.
//
// - GET  /                serves the login / dashboard shell (public/index.html)
// - GET  /api/health      { ok, phase }
// - GET  /api/me          current user if a valid session cookie exists
// - POST /api/login       { username, password, mfa } → session cookie
// - POST /api/logout      clears session

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSession,
  deleteSession,
  findSession,
  findUserById,
  findUserByName,
  logAudit,
  markLogin,
  sweepExpiredSessions,
} from "./db.mjs";
import {
  clearSessionCookie,
  newSessionId,
  parseCookies,
  sessionCookie,
  verifyPassword,
  verifyTotp,
} from "./auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = process.env.APEX_HOST || "100.74.13.60";
const PORT = Number(process.env.APEX_PORT || 7686);
const CERT_PATH = process.env.APEX_CERT;
const KEY_PATH = process.env.APEX_KEY;

// HIPAA-reasonable session lifetime. TODO: add a shorter idle timeout too.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

function readJson(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error(`bad json: ${e.message}`));
      }
    });
    req.on("error", reject);
  });
}

function getCurrentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.apex_session;
  if (!sid) return null;
  const session = findSession(sid);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    deleteSession(sid);
    return null;
  }
  const user = findUserById(session.user_id);
  if (!user) {
    deleteSession(sid);
    return null;
  }
  return { ...user, sessionId: sid };
}

// --- Handlers ---------------------------------------------------------------

async function handleLogin(req, res) {
  let body;
  try { body = await readJson(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }

  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const mfa = String(body.mfa || "").trim();
  const ip = clientIp(req);
  const userAgent = req.headers["user-agent"] || null;

  // Always perform the full bcrypt compare even if the user doesn't exist, so
  // wrong-username and wrong-password take the same time (no username probing).
  const user = findUserByName(username);
  const validPassword = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, "$2a$12$invalidhashinvalidhashinvalidhashinvalidhashinvalid");

  if (!user || !validPassword) {
    logAudit({ action: "login.failed", details: { username, reason: "bad_credentials" }, ip, userAgent });
    return sendJson(res, 401, { error: "Invalid username, password, or code." });
  }

  if (!verifyTotp(mfa, user.totp_secret)) {
    logAudit({ userId: user.id, action: "login.failed", details: { reason: "bad_mfa" }, ip, userAgent });
    return sendJson(res, 401, { error: "Invalid username, password, or code." });
  }

  const sid = newSessionId();
  createSession(sid, user.id, SESSION_TTL_MS);
  markLogin(user.id);
  logAudit({ userId: user.id, action: "login.success", ip, userAgent });

  sendJson(
    res,
    200,
    { ok: true, user: { username: user.username, role: user.role } },
    { "Set-Cookie": sessionCookie(sid, { maxAgeSeconds: SESSION_TTL_MS / 1000 }) }
  );
}

function handleLogout(req, res) {
  const user = getCurrentUser(req);
  if (user) {
    deleteSession(user.sessionId);
    logAudit({ userId: user.id, action: "logout", ip: clientIp(req) });
  }
  sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
}

function handleMe(req, res) {
  const user = getCurrentUser(req);
  if (!user) return sendJson(res, 401, { error: "not authenticated" });
  sendJson(res, 200, {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      lastLoginAt: user.last_login_at,
    },
  });
}

// --- Static + routing -------------------------------------------------------

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
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    });
    res.end(data);
  });
}

const handler = async (req, res) => {
  try {
    const url = (req.url || "/").split("?")[0];
    if (req.method === "GET" && url === "/api/health") {
      return sendJson(res, 200, { ok: true, phase: "auth", host: HOST, port: PORT });
    }
    if (req.method === "GET" && url === "/api/me") return handleMe(req, res);
    if (req.method === "POST" && url === "/api/login") return handleLogin(req, res);
    if (req.method === "POST" && url === "/api/logout") return handleLogout(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    sendJson(res, 405, { error: "method not allowed" });
  } catch (e) {
    log(`handler error: ${e}`);
    sendJson(res, 500, { error: String(e) });
  }
};

// Sweep expired sessions hourly.
setInterval(() => {
  try { sweepExpiredSessions(); } catch (e) { log(`sweep error: ${e}`); }
}, 60 * 60 * 1000).unref();

const useHttps = CERT_PATH && KEY_PATH && fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);

const server = useHttps
  ? https.createServer(
      { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) },
      handler
    )
  : http.createServer(handler);

server.listen(PORT, HOST, () => {
  log(`Apex App listening on ${useHttps ? "https" : "http"}://${HOST}:${PORT}`);
});
