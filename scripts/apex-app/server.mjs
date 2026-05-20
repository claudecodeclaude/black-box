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
  addPasskey,
  addTestimonial,
  addTestimonialLog,
  compactTestimonials,
  createSession,
  deletePasskey,
  deleteSession,
  deleteTestimonial,
  dismissPasskeyPrompt,
  findPasskeyByCredentialId,
  findSession,
  findUserById,
  findUserByName,
  listPasskeysForUser,
  listTestimonialLogs,
  listTestimonials,
  logAudit,
  markLogin,
  reorderTestimonial,
  sweepExpiredSessions,
  touchSession,
  updatePasskeyCounter,
  updateTestimonial,
} from "./db.mjs";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
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

// HIPAA-aligned session lifetime. 12h absolute maximum, 15m inactivity timeout.
// NIST recommends ~15min for clinical systems; HIPAA itself requires "automatic
// logoff after a predetermined time of inactivity" without specifying a number.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;  // 12h absolute max
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;      // 15m inactivity

// WebAuthn / passkeys. RP_ID is the hostname only, no port/scheme. Origin is
// the full URL Jason loads in his browser.
const RP_ID = process.env.APEX_RP_ID || "jasons-mac-mini-1.taile58089.ts.net";
const RP_ORIGIN = process.env.APEX_RP_ORIGIN || `https://${RP_ID}:${PORT}`;
const RP_NAME = "Apex App";

// In-memory challenge store. Key is a short-lived id we return to the client
// (or the username for registration). Value is { challenge, userId?, expiresAt }.
// Cleared after use; auto-purged after 5 minutes.
const challengeStore = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
function putChallenge(key, value) {
  challengeStore.set(key, { ...value, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}
function takeChallenge(key) {
  const v = challengeStore.get(key);
  challengeStore.delete(key);
  if (!v || v.expiresAt < Date.now()) return null;
  return v;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challengeStore) if (v.expiresAt < now) challengeStore.delete(k);
}, 60 * 1000).unref();

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

function getCurrentUser(req, { touch = true } = {}) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.apex_session;
  if (!sid) return null;
  const session = findSession(sid);
  if (!session) return null;
  const now = Date.now();
  // Absolute session max (12h from creation).
  if (new Date(session.expires_at).getTime() < now) {
    deleteSession(sid);
    logAudit({ userId: session.user_id, action: "session.expired", details: { reason: "absolute" } });
    return null;
  }
  // HIPAA idle timeout: if no activity in IDLE_TIMEOUT_MS, kill the session.
  // last_activity_at may be NULL for pre-migration sessions — treat as idle
  // too since we can't prove otherwise.
  const lastActivityAt = session.last_activity_at
    ? new Date(session.last_activity_at).getTime()
    : 0;
  if (now - lastActivityAt > IDLE_TIMEOUT_MS) {
    deleteSession(sid);
    logAudit({ userId: session.user_id, action: "session.expired", details: { reason: "idle" } });
    return null;
  }
  const user = findUserById(session.user_id);
  if (!user) {
    deleteSession(sid);
    return null;
  }
  // Slide the idle window forward on active use.
  if (touch) touchSession(sid);
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
    { ok: true, user: { username: user.username, role: user.role, passkeyPromptDismissed: Boolean(user.passkey_prompt_dismissed_at) } },
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
      passkeyPromptDismissed: Boolean(user.passkey_prompt_dismissed_at),
    },
  });
}

function handlePasskeySkip(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  dismissPasskeyPrompt(user.id);
  logAudit({ userId: user.id, action: "passkey.prompt.dismissed", ip: clientIp(req) });
  sendJson(res, 200, { ok: true });
}

// --- Passkeys / WebAuthn ---------------------------------------------------

function b64urlToBuffer(b64url) {
  return Buffer.from(b64url, "base64url");
}
function bufferToB64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

async function handlePasskeyRegisterBegin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const existing = listPasskeysForUser(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(String(user.id)),
    userName: user.username,
    userDisplayName: user.username,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports || undefined,
    })),
  });
  putChallenge(`reg:${user.id}`, { challenge: options.challenge, userId: user.id });
  sendJson(res, 200, options);
}

async function handlePasskeyRegisterFinish(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  const { response, name } = body || {};
  const stored = takeChallenge(`reg:${user.id}`);
  if (!stored) return sendJson(res, 400, { error: "no pending registration challenge" });
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch (e) {
    log(`passkey register verify failed: ${e.message || e}`);
    return sendJson(res, 400, { error: `verify failed: ${e.message || e}` });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return sendJson(res, 400, { error: "verification failed" });
  }
  const { credential } = verification.registrationInfo;
  addPasskey({
    userId: user.id,
    credentialId: credential.id,
    publicKey: bufferToB64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports || null,
    name: typeof name === "string" ? name.slice(0, 80) : null,
  });
  logAudit({ userId: user.id, action: "passkey.registered", ip: clientIp(req) });
  sendJson(res, 200, { ok: true });
}

async function handlePasskeyAuthBegin(_req, res) {
  // Discoverable credentials: don't pre-filter by user, the browser picks.
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
  });
  // Random client-side id to correlate response with stored challenge.
  const id = newSessionId();
  putChallenge(`auth:${id}`, { challenge: options.challenge });
  sendJson(res, 200, { challengeId: id, options });
}

async function handlePasskeyAuthFinish(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  const { challengeId, response } = body || {};
  const stored = takeChallenge(`auth:${challengeId}`);
  if (!stored) return sendJson(res, 400, { error: "no pending authentication challenge" });

  const credId = response?.id;
  if (!credId) return sendJson(res, 400, { error: "missing credential id" });
  const stored_passkey = findPasskeyByCredentialId(credId);
  if (!stored_passkey) {
    logAudit({ action: "passkey.auth.failed", details: { reason: "unknown_credential" }, ip: clientIp(req) });
    return sendJson(res, 401, { error: "credential not recognized" });
  }
  const user = findUserById(stored_passkey.user_id);
  if (!user) return sendJson(res, 401, { error: "user no longer exists" });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: stored_passkey.credential_id,
        publicKey: b64urlToBuffer(stored_passkey.public_key),
        counter: stored_passkey.counter,
        transports: stored_passkey.transports || undefined,
      },
      requireUserVerification: false,
    });
  } catch (e) {
    logAudit({ userId: user.id, action: "passkey.auth.failed", details: { reason: "verify_threw", error: String(e.message || e) }, ip: clientIp(req) });
    return sendJson(res, 401, { error: "verification failed" });
  }
  if (!verification.verified) {
    logAudit({ userId: user.id, action: "passkey.auth.failed", details: { reason: "not_verified" }, ip: clientIp(req) });
    return sendJson(res, 401, { error: "verification failed" });
  }

  updatePasskeyCounter(stored_passkey.credential_id, verification.authenticationInfo.newCounter);

  const sid = newSessionId();
  createSession(sid, user.id, SESSION_TTL_MS);
  markLogin(user.id);
  logAudit({ userId: user.id, action: "login.success", details: { method: "passkey" }, ip: clientIp(req), userAgent: req.headers["user-agent"] || null });

  sendJson(
    res,
    200,
    { ok: true, user: { username: user.username, role: user.role, passkeyPromptDismissed: Boolean(user.passkey_prompt_dismissed_at) } },
    { "Set-Cookie": sessionCookie(sid, { maxAgeSeconds: SESSION_TTL_MS / 1000 }) }
  );
}

function handlePasskeyList(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const list = listPasskeysForUser(user.id).map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.created_at,
    lastUsedAt: p.last_used_at,
  }));
  sendJson(res, 200, { passkeys: list });
}

async function handlePasskeyDelete(req, res, id) {
  const user = requireAuth(req, res);
  if (!user) return;
  const ok = deletePasskey(id, user.id);
  if (!ok) return sendJson(res, 404, { error: "not found" });
  logAudit({ userId: user.id, action: "passkey.deleted", details: { id } });
  sendJson(res, 200, { ok: true });
}

// --- Testimonial Matcher (auth-required) -----------------------------------
// All testimonial CRUD lives on this auth-gated server; the actual match
// (claude -p) and video transcribe (yt-dlp + whisper) still run in the
// existing testimonial-match service on port 7685, proxied through here so
// the browser only ever talks to the auth-gated origin.
const TM_HELPER_BASE = process.env.APEX_TM_HELPER ||
  "https://jasons-mac-mini-1.taile58089.ts.net:7685";

// Sales Calls helper (proxied for the /apps/sales-calls/ page so the browser
// stays same-origin and inherits the passkey session). The helper enforces a
// bearer token on its own write endpoints; we forward it here.
const SC_HELPER_BASE = process.env.APEX_SC_HELPER ||
  "https://jasons-mac-mini-1.taile58089.ts.net:7687";
const SC_HELPER_TOKEN = process.env.APEX_SC_TOKEN || "";

async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error(`bad json: ${e.message}`)); }
    });
    req.on("error", reject);
  });
}

function requireAuth(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "not authenticated" });
    return null;
  }
  return user;
}

async function handleTestimonialsList(req, res) {
  if (!requireAuth(req, res)) return;
  const list = listTestimonials();
  sendJson(res, 200, {
    testimonials: list.map((t) => ({ number: t.number, text: t.text, createdAt: t.created_at })),
  });
}

async function handleTestimonialsCreate(req, res) {
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  const text = String(body.text || "").trim();
  if (!text) return sendJson(res, 400, { error: "text required" });
  const t = addTestimonial(text);
  sendJson(res, 200, { ok: true, testimonial: t });
}

async function handleTestimonialUpdate(req, res, number) {
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  const text = String(body.text || "").trim();
  if (!text) return sendJson(res, 400, { error: "text required" });
  const updated = updateTestimonial(number, text);
  if (!updated) return sendJson(res, 404, { error: "not found" });
  sendJson(res, 200, { ok: true, testimonial: updated });
}

function handleTestimonialDelete(req, res, number) {
  if (!requireAuth(req, res)) return;
  const ok = deleteTestimonial(number);
  if (!ok) return sendJson(res, 404, { error: "not found" });
  sendJson(res, 200, { ok: true });
}

async function handleTestimonialReorder(req, res) {
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  const number = Number(body.number);
  const direction = body.direction;
  if (!Number.isFinite(number) || (direction !== "up" && direction !== "down")) {
    return sendJson(res, 400, { error: "bad request" });
  }
  reorderTestimonial(number, direction);
  sendJson(res, 200, { ok: true });
}

function handleTestimonialCompact(req, res) {
  if (!requireAuth(req, res)) return;
  const count = compactTestimonials();
  sendJson(res, 200, { ok: true, count });
}

function handleTestimonialLogsList(req, res) {
  if (!requireAuth(req, res)) return;
  const entries = listTestimonialLogs();
  sendJson(res, 200, { entries });
}

async function handleTestimonialMatch(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  const notes = String(body.notes || "").trim();
  if (!notes) return sendJson(res, 400, { error: "notes required" });
  const list = listTestimonials();
  if (list.length < 4) {
    return sendJson(res, 400, {
      error: `need at least 4 testimonials in the database (currently ${list.length})`,
    });
  }
  try {
    const upstream = await fetch(`${TM_HELPER_BASE}/api/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notes,
        testimonials: list.map((t) => ({ number: t.number, text: t.text })),
      }),
    });
    const text = await upstream.text();
    if (!upstream.ok) return sendJson(res, upstream.status, { error: text || `HTTP ${upstream.status}` });
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return sendJson(res, 502, { error: "matcher returned non-JSON" }); }
    // Log this run for the audit trail and the past-entries panel.
    if (Array.isArray(parsed.matches)) {
      addTestimonialLog({ notes, matches: parsed.matches });
      logAudit({ userId: user.id, action: "testimonial.match", details: { matched: parsed.matches.map((m) => m.number) } });
    }
    sendJson(res, 200, parsed);
  } catch (e) {
    log(`testimonial match error: ${e.message || e}`);
    sendJson(res, 502, {
      error: `Can't reach the matcher service. ${e.message || e}`,
    });
  }
}

async function handleTestimonialTranscribeUrl(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  const url = String(body.url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return sendJson(res, 400, { error: "valid http(s) URL required" });
  }
  try {
    const upstream = await fetch(`${TM_HELPER_BASE}/api/transcribe-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const text = await upstream.text();
    if (!upstream.ok) return sendJson(res, upstream.status, { error: text || `HTTP ${upstream.status}` });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    log(`testimonial transcribe-url error: ${e.message || e}`);
    sendJson(res, 502, { error: `Can't reach the transcribe service. ${e.message || e}` });
  }
}

// --- Sales Calls proxy (auth-required) -------------------------------------
// Records, audio, and extracted notes live on the sales-calls helper service.
// We proxy GETs and the push-to-NPE POST through this auth-gated server so the
// page never has to talk cross-origin or hold a bearer token in the browser.

function scAuthHeaders() {
  return SC_HELPER_TOKEN
    ? { Authorization: `Bearer ${SC_HELPER_TOKEN}` }
    : {};
}

async function handleSalesCallsList(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    const upstream = await fetch(`${SC_HELPER_BASE}/api/records`, {
      headers: scAuthHeaders(),
    });
    const text = await upstream.text();
    if (!upstream.ok) return sendJson(res, upstream.status, { error: text || `HTTP ${upstream.status}` });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    log(`sales-calls list error: ${e.message || e}`);
    sendJson(res, 502, { error: `Can't reach sales-calls helper. ${e.message || e}` });
  }
}

async function handleSalesCallsGet(req, res, id) {
  if (!requireAuth(req, res)) return;
  if (!/^[A-Za-z0-9\-]+$/.test(id)) return sendJson(res, 400, { error: "bad id" });
  try {
    const upstream = await fetch(`${SC_HELPER_BASE}/api/records/${encodeURIComponent(id)}`, {
      headers: scAuthHeaders(),
    });
    const text = await upstream.text();
    if (!upstream.ok) return sendJson(res, upstream.status, { error: text || `HTTP ${upstream.status}` });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    log(`sales-calls get error: ${e.message || e}`);
    sendJson(res, 502, { error: `Can't reach sales-calls helper. ${e.message || e}` });
  }
}

async function handleSalesCallsPushToNpe(req, res, id) {
  const user = requireAuth(req, res);
  if (!user) return;
  if (!/^[A-Za-z0-9\-]+$/.test(id)) return sendJson(res, 400, { error: "bad id" });
  try {
    const upstream = await fetch(
      `${SC_HELPER_BASE}/api/records/${encodeURIComponent(id)}/push-to-npe`,
      { method: "POST", headers: scAuthHeaders() }
    );
    const text = await upstream.text();
    if (upstream.ok) {
      logAudit({ userId: user.id, action: "sales-call.push-to-npe", details: { id } });
    }
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    log(`sales-calls push error: ${e.message || e}`);
    sendJson(res, 502, { error: `Can't reach sales-calls helper. ${e.message || e}` });
  }
}

// --- Static + routing -------------------------------------------------------

function serveStatic(req, res) {
  const url = (req.url || "/").split("?")[0];
  let filePath = url === "/" ? "/index.html" : url;
  let full = path.join(__dirname, "public", filePath);
  if (!full.startsWith(path.join(__dirname, "public"))) {
    return sendJson(res, 403, { error: "forbidden" });
  }
  // If the URL points at a directory, serve its index.html. Lets sub-apps
  // sit at /apps/<slug>/ without a trailing-slash gymnastic.
  try {
    const stat = fs.statSync(full);
    if (stat.isDirectory()) full = path.join(full, "index.html");
  } catch {}
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
    if (req.method === "POST" && url === "/api/passkey/register/begin") return handlePasskeyRegisterBegin(req, res);
    if (req.method === "POST" && url === "/api/passkey/register/finish") return handlePasskeyRegisterFinish(req, res);
    if (req.method === "POST" && url === "/api/passkey/auth/begin") return handlePasskeyAuthBegin(req, res);
    if (req.method === "POST" && url === "/api/passkey/auth/finish") return handlePasskeyAuthFinish(req, res);
    if (req.method === "GET" && url === "/api/passkey/list") return handlePasskeyList(req, res);
    if (req.method === "POST" && url === "/api/passkey/skip") return handlePasskeySkip(req, res);
    {
      const m = url.match(/^\/api\/passkey\/(\d+)$/);
      if (m && req.method === "DELETE") return handlePasskeyDelete(req, res, Number(m[1]));
    }

    // Testimonial Matcher API
    if (req.method === "GET" && url === "/api/testimonials") return handleTestimonialsList(req, res);
    if (req.method === "POST" && url === "/api/testimonials") return handleTestimonialsCreate(req, res);
    if (req.method === "POST" && url === "/api/testimonials/reorder") return handleTestimonialReorder(req, res);
    if (req.method === "POST" && url === "/api/testimonials/compact") return handleTestimonialCompact(req, res);
    if (req.method === "GET" && url === "/api/testimonials/logs") return handleTestimonialLogsList(req, res);
    if (req.method === "POST" && url === "/api/testimonials/match") return handleTestimonialMatch(req, res);
    if (req.method === "POST" && url === "/api/testimonials/transcribe-url") return handleTestimonialTranscribeUrl(req, res);
    {
      const m = url.match(/^\/api\/testimonials\/(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (req.method === "PUT") return handleTestimonialUpdate(req, res, n);
        if (req.method === "DELETE") return handleTestimonialDelete(req, res, n);
      }
    }
    // Sales Calls proxy
    if (req.method === "GET" && url === "/api/sales-calls/records") return handleSalesCallsList(req, res);
    {
      const m = url.match(/^\/api\/sales-calls\/records\/([A-Za-z0-9\-]+)$/);
      if (m && req.method === "GET") return handleSalesCallsGet(req, res, m[1]);
    }
    {
      const m = url.match(/^\/api\/sales-calls\/records\/([A-Za-z0-9\-]+)\/push-to-npe$/);
      if (m && req.method === "POST") return handleSalesCallsPushToNpe(req, res, m[1]);
    }

    // Sub-apps under /apps/* are gated behind login. PHI-bearing apps live
    // here (testimonials, eventually patient records). Unauthenticated
    // requests bounce to the login screen.
    if (req.method === "GET" && url.startsWith("/apps/")) {
      const user = getCurrentUser(req);
      if (!user) {
        res.writeHead(302, { Location: "/" });
        return res.end();
      }
      return serveStatic(req, res);
    }
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
