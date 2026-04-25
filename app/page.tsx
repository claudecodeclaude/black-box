"use client";

import { HomeItem, HomeList } from "./_components/HomeTiles";

const home: HomeItem[] = [
  {
    kind: "tile",
    href: "/ninja",
    name: "Ninja Lab",
    description: "Upload ninja run videos, annotate frames, and save attempts for review.",
  },
  {
    kind: "tile",
    href: "/cleaning",
    name: "Cleaning",
    description: "Jodi & Cody's rotating 5-week cleaning checklist — Gameboy-style.",
  },
  {
    kind: "folder",
    name: "Claude",
    description: "Remote access to the Mac Mini's Claude Code session.",
    items: [
      {
        kind: "tile",
        href: "https://jasons-mac-mini-1.taile58089.ts.net:7684/",
        name: "Claude Code Terminal",
        description: "Terminal into the Mac Mini's Claude Code session over Tailscale.",
        external: true,
      },
      {
        kind: "tile",
        href: "https://jasons-mac-mini-1.taile58089.ts.net:7683/",
        name: "Call Claude",
        description: "Hands-free voice conversation with Claude Code — speak and listen.",
        external: true,
      },
    ],
  },
];

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

      <HomeList items={home} alertsById={{}} />
    </main>
  );
}
