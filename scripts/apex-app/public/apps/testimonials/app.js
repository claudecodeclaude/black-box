// Vanilla port of the Black Box Testimonial Matcher to the HIPAA-compliant
// Apex App. All API calls go to the same-origin auth-gated server, which
// stores testimonials in SQLite and proxies match/transcribe to the
// existing testimonial-match service on port 7685.

const $ = (id) => document.getElementById(id);

let testimonials = [];
let logs = [];
let dbOpen = false;
let logsOpen = false;
let editingNumber = null;

const EASTERN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "short", day: "2-digit",
  hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
});
function formatEastern(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : EASTERN_FMT.format(d);
}

// --- Data fetch ----

async function refreshAll() {
  await Promise.all([refreshTestimonials(), refreshLogs()]);
}
async function refreshTestimonials() {
  const r = await fetch("/api/testimonials", { credentials: "same-origin" });
  if (!r.ok) return;
  const j = await r.json();
  testimonials = j.testimonials || [];
  // Heal any leftover gaps once on load.
  const hasGap = testimonials.some((t, i) => t.number !== i + 1);
  if (hasGap) {
    await fetch("/api/testimonials/compact", { method: "POST", credentials: "same-origin" });
    const r2 = await fetch("/api/testimonials", { credentials: "same-origin" });
    if (r2.ok) testimonials = (await r2.json()).testimonials || [];
  }
  paintCounts();
  paintList();
}
async function refreshLogs() {
  const r = await fetch("/api/testimonials/logs", { credentials: "same-origin" });
  if (!r.ok) return;
  logs = (await r.json()).entries || [];
  paintCounts();
  paintLogs();
}

function paintCounts() {
  $("counts").textContent = `${testimonials.length} testimonial${testimonials.length === 1 ? "" : "s"} loaded`;
  $("dbToggle").textContent = dbOpen
    ? "▴ Close Database"
    : `▾ Testimonial Database (${testimonials.length})`;
  $("logsToggle").textContent = logsOpen
    ? "▴ Close Past Entries"
    : `▾ Past Entries Database (${logs.length})`;
  $("addBtn").textContent = `Add as #${(testimonials.at(-1)?.number || 0) + 1}`;
}

// --- Match flow ----

$("matchBtn").addEventListener("click", async () => {
  const notes = $("notes").value.trim();
  if (!notes) return;
  const errEl = $("matchError");
  errEl.hidden = true;
  $("matchResults").innerHTML = "";
  $("matchBtn").disabled = true;
  $("matchBtn").textContent = "Matching…";
  try {
    const r = await fetch("/api/testimonials/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ notes }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = j.error || `HTTP ${r.status}`;
      errEl.hidden = false;
      return;
    }
    paintMatches(j.matches || []);
    refreshLogs(); // server already added a log entry
  } catch (e) {
    errEl.textContent = `Network error: ${e.message || e}`;
    errEl.hidden = false;
  } finally {
    $("matchBtn").disabled = false;
    $("matchBtn").textContent = "Match top 4";
  }
});

function paintMatches(matches) {
  const root = $("matchResults");
  root.innerHTML = "";
  for (const m of matches) {
    const full = testimonials.find((t) => t.number === m.number);
    const div = document.createElement("div");
    div.className = "match-result";
    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.alignItems = "baseline";
    head.style.gap = "12px";
    head.style.marginBottom = "6px";
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = `#${m.number}`;
    const reason = document.createElement("div");
    reason.className = "reason";
    reason.textContent = m.reason || "";
    head.appendChild(num);
    head.appendChild(reason);
    div.appendChild(head);
    if (full) {
      const preview = document.createElement("div");
      preview.className = "preview";
      preview.textContent = full.text.length > 220 ? full.text.slice(0, 220) + "…" : full.text;
      div.appendChild(preview);
    }
    root.appendChild(div);
  }
}

// --- Database panel ----

$("dbToggle").addEventListener("click", () => {
  dbOpen = !dbOpen;
  $("dbPanel").hidden = !dbOpen;
  $("dbToggle").classList.toggle("open", dbOpen);
  paintCounts();
});
$("logsToggle").addEventListener("click", () => {
  logsOpen = !logsOpen;
  $("logsPanel").hidden = !logsOpen;
  $("logsToggle").classList.toggle("open", logsOpen);
  paintCounts();
});

$("addBtn").addEventListener("click", async () => {
  const text = $("newText").value.trim();
  if (!text) return;
  $("addBtn").disabled = true;
  try {
    const r = await fetch("/api/testimonials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ text }),
    });
    if (r.ok) {
      $("newText").value = "";
      await refreshTestimonials();
    }
  } finally {
    $("addBtn").disabled = false;
  }
});

$("transcribeBtn").addEventListener("click", async () => {
  const url = $("videoUrl").value.trim();
  if (!url) return;
  const errEl = $("transcribeError");
  errEl.hidden = true;
  $("transcribeBtn").disabled = true;
  $("transcribeBtn").textContent = "Transcribing…";
  try {
    const r = await fetch("/api/testimonials/transcribe-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ url }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = j.error || `HTTP ${r.status}`;
      errEl.hidden = false;
      return;
    }
    if (!j.text?.trim()) {
      errEl.textContent = "Transcript came back empty — check the URL points to audio/video.";
      errEl.hidden = false;
      return;
    }
    const cur = $("newText").value.trim();
    $("newText").value = cur ? cur + "\n\n" + j.text : j.text;
    $("videoUrl").value = "";
  } catch (e) {
    errEl.textContent = `Network error: ${e.message || e}`;
    errEl.hidden = false;
  } finally {
    $("transcribeBtn").disabled = false;
    $("transcribeBtn").textContent = "Transcribe";
  }
});

function paintList() {
  const root = $("testimonialList");
  root.innerHTML = "";
  if (testimonials.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted small";
    empty.textContent = "No testimonials yet. Add your first one above.";
    root.appendChild(empty);
    return;
  }
  testimonials.forEach((t, idx) => {
    const row = document.createElement("div");
    row.className = "t-row";

    const header = document.createElement("div");
    header.className = "header";

    const left = document.createElement("div");
    left.className = "nleft";
    const numLabel = document.createElement("strong");
    numLabel.className = "num-label";
    numLabel.textContent = `#${t.number}`;
    left.appendChild(numLabel);
    const upBtn = document.createElement("button");
    upBtn.className = "arrow";
    upBtn.textContent = "▲";
    upBtn.title = "Move up (lower number)";
    upBtn.disabled = idx === 0;
    upBtn.addEventListener("click", () => reorder(t.number, "up"));
    left.appendChild(upBtn);
    const dnBtn = document.createElement("button");
    dnBtn.className = "arrow";
    dnBtn.textContent = "▼";
    dnBtn.title = "Move down (higher number)";
    dnBtn.disabled = idx === testimonials.length - 1;
    dnBtn.addEventListener("click", () => reorder(t.number, "down"));
    left.appendChild(dnBtn);
    header.appendChild(left);

    const actions = document.createElement("div");
    actions.className = "actions";
    if (editingNumber === t.number) {
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn-sm";
      saveBtn.textContent = "save";
      saveBtn.addEventListener("click", () => {
        const ta = row.querySelector("textarea");
        saveEdit(t.number, ta?.value || "");
      });
      actions.appendChild(saveBtn);
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn-sm";
      cancelBtn.textContent = "cancel";
      cancelBtn.addEventListener("click", () => { editingNumber = null; paintList(); });
      actions.appendChild(cancelBtn);
    } else {
      const editBtn = document.createElement("button");
      editBtn.className = "btn-sm";
      editBtn.textContent = "edit";
      editBtn.addEventListener("click", () => { editingNumber = t.number; paintList(); });
      actions.appendChild(editBtn);
      const delBtn = document.createElement("button");
      delBtn.className = "btn-sm danger";
      delBtn.textContent = "delete";
      delBtn.addEventListener("click", () => removeOne(t.number));
      actions.appendChild(delBtn);
    }
    header.appendChild(actions);
    row.appendChild(header);

    if (editingNumber === t.number) {
      const ta = document.createElement("textarea");
      ta.value = t.text;
      row.appendChild(ta);
    } else {
      const body = document.createElement("div");
      body.className = "body";
      body.textContent = t.text;
      row.appendChild(body);
    }

    root.appendChild(row);
  });
}

async function reorder(number, direction) {
  const r = await fetch("/api/testimonials/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ number, direction }),
  });
  if (r.ok) await refreshTestimonials();
}

async function saveEdit(number, text) {
  if (!text.trim()) return;
  const r = await fetch(`/api/testimonials/${number}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ text: text.trim() }),
  });
  if (r.ok) {
    editingNumber = null;
    await refreshTestimonials();
  }
}

async function removeOne(number) {
  if (!confirm(`Delete testimonial #${number}?`)) return;
  const r = await fetch(`/api/testimonials/${number}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (r.ok) await refreshTestimonials();
}

// --- Past entries ----

function paintLogs() {
  const root = $("logsList");
  root.innerHTML = "";
  if (logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted small";
    empty.textContent = "No past entries yet. Every match you run gets logged here.";
    root.appendChild(empty);
    return;
  }
  // Server already returns newest-first.
  for (const entry of logs) {
    const row = document.createElement("div");
    row.className = "log-row";

    const ts = document.createElement("div");
    ts.className = "ts";
    ts.textContent = formatEastern(entry.created_at);
    row.appendChild(ts);

    const sec1 = document.createElement("div");
    sec1.className = "sec";
    const lbl1 = document.createElement("div");
    lbl1.className = "sec-label";
    lbl1.textContent = "Consult notes";
    sec1.appendChild(lbl1);
    const notes = document.createElement("div");
    notes.className = "notes";
    notes.textContent = entry.notes;
    sec1.appendChild(notes);
    row.appendChild(sec1);

    const sec2 = document.createElement("div");
    sec2.className = "sec";
    const lbl2 = document.createElement("div");
    lbl2.className = "sec-label";
    lbl2.textContent = "Matched testimonials";
    sec2.appendChild(lbl2);
    const nums = document.createElement("div");
    nums.className = "nums";
    for (const m of entry.matches || []) {
      const span = document.createElement("span");
      span.textContent = `#${m.number}`;
      nums.appendChild(span);
    }
    sec2.appendChild(nums);
    row.appendChild(sec2);

    const sec3 = document.createElement("div");
    sec3.className = "sec";
    const lbl3 = document.createElement("div");
    lbl3.className = "sec-label";
    lbl3.textContent = "Why these match";
    sec3.appendChild(lbl3);
    const ul = document.createElement("ul");
    for (const m of entry.matches || []) {
      const li = document.createElement("li");
      const strong = document.createElement("strong");
      strong.textContent = `#${m.number}`;
      li.appendChild(strong);
      li.appendChild(document.createTextNode(` — ${m.reason || ""}`));
      ul.appendChild(li);
    }
    sec3.appendChild(ul);
    row.appendChild(sec3);

    root.appendChild(row);
  }
}

refreshAll();
