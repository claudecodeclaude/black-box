// Call Claude — hands-free voice loop (Whisper-based STT).
//
// We don't rely on the Web Speech API because iOS Safari often refuses it with
// "service-not-allowed" even when mic permission is granted. Instead:
//
//   1. getUserMedia → raw mic stream
//   2. Web Audio AnalyserNode watches volume
//   3. When speech detected → MediaRecorder starts
//   4. After ~1.2s of silence → stop, upload to /api/transcribe
//   5. Transcript → /api/turn → stream response → TTS
//   6. Loop

const $ = (id) => document.getElementById(id);
const stateEl = $("state");
const logEl = $("log");
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const resetBtn = $("resetBtn");
const overModeBtn = $("overModeBtn");
const muteBtn = $("muteBtn");

let state = "idle";
let currentTurn = null; // AbortController for /api/turn
let wakeLock = null;
let muted = false; // mic paused — call stays alive, nothing is transcribed

// "over" mode: buffer transcripts across silence breaks until the user
// says "over", then send the whole thing as one turn. Defaults on;
// preference is remembered across page reloads.
let overMode = (() => {
  const stored = localStorage.getItem("callClaudeOverMode");
  return stored === null ? true : stored === "true";
})();
let overBuffer = [];
// Trigger only when the chunk is the standalone word "over" (±punctuation),
// i.e. Jason pauses, says "over" on its own, then pauses again. Matching
// any trailing "over" would false-trigger mid-sentence ("wait for over...").
const OVER_RE = /^\s*over[\s.!?,]*$/i;

// Running chat log elements
let pendingUserLine = null; // user line being built up during overMode buffering
let currentAssistantLine = null; // assistant line being updated while streaming

function appendLine(role, speakerLabel, text = "") {
  const line = document.createElement("div");
  line.className = `line ${role}`;
  const speaker = document.createElement("span");
  speaker.className = "speaker";
  speaker.textContent = speakerLabel;
  const body = document.createElement("span");
  body.className = "body";
  body.textContent = text;
  line.appendChild(speaker);
  line.appendChild(body);
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  return line;
}

function setLineText(line, text) {
  if (!line) return;
  const body = line.querySelector(".body");
  if (body) body.textContent = text;
  logEl.scrollTop = logEl.scrollHeight;
}

// persistent audio plumbing (created once when the call starts)
let micStream = null;
let audioCtx = null;
let analyser = null;
let vadTimer = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingMime = "audio/webm";

function setState(next) {
  state = next;
  document.body.className = `state-${next}`;
  const labels = {
    idle: "tap to start",
    listening: "listening...",
    recording: "recording...",
    transcribing: "transcribing...",
    thinking: "thinking...",
    speaking: "speaking...",
    error: "error — tap to retry",
  };
  stateEl.textContent = next === "muted" ? "muted — tap unmute" : (labels[next] || next);
  startBtn.disabled = next !== "idle" && next !== "error";
  stopBtn.disabled = next === "idle" || next === "error";
  muteBtn.disabled = next === "idle" || next === "error";
}

// ---------- wake lock ----------

async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (e) { console.warn("wakeLock failed", e); }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state !== "idle") acquireWakeLock();
});

// ---------- TTS (server-side via macOS `say`, streamed back as m4a) ----------

// Reuse a single <audio> element — iOS needs it to have been "touched" by a
// user gesture at least once, so we create it on first start-tap and keep it.
let audioEl = null;
function ensureAudio() {
  if (audioEl) return audioEl;
  audioEl = document.createElement("audio");
  audioEl.playsInline = true;
  audioEl.preload = "auto";
  document.body.appendChild(audioEl);
  return audioEl;
}

async function speak(text) {
  if (!text) return;
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const el = ensureAudio();
    el.src = url;
    await new Promise((resolve) => {
      const done = () => {
        el.onended = null;
        el.onerror = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      el.onended = done;
      el.onerror = done;
      el.play().catch((err) => {
        console.error("audio play failed", err);
        done();
      });
    });
  } catch (err) {
    console.error("speak failed", err);
  }
}

// ---------- mic setup ----------

async function openMic() {
  if (micStream) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    console.error("getUserMedia failed", err);
    setState("error");
    stateEl.textContent = `mic blocked: ${err.name || err.message}`;
    return false;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);

  // Pick a mimeType that works on Safari (mp4) or Chrome/Firefox (webm)
  const candidates = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  recordingMime = candidates.find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
  return true;
}

function closeMic() {
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  try { mediaRecorder?.stop(); } catch {}
  mediaRecorder = null;
  recordedChunks = [];
  try { micStream?.getTracks().forEach((t) => t.stop()); } catch {}
  micStream = null;
  try { audioCtx?.close(); } catch {}
  audioCtx = null;
  analyser = null;
}

// ---------- VAD + recording ----------

const SILENCE_THRESHOLD = 0.015; // RMS (0-1); adjust for car noise if needed
const SPEECH_START_FRAMES = 3;   // ~60ms above threshold triggers record
const SILENCE_HANG_MS = 1200;    // stop after this much continuous silence
const MIN_RECORDING_MS = 400;    // ignore too-short blips
const MAX_RECORDING_MS = 20_000; // hard cap per utterance

function startVoiceLoop() {
  setState("listening");
  recordedChunks = [];

  const buf = new Uint8Array(analyser.fftSize);
  let aboveCount = 0;
  let lastSoundAt = 0;
  let recordingStartedAt = 0;
  let recording = false;

  const stopRec = () => {
    if (!recording) return;
    recording = false;
    try { mediaRecorder?.stop(); } catch {}
  };

  vadTimer = setInterval(() => {
    if (state !== "listening" && state !== "recording") return;
    analyser.getByteTimeDomainData(buf);
    // RMS over [-1, 1] signal derived from 8-bit PCM centered at 128
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / buf.length);
    const now = Date.now();

    if (!recording) {
      if (rms > SILENCE_THRESHOLD) {
        aboveCount++;
        if (aboveCount >= SPEECH_START_FRAMES) {
          recording = true;
          setState("recording");
          recordingStartedAt = now;
          lastSoundAt = now;
          recordedChunks = [];
          mediaRecorder = new MediaRecorder(micStream, recordingMime ? { mimeType: recordingMime } : {});
          mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordedChunks.push(e.data); };
          mediaRecorder.onstop = onRecordingStopped;
          try { mediaRecorder.start(); }
          catch (err) {
            console.error("recorder start failed", err);
            setState("error");
            stateEl.textContent = `recorder failed: ${err.name || err.message}`;
          }
        }
      } else {
        aboveCount = 0;
      }
      return;
    }

    // currently recording
    if (rms > SILENCE_THRESHOLD) lastSoundAt = now;

    const elapsed = now - recordingStartedAt;
    const silent = now - lastSoundAt;
    if ((silent > SILENCE_HANG_MS && elapsed > MIN_RECORDING_MS) || elapsed > MAX_RECORDING_MS) {
      stopRec();
    }
  }, 20);
}

async function onRecordingStopped() {
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  if (state === "idle") return;
  if (!recordedChunks.length) { startVoiceLoop(); return; }

  setState("transcribing");
  const blob = new Blob(recordedChunks, { type: recordingMime || "audio/webm" });
  recordedChunks = [];

  let text = "";
  try {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type },
      body: blob,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    text = (json.text || "").trim();
  } catch (err) {
    console.error("transcribe failed", err);
    text = "";
  }

  if (!text || text.length < 2) {
    if (state !== "idle" && !muted) startVoiceLoop();
    return;
  }

  if (overMode) {
    if (!OVER_RE.test(text)) {
      overBuffer.push(text);
      const combined = overBuffer.join(" ");
      if (!pendingUserLine) {
        pendingUserLine = appendLine("user pending", "you");
      }
      setLineText(pendingUserLine, combined);
      if (state !== "idle" && !muted) startVoiceLoop();
      return;
    }
    // Standalone "over" → commit buffer and send.
    const finalText = overBuffer.join(" ").trim();
    overBuffer = [];
    const committedLine = pendingUserLine;
    pendingUserLine = null;
    if (!finalText) {
      if (committedLine) committedLine.remove();
      if (state !== "idle" && !muted) startVoiceLoop();
      return;
    }
    committedLine.classList.remove("pending");
    setLineText(committedLine, finalText);
    await sendTurn(finalText);
    return;
  }

  appendLine("user", "you", text);
  await sendTurn(text);
}

// ---------- Claude turn ----------

async function sendTurn(userText) {
  setState("thinking");
  currentTurn = new AbortController();
  let assistantText = "";
  currentAssistantLine = appendLine("assistant", "claude", "…");

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
          setLineText(currentAssistantLine, assistantText);
        } else if (evt.type === "final" && !assistantText) {
          assistantText = evt.value;
          setLineText(currentAssistantLine, assistantText);
        } else if (evt.type === "error") {
          throw new Error(evt.message);
        }
      }
    }
  } catch (err) {
    console.error(err);
    assistantText = "sorry — something went wrong. " + (err.message || "");
    setLineText(currentAssistantLine, assistantText);
  }
  currentAssistantLine = null;

  if (state === "idle") return;

  setState("speaking");
  const spoken = assistantText
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_#>]/g, "")
    .trim();

  // iOS Safari routes audio to the earpiece (and at very low volume) whenever
  // a mic stream is live via getUserMedia. Fully release the mic so the audio
  // session returns to playback mode, speak, then reopen the mic.
  closeMic();
  await speak(spoken);

  if (state === "idle" || muted) return;
  const reopened = await openMic();
  if (!reopened) return;
  startVoiceLoop();
}

// ---------- controls ----------

// Tiny silent WAV used to unlock the <audio> element during a user gesture.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRhwAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

startBtn.addEventListener("click", (ev) => {
  ev.preventDefault();
  // === SYNCHRONOUS portion of the user gesture ===
  // Must happen before any await so iOS considers the audio element "unlocked".
  const el = ensureAudio();
  el.src = SILENT_WAV;
  el.play().catch(() => {});

  stateEl.textContent = "requesting mic...";

  // Now kick off the async work
  (async () => {
    try {
      const ok = await openMic();
      if (!ok) return; // openMic already set error state
      await acquireWakeLock();
      startVoiceLoop();
    } catch (err) {
      console.error("start failed", err);
      setState("error");
      stateEl.textContent = `start failed: ${err.name || err.message || err}`;
    }
  })();
});

stopBtn.addEventListener("click", () => {
  setState("idle");
  muted = false;
  muteBtn.setAttribute("aria-pressed", "false");
  muteBtn.textContent = "mute mic";
  try { audioEl?.pause(); } catch {}
  try { currentTurn?.abort(); } catch {}
  closeMic();
  releaseWakeLock();
});

resetBtn.addEventListener("click", async () => {
  try { await fetch("/api/reset", { method: "POST" }); }
  catch {}
  overBuffer = [];
  pendingUserLine = null;
  currentAssistantLine = null;
  logEl.textContent = "";
  stateEl.textContent = "new conversation — tap start";
});

overModeBtn.addEventListener("click", () => {
  overMode = !overMode;
  overModeBtn.setAttribute("aria-pressed", overMode ? "true" : "false");
  localStorage.setItem("callClaudeOverMode", String(overMode));
  if (!overMode) overBuffer = [];
});

muteBtn.addEventListener("click", async () => {
  if (state === "idle" || state === "error") return;
  if (!muted) {
    muted = true;
    muteBtn.setAttribute("aria-pressed", "true");
    muteBtn.textContent = "unmute mic";
    try { currentTurn?.abort(); } catch {}
    try { audioEl?.pause(); } catch {}
    closeMic();
    setState("muted");
  } else {
    muted = false;
    muteBtn.setAttribute("aria-pressed", "false");
    muteBtn.textContent = "mute mic";
    const ok = await openMic();
    if (!ok) return;
    startVoiceLoop();
  }
});

overModeBtn.setAttribute("aria-pressed", overMode ? "true" : "false");
setState("idle");
