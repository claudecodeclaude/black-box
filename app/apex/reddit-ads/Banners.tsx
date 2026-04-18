"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { candidates } from "./keywords";

const LS_APPROVED = "reddit-ads/approved-candidates";
const LS_REJECTED = "reddit-ads/rejected-candidates";
const CLAUDE_CODE_URL = "http://100.74.13.60:7681/";
const STALE_DAYS = 14;

type Props = { generatedAt: string };

export default function Banners({ generatedAt }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    try {
      const approved = JSON.parse(
        localStorage.getItem(LS_APPROVED) || "[]"
      ) as { term: string }[];
      const rejected = JSON.parse(
        localStorage.getItem(LS_REJECTED) || "[]"
      ) as string[];
      const acted = new Set([
        ...approved.map((a) => a.term),
        ...rejected,
      ]);
      setPendingCount(candidates.filter((c) => !acted.has(c.term)).length);
    } catch {
      setPendingCount(candidates.length);
    }
    setHydrated(true);
  }, []);

  if (!hydrated) return null;

  const ageDays = Math.floor(
    (Date.now() - new Date(generatedAt).getTime()) / 86_400_000
  );
  const stale = ageDays >= STALE_DAYS;

  if (!stale && pendingCount === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
      {stale && (
        <a
          href={CLAUDE_CODE_URL}
          style={{
            display: "block",
            padding: "14px 16px",
            background: "#2a0e0e",
            border: "1px solid #6f2525",
            borderLeft: "4px solid #ff3b3b",
            borderRadius: 10,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#ff6b6b",
              letterSpacing: 2,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Update needed
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, marginTop: 4 }}>
            Last scan was {ageDays} days ago
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#e6a0a0",
              marginTop: 6,
              lineHeight: 1.4,
            }}
          >
            Tap to open Claude Code, then type:{" "}
            <code
              style={{
                background: "rgba(0,0,0,0.35)",
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              update reddit ads
            </code>
          </div>
        </a>
      )}

      {pendingCount > 0 && (
        <Link
          href="/apex/reddit-ads/keywords"
          style={{
            display: "block",
            padding: "12px 14px",
            background: "#2a230e",
            border: "1px solid #6f5725",
            borderLeft: "4px solid #ffd34d",
            borderRadius: 10,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#ffd34d",
              letterSpacing: 2,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Review needed
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>
            {pendingCount} new keyword{pendingCount === 1 ? "" : "s"} to approve or reject →
          </div>
        </Link>
      )}
    </div>
  );
}
