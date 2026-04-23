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
const splashEl = $("splash");
const stopBtn = $("stopBtn");
const muteBtn = $("muteBtn");

let state = "idle";
let currentTurn = null; // AbortController for /api/turn
let wakeLock = null;
let muted = false; // mic paused — call stays alive, nothing is transcribed

// Queue of transcripts captured while Claude was busy (thinking/transcribing).
// Drained once the turn completes and listening resumes.
let queuedTurns = [];
let recordingIsQueued = false;

// "over" mode: always on. Buffers transcripts across silence breaks until
// Jason says "over" alone, then sends the whole thing as one turn.
const overMode = true;
let overBuffer = [];
// Trigger on the standalone word "over" plus common Whisper mishears for
// short clipped audio (hoover, thor, rover, etc). Case-insensitive, optional
// trailing punctuation. Must be the entire chunk, not mid-sentence.
const OVER_RE = /^\s*(over|hoover|thor|rover|clover|oever|ova|ower|o-?ver|oh-?ver|overr|oeuvre)[\s.!?,]*$/i;
// Standalone voice commands. Same pause-word-pause rule as "over", with
// common Whisper mishears accepted.
const MUTE_RE = /^\s*(mute|moot|meut|mewt)(\s+mic)?[\s.!?,]*$/i;
const UNMUTE_RE = /^\s*(un-?\s*(mute|moot|meut))(\s+mic)?[\s.!?,]*$/i;
const NEW_CONV_RE = /^\s*new\s+conversation[\s.!?,]*$/i;
// Clear the current over-mode buffer without sending — used when Whisper
// misheard something mid-sentence and Jason wants to restart.
const SCRATCH_RE = /^\s*(scratch\s+that|scratch|never\s*mind|cancel(\s+that)?|redo|start\s+over)[\s.!?,]*$/i;

// TTS voice — dynamic, client-side preference sent with each /api/speak call.
let ttsVoice = localStorage.getItem("callClaudeVoice") || "Nathan";
// Words-per-minute; macOS default is ~175. Nudged down so Jason can follow
// while driving.
let ttsRate = Number(localStorage.getItem("callClaudeRate")) || 160;

// Running chat log elements
let pendingUserLine = null; // user line being built up during overMode buffering
let currentAssistantLine = null; // assistant line being updated while streaming
let queuedLineEls = []; // preview lines shown while Claude is busy (removed on drain)

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

function playCommandBeep() {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1100, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
    gain.gain.linearRampToValueAtTime(0, t0 + 0.12);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.13);
  } catch (e) { console.warn("beep failed", e); }
}

function doMute() {
  muted = true;
  muteBtn.setAttribute("aria-pressed", "true");
  muteBtn.textContent = "unmute mic";
  queuedTurns = [];
  overBuffer = [];
  for (const el of queuedLineEls) el.remove();
  queuedLineEls = [];
  if (pendingUserLine) { pendingUserLine.remove(); pendingUserLine = null; }
  try { currentTurn?.abort(); } catch {}
  try { audioEl?.pause(); } catch {}
  setState("muted");
  playCommandBeep();
  appendLine("assistant warning", "!", "muted — say unmute to resume");
  startQueueListening();
}

function doUnmute() {
  muted = false;
  muteBtn.setAttribute("aria-pressed", "false");
  muteBtn.textContent = "mute mic";
  playCommandBeep();
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  if (!analyser) {
    openMic().then((ok) => { if (ok) startVoiceLoop(); });
    return;
  }
  startVoiceLoop();
}

function doScratch() {
  overBuffer = [];
  if (pendingUserLine) { pendingUserLine.remove(); pendingUserLine = null; }
  playCommandBeep();
  appendLine("assistant warning", "!", "scratched — go ahead and restart the sentence");
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  if (state !== "idle" && !muted && analyser) startVoiceLoop();
}

async function doReset() {
  try { await fetch("/api/reset", { method: "POST" }); } catch {}
  overBuffer = [];
  queuedTurns = [];
  queuedLineEls = [];
  pendingUserLine = null;
  currentAssistantLine = null;
  logEl.textContent = "";
  appendLine("assistant warning", "!", "started a fresh conversation");
  playCommandBeep();
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  if (state !== "idle" && !muted && analyser) startVoiceLoop();
}

function playQueuedBeep() {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, t0);
    osc.frequency.setValueAtTime(880, t0 + 0.1);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
    gain.gain.linearRampToValueAtTime(0, t0 + 0.24);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  } catch (e) { console.warn("beep failed", e); }
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
// iOS Safari suspends getUserMedia streams and fetches when the tab is
// backgrounded, so the call can't resume cleanly by itself. Stop everything
// on hide, then drop back to the splash so the return tap counts as a user
// gesture and iOS is happy to reopen the mic.
let wasActiveBeforeHide = false;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (state !== "idle" && state !== "error") {
      wasActiveBeforeHide = true;
      try { audioEl?.pause(); } catch {}
      try { currentTurn?.abort(); } catch {}
      closeMic();
      releaseWakeLock();
      muted = false;
      muteBtn.setAttribute("aria-pressed", "false");
      muteBtn.textContent = "mute mic";
      queuedTurns = [];
      for (const el of queuedLineEls) el.remove();
      queuedLineEls = [];
      if (pendingUserLine) { pendingUserLine.remove(); pendingUserLine = null; }
      overBuffer = [];
      setState("idle");
    }
  } else if (document.visibilityState === "visible") {
    if (wasActiveBeforeHide) {
      wasActiveBeforeHide = false;
      splashEl.classList.remove("hidden");
      stateEl.textContent = "tap to resume";
    }
    if (state !== "idle") acquireWakeLock();
  }
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
      body: JSON.stringify({ text, voice: ttsVoice, rate: ttsRate }),
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

// Voice sustains energy; brief clicks/whooshes don't — so we gate on a few
// sustained frames above threshold rather than raising the threshold too high
// (which would miss soft speech). This tuning tries to keep sensitivity high
// for Jason's voice while still rejecting transients.
const SILENCE_THRESHOLD = 0.018; // RMS (0-1)
const SPEECH_START_FRAMES = 2;   // ~40ms sustained above threshold — low so
                                 // the first word isn't clipped. Short blips
                                 // still transcribe to junk which the
                                 // annotation filter below tosses.
const SILENCE_HANG_MS = 1200;    // stop after this much continuous silence
const MIN_RECORDING_MS = 500;    // ignore too-short blips
const MAX_RECORDING_MS = 20_000; // hard cap per utterance

// Whisper tags non-speech audio with annotations like "[BLANK_AUDIO]",
// "[MUSIC PLAYING]", "(clapping)", "[LAUGHTER]". Strip them so they never
// count as Jason's speech.
function cleanTranscript(raw) {
  if (!raw) return "";
  return raw
    .replace(/[\[(][^\])]*[\])]/g, "") // drop [bracketed] and (parenthesized) tokens
    .replace(/\s+/g, " ")
    .trim();
}

function startVoiceLoop() {
  setState("listening");
  setupVAD({ queued: false });
}

// Runs VAD silently during thinking/transcribing states so speech captured
// there becomes queued turns rather than being dropped.
function startQueueListening() {
  if (!analyser || vadTimer) return;
  setupVAD({ queued: true });
}

function setupVAD({ queued }) {
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
    if (!analyser) return;
    analyser.getByteTimeDomainData(buf);
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
          recordingIsQueued = queued;
          if (!queued) setState("recording");
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
  const wasQueued = recordingIsQueued;
  recordingIsQueued = false;
  if (state === "idle") return;
  if (!recordedChunks.length) {
    resumeVadForContext(wasQueued);
    return;
  }

  if (!wasQueued && !muted) setState("transcribing");
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
    text = cleanTranscript(json.text || "");
  } catch (err) {
    console.error("transcribe failed", err);
    text = "";
  }

  if (!text || text.length < 2) {
    resumeVadForContext(wasQueued);
    return;
  }

  // While muted, the only transcript that matters is "unmute".
  if (muted) {
    if (UNMUTE_RE.test(text)) { doUnmute(); return; }
    resumeVadForContext(wasQueued);
    return;
  }

  // Global voice commands — take precedence over queueing/over-mode so they
  // fire immediately even when captured during Claude's turn.
  if (MUTE_RE.test(text)) { doMute(); return; }
  if (NEW_CONV_RE.test(text)) { await doReset(); return; }
  if (SCRATCH_RE.test(text)) { doScratch(); return; }

  if (wasQueued) {
    queuedTurns.push(text);
    const line = appendLine("user pending", "queued", text);
    queuedLineEls.push(line);
    startQueueListening();
    return;
  }

  await processTranscript(text);
}

function resumeVadForContext(wasQueued) {
  if (state === "idle") return;
  if (muted || wasQueued) { startQueueListening(); return; }
  startVoiceLoop();
}

async function processTranscript(text) {
  if (overMode) {
    if (!OVER_RE.test(text)) {
      overBuffer.push(text);
      const combined = overBuffer.join(" ");
      if (!pendingUserLine) {
        pendingUserLine = appendLine("user pending", "you");
      }
      setLineText(pendingUserLine, combined);
      if (state !== "idle" && !muted && !vadTimer) startVoiceLoop();
      return;
    }
    const finalText = overBuffer.join(" ").trim();
    overBuffer = [];
    const committedLine = pendingUserLine;
    pendingUserLine = null;
    if (!finalText) {
      if (committedLine) committedLine.remove();
      if (state !== "idle" && !muted && !vadTimer) startVoiceLoop();
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

function cleanForTTS(s) {
  return s
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_#>]/g, "")
    .trim();
}

async function sendTurn(userText) {
  setState("thinking");
  startQueueListening();
  currentTurn = new AbortController();
  let assistantText = "";
  let lastSpokenIdx = 0;
  let micClosedForSpeech = false;
  const ttsQueue = [];
  let ttsRunner = null;

  const runTTSQueue = async () => {
    while (ttsQueue.length) {
      const chunk = ttsQueue.shift();
      try { await speak(chunk); } catch (e) { console.warn("speak failed", e); }
    }
    ttsRunner = null;
  };

  const ensureMicClosedForSpeech = () => {
    if (micClosedForSpeech) return;
    micClosedForSpeech = true;
    if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
    closeMic();
    setState("speaking");
  };

  // Enqueue any completed sentences from the accumulating assistantText.
  // A "complete sentence" ends in . ! or ? followed by whitespace or EOT.
  const flushCompletedSentences = () => {
    while (true) {
      const remaining = assistantText.slice(lastSpokenIdx);
      const m = remaining.match(/^([\s\S]*?[.!?])(\s|$)/);
      if (!m) return;
      const raw = m[1];
      lastSpokenIdx += raw.length;
      const spoken = cleanForTTS(raw);
      if (!spoken) continue;
      ensureMicClosedForSpeech();
      ttsQueue.push(spoken);
      if (!ttsRunner) ttsRunner = runTTSQueue();
    }
  };

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
          flushCompletedSentences();
        } else if (evt.type === "final" && !assistantText) {
          assistantText = evt.value;
          setLineText(currentAssistantLine, assistantText);
          flushCompletedSentences();
        } else if (evt.type === "error") {
          throw new Error(evt.message);
        }
      }
    }
  } catch (err) {
    console.error(err);
    assistantText += (assistantText ? " " : "") + "sorry — something went wrong. " + (err.message || "");
    setLineText(currentAssistantLine, assistantText);
  }

  // Speak any trailing text that didn't end with sentence punctuation
  const tail = assistantText.slice(lastSpokenIdx);
  const tailSpoken = cleanForTTS(tail);
  if (tailSpoken) {
    ensureMicClosedForSpeech();
    ttsQueue.push(tailSpoken);
    if (!ttsRunner) ttsRunner = runTTSQueue();
  }

  if (ttsRunner) await ttsRunner;

  currentAssistantLine = null;

  if (state === "idle" || muted) return;
  const reopened = await openMic();
  if (!reopened) return;
  startVoiceLoop();

  // Drain anything the user said while we were busy. The recursive sendTurn
  // inside processTranscript will itself drain the rest, so a single shift is
  // enough — but we loop defensively in case a queued item was a no-op.
  if (queuedTurns.length) {
    playQueuedBeep();
    for (const el of queuedLineEls) el.remove();
    queuedLineEls = [];
    appendLine("assistant warning", "!", `picking up what you said while i was busy (${queuedTurns.length} chunk${queuedTurns.length === 1 ? "" : "s"})`);
    while (queuedTurns.length && state !== "idle" && !muted) {
      const text = queuedTurns.shift();
      if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
      await processTranscript(text);
    }
    if (!vadTimer && analyser && state !== "idle" && !muted) startVoiceLoop();
  }
}

// ---------- controls ----------

// Tiny silent WAV used to unlock the <audio> element during a user gesture.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRhwAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

splashEl.addEventListener("click", (ev) => {
  ev.preventDefault();
  // === SYNCHRONOUS portion of the user gesture ===
  // Must happen before any await so iOS considers the audio element "unlocked".
  const el = ensureAudio();
  el.src = SILENT_WAV;
  el.play().catch(() => {});

  splashEl.classList.add("hidden");
  stateEl.textContent = "requesting mic...";

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
  queuedTurns = [];
  for (const el of queuedLineEls) el.remove();
  queuedLineEls = [];
  try { audioEl?.pause(); } catch {}
  try { currentTurn?.abort(); } catch {}
  closeMic();
  releaseWakeLock();
  splashEl.classList.remove("hidden");
});

muteBtn.addEventListener("click", () => {
  if (state === "idle" || state === "error") return;
  if (!muted) doMute();
  else doUnmute();
});

setState("idle");
