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
  "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
);
const stmtFindSession = db.prepare(
  "SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?"
);
const stmtDeleteSession = db.prepare("DELETE FROM sessions WHERE id = ?");
const stmtSweepSessions = db.prepare("DELETE FROM sessions WHERE expires_at < ?");

export function createSession(sessionId, userId, ttlMs) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  stmtInsertSession.run(sessionId, userId, now.toISOString(), expires.toISOString());
  return { id: sessionId, userId, expiresAt: expires };
}

export function findSession(sessionId) {
  return stmtFindSession.get(sessionId);
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
