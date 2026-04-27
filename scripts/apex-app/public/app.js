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
  maybeShowPasskeyBanner(user);
}

const PASSKEY_SKIP_LS_KEY = (username) => `apex/passkey-prompt-skipped/${username}`;

async function maybeShowPasskeyBanner(user) {
  const banner = $("passkeyBanner");
  if (!banner) return;
  banner.hidden = true;
  if (!window.PublicKeyCredential) return;
  if (localStorage.getItem(PASSKEY_SKIP_LS_KEY(user.username))) return;
  try {
    const r = await fetch("/api/passkey/list", { credentials: "same-origin" });
    if (!r.ok) return;
    const { passkeys } = await r.json();
    if (passkeys && passkeys.length > 0) return; // already enrolled
    banner.hidden = false;
  } catch {}
}

function dismissPasskeyBanner(username, skipped) {
  $("passkeyBanner").hidden = true;
  if (skipped) localStorage.setItem(PASSKEY_SKIP_LS_KEY(username), "1");
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

// --- Passkeys / WebAuthn ---------------------------------------------------

// SimpleWebAuthn-style helpers: convert between base64url and ArrayBuffer.
function b64urlToBuf(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + (4 - s.length % 4) % 4, "=");
  const bin = atob(padded);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Hide the passkey button on browsers that don't support WebAuthn.
if (!window.PublicKeyCredential) {
  const btn = $("passkeyBtn");
  if (btn) btn.style.display = "none";
}

$("passkeyBtn")?.addEventListener("click", async () => {
  const errEl = $("loginError");
  errEl.hidden = true;
  const btn = $("passkeyBtn");
  btn.disabled = true;
  btn.textContent = "Waiting for passkey…";
  try {
    const beginRes = await fetch("/api/passkey/auth/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: "{}",
    });
    if (!beginRes.ok) throw new Error(`begin failed (${beginRes.status})`);
    const { challengeId, options } = await beginRes.json();

    // Translate base64url fields the server gave us into ArrayBuffers for
    // navigator.credentials.get().
    const publicKey = {
      ...options,
      challenge: b64urlToBuf(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((c) => ({
        ...c,
        id: b64urlToBuf(c.id),
      })),
    };
    const cred = await navigator.credentials.get({ publicKey });
    const response = {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        authenticatorData: bufToB64url(cred.response.authenticatorData),
        signature: bufToB64url(cred.response.signature),
        userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : undefined,
      },
      clientExtensionResults: cred.getClientExtensionResults?.() || {},
      authenticatorAttachment: cred.authenticatorAttachment,
    };

    const finishRes = await fetch("/api/passkey/auth/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ challengeId, response }),
    });
    const j = await finishRes.json().catch(() => ({}));
    if (!finishRes.ok) {
      errEl.textContent = j.error || `Passkey sign-in failed (${finishRes.status})`;
      errEl.hidden = false;
      return;
    }
    paintDashboard(j.user);
  } catch (err) {
    if (err.name === "NotAllowedError") {
      // User cancelled or no matching passkey — silent.
      return;
    }
    errEl.textContent = `Passkey error: ${err.message || err}`;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="key">🔑</span> Sign in with passkey';
  }
});

async function refreshPasskeys() {
  try {
    const r = await fetch("/api/passkey/list", { credentials: "same-origin" });
    if (!r.ok) return;
    const { passkeys } = await r.json();
    const list = $("passkeyList");
    list.innerHTML = "";
    for (const pk of passkeys || []) {
      const row = document.createElement("div");
      row.className = "passkey-row";
      const left = document.createElement("div");
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = pk.name || "Passkey";
      const meta = document.createElement("div");
      meta.className = "meta";
      const created = new Date(pk.createdAt).toLocaleDateString();
      const used = pk.lastUsedAt ? new Date(pk.lastUsedAt).toLocaleDateString() : "never used";
      meta.textContent = `added ${created} · last used ${used}`;
      left.appendChild(name);
      left.appendChild(meta);
      row.appendChild(left);
      const del = document.createElement("button");
      del.textContent = "remove";
      del.addEventListener("click", () => removePasskey(pk.id));
      row.appendChild(del);
      list.appendChild(row);
    }
  } catch {}
}

async function removePasskey(id) {
  if (!confirm("Remove this passkey?")) return;
  await fetch(`/api/passkey/${id}`, { method: "DELETE", credentials: "same-origin" });
  refreshPasskeys();
}

async function enrollPasskey() {
  const beginRes = await fetch("/api/passkey/register/begin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: "{}",
  });
  if (!beginRes.ok) throw new Error(`begin failed (${beginRes.status})`);
  const options = await beginRes.json();

  const publicKey = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    user: { ...options.user, id: b64urlToBuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({
      ...c, id: b64urlToBuf(c.id),
    })),
  };

  const cred = await navigator.credentials.create({ publicKey });
  const response = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      attestationObject: bufToB64url(cred.response.attestationObject),
      transports: cred.response.getTransports ? cred.response.getTransports() : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
    authenticatorAttachment: cred.authenticatorAttachment,
  };

  const defaultName = navigator.userAgent.includes("iPhone") ? "iPhone"
    : navigator.userAgent.includes("Mac") ? "Mac"
    : navigator.userAgent.includes("Windows") ? "Windows PC"
    : "this device";
  const name = prompt("Name this passkey:", defaultName) || defaultName;

  const finishRes = await fetch("/api/passkey/register/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ response, name }),
  });
  const j = await finishRes.json().catch(() => ({}));
  if (!finishRes.ok) throw new Error(j.error || `register failed (${finishRes.status})`);
  return j;
}

$("passkeyBannerSetup")?.addEventListener("click", async () => {
  const btn = $("passkeyBannerSetup");
  btn.disabled = true;
  btn.textContent = "Setting up…";
  try {
    await enrollPasskey();
    $("passkeyBanner").hidden = true;
    alert("Passkey added. Next time you can sign in with just Face ID or Touch ID.");
  } catch (err) {
    if (err.name !== "NotAllowedError") {
      alert(`Couldn't add passkey: ${err.message || err}`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Set up now";
  }
});

$("passkeyBannerSkip")?.addEventListener("click", () => {
  // Hide immediately for snappy UX — record the skip in localStorage in the
  // background using the username we already showed in the topbar.
  $("passkeyBanner").hidden = true;
  const username = $("whoUsername").textContent.trim();
  if (username) {
    try { localStorage.setItem(PASSKEY_SKIP_LS_KEY(username), "1"); } catch {}
  }
});

init();
