// Call Claude — hands-free voice loop.
//
// State machine: idle -> listening -> thinking -> speaking -> listening -> ...
// Tapping "start" begins the loop. "stop" cancels and returns to idle.

const $ = (id) => document.getElementById(id);
const stateEl = $("state");
const transcriptEl = $("transcript");
const responseEl = $("response");
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const resetBtn = $("resetBtn");

let state = "idle";
let recognition = null;
let currentTurn = null; // AbortController
let wakeLock = null;

function setState(next) {
  state = next;
  document.body.className = `state-${next}`;
  const labels = {
    idle: "tap to start",
    listening: "listening...",
    thinking: "thinking...",
    speaking: "speaking...",
    error: "error — tap to retry",
  };
  stateEl.textContent = labels[next] || next;
  startBtn.disabled = next !== "idle" && next !== "error";
  stopBtn.disabled = next === "idle" || next === "error";
}

// ---------- screen wake lock (keep screen on while in call) ----------

async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (e) {
    console.warn("wakeLock failed", e);
  }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state !== "idle") acquireWakeLock();
});

// ---------- STT ----------

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  stateEl.textContent = "speech recognition not supported in this browser";
}

function startListening() {
  if (!SR) return;
  setState("listening");
  transcriptEl.textContent = "";
  responseEl.textContent = "";

  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let finalText = "";
  let lastInterim = "";

  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    lastInterim = interim;
    transcriptEl.textContent = finalText + interim;
  };

  recognition.onerror = (e) => {
    console.warn("recognition error", e.error);
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      setState("error");
      stateEl.textContent = "mic permission denied";
    }
    // no-speech: just restart
  };

  recognition.onend = () => {
    const text = (finalText || lastInterim).trim();
    if (state !== "listening") return; // user stopped
    if (text.length < 2) {
      // didn't hear anything — loop back
      startListening();
      return;
    }
    sendTurn(text);
  };

  try { recognition.start(); }
  catch (err) { console.error("start failed", err); setState("error"); }
}

function stopListening() {
  try { recognition?.stop(); } catch {}
  recognition = null;
}

// ---------- TTS ----------

const synth = window.speechSynthesis;

function speak(text) {
  return new Promise((resolve) => {
    if (!text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.0;
    // Prefer a nicer English voice if available
    const voices = synth.getVoices();
    const preferred =
      voices.find((v) => /Samantha|Karen|Daniel|Serena/i.test(v.name) && v.lang.startsWith("en")) ||
      voices.find((v) => v.lang.startsWith("en"));
    if (preferred) u.voice = preferred;
    u.onend = resolve;
    u.onerror = resolve;
    synth.speak(u);
  });
}

// ---------- one turn ----------

async function sendTurn(userText) {
  if (!userText) return;
  setState("thinking");
  stopListening();

  currentTurn = new AbortController();
  let assistantText = "";

  try {
    const res = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: userText }),
      signal: currentTurn.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === "text") {
          assistantText += evt.value;
          responseEl.textContent = assistantText;
        } else if (evt.type === "final" && !assistantText) {
          assistantText = evt.value;
          responseEl.textContent = assistantText;
        } else if (evt.type === "tool") {
          // optional: could narrate tool use briefly
        } else if (evt.type === "error") {
          throw new Error(evt.message);
        }
      }
    }
  } catch (err) {
    console.error(err);
    assistantText = "sorry — something went wrong. " + (err.message || "");
  }

  if (state === "idle") return; // user stopped mid-turn

  setState("speaking");
  // strip markdown-ish noise for TTS
  const spoken = assistantText
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_#>]/g, "")
    .trim();
  await speak(spoken);

  if (state === "idle") return;
  startListening();
}

// ---------- controls ----------

startBtn.addEventListener("click", async () => {
  if (!SR) return;
  await acquireWakeLock();
  // iOS: kick the TTS engine with a silent utterance so later calls work without extra gestures
  const warm = new SpeechSynthesisUtterance(" ");
  warm.volume = 0;
  synth.speak(warm);
  startListening();
});

stopBtn.addEventListener("click", () => {
  setState("idle");
  stopListening();
  try { synth.cancel(); } catch {}
  try { currentTurn?.abort(); } catch {}
  releaseWakeLock();
});

resetBtn.addEventListener("click", async () => {
  try { await fetch("/api/reset", { method: "POST" }); }
  catch {}
  responseEl.textContent = "";
  transcriptEl.textContent = "";
  stateEl.textContent = "new conversation — tap start";
});

// Preload voices on first interaction
if (synth && typeof synth.getVoices === "function") {
  synth.getVoices();
  synth.onvoiceschanged = () => synth.getVoices();
}

setState("idle");
