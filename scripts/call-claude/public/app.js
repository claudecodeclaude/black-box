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
const transcriptEl = $("transcript");
const responseEl = $("response");
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const resetBtn = $("resetBtn");

let state = "idle";
let currentTurn = null; // AbortController for /api/turn
let wakeLock = null;

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
  stateEl.textContent = labels[next] || next;
  startBtn.disabled = next !== "idle" && next !== "error";
  stopBtn.disabled = next === "idle" || next === "error";
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

// ---------- TTS (still browser SpeechSynthesis) ----------

const synth = window.speechSynthesis;
function speak(text) {
  return new Promise((resolve) => {
    if (!text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.0;
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
  transcriptEl.textContent = "";
  responseEl.textContent = "";
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

  transcriptEl.textContent = text || "(didn't catch that)";
  if (!text || text.length < 2) {
    if (state !== "idle") startVoiceLoop();
    return;
  }
  await sendTurn(text);
}

// ---------- Claude turn ----------

async function sendTurn(userText) {
  setState("thinking");
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
        } else if (evt.type === "error") {
          throw new Error(evt.message);
        }
      }
    }
  } catch (err) {
    console.error(err);
    assistantText = "sorry — something went wrong. " + (err.message || "");
  }

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

  if (state === "idle") return;
  const reopened = await openMic();
  if (!reopened) return;
  startVoiceLoop();
}

// ---------- controls ----------

startBtn.addEventListener("click", async () => {
  const ok = await openMic();
  if (!ok) return;
  await acquireWakeLock();
  // iOS: prime TTS engine with a silent utterance
  const warm = new SpeechSynthesisUtterance(" ");
  warm.volume = 0;
  synth.speak(warm);
  startVoiceLoop();
});

stopBtn.addEventListener("click", () => {
  setState("idle");
  try { synth.cancel(); } catch {}
  try { currentTurn?.abort(); } catch {}
  closeMic();
  releaseWakeLock();
});

resetBtn.addEventListener("click", async () => {
  try { await fetch("/api/reset", { method: "POST" }); }
  catch {}
  responseEl.textContent = "";
  transcriptEl.textContent = "";
  stateEl.textContent = "new conversation — tap start";
});

if (synth && typeof synth.getVoices === "function") {
  synth.getVoices();
  synth.onvoiceschanged = () => synth.getVoices();
}

setState("idle");
