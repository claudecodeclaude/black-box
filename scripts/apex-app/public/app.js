const $ = (id) => document.getElementById(id);

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
