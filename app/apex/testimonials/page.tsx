"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  EMPTY_LOGS,
  EMPTY_STATE,
  LogsState,
  Match,
  Testimonial,
  TestimonialsState,
} from "./types";

// The matcher runs on the Mac Mini over Tailscale.
const TM_BASE = "https://jasons-mac-mini-1.taile58089.ts.net:7685";
const MATCH_URL = `${TM_BASE}/api/match`;
const TRANSCRIBE_URL = `${TM_BASE}/api/transcribe-url`;

type MatchResult =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; matches: Match[] };

export default function TestimonialsPage() {
  const [state, setState] = useState<TestimonialsState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);

  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);

  const [videoUrl, setVideoUrl] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  const [editingNumber, setEditingNumber] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const [notes, setNotes] = useState("");
  const [matchResult, setMatchResult] = useState<MatchResult>({ status: "idle" });

  const [dbOpen, setDbOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<LogsState>(EMPTY_LOGS);

  async function refresh() {
    const res = await fetch("/api/apex/testimonials", { cache: "no-store" });
    const data = (await res.json()) as TestimonialsState;
    // Heal any numbering gaps left over from earlier deletes.
    const sorted = [...data.testimonials].sort((a, b) => a.number - b.number);
    const hasGap = sorted.some((t, i) => t.number !== i + 1);
    if (hasGap) {
      const compactRes = await fetch("/api/apex/testimonials/compact", {
        method: "POST",
      });
      if (compactRes.ok) {
        const j = await compactRes.json();
        setState(j.state);
        setLoaded(true);
        return;
      }
    }
    setState(data);
    setLoaded(true);
  }

  async function refreshLogs() {
    const res = await fetch("/api/apex/testimonials/logs", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as LogsState;
      setLogs(data);
    }
  }

  useEffect(() => {
    refresh();
    refreshLogs();
  }, []);

  async function transcribeFromUrl() {
    if (!videoUrl.trim() || transcribing) return;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const res = await fetch(TRANSCRIBE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setTranscribeError(j.error || `HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as { text: string };
      if (!json.text?.trim()) {
        setTranscribeError("Transcript came back empty — check the URL points to audio/video.");
        return;
      }
      setNewText((prev) => (prev.trim() ? prev + "\n\n" + json.text : json.text));
      setVideoUrl("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTranscribeError(
        `Can't reach the matcher on your Mac Mini. Make sure the Mac is on and this device is on your tailnet. (${msg})`
      );
    } finally {
      setTranscribing(false);
    }
  }

  async function addTestimonial() {
    if (!newText.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/apex/testimonials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newText.trim() }),
      });
      if (res.ok) {
        const json = await res.json();
        setState(json.state);
        setNewText("");
      }
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit(n: number) {
    const res = await fetch(`/api/apex/testimonials/${n}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: editText.trim() }),
    });
    if (res.ok) {
      const json = await res.json();
      setState(json.state);
      setEditingNumber(null);
      setEditText("");
    }
  }

  async function deleteTestimonial(n: number) {
    if (!confirm(`Delete testimonial #${n}?`)) return;
    const res = await fetch(`/api/apex/testimonials/${n}`, { method: "DELETE" });
    if (res.ok) {
      const json = await res.json();
      setState(json.state);
    }
  }

  async function reorder(n: number, direction: "up" | "down") {
    const res = await fetch("/api/apex/testimonials/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: n, direction }),
    });
    if (res.ok) {
      const json = await res.json();
      setState(json.state);
    }
  }

  async function runMatch() {
    if (!notes.trim()) return;
    if (state.testimonials.length < 4) {
      setMatchResult({
        status: "error",
        message: `You have ${state.testimonials.length} testimonials — add at least 4 before matching.`,
      });
      return;
    }
    setMatchResult({ status: "loading" });
    try {
      const res = await fetch(MATCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notes.trim(),
          testimonials: state.testimonials.map((t) => ({
            number: t.number,
            text: t.text,
          })),
        }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => `HTTP ${res.status}`);
        setMatchResult({ status: "error", message: msg || `HTTP ${res.status}` });
        return;
      }
      const json = (await res.json()) as { matches: Match[] };
      setMatchResult({ status: "done", matches: json.matches });
      // Log this run (fire-and-forget)
      fetch("/api/apex/testimonials/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim(), matches: json.matches }),
      })
        .then((r) => r.ok && r.json())
        .then((j) => j?.state && setLogs(j.state))
        .catch(() => {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMatchResult({
        status: "error",
        message: `Can't reach the matcher on your Mac Mini. Make sure the Mac is on and this device is on your tailnet. (${msg})`,
      });
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px 80px" }}>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/"
          style={{ color: "var(--muted)", fontSize: 14, textDecoration: "none" }}
        >
          ← Black Box
        </Link>
      </div>

      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Testimonial Matcher</h1>
      <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 28, fontSize: 14 }}>
        Paste a new patient&apos;s phone consult notes and get the 4 testimonials that
        will resonate most. Matcher runs on your Mac Mini over Tailscale.
      </p>

      {/* Match section */}
      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 32,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18, marginBottom: 10 }}>Match</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Paste the phone consult notes for the new patient…"
          rows={8}
          style={{
            width: "100%",
            background: "#0a0a0a",
            color: "inherit",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            fontSize: 14,
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
          <button
            onClick={runMatch}
            disabled={!notes.trim() || matchResult.status === "loading"}
            style={{
              background: "var(--accent)",
              color: "#000",
              border: "none",
              borderRadius: 999,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              opacity: !notes.trim() || matchResult.status === "loading" ? 0.5 : 1,
            }}
          >
            {matchResult.status === "loading" ? "Matching…" : "Match top 4"}
          </button>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            {state.testimonials.length} testimonial{state.testimonials.length === 1 ? "" : "s"} loaded
          </span>
        </div>

        {matchResult.status === "error" && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: "#2a0e0e",
              border: "1px solid #ff6b6b",
              borderRadius: 8,
              color: "#ff9b9b",
              fontSize: 13,
              whiteSpace: "pre-wrap",
            }}
          >
            {matchResult.message}
          </div>
        )}

        {matchResult.status === "done" && (
          <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
            {matchResult.matches.map((m) => {
              const full = state.testimonials.find((t) => t.number === m.number);
              return (
                <div
                  key={m.number}
                  style={{
                    background: "#0a1a24",
                    border: "1px solid #1a3a54",
                    borderRadius: 10,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 12,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 32,
                        fontWeight: 800,
                        color: "var(--accent)",
                        minWidth: 60,
                      }}
                    >
                      #{m.number}
                    </div>
                    <div style={{ fontSize: 14, color: "#e5f3fa" }}>{m.reason}</div>
                  </div>
                  {full && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        marginTop: 6,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.4,
                      }}
                    >
                      {full.text.length > 220 ? full.text.slice(0, 220) + "…" : full.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Database + past entries toggles */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          marginTop: 8,
          marginBottom: dbOpen || logsOpen ? 24 : 0,
        }}
      >
        <button
          onClick={() => setDbOpen((v) => !v)}
          style={{
            background: dbOpen ? "var(--accent-warm, #ff9a4d)" : "var(--surface)",
            color: dbOpen ? "#000" : "inherit",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "12px 28px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: 1,
          }}
        >
          {dbOpen ? "▴ Close Database" : `▾ Testimonial Database (${state.testimonials.length})`}
        </button>
        <button
          onClick={() => setLogsOpen((v) => !v)}
          style={{
            background: logsOpen ? "var(--accent-warm, #ff9a4d)" : "var(--surface)",
            color: logsOpen ? "#000" : "inherit",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "12px 28px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: 1,
          }}
        >
          {logsOpen ? "▴ Close Past Entries" : `▾ Past Entries Database (${logs.entries.length})`}
        </button>
      </div>

      {/* Past entries log (read-only, chronological oldest → newest, Eastern time) */}
      <section style={{ display: logsOpen ? "block" : "none", marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Past entries</h2>
        {logs.entries.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            No past entries yet. Every match you run gets logged here.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {[...logs.entries]
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              )
              .map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      letterSpacing: 1,
                      marginBottom: 14,
                    }}
                  >
                    {formatEastern(entry.createdAt)}
                  </div>

                  {/* Section 1 — phone consult notes */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={sectionLabel}>Consult notes</div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#e5e5e5",
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.45,
                      }}
                    >
                      {entry.notes}
                    </div>
                  </div>

                  {/* Section 2 — matched testimonial numbers */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={sectionLabel}>Matched testimonials</div>
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        fontSize: 22,
                        fontWeight: 800,
                        color: "var(--accent)",
                      }}
                    >
                      {entry.matches.map((m) => (
                        <span key={m.number}>#{m.number}</span>
                      ))}
                    </div>
                  </div>

                  {/* Section 3 — why each match */}
                  <div>
                    <div style={sectionLabel}>Why these match</div>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 20,
                        fontSize: 13,
                        color: "#d5d5d5",
                        lineHeight: 1.5,
                      }}
                    >
                      {entry.matches.map((m) => (
                        <li key={m.number} style={{ marginBottom: 4 }}>
                          <strong style={{ color: "var(--accent)" }}>#{m.number}</strong>
                          {" — "}
                          {m.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* Admin: add + list (collapsible) */}
      <section style={{ display: dbOpen ? "block" : "none" }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Testimonials</h2>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="Paste a video URL (YouTube, Drive, etc) to auto-transcribe…"
              style={{
                flex: "1 1 260px",
                background: "#0a0a0a",
                color: "inherit",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={transcribeFromUrl}
              disabled={!videoUrl.trim() || transcribing}
              style={{
                background: "var(--accent)",
                color: "#000",
                border: "none",
                borderRadius: 999,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                opacity: !videoUrl.trim() || transcribing ? 0.5 : 1,
              }}
            >
              {transcribing ? "Transcribing…" : "Transcribe"}
            </button>
          </div>
          {transcribeError && (
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                background: "#2a0e0e",
                border: "1px solid #ff6b6b",
                borderRadius: 8,
                color: "#ff9b9b",
                fontSize: 12,
                whiteSpace: "pre-wrap",
              }}
            >
              {transcribeError}
            </div>
          )}
          <div
            style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10, letterSpacing: 0.2 }}
          >
            Tip: scan a printed QR with your iPhone camera, copy the URL, and paste it above.
          </div>
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Paste a testimonial (video transcript, Google review, etc)…"
            rows={5}
            style={{
              width: "100%",
              background: "#0a0a0a",
              color: "inherit",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
              fontSize: 14,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <button
              onClick={addTestimonial}
              disabled={!newText.trim() || adding}
              style={{
                background: "var(--accent-warm, #ff9a4d)",
                color: "#000",
                border: "none",
                borderRadius: 999,
                padding: "9px 18px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                opacity: !newText.trim() || adding ? 0.5 : 1,
              }}
            >
              {adding ? "Adding…" : `Add as #${state.nextNumber}`}
            </button>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              Numbers are assigned automatically and never reused.
            </span>
          </div>
        </div>

        {!loaded && <div style={{ color: "var(--muted)" }}>Loading…</div>}

        {loaded && state.testimonials.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            No testimonials yet. Add your first one above.
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {[...state.testimonials].sort((a, b) => a.number - b.number).map((t, idx, arr) => (
            <div
              key={t.number}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ color: "var(--accent)" }}>#{t.number}</strong>
                  <button
                    onClick={() => reorder(t.number, "up")}
                    disabled={idx === 0}
                    title="Move up (lower number)"
                    style={arrowBtn(idx === 0)}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => reorder(t.number, "down")}
                    disabled={idx === arr.length - 1}
                    title="Move down (higher number)"
                    style={arrowBtn(idx === arr.length - 1)}
                  >
                    ▼
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {editingNumber === t.number ? (
                    <>
                      <button
                        onClick={() => saveEdit(t.number)}
                        style={btnSmall("#4dff88", "#001a0a")}
                      >
                        save
                      </button>
                      <button
                        onClick={() => {
                          setEditingNumber(null);
                          setEditText("");
                        }}
                        style={btnSmall("var(--border)", "inherit")}
                      >
                        cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingNumber(t.number);
                          setEditText(t.text);
                        }}
                        style={btnSmall("var(--border)", "inherit")}
                      >
                        edit
                      </button>
                      <button
                        onClick={() => deleteTestimonial(t.number)}
                        style={btnSmall("#2a0e0e", "#ff8a8a")}
                      >
                        delete
                      </button>
                    </>
                  )}
                </div>
              </div>
              {editingNumber === t.number ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={5}
                  style={{
                    width: "100%",
                    background: "#0a0a0a",
                    color: "inherit",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 14,
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              ) : (
                <div
                  style={{
                    fontSize: 14,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.45,
                    color: "#e5e5e5",
                  }}
                >
                  {t.text}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function btnSmall(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    border: "1px solid var(--border)",
    borderRadius: 999,
    padding: "4px 12px",
    fontSize: 12,
    cursor: "pointer",
  };
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 2,
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 6,
};

const EASTERN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

function formatEastern(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return EASTERN_FMT.format(d);
}

function arrowBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "var(--border)",
    color: "inherit",
    border: "none",
    borderRadius: 6,
    padding: "3px 10px",
    fontSize: 11,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.3 : 1,
    lineHeight: 1,
  };
}
