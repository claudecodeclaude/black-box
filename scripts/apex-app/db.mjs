// Apex App — SQLite storage. Uses Node's built-in node:sqlite (experimental
// in 22.x but stable enough for our needs; zero native compilation required).

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.APEX_DB || `${process.env.HOME}/.apex-app/apex.db`;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
`);

// Migration: add last_activity_at for the HIPAA-aligned 15-min idle timeout.
// Wrapped because 'ALTER TABLE ADD COLUMN' errors when the column already
// exists and node:sqlite doesn't have IF NOT EXISTS for columns.
try {
  db.exec("ALTER TABLE sessions ADD COLUMN last_activity_at TEXT");
} catch {}

// Passkeys (WebAuthn). One row per registered authenticator (a single user
// can have multiple — phone, laptop, hardware key, etc).
db.exec(`
  CREATE TABLE IF NOT EXISTS passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id);
`);

// Testimonial Matcher — patient testimonials and past-match log.
db.exec(`
  CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER UNIQUE NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS testimonial_logs (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    notes TEXT NOT NULL,
    matches TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_testimonial_logs_created_at
    ON testimonial_logs(created_at);
`);

// --- User queries ----------------------------------------------------------

const stmtFindUserByName = db.prepare(
  "SELECT id, username, password_hash, totp_secret, role, created_at, last_login_at FROM users WHERE username = ?"
);
const stmtInsertUser = db.prepare(
  "INSERT INTO users (username, password_hash, totp_secret, role, created_at) VALUES (?, ?, ?, ?, ?)"
);
const stmtUpdateLastLogin = db.prepare(
  "UPDATE users SET last_login_at = ? WHERE id = ?"
);
const stmtFindUserById = db.prepare(
  "SELECT id, username, role, created_at, last_login_at FROM users WHERE id = ?"
);

export function findUserByName(username) {
  return stmtFindUserByName.get(username);
}

export function findUserById(id) {
  return stmtFindUserById.get(id);
}

export function createUser({ username, passwordHash, totpSecret, role = "staff" }) {
  const createdAt = new Date().toISOString();
  const info = stmtInsertUser.run(username, passwordHash, totpSecret, role, createdAt);
  return { id: info.lastInsertRowid, username, role, createdAt };
}

export function markLogin(userId) {
  stmtUpdateLastLogin.run(new Date().toISOString(), userId);
}

// --- Session queries -------------------------------------------------------

const stmtInsertSession = db.prepare(
  "INSERT INTO sessions (id, user_id, created_at, expires_at, last_activity_at) VALUES (?, ?, ?, ?, ?)"
);
const stmtFindSession = db.prepare(
  "SELECT id, user_id, created_at, expires_at, last_activity_at FROM sessions WHERE id = ?"
);
const stmtDeleteSession = db.prepare("DELETE FROM sessions WHERE id = ?");
const stmtSweepSessions = db.prepare("DELETE FROM sessions WHERE expires_at < ?");
const stmtTouchSession = db.prepare(
  "UPDATE sessions SET last_activity_at = ? WHERE id = ?"
);

export function createSession(sessionId, userId, ttlMs) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  const nowIso = now.toISOString();
  stmtInsertSession.run(sessionId, userId, nowIso, expires.toISOString(), nowIso);
  return { id: sessionId, userId, expiresAt: expires };
}

export function findSession(sessionId) {
  return stmtFindSession.get(sessionId);
}

export function touchSession(sessionId) {
  stmtTouchSession.run(new Date().toISOString(), sessionId);
}

export function deleteSession(sessionId) {
  stmtDeleteSession.run(sessionId);
}

export function sweepExpiredSessions() {
  stmtSweepSessions.run(new Date().toISOString());
}

// --- Audit log -------------------------------------------------------------

const stmtInsertAudit = db.prepare(
  "INSERT INTO audit_log (user_id, action, details, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)"
);

export function logAudit({ userId = null, action, details = null, ip = null, userAgent = null }) {
  stmtInsertAudit.run(
    userId,
    action,
    details ? JSON.stringify(details) : null,
    ip,
    userAgent,
    new Date().toISOString()
  );
}

// --- Passkeys --------------------------------------------------------------

const stmtPasskeyInsert = db.prepare(
  "INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const stmtPasskeyByCredId = db.prepare(
  "SELECT id, user_id, credential_id, public_key, counter, transports, name, created_at, last_used_at FROM passkeys WHERE credential_id = ?"
);
const stmtPasskeysForUser = db.prepare(
  "SELECT id, credential_id, transports, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at ASC"
);
const stmtPasskeyUpdateCounter = db.prepare(
  "UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?"
);
const stmtPasskeyDelete = db.prepare(
  "DELETE FROM passkeys WHERE id = ? AND user_id = ?"
);

export function addPasskey({ userId, credentialId, publicKey, counter, transports, name }) {
  stmtPasskeyInsert.run(
    userId,
    credentialId,
    publicKey,
    counter,
    transports ? JSON.stringify(transports) : null,
    name || null,
    new Date().toISOString()
  );
}
export function findPasskeyByCredentialId(credentialId) {
  const row = stmtPasskeyByCredId.get(credentialId);
  if (!row) return null;
  return {
    ...row,
    transports: row.transports ? JSON.parse(row.transports) : null,
  };
}
export function listPasskeysForUser(userId) {
  return stmtPasskeysForUser.all(userId).map((r) => ({
    ...r,
    transports: r.transports ? JSON.parse(r.transports) : null,
  }));
}
export function updatePasskeyCounter(credentialId, counter) {
  stmtPasskeyUpdateCounter.run(counter, new Date().toISOString(), credentialId);
}
export function deletePasskey(id, userId) {
  return stmtPasskeyDelete.run(id, userId).changes > 0;
}

// --- Testimonials ----------------------------------------------------------

const stmtTestimonialsAll = db.prepare(
  "SELECT number, text, created_at FROM testimonials ORDER BY number ASC"
);
const stmtTestimonialMaxNumber = db.prepare(
  "SELECT MAX(number) AS m FROM testimonials"
);
const stmtTestimonialInsert = db.prepare(
  "INSERT INTO testimonials (number, text, created_at) VALUES (?, ?, ?)"
);
const stmtTestimonialFind = db.prepare(
  "SELECT id, number, text, created_at FROM testimonials WHERE number = ?"
);
const stmtTestimonialUpdateText = db.prepare(
  "UPDATE testimonials SET text = ? WHERE number = ?"
);
const stmtTestimonialDelete = db.prepare(
  "DELETE FROM testimonials WHERE number = ?"
);
const stmtTestimonialUpdateNumber = db.prepare(
  "UPDATE testimonials SET number = ? WHERE number = ?"
);

export function listTestimonials() {
  return stmtTestimonialsAll.all();
}

export function nextTestimonialNumber() {
  const row = stmtTestimonialMaxNumber.get();
  return (row?.m ?? 0) + 1;
}

export function addTestimonial(text) {
  const n = nextTestimonialNumber();
  stmtTestimonialInsert.run(n, text, new Date().toISOString());
  return stmtTestimonialFind.get(n);
}

export function updateTestimonial(number, text) {
  if (!stmtTestimonialFind.get(number)) return null;
  stmtTestimonialUpdateText.run(text, number);
  return stmtTestimonialFind.get(number);
}

export function deleteTestimonial(number) {
  // Renumber anything above the deleted entry down by one so the sequence
  // stays contiguous (mirrors the Black Box app's behavior).
  const rows = stmtTestimonialsAll.all();
  const idx = rows.findIndex((r) => r.number === number);
  if (idx === -1) return false;
  stmtTestimonialDelete.run(number);
  // Reload remaining and renumber from 1..N. Use a temporary high number
  // to avoid UNIQUE collisions during the swap.
  const remaining = rows.filter((r) => r.number !== number);
  // Step 1: bump everything to negative numbers so we can rewrite cleanly.
  const txn = db.transaction(() => {
    for (let i = 0; i < remaining.length; i++) {
      stmtTestimonialUpdateNumber.run(-(i + 1), remaining[i].number);
    }
    for (let i = 0; i < remaining.length; i++) {
      stmtTestimonialUpdateNumber.run(i + 1, -(i + 1));
    }
  });
  txn();
  return true;
}

export function reorderTestimonial(number, direction) {
  const target = stmtTestimonialFind.get(number);
  if (!target) return null;
  const neighborNumber = direction === "up" ? number - 1 : number + 1;
  const neighbor = stmtTestimonialFind.get(neighborNumber);
  if (!neighbor) return target; // already at edge
  // Three-step swap to avoid the UNIQUE constraint.
  const txn = db.transaction(() => {
    stmtTestimonialUpdateNumber.run(-1, target.number);
    stmtTestimonialUpdateNumber.run(target.number, neighbor.number);
    stmtTestimonialUpdateNumber.run(neighbor.number, -1);
  });
  txn();
  return stmtTestimonialFind.get(neighborNumber);
}

export function compactTestimonials() {
  const rows = stmtTestimonialsAll.all();
  const txn = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      stmtTestimonialUpdateNumber.run(-(i + 1), rows[i].number);
    }
    for (let i = 0; i < rows.length; i++) {
      stmtTestimonialUpdateNumber.run(i + 1, -(i + 1));
    }
  });
  txn();
  return rows.length;
}

// --- Testimonial logs ------------------------------------------------------

const stmtLogInsert = db.prepare(
  "INSERT INTO testimonial_logs (id, created_at, notes, matches) VALUES (?, ?, ?, ?)"
);
const stmtLogList = db.prepare(
  "SELECT id, created_at, notes, matches FROM testimonial_logs ORDER BY created_at DESC"
);

export function addTestimonialLog({ notes, matches }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  stmtLogInsert.run(id, createdAt, notes, JSON.stringify(matches));
  return { id, created_at: createdAt, notes, matches };
}

export function listTestimonialLogs() {
  return stmtLogList.all().map((r) => ({
    id: r.id,
    created_at: r.created_at,
    notes: r.notes,
    matches: JSON.parse(r.matches),
  }));
}
