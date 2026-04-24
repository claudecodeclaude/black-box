// Apex App — auth primitives: bcrypt for passwords, TOTP (RFC 6238) for MFA,
// random session IDs, cookie parsing. Pure JS, no native compilation.

import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { randomBytes } from "node:crypto";

// HIPAA-adjacent strong bcrypt cost. Slower login (~200ms) is worth it for
// small-staff setups.
const BCRYPT_COST = 12;

// TOTP: 30s window, allow ±1 step for clock drift.
authenticator.options = { window: 1, step: 30 };

export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain, hash) {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function generateTotpSecret() {
  return authenticator.generateSecret();
}

export function verifyTotp(token, secret) {
  if (!token || !secret) return false;
  // strip whitespace from user input like "123 456"
  const clean = String(token).replace(/\s+/g, "");
  try {
    return authenticator.verify({ token: clean, secret });
  } catch {
    return false;
  }
}

export function totpKeyUri(username, secret, issuer = "Apex App") {
  return authenticator.keyuri(username, issuer, secret);
}

export function newSessionId() {
  return randomBytes(32).toString("hex");
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const piece of header.split(";")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    const k = piece.slice(0, eq).trim();
    const v = piece.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookie(sessionId, { maxAgeSeconds, secure = true } = {}) {
  const parts = [
    `apex_session=${sessionId}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  if (maxAgeSeconds) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join("; ");
}

export function clearSessionCookie({ secure = true } = {}) {
  const parts = [
    "apex_session=",
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
