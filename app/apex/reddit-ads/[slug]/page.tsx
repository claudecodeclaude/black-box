import Link from "next/link";
import { notFound } from "next/navigation";
import { findTopic, report } from "../data";

export function generateStaticParams() {
  return report.topics.map((t) => ({ slug: t.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

export default async function TopicPage({ params }: PageProps) {
  const { slug } = await params;
  const topic = findTopic(slug);
  if (!topic) notFound();

  const sections: { title: string; blurb: string; items: string[] }[] = [
    {
      title: "Authentic Hooks",
      blurb: "Drawn from how people actually speak about this on Reddit.",
      items: topic.authenticHooks,
    },
    {
      title: "Facebook-style Hooks",
      blurb: "Pattern-interrupt openers modeled on high-performing ad formats.",
      items: topic.fbHooks,
    },
    {
      title: "Video Ideas",
      blurb: "Concepts — not scripts. Shoot these as authentic, uncut talking-head pieces.",
      items: topic.videoIdeas,
    },
    {
      title: "Top Quoted Phrases",
      blurb: "Verbatim phrases pulled from comments. Use them to sound like one of the community.",
      items: topic.quotes,
    },
  ];

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 64px" }}>
      <Link
        href="/apex/reddit-ads"
        style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
      >
        ← All topics
      </Link>

      <div style={{ marginTop: 24, marginBottom: 28 }}>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {topic.count.toLocaleString()} mentions
          {topic.subreddits && topic.subreddits.length > 0 && (
            <> · {topic.subreddits.join(", ")}</>
          )}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>
          {topic.name}
        </h1>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {sections.map((section) => (
          <section key={section.title}>
            <h2 style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.5 }}>
              {section.title}
            </h2>
            <p
              style={{
                fontSize: 12,
                color: "var(--muted)",
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              {section.blurb}
            </p>
            {section.items.length === 0 ? (
              <div
                style={{
                  marginTop: 12,
                  padding: "14px 16px",
                  background: "var(--surface)",
                  border: "1px dashed var(--border)",
                  borderRadius: 10,
                  fontSize: 13,
                  color: "var(--muted)",
                }}
              >
                Not yet generated. Will populate after the next Reddit scan + LLM pass.
              </div>
            ) : (
              <ol
                style={{
                  marginTop: 12,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {section.items.map((item, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "12px 14px",
                      background: "var(--surface)",
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      fontSize: 14,
                      lineHeight: 1.45,
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        fontSize: 12,
                        color: "var(--muted)",
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
