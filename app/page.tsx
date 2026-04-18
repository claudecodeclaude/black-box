"use client";

import Link from "next/link";
import { useState } from "react";

type Tile = {
  kind: "tile";
  href: string;
  name: string;
  description: string;
  external?: boolean;
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
        description: "Monthly Reddit topic scan for neuropathy, sciatica, and disc/back pain — with video hooks and ad ideas per topic.",
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

function TileBody({ tile }: { tile: Tile }) {
  return (
    <>
      <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
        {tile.name}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
        {tile.description}
      </div>
    </>
  );
}

function TileLink({ tile }: { tile: Tile }) {
  return tile.external ? (
    <a href={tile.href} style={tileStyle}>
      <TileBody tile={tile} />
    </a>
  ) : (
    <Link href={tile.href} style={tileStyle}>
      <TileBody tile={tile} />
    </Link>
  );
}

function FolderTile({ folder }: { folder: Folder }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          ...tileStyle,
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
          }}
          aria-hidden
        >
          {open ? "📂" : "📁"}
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
            <TileLink key={item.href} tile={item} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
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
            <FolderTile key={i} folder={item} />
          ) : (
            <TileLink key={item.href} tile={item} />
          )
        )}
      </div>
    </main>
  );
}
