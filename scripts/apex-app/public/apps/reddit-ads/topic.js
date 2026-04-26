// Reddit Ads — topic detail page (vanilla port).

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const slug = params.get("slug");

async function load() {
  if (!slug) {
    $("title").textContent = "Topic not found";
    return;
  }
  const r = await fetch("/apps/reddit-ads/data/report.json", { cache: "no-store" });
  if (!r.ok) {
    $("title").textContent = `Couldn't load report.json (${r.status})`;
    return;
  }
  const report = await r.json();
  const topic = report.topics.find((t) => t.slug === slug);
  if (!topic) {
    $("title").textContent = `No topic: ${slug}`;
    return;
  }

  document.title = `${topic.name} · Reddit Ads · Apex App`;
  const subs = topic.subreddits && topic.subreddits.length
    ? ` · ${topic.subreddits.join(", ")}`
    : "";
  $("meta").textContent = `${topic.count.toLocaleString()} mentions${subs}`;
  $("title").textContent = topic.name;

  const sections = [
    { title: "Authentic Hooks",
      blurb: "Drawn from how people actually speak about this on Reddit.",
      items: topic.authenticHooks || [] },
    { title: "Facebook-style Hooks",
      blurb: "Pattern-interrupt openers modeled on high-performing ad formats.",
      items: topic.fbHooks || [] },
    { title: "Video Ideas",
      blurb: "Concepts — not scripts. Shoot these as authentic, uncut talking-head pieces.",
      items: topic.videoIdeas || [] },
    { title: "Top Quoted Phrases",
      blurb: "Verbatim phrases pulled from comments. Use them to sound like one of the community.",
      items: topic.quotes || [] },
  ];

  const root = $("sections");
  root.innerHTML = "";
  for (const s of sections) {
    const sec = document.createElement("div");
    sec.className = "section";
    const h = document.createElement("h2");
    h.textContent = s.title;
    sec.appendChild(h);
    const b = document.createElement("p");
    b.className = "blurb";
    b.textContent = s.blurb;
    sec.appendChild(b);
    if (s.items.length === 0) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Not yet generated. Will populate after the next Reddit scan + LLM pass.";
      sec.appendChild(e);
    } else {
      const ol = document.createElement("ol");
      s.items.forEach((item, i) => {
        const li = document.createElement("li");
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = i + 1;
        const span = document.createElement("span");
        span.textContent = item;
        li.appendChild(num);
        li.appendChild(span);
        ol.appendChild(li);
      });
      sec.appendChild(ol);
    }
    root.appendChild(sec);
  }
}

load();
