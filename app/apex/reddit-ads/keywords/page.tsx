"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  baseKeywords,
  candidates,
  hitCounts,
  misspellings,
  rejected as rejectedBase,
  type CategoryName,
  type Candidate,
} from "../keywords";

const LS_APPROVED = "reddit-ads/approved-candidates";
const LS_REJECTED = "reddit-ads/rejected-candidates";
const HELPER_URL = "https://jasons-mac-mini-1.taile58089.ts.net:7682";

type LocalApproval = { term: string; category: CategoryName };

function readList<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(key) || "[]") as T[];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, value: T[]) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function syncToHelper(approved: LocalApproval[], rejected: string[]) {
  // Fire-and-forget. Mixed-content will block this from HTTPS origins, so
  // localStorage remains the authoritative client-side store. When the UI is
  // served same-origin (or over HTTPS via Tailscale cert), this succeeds and
  // writes data/keywords-overlay.json on the Mac for the next scan.
  fetch(`${HELPER_URL}/sync-approvals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, rejected }),
    keepalive: true,
  }).catch(() => {});
}

export default function KeywordsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [localApproved, setLocalApproved] = useState<LocalApproval[]>([]);
  const [localRejected, setLocalRejected] = useState<string[]>([]);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);

  useEffect(() => {
    setLocalApproved(readList<LocalApproval>(LS_APPROVED));
    setLocalRejected(readList<string>(LS_REJECTED));
    setHydrated(true);
  }, []);

  function approve(c: Candidate) {
    const next = [
      ...localApproved.filter((a) => a.term !== c.term),
      { term: c.term, category: c.suggestedCategory },
    ];
    setLocalApproved(next);
    writeList(LS_APPROVED, next);
    syncToHelper(next, localRejected);
  }

  function reject(c: Candidate) {
    const next = [...new Set([...localRejected, c.term])];
    setLocalRejected(next);
    writeList(LS_REJECTED, next);
    syncToHelper(localApproved, next);
  }

  function undo(term: string) {
    const a = localApproved.filter((x) => x.term !== term);
    const r = localRejected.filter((x) => x !== term);
    setLocalApproved(a);
    setLocalRejected(r);
    writeList(LS_APPROVED, a);
    writeList(LS_REJECTED, r);
    syncToHelper(a, r);
  }

  function rejectTerm(term: string) {
    const next = [...new Set([...localRejected, term])];
    setLocalRejected(next);
    writeList(LS_REJECTED, next);
    syncToHelper(localApproved, next);
    setSelectedKeyword(null);
  }

  const approvedSet = new Set(localApproved.map((a) => a.term));
  const rejectedAllSet = new Set([...rejectedBase, ...localRejected]);
  const actedSet = new Set([...approvedSet, ...rejectedAllSet]);
  const pending = candidates.filter((c) => !actedSet.has(c.term));

  // Filter out rejected terms from the displayed lists.
  const activeBase: Record<CategoryName, string[]> = Object.fromEntries(
    (Object.entries(baseKeywords) as [CategoryName, string[]][]).map(
      ([cat, terms]) => [cat, terms.filter((t) => !rejectedAllSet.has(t))]
    )
  ) as Record<CategoryName, string[]>;
  const activeMisspellings = misspellings.filter(
    (m) => !rejectedAllSet.has(m)
  );

  const totalBase = Object.values(activeBase).flat().length;
  const totalMisspellings = activeMisspellings.length;
  const rejectedAll = [...new Set([...rejectedBase, ...localRejected])];

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 64px" }}>
      <Link
        href="/apex/reddit-ads"
        style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
      >
        ← Reddit Ads
      </Link>

      <div style={{ marginTop: 24, marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>Keywords</h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--muted)",
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          {totalBase + totalMisspellings} active · {totalBase} base ·{" "}
          {totalMisspellings} misspellings · {rejectedAll.length} rejected
          {hydrated && pending.length > 0 && (
            <>
              {" "}
              · <span style={{ color: "#ffd34d" }}>{pending.length} pending</span>
            </>
          )}
        </p>
      </div>

      {/* Pending candidates */}
      {hydrated && pending.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionHeader
            title="New candidates"
            subtitle="Mentioned ≥10 times in the corpus and close to an existing topic. Approve to add to the base list, reject to never see again."
            badge={`${pending.length}`}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {pending.map((c) => (
              <CandidateCard
                key={c.term}
                candidate={c}
                onApprove={() => approve(c)}
                onReject={() => reject(c)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Saved local actions (not yet applied to base) */}
      {hydrated && (localApproved.length > 0 || localRejected.length > 0) && (
        <section style={{ marginBottom: 32 }}>
          <SectionHeader
            title="Pending to apply"
            subtitle="Your choices save locally and get applied on the next scan."
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {localApproved.map((a) => (
              <ActionRow
                key={`a-${a.term}`}
                label={a.term}
                tag={`approve → ${a.category}`}
                tone="approve"
                onUndo={() => undo(a.term)}
              />
            ))}
            {localRejected.map((t) => (
              <ActionRow
                key={`r-${t}`}
                label={t}
                tag="reject"
                tone="reject"
                onUndo={() => undo(t)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Base keywords by category */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Base keywords" badge={`${totalBase}`} />
        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 14 }}>
          {(Object.entries(activeBase) as [CategoryName, string[]][]).map(
            ([cat, terms]) => (
              <div key={cat}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  {cat} · {terms.length}
                </div>
                <KeywordChips terms={terms} onSelect={setSelectedKeyword} />
              </div>
            )
          )}
        </div>
      </section>

      {/* Misspellings */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader
          title="Misspellings"
          subtitle="Auto-added every scan. No approval needed."
          badge={`${totalMisspellings}`}
        />
        <div style={{ marginTop: 12 }}>
          <KeywordChips terms={activeMisspellings} muted onSelect={setSelectedKeyword} />
        </div>
      </section>

      {/* Rejected */}
      <RejectedSection terms={rejectedAll} />

      {/* Keyword detail popup */}
      {selectedKeyword && (
        <KeywordPopup
          term={selectedKeyword}
          hits={hitCounts[selectedKeyword]}
          onReject={() => rejectTerm(selectedKeyword)}
          onClose={() => setSelectedKeyword(null)}
        />
      )}
    </main>
  );
}

function SectionHeader({
  title,
  subtitle,
  badge,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
        {badge && (
          <span
            style={{
              fontSize: 12,
              color: "var(--muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {badge}
          </span>
        )}
      </div>
      {subtitle && (
        <p
          style={{
            fontSize: 12,
            color: "var(--muted)",
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

function CandidateCard({
  candidate,
  onApprove,
  onReject,
}: {
  candidate: Candidate;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid #3a3012",
        borderLeft: "3px solid #ffd34d",
        borderRadius: 10,
        padding: "14px 14px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15 }}>{candidate.term}</div>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {candidate.count} mentions
        </div>
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--muted)",
          marginTop: 2,
          letterSpacing: 0.5,
        }}
      >
        suggested → {candidate.suggestedCategory}
      </div>
      {candidate.example && (
        <div
          style={{
            fontSize: 13,
            color: "#bbb",
            marginTop: 10,
            paddingLeft: 10,
            borderLeft: "2px solid var(--border)",
            fontStyle: "italic",
            lineHeight: 1.45,
          }}
        >
          "{candidate.example}"
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={onApprove}
          style={{
            flex: 1,
            padding: "10px 12px",
            background: "#1f3f1f",
            border: "1px solid #2f6f2f",
            color: "#cff0cf",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onReject}
          style={{
            flex: 1,
            padding: "10px 12px",
            background: "#3a1a1a",
            border: "1px solid #6f2f2f",
            color: "#f0cfcf",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function ActionRow({
  label,
  tag,
  tone,
  onUndo,
}: {
  label: string;
  tag: string;
  tone: "approve" | "reject";
  onUndo: () => void;
}) {
  const toneColor = tone === "approve" ? "#9fd89f" : "#e6a0a0";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: 14, flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, color: toneColor, letterSpacing: 0.5 }}>
        {tag}
      </span>
      <button
        type="button"
        onClick={onUndo}
        style={{
          background: "transparent",
          border: "1px solid var(--border)",
          color: "var(--muted)",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        undo
      </button>
    </div>
  );
}

function KeywordChips({
  terms,
  muted = false,
  onSelect,
}: {
  terms: string[];
  muted?: boolean;
  onSelect?: (t: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {terms.map((t) =>
        onSelect ? (
          <button
            key={t}
            type="button"
            onClick={() => onSelect(t)}
            style={{
              padding: "5px 10px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              fontSize: 13,
              color: muted ? "var(--muted)" : "var(--text)",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            {t}
          </button>
        ) : (
          <span
            key={t}
            style={{
              padding: "5px 10px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              fontSize: 13,
              color: muted ? "var(--muted)" : "var(--text)",
            }}
          >
            {t}
          </span>
        )
      )}
    </div>
  );
}

function KeywordPopup({
  term,
  hits,
  onReject,
  onClose,
}: {
  term: string;
  hits: number | undefined;
  onReject: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "22px 20px 14px",
          width: "100%",
          maxWidth: 360,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Keyword
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            marginTop: 4,
            marginBottom: 16,
            wordBreak: "break-word",
          }}
        >
          {term}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 14px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 14 }}>Direct Hits</span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: hits == null ? "var(--muted)" : "var(--text)",
            }}
          >
            {hits != null ? hits.toLocaleString() : "—"}
          </span>
        </div>

        <button
          type="button"
          onClick={onReject}
          style={{
            display: "block",
            width: "100%",
            padding: "12px 14px",
            background: "#3a1a1a",
            border: "1px solid #6f2f2f",
            color: "#f0cfcf",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: 8,
          }}
        >
          Reject
        </button>

        <button
          type="button"
          onClick={onClose}
          style={{
            display: "block",
            width: "100%",
            padding: "10px 14px",
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--muted)",
            borderRadius: 10,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function RejectedSection({ terms }: { terms: string[] }) {
  const [open, setOpen] = useState(false);
  if (terms.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: 0,
          color: "inherit",
          font: "inherit",
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Rejected</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {terms.length}
        </span>
        <span
          style={{
            fontSize: 14,
            color: "var(--muted)",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 150ms ease",
          }}
        >
          ›
        </span>
      </button>
      <p
        style={{
          fontSize: 12,
          color: "var(--muted)",
          marginTop: 4,
          lineHeight: 1.5,
        }}
      >
        Never re-suggested.
      </p>
      {open && (
        <div style={{ marginTop: 12 }}>
          <KeywordChips terms={terms} muted />
        </div>
      )}
    </section>
  );
}
