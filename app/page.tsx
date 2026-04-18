"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { report } from "./apex/reddit-ads/data";
import { candidates } from "./apex/reddit-ads/keywords";

const LS_APPROVED = "reddit-ads/approved-candidates";
const LS_REJECTED = "reddit-ads/rejected-candidates";
const STALE_DAYS = 14;

type Alert = {
  label: string;
  tone: "red" | "yellow";
};

type Tile = {
  kind: "tile";
  href: string;
  name: string;
  description: string;
  external?: boolean;
  alertId?: "reddit-ads";
};

type Folder = {
  kind: "folder";
  name: string;
  description: string;
  items: Tile[];
};

type HomeItem = Tile | Folder;

const home: HomeItem[] = [
  {
    kind: "tile",
    href: "/ninja",
    name: "Ninja Lab",
    description: "Upload ninja run videos, annotate frames, and save attempts for review.",
  },
  {
    kind: "tile",
    href: "http://100.74.13.60:7681/",
    name: "Claude Code",
    description: "Open a terminal into the Mac Mini's Claude Code session over Tailscale.",
    external: true,
  },
  {
    kind: "folder",
    name: "Apex App Projects",
    description: "In-progress tools that will graduate to the Apex App.",
    items: [
      {
        kind: "tile",
        href: "/apex/reddit-ads",
        name: "Reddit Ads",
        description: "Bi-weekly Reddit topic scan for neuropathy, sciatica, and disc/back pain — with video hooks and ad ideas per topic.",
        alertId: "reddit-ads",
      },
      {
        kind: "tile",
        href: "/apex/qr",
        name: "QR Generator",
        description: "Create QR codes from any text or URL, with optional logo overlay.",
      },
    ],
  },
];

const tileStyle = {
  display: "block",
  padding: "20px 18px",
  background: "var(--surface)",
  borderRadius: 12,
  border: "1px solid var(--border)",
  textDecoration: "none",
  color: "inherit",
} as const;

function alertBorder(tone: Alert["tone"]) {
  return tone === "red" ? "#ff3b3b" : "#ffd34d";
}

function TileBody({ tile, alert }: { tile: Tile; alert?: Alert }) {
  return (
    <>
      <div
        style={{
          fontWeight: 600,
          fontSize: 16,
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{tile.name}</span>
        {alert && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              padding: "2px 7px",
              borderRadius: 999,
              background:
                alert.tone === "red" ? "#2a0e0e" : "#2a230e",
              color: alert.tone === "red" ? "#ff6b6b" : "#ffd34d",
              border: `1px solid ${alertBorder(alert.tone)}`,
              textTransform: "uppercase",
            }}
          >
            {alert.label}
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
        {tile.description}
      </div>
    </>
  );
}

function TileLink({ tile, alert }: { tile: Tile; alert?: Alert }) {
  const style = alert
    ? {
        ...tileStyle,
        borderLeft: `3px solid ${alertBorder(alert.tone)}`,
      }
    : tileStyle;
  return tile.external ? (
    <a href={tile.href} style={style}>
      <TileBody tile={tile} alert={alert} />
    </a>
  ) : (
    <Link href={tile.href} style={style}>
      <TileBody tile={tile} alert={alert} />
    </Link>
  );
}

function FolderTile({
  folder,
  alertsById,
}: {
  folder: Folder;
  alertsById: Record<string, Alert>;
}) {
  const [open, setOpen] = useState(false);
  const folderAlertTone: Alert["tone"] | null = (() => {
    const tones = folder.items
      .map((it) => (it.alertId ? alertsById[it.alertId]?.tone : null))
      .filter((t): t is Alert["tone"] => t !== null && t !== undefined);
    if (tones.includes("red")) return "red";
    if (tones.includes("yellow")) return "yellow";
    return null;
  })();

  const buttonStyle = folderAlertTone
    ? {
        ...tileStyle,
        borderLeft: `3px solid ${alertBorder(folderAlertTone)}`,
      }
    : tileStyle;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          ...buttonStyle,
          width: "100%",
          textAlign: "left",
          font: "inherit",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <span
          style={{
            fontSize: 22,
            lineHeight: 1,
            flexShrink: 0,
            position: "relative",
          }}
          aria-hidden
        >
          {open ? "📂" : "📁"}
          {folderAlertTone && (
            <span
              style={{
                position: "absolute",
                top: -2,
                right: -4,
                width: 10,
                height: 10,
                borderRadius: 999,
                background: alertBorder(folderAlertTone),
                border: "2px solid var(--surface)",
              }}
            />
          )}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 16,
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>{folder.name}</span>
            <span
              style={{
                fontSize: 12,
                color: "var(--muted)",
                fontWeight: 400,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {folder.items.length}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
            {folder.description}
          </div>
        </span>
        <span
          style={{
            fontSize: 14,
            color: "var(--muted)",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 150ms ease",
            flexShrink: 0,
          }}
          aria-hidden
        >
          ›
        </span>
      </button>

      {open && (
        <div
          style={{
            marginTop: 10,
            marginLeft: 16,
            paddingLeft: 14,
            borderLeft: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {folder.items.map((item) => (
            <TileLink
              key={item.href}
              tile={item}
              alert={item.alertId ? alertsById[item.alertId] : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function useRedditAdsAlert(): Alert | undefined {
  const [alert, setAlert] = useState<Alert | undefined>(undefined);
  useEffect(() => {
    const ageDays = Math.floor(
      (Date.now() - new Date(report.generatedAt).getTime()) / 86_400_000
    );
    const stale = ageDays >= STALE_DAYS;

    let pending = candidates.length;
    try {
      const approved = JSON.parse(
        localStorage.getItem(LS_APPROVED) || "[]"
      ) as { term: string }[];
      const rejected = JSON.parse(
        localStorage.getItem(LS_REJECTED) || "[]"
      ) as string[];
      const acted = new Set([...approved.map((a) => a.term), ...rejected]);
      pending = candidates.filter((c) => !acted.has(c.term)).length;
    } catch {}

    if (stale) {
      setAlert({ label: "Update", tone: "red" });
    } else if (pending > 0) {
      setAlert({ label: `${pending} to review`, tone: "yellow" });
    } else {
      setAlert(undefined);
    }
  }, []);
  return alert;
}

export default function Home() {
  const redditAdsAlert = useRedditAdsAlert();
  const alertsById: Record<string, Alert> = {};
  if (redditAdsAlert) alertsById["reddit-ads"] = redditAdsAlert;

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px" }}>
      <div style={{ marginBottom: 40 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          Black Box
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, letterSpacing: 2 }}>
          PERSONAL APP HUB
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {home.map((item, i) =>
          item.kind === "folder" ? (
            <FolderTile key={i} folder={item} alertsById={alertsById} />
          ) : (
            <TileLink
              key={item.href}
              tile={item}
              alert={item.alertId ? alertsById[item.alertId] : undefined}
            />
          )
        )}
      </div>
    </main>
  );
}
