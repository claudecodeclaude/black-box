"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { OfficeText } from "./types";

export default function OfficeTextsPage() {
  const [texts, setTexts] = useState<OfficeText[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const res = await fetch("/api/apex/office-texts", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { texts: OfficeText[] };
      setTexts(data.texts);
    }
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  async function toggleRead(t: OfficeText) {
    const res = await fetch("/api/apex/office-texts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markRead", id: t.id, read: !t.read }),
    });
    if (res.ok) refresh();
  }

  const unread = texts.filter((t) => !t.read).length;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 80px" }}>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/apex-app"
          style={{ color: "var(--muted)", fontSize: 14, textDecoration: "none" }}
        >
          ← Apex App
        </Link>
      </div>

      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Office Texts</h1>
      <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 24, fontSize: 14 }}>
        Inbound SMS to the office landline, via Twilio. Each message is also forwarded
        into Go High Level so it lands in the right contact thread.
      </p>

      <div
        style={{
          fontSize: 12,
          color: "var(--muted)",
          letterSpacing: 1,
          marginBottom: 16,
          textTransform: "uppercase",
        }}
      >
        {loaded ? `${texts.length} message${texts.length === 1 ? "" : "s"} · ${unread} unread` : "Loading…"}
      </div>

      {loaded && texts.length === 0 && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px dashed var(--border)",
            borderRadius: 10,
            padding: 20,
            color: "var(--muted)",
            fontSize: 14,
          }}
        >
          No texts yet. Once Twilio is wired up to the office line, inbound messages will
          appear here within a few seconds of arrival.
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {texts.map((t) => (
          <article
            key={t.id}
            style={{
              background: t.read ? "var(--surface)" : "#0a1a24",
              border: `1px solid ${t.read ? "var(--border)" : "#1a3a54"}`,
              borderRadius: 10,
              padding: 14,
            }}
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
                marginBottom: 8,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 15 }}>{formatPhone(t.from)}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {formatEastern(t.receivedAt)}
              </div>
            </header>
            <div
              style={{
                fontSize: 14,
                whiteSpace: "pre-wrap",
                lineHeight: 1.45,
                color: "#e5e5e5",
              }}
            >
              {t.body || <em style={{ color: "var(--muted)" }}>(empty body)</em>}
            </div>
            {t.numMedia > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                {t.numMedia} attachment{t.numMedia === 1 ? "" : "s"} (view in GHL)
              </div>
            )}
            <footer
              style={{
                marginTop: 12,
                display: "flex",
                gap: 12,
                alignItems: "center",
                fontSize: 12,
                color: "var(--muted)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: t.ghlForwarded ? "#4dff88" : "#ff9b9b" }}>
                {t.ghlForwarded ? "✓ forwarded to GHL" : t.ghlError ? "✗ GHL forward failed" : "… GHL pending"}
              </span>
              <button
                onClick={() => toggleRead(t)}
                style={{
                  marginLeft: "auto",
                  background: "var(--border)",
                  color: "inherit",
                  border: "none",
                  borderRadius: 999,
                  padding: "4px 14px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {t.read ? "mark unread" : "mark read"}
              </button>
            </footer>
            {t.ghlError && (
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  background: "#2a0e0e",
                  border: "1px solid #ff6b6b",
                  borderRadius: 6,
                  color: "#ff9b9b",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                }}
              >
                {t.ghlError}
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}

const EASTERN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatEastern(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return EASTERN_FMT.format(d);
}

function formatPhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return p;
}
