// Sales Calls — Apex App sub-app.
// Reads records from the sales-calls helper service. The helper lives on the
// same Mac Mini, exposed over Tailscale on a different port (default 7687).
// We read at /api/sales-calls/* which the Apex App server proxies through, so
// this page stays same-origin and inherits the existing passkey/session auth.

const $ = (sel) => document.querySelector(sel);
const recordsEl = $("#records");
const statusEl = $("#status");
const errorEl = $("#error");
const refreshBtn = $("#refreshBtn");

const SCHEMA_FIELDS = [
  ["credentials", "Credentials"],
  ["treatingNeuropathy", "Currently treating neuropathy"],
  ["protocols", "Protocols"],
  ["neuropathyProgramPrice", "Neuropathy program price"],
  ["cashHighTicketExperience", "Cash high-ticket sales experience"],
  ["capacityForNewPatients", "Capacity for new patients"],
  ["staffForLeadFlow", "Staff to support lead flow"],
  ["currentNeuropathyAds", "Currently advertising for neuropathy"],
  ["adAgencyPainPoints", "Pain points / past ad agency issues"],
  ["objections", "Objections raised"],
  ["decisionMakers", "Decision-makers besides them"],
  ["whatTheyWant", "What they want from an ad agency"],
  ["personal", "Personal (family, hobbies, rapport)"],
  ["nextSteps", "Next steps"],
  ["redFlags", "Red flags"],
];

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function setError(msg) {
  if (!msg) { errorEl.hidden = true; errorEl.textContent = ""; return; }
  errorEl.hidden = false;
  errorEl.textContent = msg;
}

function statusBadge(status) {
  const map = {
    pending:   { label: "Awaiting extraction", cls: "badge pending" },
    extracted: { label: "Ready to push",       cls: "badge ready" },
    pushed:    { label: "Pushed to NPE",       cls: "badge done" },
  };
  const m = map[status] || { label: status || "?", cls: "badge" };
  return `<span class="${m.cls}">${m.label}</span>`;
}

function renderRecordCard(meta) {
  const el = document.createElement("div");
  el.className = "record";
  el.dataset.id = meta.id;
  el.innerHTML = `
    <div class="record-head">
      <div class="record-title">
        <div class="doc">${escapeHtml(meta.doctorName || "(no name)")}</div>
        <div class="meta-line">${fmtDate(meta.createdAt)} · ${statusBadge(meta.status)}${meta.hasThoughts ? ' · <span class="thoughts-pill">+ thoughts</span>' : ""}</div>
      </div>
      <button class="ghost-toggle expand-btn">View</button>
    </div>
    <div class="record-body" hidden></div>
  `;
  el.querySelector(".expand-btn").addEventListener("click", () => toggleRecord(el, meta.id));
  return el;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function toggleRecord(el, id) {
  const body = el.querySelector(".record-body");
  const btn = el.querySelector(".expand-btn");
  if (!body.hidden) {
    body.hidden = true;
    btn.textContent = "View";
    return;
  }
  body.hidden = false;
  btn.textContent = "Hide";
  body.innerHTML = `<div class="muted small">Loading…</div>`;
  try {
    const r = await fetch(`/api/sales-calls/records/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    body.innerHTML = renderRecordBody(data);
    wireRecordBody(body, id, data);
  } catch (e) {
    body.innerHTML = `<div class="error">Couldn't load: ${escapeHtml(e.message || e)}</div>`;
  }
}

function renderRecordBody({ meta, transcript, extracted, thoughts }) {
  const fieldsHtml = extracted
    ? SCHEMA_FIELDS.map(([k, label]) => {
        const v = extracted[k];
        if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "";
        const body = Array.isArray(v)
          ? `<ul>${v.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
          : `<div class="field-body">${escapeHtml(v)}</div>`;
        return `<div class="field"><div class="field-label">${escapeHtml(label)}</div>${body}</div>`;
      }).filter(Boolean).join("")
    : `<div class="muted small">Not extracted yet. Run <code>process sales calls</code> in the Claude Code Terminal to extract.</div>`;

  return `
    <div class="section">
      <h4>Extracted notes</h4>
      ${fieldsHtml}
    </div>

    ${thoughts ? `
    <div class="section">
      <h4>Jason's post-call thoughts</h4>
      <pre class="thoughts">${escapeHtml(thoughts)}</pre>
    </div>` : ""}

    <div class="section">
      <h4>Transcript</h4>
      <pre class="transcript">${escapeHtml(transcript || "(no transcript)")}</pre>
    </div>

    <div class="actions-row">
      ${meta.status === "extracted"
        ? `<button class="primary push-btn">Push to NPE</button>`
        : ""}
      <span class="push-status muted small"></span>
    </div>
  `;
}

function wireRecordBody(body, id, _data) {
  const pushBtn = body.querySelector(".push-btn");
  if (!pushBtn) return;
  pushBtn.addEventListener("click", async () => {
    const statusSpan = body.querySelector(".push-status");
    pushBtn.disabled = true;
    statusSpan.textContent = "Pushing…";
    try {
      const r = await fetch(`/api/sales-calls/records/${encodeURIComponent(id)}/push-to-npe`, {
        method: "POST",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        statusSpan.textContent = data.error
          ? `${data.error}${data.detail ? " — " + data.detail : ""}`
          : `HTTP ${r.status}`;
        pushBtn.disabled = false;
        return;
      }
      statusSpan.textContent = "Pushed.";
      load();
    } catch (e) {
      statusSpan.textContent = `Error: ${e.message || e}`;
      pushBtn.disabled = false;
    }
  });
}

async function load() {
  setError(null);
  statusEl.textContent = "Loading…";
  try {
    const r = await fetch("/api/sales-calls/records");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { records } = await r.json();
    recordsEl.innerHTML = "";
    if (!records || records.length === 0) {
      recordsEl.innerHTML = `<div class="muted">No calls yet. Use the iPhone Shortcut to send one in.</div>`;
      statusEl.textContent = "";
      return;
    }
    for (const meta of records) recordsEl.appendChild(renderRecordCard(meta));
    const pending = records.filter((r) => r.status === "pending").length;
    statusEl.textContent = `${records.length} call${records.length === 1 ? "" : "s"}${pending ? ` · ${pending} awaiting extraction` : ""}`;
  } catch (e) {
    setError(`Couldn't load records: ${e.message || e}`);
    statusEl.textContent = "";
  }
}

refreshBtn.addEventListener("click", load);
load();
