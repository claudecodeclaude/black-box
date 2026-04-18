import Link from "next/link";
import Banners from "./Banners";
import { report } from "./data";

export default function RedditAdsPage() {
  const generated = new Date(report.generatedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 64px" }}>
      <Link
        href="/"
        style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
      >
        ← Back
      </Link>

      <div style={{ marginTop: 24, marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>
          Reddit Ads
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--muted)",
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          Top topics being discussed around{" "}
          <span style={{ color: "var(--text)" }}>{report.keywordSet}</span>.
          Tap any row to generate hooks and video ideas from real comments.
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 12,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: "var(--muted)",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Last updated {generated} · {report.topics.length} topics
          </span>
          <Link
            href="/apex/reddit-ads/keywords"
            style={{
              fontSize: 12,
              color: "var(--muted)",
              textDecoration: "none",
              padding: "4px 10px",
              border: "1px solid var(--border)",
              borderRadius: 999,
              marginLeft: "auto",
            }}
          >
            Keywords
          </Link>
        </div>
      </div>

      <Banners generatedAt={report.generatedAt} />

      <ol
        style={{
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {[...report.topics].sort((a, b) => b.count - a.count).map((topic, i) => (
          <li key={topic.slug}>
            <Link
              href={`/apex/reddit-ads/${topic.slug}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: "var(--surface)",
                borderRadius: 10,
                border: "1px solid var(--border)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span
                style={{
                  width: 28,
                  fontSize: 12,
                  color: "var(--muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>
                {topic.name}
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {topic.count.toLocaleString()}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
