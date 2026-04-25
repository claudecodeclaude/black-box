const $ = (id) => document.getElementById(id);

// HIPAA-aligned client-side idle auto-logout (server enforces the same, but
// this also clears whatever PHI is on screen if Jason walks away).
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
let lastActivityAt = Date.now();
let idleTimer = null;
function markActive() { lastActivityAt = Date.now(); }
function startIdleWatch() {
  stopIdleWatch();
  lastActivityAt = Date.now();
  for (const ev of ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "visibilitychange"]) {
    window.addEventListener(ev, markActive, { passive: true });
  }
  idleTimer = setInterval(() => {
    if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) {
      forceLogout("signed out after 15 minutes of inactivity");
    }
  }, 30 * 1000);
}
function stopIdleWatch() {
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  for (const ev of ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "visibilitychange"]) {
    window.removeEventListener(ev, markActive);
  }
}
async function forceLogout(reason) {
  stopIdleWatch();
  try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch {}
  const err = $("loginError");
  if (err) { err.textContent = reason; err.hidden = false; }
  show("login");
}

const views = {
  loading: $("view-loading"),
  login: $("view-login"),
  dashboard: $("view-dashboard"),
};

function show(name) {
  for (const [k, el] of Object.entries(views)) {
    el.hidden = k !== name;
  }
}

async function fetchMe() {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (!res.ok) return null;
  const j = await res.json();
  return j.user;
}

function paintDashboard(user) {
  $("whoUsername").textContent = user.username;
  $("whoRole").textContent = user.role;
  show("dashboard");
  startIdleWatch();
}

async function onLogin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector("button[type=submit]");
  const errEl = $("loginError");
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const body = {
      username: form.username.value.trim(),
      password: form.password.value,
      mfa: form.mfa.value,
    };
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = j.error || `Login failed (${res.status})`;
      errEl.hidden = false;
      return;
    }
    form.reset();
    paintDashboard(j.user);
  } catch (err) {
    errEl.textContent = "Network error — check your tailnet connection.";
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
}

async function onLogout() {
  stopIdleWatch();
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch {}
  show("login");
}

async function init() {
  show("loading");
  const user = await fetchMe();
  if (user) paintDashboard(user);
  else show("login");
}

$("loginForm").addEventListener("submit", onLogin);
$("logoutBtn").addEventListener("click", onLogout);
init();
