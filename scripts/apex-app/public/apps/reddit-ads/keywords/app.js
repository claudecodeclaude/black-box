// Keywords admin (read + approve/reject candidates).
// State for approvals/rejections lives in localStorage. The bi-weekly Reddit
// scan run via Claude Code reads both the committed keywords.json and the
// localStorage overlay (exported by Jason or the future Mac helper) to
// materialize approvals into the source-of-truth file.

const $ = (id) => document.getElementById(id);
const LS_APPROVED = "reddit-ads/approved-candidates";
const LS_REJECTED = "reddit-ads/rejected-candidates";

function readList(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}
function writeList(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let approved = readList(LS_APPROVED); // [{term, category}]
let rejected = readList(LS_REJECTED); // [term, ...]

function approve(c) {
  approved = [...approved.filter((a) => a.term !== c.term), { term: c.term, category: c.suggestedCategory }];
  writeList(LS_APPROVED, approved);
  paint(currentData);
}
function rejectTerm(term) {
  rejected = Array.from(new Set([...rejected, term]));
  writeList(LS_REJECTED, rejected);
  paint(currentData);
}
function unapprove(term) {
  approved = approved.filter((a) => a.term !== term);
  writeList(LS_APPROVED, approved);
  paint(currentData);
}
function unreject(term) {
  rejected = rejected.filter((t) => t !== term);
  writeList(LS_REJECTED, rejected);
  paint(currentData);
}

let currentData = null;

async function load() {
  const r = await fetch("/apps/reddit-ads/data/keywords.json", { cache: "no-store" });
  if (!r.ok) {
    $("sections").textContent = `Couldn't load keywords.json (${r.status})`;
    return;
  }
  currentData = await r.json();
  paint(currentData);
}

function paint(data) {
  const root = $("sections");
  root.innerHTML = "";

  // Approved overlay (from localStorage)
  if (approved.length) {
    const sec = makeSection("Pending approvals", "Approved here, waiting for the next scan to fold into baseKeywords.");
    const grid = document.createElement("div");
    grid.className = "kw-grid";
    for (const a of approved) {
      const chip = makeChip(`${a.term}`, "approved");
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `→ ${a.category}`;
      chip.appendChild(meta);
      chip.title = "Tap to undo";
      chip.style.cursor = "pointer";
      chip.addEventListener("click", () => unapprove(a.term));
      grid.appendChild(chip);
    }
    sec.appendChild(grid);
    root.appendChild(sec);
  }

  // Candidates (≥10 mentions, awaiting approval)
  const liveCandidates = (data.candidates || []).filter(
    (c) => !rejected.includes(c.term) && !approved.find((a) => a.term === c.term)
  );
  const cs = makeSection(
    `Candidates (${liveCandidates.length})`,
    "Terms hit ≥10 times this scan that aren't already in base/misspellings/rejected. Tap to approve or reject."
  );
  const cg = document.createElement("div");
  cg.className = "kw-grid";
  if (liveCandidates.length === 0) {
    cg.innerHTML = `<span class="blurb">None pending review.</span>`;
  } else {
    for (const c of liveCandidates) {
      const wrap = document.createElement("span");
      wrap.style.display = "inline-flex";
      wrap.style.gap = "4px";
      const chip = makeChip(c.term, "candidate");
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${c.count}× → ${c.suggestedCategory}`;
      chip.appendChild(meta);
      chip.title = c.exampleQuote || "";
      chip.addEventListener("click", () => approve(c));
      wrap.appendChild(chip);
      const rej = document.createElement("button");
      rej.className = "kw-chip";
      rej.textContent = "✕";
      rej.title = "Reject";
      rej.style.cursor = "pointer";
      rej.style.borderColor = "#ff6b6b";
      rej.style.color = "#ff6b6b";
      rej.addEventListener("click", () => rejectTerm(c.term));
      wrap.appendChild(rej);
      cg.appendChild(wrap);
    }
  }
  cs.appendChild(cg);
  root.appendChild(cs);

  // Base keywords by category
  const bs = makeSection("Base keywords", "Approved terms the scrape uses every run. Hit-counts from the latest scan.");
  for (const [category, list] of Object.entries(data.baseKeywords || {})) {
    const lbl = document.createElement("div");
    lbl.className = "kw-cat";
    lbl.textContent = category;
    bs.appendChild(lbl);
    const g = document.createElement("div");
    g.className = "kw-grid";
    for (const term of list) {
      const chip = makeChip(term);
      const hits = (data.hitCounts || {})[term];
      if (typeof hits === "number") {
        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = `${hits}×`;
        chip.appendChild(meta);
      }
      g.appendChild(chip);
    }
    bs.appendChild(g);
  }
  root.appendChild(bs);

  // Misspellings (auto-added)
  if ((data.misspellings || []).length) {
    const ms = makeSection(`Misspellings (${data.misspellings.length})`, "Auto-added when a near-miss term hits ≥3 times — no approval needed.");
    const mg = document.createElement("div");
    mg.className = "kw-grid";
    for (const term of data.misspellings) {
      mg.appendChild(makeChip(term));
    }
    ms.appendChild(mg);
    root.appendChild(ms);
  }

  // Rejected (committed + local)
  const allRejected = Array.from(new Set([...(data.rejected || []), ...rejected]));
  if (allRejected.length) {
    const rs = makeSection(`Rejected (${allRejected.length})`, "Won't be re-suggested. Tap a locally-rejected term to take it back.");
    const rg = document.createElement("div");
    rg.className = "kw-grid";
    for (const term of allRejected) {
      const chip = makeChip(term, "rejected");
      if (rejected.includes(term)) {
        chip.style.cursor = "pointer";
        chip.title = "Tap to undo (locally rejected)";
        chip.addEventListener("click", () => unreject(term));
      }
      rg.appendChild(chip);
    }
    rs.appendChild(rg);
    root.appendChild(rs);
  }
}

function makeSection(title, blurb) {
  const sec = document.createElement("section");
  sec.className = "kw-section";
  const h = document.createElement("h2");
  h.textContent = title;
  sec.appendChild(h);
  if (blurb) {
    const b = document.createElement("p");
    b.className = "blurb";
    b.textContent = blurb;
    sec.appendChild(b);
  }
  return sec;
}

function makeChip(text, extraClass) {
  const span = document.createElement("span");
  span.className = "kw-chip" + (extraClass ? " " + extraClass : "");
  span.textContent = text;
  return span;
}

load();
