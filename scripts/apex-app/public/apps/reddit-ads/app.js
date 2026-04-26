// Reddit Ads landing page (vanilla port).

const $ = (id) => document.getElementById(id);

async function load() {
  const r = await fetch("/apps/reddit-ads/data/report.json", { cache: "no-store" });
  if (!r.ok) {
    $("topicList").innerHTML =
      `<li class="empty">Couldn't load report.json (${r.status})</li>`;
    return;
  }
  const report = await r.json();

  const generated = new Date(report.generatedAt).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  $("lede").innerHTML = `Top topics being discussed around <strong>${escapeHtml(report.keywordSet)}</strong>. Tap any row to see hooks and video ideas drawn from real comments.`;
  $("meta").textContent = `Last updated ${generated} · ${report.topics.length} topics`;

  paintBanners(report.generatedAt);

  const list = $("topicList");
  list.innerHTML = "";
  const sorted = [...report.topics].sort((a, b) => b.count - a.count);
  sorted.forEach((topic, i) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `/apps/reddit-ads/topic.html?slug=${encodeURIComponent(topic.slug)}`;
    a.className = "topic-row";
    a.innerHTML = `
      <span class="rank">${i + 1}</span>
      <span class="name"></span>
      <span class="count">${topic.count.toLocaleString()}</span>
    `;
    a.querySelector(".name").textContent = topic.name;
    li.appendChild(a);
    list.appendChild(li);
  });
}

function paintBanners(generatedAt) {
  const root = $("banners");
  root.innerHTML = "";
  const ageDays = (Date.now() - new Date(generatedAt).getTime()) / (24 * 60 * 60 * 1000);
  // Mirror the Black Box thresholds — yellow at 14d, red at 30d.
  if (ageDays > 30) {
    root.innerHTML = `<div class="banner red">Scan is over a month old — time to re-run the bi-weekly Reddit pipeline.</div>`;
  } else if (ageDays > 14) {
    root.innerHTML = `<div class="banner yellow">Scan is over two weeks old — consider re-running soon.</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

load();
