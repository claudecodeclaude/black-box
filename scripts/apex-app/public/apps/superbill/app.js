// Superbill Creator — scaffolding only for now.
//
// Real wire-up (file upload to /api/superbill/extract, server-side OCR +
// Ollama-based field extraction, PDF rendering per insurance template) is
// added in follow-up commits once Jason hands over a sample superbill so
// we can model the template + per-insurance variants accurately.

const $ = (id) => document.getElementById(id);

const state = {
  files: [],          // { name, file }
  extracted: null,    // populated after step 1 → 2
  step: "drop",       // "drop" | "review" | "output"
};

function show(stepId) {
  state.step = stepId.replace("step-", "");
  for (const id of ["step-drop", "step-review", "step-output"]) {
    $(id).hidden = id !== stepId;
  }
  $("error").hidden = true;
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = false;
}

function renderFileList() {
  const list = $("fileList");
  list.innerHTML = "";
  for (const [i, f] of state.files.entries()) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${f.name} <span class="muted small">(${Math.round(f.file.size / 1024)} KB)</span></span>`;
    const btn = document.createElement("button");
    btn.className = "remove";
    btn.type = "button";
    btn.textContent = "×";
    btn.addEventListener("click", () => {
      state.files.splice(i, 1);
      renderFileList();
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  $("extractBtn").disabled = state.files.length === 0;
}

function addFiles(fileList) {
  for (const f of fileList) {
    state.files.push({ name: f.name, file: f });
  }
  renderFileList();
}

// --- drop zone wiring ---
const dropZone = $("dropZone");
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
});
$("pickBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => addFiles(e.target.files));

// --- extract (stub for now) ---
$("extractBtn").addEventListener("click", async () => {
  $("extractBtn").disabled = true;
  $("extractBtn").textContent = "Extracting…";
  try {
    // TODO wire to /api/superbill/extract once the server side exists.
    // For now, jump to a blank Review screen so we can iterate UI.
    state.extracted = blankSuperbill();
    populateReview(state.extracted);
    show("step-review");
  } catch (err) {
    showError(String(err.message || err));
  } finally {
    $("extractBtn").disabled = false;
    $("extractBtn").textContent = "Extract fields →";
  }
});

$("backToDrop").addEventListener("click", () => show("step-drop"));
$("backToReview").addEventListener("click", () => show("step-review"));

$("renderBtn").addEventListener("click", () => {
  state.extracted = collectReview();
  // TODO post to /api/superbill/render with template choice → returns PDF URL.
  show("step-output");
});

$("addDx").addEventListener("click", () => {
  state.extracted.diagnoses.push({ code: "", description: "" });
  renderDxRows();
});
$("addSvc").addEventListener("click", () => {
  state.extracted.services.push({ cpt: "", modifier: "", units: 1, fee: 0, dxPointers: "1" });
  renderSvcRows();
});

// --- data model + form glue ---
function blankSuperbill() {
  return {
    patient: { name: "", dob: "", address: "", phone: "", insurance: { company: "", memberId: "", groupNumber: "" } },
    provider: { practice: "", name: "", npi: "", taxId: "", address: "", phone: "" },
    encounter: { date: "", pos: "11", referring: "" },
    diagnoses: [],
    services: [],
    totals: { charges: 0, paid: 0 },
  };
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  let target = obj;
  for (const p of parts) {
    target[p] = target[p] || {};
    target = target[p];
  }
  target[last] = value;
}

function populateReview(data) {
  for (const input of document.querySelectorAll("[data-path]")) {
    const v = getPath(data, input.dataset.path);
    input.value = v == null ? "" : v;
  }
  renderDxRows();
  renderSvcRows();
}

function collectReview() {
  const out = blankSuperbill();
  for (const input of document.querySelectorAll("[data-path]")) {
    const value = input.type === "number" ? Number(input.value) : input.value;
    setPath(out, input.dataset.path, value);
  }
  out.diagnoses = readRows("dxRows", ["code", "description"]);
  out.services = readRows("svcRows", ["cpt", "modifier", "units", "fee", "dxPointers"]);
  return out;
}

function readRows(containerId, fields) {
  const rows = [];
  for (const card of $(containerId).querySelectorAll(".row-card")) {
    const obj = {};
    fields.forEach((f, i) => {
      const input = card.querySelectorAll("input")[i];
      obj[f] = input ? input.value : "";
    });
    rows.push(obj);
  }
  return rows;
}

function renderDxRows() {
  const c = $("dxRows");
  c.innerHTML = "";
  state.extracted.diagnoses.forEach((d, i) => {
    const card = document.createElement("div");
    card.className = "row-card dx";
    card.innerHTML = `
      <input placeholder="ICD-10 (e.g. G62.9)" value="${d.code || ""}" />
      <input placeholder="Description" value="${d.description || ""}" />
      <button class="del" type="button" aria-label="remove">×</button>`;
    card.querySelector(".del").addEventListener("click", () => {
      state.extracted.diagnoses.splice(i, 1);
      renderDxRows();
    });
    c.appendChild(card);
  });
}

function renderSvcRows() {
  const c = $("svcRows");
  c.innerHTML = "";
  state.extracted.services.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "row-card svc";
    card.innerHTML = `
      <input placeholder="CPT" value="${s.cpt || ""}" />
      <input placeholder="Mod" value="${s.modifier || ""}" />
      <input type="number" placeholder="Units" value="${s.units || 1}" />
      <input type="number" placeholder="Fee" value="${s.fee || 0}" step="0.01" />
      <input placeholder="Dx ptrs (1,2)" value="${s.dxPointers || "1"}" />
      <button class="del" type="button" aria-label="remove">×</button>`;
    card.querySelector(".del").addEventListener("click", () => {
      state.extracted.services.splice(i, 1);
      renderSvcRows();
    });
    c.appendChild(card);
  });
}

show("step-drop");
