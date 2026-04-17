import Link from "next/link";

const apps = [
  {
    href: "/qr",
    name: "QR Generator",
    description: "Create QR codes from any text or URL, with optional logo overlay.",
  },
  {
    href: "/ninja",
    name: "Ninja Lab",
    description: "Upload ninja run videos, annotate frames, and save attempts for review.",
  },
  {
    href: "http://100.74.13.60:7681/",
    name: "Claude Code",
    description: "Open a terminal into the Mac Mini's Claude Code session over Tailscale.",
    external: true,
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

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {apps.map((app) => {
          const tileStyle = {
            display: "block",
            padding: "20px 18px",
            background: "var(--surface)",
            borderRadius: 12,
            border: "1px solid var(--border)",
            textDecoration: "none",
            color: "inherit",
          } as const;
          const inner = (
            <>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
                {app.name}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
                {app.description}
              </div>
            </>
          );
          return app.external ? (
            <a key={app.href} href={app.href} style={tileStyle}>
              {inner}
            </a>
          ) : (
            <Link key={app.href} href={app.href} style={tileStyle}>
              {inner}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
