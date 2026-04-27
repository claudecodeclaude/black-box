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
const orbEl = $("orb");

let state = "idle";
let stateChangedAt = Date.now();
let currentTurn = null; // AbortController for /api/turn
let wakeLock = null;
let muted = false; // mic paused — call stays alive, nothing is transcribed

// Queue of transcripts captured while Claude was busy (thinking/transcribing).
// Drained once the turn completes and listening resumes.
let queuedTurns = [];
let recordingIsQueued = false;

// Send mode: always on. Buffers transcripts across silence breaks. When the
// last chunk ends with "send" (or a common mishear), wait 3 seconds — if no
// more speech arrives, the buffer commits as a turn. Any new speech in that
// window cancels the pending send and keeps buffering.
let overBuffer = [];
let sendTimer = null;
const SEND_TAIL_RE = /\b(send|sent|sind|senned|scend|sand|sound|end|ten|and)[\s.!?,]*$/i;
const SEND_STRIP_RE = /\s*\b(send|sent|sind|senned|scend|sand|sound|end|ten|and)\b[\s.!?,]*$/i;
const SEND_SILENCE_MS = 3000;
// Standalone voice commands. Same pause-word-pause rule as "over", with
// common Whisper mishears accepted.
const MUTE_RE = /^\s*(mute|moot|meut|mewt)(\s+mic)?[\s.!?,]*$/i;
// Whisper mangles 'unmute' badly, especially while Claude's TTS is bleeding
// into the mic. Use a permissive check: if a short utterance contains any
// recognizable "unmute" token, treat it as the command.
const UNMUTE_TOKEN_RE = /\b(un-?\s*(mute|moot|meut|muted)|unboot|unmuet|on\s+(mute|moot|meut)|and\s+(mute|moot|meet)|in\s+(mute|moot)|hum\s*mute|on\s*moot)\b/i;
function looksLikeUnmute(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (!t) return false;
  // Reject anything substantially longer than the actual command — keeps the
  // permissive match from false-firing inside long sentences.
  const wordCount = t.split(/\s+/).length;
  if (wordCount > 6) return false;
  return UNMUTE_TOKEN_RE.test(t);
}
const NEW_CONV_RE = /^\s*new\s+conversation[\s.!?,]*$/i;
// Clear the current over-mode buffer without sending — used when Whisper
// misheard something mid-sentence and Jason wants to restart.
// Accept common Whisper mishears for "scratch that" (the sh/ch sound gets
// mangled easily): preach, crouch, crotch, scrap, scrash, catch, scratch.
const SCRATCH_RE = /^\s*(scratch|scrap|scrash|crouch|crotch|preach|catch|pritch|scrash)\s*(that|this)?[\s.!?,]*$|^\s*(never\s*mind|cancel(\s+that)?|redo|start\s+over)[\s.!?,]*$/i;
// "close call claude" — full stop, mic off, splash back up.
const CLOSE_RE = /^\s*close\s+(call\s*)?(claude|clod|cloud|cloed|clawed)[\s.!?,]*$/i;
// Last-resort recovery: tear the mic down and bring it back up without ending
// the call. Doesn't reset the conversation or clear the buffer.
const RESET_MIC_RE = /^\s*reset\s+(mic|mike|mick|mick\s+up)[\s.!?,]*$/i;

// Voice edit commands — short standalone utterances that modify the pending
// over-mode buffer instead of being added to it.
const EDIT_LAST_SENTENCE_RE = /^\s*(delete|remove|erase|drop)\s+(that|the)?\s*last\s+sentence[\s.!?,]*$/i;
const EDIT_LAST_WORD_RE = /^\s*(delete|remove|erase|drop)\s+(that|the)?\s*last\s+word[\s.!?,]*$/i;
const EDIT_LAST_N_WORDS_RE = /^\s*(delete|remove|erase|drop)\s+(that|the)?\s*last\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|twenty)\s+words?[\s.!?,]*$/i;
const EDIT_CLEAR_RE = /^\s*(delete|clear|erase)\s+(everything|all|all\s+of\s+(it|that))[\s.!?,]*$/i;
const NUM_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20 };
function parseSpokenInt(s) {
  return NUM_WORDS[s.toLowerCase()] || parseInt(s, 10) || 1;
}

// TTS voice — dynamic, client-side preference sent with each /api/speak call.
let ttsVoice = localStorage.getItem("callClaudeVoice") || "Nathan";
// Words-per-minute; macOS default is ~175. Nudged down so Jason can follow
// while driving.
let ttsRate = Number(localStorage.getItem("callClaudeRate")) || 140;

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

// Separate AudioContext for UI sound effects — survives the mic's audioCtx
// being opened/closed so we can drip/beep regardless of mic state.
let fxCtx = null;
function ensureFxCtx() {
  if (!fxCtx || fxCtx.state === "closed") {
    try { fxCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { fxCtx = null; }
  }
  // Resume if suspended (iOS sometimes suspends after backgrounding)
  if (fxCtx && fxCtx.state === "suspended") { fxCtx.resume().catch(() => {}); }
  return fxCtx;
}

let dripTimer = null;
function playDrip() {
  const ctx = ensureFxCtx();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(700, t0);
    osc.frequency.exponentialRampToValueAtTime(240, t0 + 0.09);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.22, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  } catch {}
}

function startDripping() {
  if (dripTimer) return;
  // Kick one off immediately so Jason hears confirmation right after "over".
  if (document.visibilityState === "visible") playDrip();
  dripTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    playDrip();
  }, 7000);
}

function stopDripping() {
  if (dripTimer) { clearInterval(dripTimer); dripTimer = null; }
}

let readyChimeTimer = null;
function startReadyChime() {
  if (readyChimeTimer) return;
  // Don't play immediately here — callers explicitly play once when they
  // want the "turn is over" signal. This only schedules the recurring
  // 30-second reminder.
  readyChimeTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    // Waiting for Jason in either plain listening OR muted-awaiting-unmute.
    if (state !== "listening" && state !== "muted") return;
    // Don't talk over Claude — audio element is actively playing TTS.
    // (state is "muted" during auto-muted TTS, which still triggers
    // the timer above.)
    if (audioEl && !audioEl.paused && !audioEl.ended) return;
    playReadyChime(2);
  }, 30000);
}
function stopReadyChime() {
  if (readyChimeTimer) { clearInterval(readyChimeTimer); readyChimeTimer = null; }
}

function playReadyChime(count = 5) {
  // Push iOS audio session toward 'playback' before playing so the chime
  // doesn't get routed to the earpiece while the mic is open in muted mode.
  forceSpeakerRouting();
  const ctx = ensureFxCtx();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime;
    // Initial 'your turn' cue uses 5 chimes (~1.1s) so Jason can't miss it
    // while driving. Recurring 30-second reminders use 2, less intrusive.
    for (let i = 0; i < count; i++) {
      const t = t0 + i * 0.22;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1320, t);
      osc.frequency.setValueAtTime(1760, t + 0.06);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch {}
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

function doMute({ silent = false } = {}) {
  muted = true;
  muteBtn.setAttribute("aria-pressed", "true");
  muteBtn.textContent = "unmute mic";
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
  // Auto-mute (after send commits) clears the buffer because the turn already
  // fired with that text. Manual mute preserves the buffer + pending line so
  // Jason can finish a thought after unmuting.
  if (silent) {
    queuedTurns = [];
    overBuffer = [];
    for (const el of queuedLineEls) el.remove();
    queuedLineEls = [];
    if (pendingUserLine) { pendingUserLine.remove(); pendingUserLine = null; }
  }
  setState("muted");
  if (!silent) {
    playCommandBeep();
    appendLine("assistant warning", "!", "muted — say unmute to resume");
  }
  // Keep the mic open so voice unmute responds at any time.
  // forceSpeakerRouting() handles iOS audio routing.
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

// Force-reset the mic and audio pipeline. Used by the orb tap (manual
// recovery while driving) and the watchdog (auto-recovery from stuck states).
async function forceMicReset(reason) {
  console.warn("forceMicReset:", reason);
  try { audioEl?.pause(); } catch {}
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  recordingIsQueued = false;
  recordedChunks = [];
  closeMic();
  await new Promise((r) => setTimeout(r, 120));
  const ok = await openMic();
  if (!ok) return;
  if (muted) {
    setState("muted");
    startQueueListening();
  } else {
    startVoiceLoop();
  }
  // Watchdog/manual mic-reset is silent now — Jason found the alert noisy
  // and the underlying false-positive ('stuck in recording' during normal
  // continuous talking) was already fixed by stateChangedAt always
  // refreshing on setState. The reset itself still runs as a safety net.
  console.log(`mic reset (${reason})`);
}

// Watchdog: if a state we expect to be transient lingers too long, kick the
// mic. Prevents the "I had to exit and reopen" recovery story.
let watchdogTimer = null;
function startWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    if (state === "idle" || state === "error") return;
    const stuckMs = Date.now() - stateChangedAt;
    if ((state === "recording" || state === "transcribing") && stuckMs > 25_000) {
      forceMicReset(`stuck in ${state} for ${Math.round(stuckMs/1000)}s`);
    }
  }, 5000);
}
function stopWatchdog() {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
}

function doClose() {
  playCommandBeep();
  setState("idle");
  muted = false;
  muteBtn.setAttribute("aria-pressed", "false");
  muteBtn.textContent = "mute mic";
  queuedTurns = [];
  overBuffer = [];
  for (const el of queuedLineEls) el.remove();
  queuedLineEls = [];
  if (pendingUserLine) { pendingUserLine.remove(); pendingUserLine = null; }
  stopWatchdog();
  try { audioEl?.pause(); } catch {}
  try { currentTurn?.abort(); } catch {}
  closeMic();
  releaseWakeLock();
  splashEl.classList.remove("hidden");
}

function doScratch() {
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
  overBuffer = [];
  if (pendingUserLine) { pendingUserLine.remove(); pendingUserLine = null; }
  playCommandBeep();
  appendLine("assistant warning", "!", "scratched — go ahead and restart the sentence");
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  if (state !== "idle" && !muted && analyser) startVoiceLoop();
}

async function doResetMic() {
  playCommandBeep();
  appendLine("assistant warning", "!", "resetting mic...");
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  closeMic();
  // Brief pause to let iOS release the audio session before reopening so the
  // new getUserMedia call gets a fresh stream rather than a stale handle.
  await new Promise((r) => setTimeout(r, 250));
  noiseFloor = 0.005; // recalibrate ambient on new mic
  const ok = await openMic();
  if (!ok) return;
  if (muted) {
    setState("muted");
    startQueueListening();
  } else {
    startVoiceLoop();
  }
}

async function doReset() {
  try { await fetch("/api/reset", { method: "POST" }); } catch {}
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
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
  // Update on every call, not just on value changes — so continuous activity
  // (e.g. the VAD setting state to "recording" repeatedly across back-to-back
  // recordings) keeps the watchdog timer fresh. Without this, stateChangedAt
  // froze at the first recording's start and the watchdog falsely flagged
  // "stuck in recording" after 25s of normal continuous talking.
  const prev = state;
  stateChangedAt = Date.now();
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

  // Drip should never carry over into a "your turn" state. Belt-and-
  // suspenders against runTTSQueue's polling-loop drip lingering past the
  // last sentence.
  if (next === "listening" || next === "muted" || next === "idle") {
    stopDripping();
  }
  // Stop the recurring chime whenever we leave a "your turn" state. The
  // chime is started explicitly at the end of sendTurn (after all TTS
  // drains) — NOT here on every state transition, because state cycles
  // through "muted" at the START of TTS playback (via ensureMicClosedForSpeech)
  // which would falsely fire the 5-chime burst before Claude even started
  // talking.
  if (next !== "listening" && next !== "muted") {
    stopReadyChime();
  }
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
// Don't tear the session down when Safari backgrounds the tab. iOS may
// auto-suspend the AudioContext + pause fetches, but the VAD's audioCtx
// resume() and the watchdog are designed to recover. While hidden, speak()
// holds TTS chunks in pendingTTSWhileHidden and only plays a short "hey
// Jason, ready when you are" cue so Claude doesn't talk over Jason's other
// app. On return we drain the held chunks.
let wasHiddenSinceLastVisible = false;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    wasHiddenSinceLastVisible = true;
    // Free the screen wake lock — let the phone sleep if it's going to.
    releaseWakeLock();
  } else if (document.visibilityState === "visible") {
    if (state !== "idle") acquireWakeLock();
    // Wake the FX context up so the chime/drip keep playing.
    if (fxCtx && fxCtx.state === "suspended") fxCtx.resume().catch(() => {});
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    // Deliver anything Claude said while we were backgrounded.
    if (pendingTTSWhileHidden.length) drainPendingTTS();
    // iOS almost always kills the getUserMedia stream + audio session on
    // backgrounding for more than a few seconds. Force a clean mic reset
    // when we come back so Jason doesn't see "fetch failed" or a stuck mic.
    if (wasHiddenSinceLastVisible && state !== "idle" && state !== "error") {
      wasHiddenSinceLastVisible = false;
      forceMicReset("returned from background");
    } else {
      wasHiddenSinceLastVisible = false;
    }
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

// iOS Safari (17+) lets us force the audio session category so TTS plays out
// the main speaker instead of the earpiece even while a mic stream was just
// released. Falls back silently on unsupported browsers.
function forceSpeakerRouting() {
  try {
    if (typeof navigator !== "undefined" && navigator.audioSession) {
      navigator.audioSession.type = "playback";
    }
  } catch {}
}

// Counterpart to forceSpeakerRouting — must run BEFORE getUserMedia, because
// iOS Safari throws InvalidStateError if you call getUserMedia while the
// audio session is locked into "playback". play-and-record allows mic
// capture and still plays audio (out the earpiece by default — speak() flips
// it back to playback right before TTS).
function prepareAudioSessionForMic() {
  try {
    if (typeof navigator !== "undefined" && navigator.audioSession) {
      navigator.audioSession.type = "play-and-record";
    }
  } catch {}
}

// Buffer of TTS chunks held back while the app is backgrounded. We don't
// want Claude's full response talking over Jason's other apps — instead we
// queue them and play once he returns. A short "hey Jason, ready when you
// are" cue announces that we have something waiting.
let pendingTTSWhileHidden = [];
let heyJasonAnnounced = false;

async function speakNow(text) {
  if (!text) return;
  forceSpeakerRouting();
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

async function speak(text) {
  if (!text) return;
  if (document.visibilityState === "hidden") {
    pendingTTSWhileHidden.push(text);
    if (!heyJasonAnnounced) {
      heyJasonAnnounced = true;
      // Short attention cue. Whether iOS lets it through depends on how
      // recently the audio element was played, but the chimes (which use
      // the FX AudioContext) keep firing on the regular interval too.
      try { await speakNow("Hey Jason, ready when you are."); } catch {}
    }
    return;
  }
  await speakNow(text);
}

async function drainPendingTTS() {
  heyJasonAnnounced = false;
  while (pendingTTSWhileHidden.length) {
    const t = pendingTTSWhileHidden.shift();
    await speakNow(t);
  }
}

// ---------- mic setup ----------

async function openMic() {
  if (micStream) return true;
  prepareAudioSessionForMic();
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
  // Force audio session back to playback so the next TTS goes out the main
  // speaker, not the earpiece (iOS keeps the session in play-and-record
  // otherwise).
  forceSpeakerRouting();
}

// ---------- VAD + recording ----------

// Adaptive VAD: effective threshold = max(BASE, noiseFloor * MULTIPLIER).
// In a quiet room the floor stays tiny so soft speech triggers; in a loud
// car the floor adapts upward so engine/AC noise no longer triggers recording
// or keeps it from stopping. The floor only updates while we're idle AND the
// current sample is plausibly background, so Jason's voice doesn't drag the
// floor up with it.
const SILENCE_THRESHOLD = 0.006;        // BASE floor — never go below this
const NOISE_FLOOR_MULTIPLIER = 2.4;     // speech must be ~2.4x ambient
const NOISE_FLOOR_ALPHA = 0.02;         // EMA weight per ~20ms tick (~10s adapt)
let noiseFloor = 0.005;                 // module-scoped: persists across mic
                                        // restarts and recording cycles
const SPEECH_START_FRAMES = 1;          // ~20ms above threshold triggers record
const SILENCE_HANG_MS = 1200;           // stop after this much continuous silence
const SILENCE_HANG_MS_MUTED = 500;      // shorter hang while muted so the
                                        // 'unmute' command fires snappily
function effectiveSilenceHang() {
  return muted ? SILENCE_HANG_MS_MUTED : SILENCE_HANG_MS;
}
const MIN_RECORDING_MS = 500;           // ignore too-short blips
const MAX_RECORDING_MS = 20_000;        // hard cap per utterance

// While muted, drop the multiplier so a quietly-spoken "unmute" still trips
// the threshold. Voice-ID verification on the server still rejects passenger
// audio, so the looser bar doesn't open up false unmutes.
const NOISE_FLOOR_MULTIPLIER_MUTED = 1.5;
function effectiveThreshold() {
  const mult = muted ? NOISE_FLOOR_MULTIPLIER_MUTED : NOISE_FLOOR_MULTIPLIER;
  return Math.max(SILENCE_THRESHOLD, noiseFloor * mult);
}

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

// For over-mode buffering: Whisper adds a "." or "..." on pauses, which then
// makes the next chunk start with a capital, producing "I went to. The store."
// Strip trailing sentence-end punctuation and lowercase the leading letter so
// buffered pieces flow together naturally.
function smoothBufferPiece(text, hasPrior) {
  let t = text.trim().replace(/[\.\…]+\s*$/g, "").trim();
  if (hasPrior && t.length > 0) {
    const first = t[0];
    if (first >= "A" && first <= "Z") t = first.toLowerCase() + t.slice(1);
  }
  return t;
}

// --- Buffer edit helpers (driven by voice edit commands or tap-to-edit) ----

function bufferText() { return overBuffer.join(" "); }

function setBufferText(text) {
  const trimmed = (text || "").trim();
  overBuffer = trimmed ? [trimmed] : [];
  if (!pendingUserLine) {
    if (trimmed) pendingUserLine = appendLine("user pending", "you", trimmed);
  } else if (!trimmed) {
    pendingUserLine.remove();
    pendingUserLine = null;
  } else {
    setLineText(pendingUserLine, trimmed);
  }
}

function deleteLastSentence() {
  const t = bufferText();
  if (!t) return false;
  // Split into sentence-ish chunks. The last entry is the trailing fragment;
  // dropping it removes "the last sentence" whether or not Whisper added a
  // final period.
  const parts = t.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [];
  if (parts.length === 0) return false;
  parts.pop();
  setBufferText(parts.join("").trim());
  return true;
}

function deleteLastWords(n) {
  const t = bufferText();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  words.splice(Math.max(0, words.length - n));
  setBufferText(words.join(" "));
  return true;
}

function tryApplyEditCommand(text) {
  if (EDIT_LAST_SENTENCE_RE.test(text)) {
    if (deleteLastSentence()) {
      playCommandBeep();
      appendLine("assistant warning", "!", "deleted the last sentence");
    }
    return true;
  }
  if (EDIT_LAST_WORD_RE.test(text)) {
    if (deleteLastWords(1)) {
      playCommandBeep();
      appendLine("assistant warning", "!", "deleted the last word");
    }
    return true;
  }
  const m = EDIT_LAST_N_WORDS_RE.exec(text);
  if (m) {
    const n = parseSpokenInt(m[3]);
    if (deleteLastWords(n)) {
      playCommandBeep();
      appendLine("assistant warning", "!", `deleted the last ${n} words`);
    }
    return true;
  }
  if (EDIT_CLEAR_RE.test(text)) {
    setBufferText("");
    playCommandBeep();
    appendLine("assistant warning", "!", "cleared everything");
    return true;
  }
  return false;
}

function startVoiceLoop() {
  // Always flip to "listening" so the ready-chime hook fires and the drip
  // doesn't carry over from a prior speaking phase. The VAD itself is set
  // up only if the timer isn't already running.
  setState("listening");
  if (vadTimer) return;
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
    // iOS Safari sometimes suspends the AudioContext (during long sessions,
    // backgrounding, or audio-session category flips for TTS). When suspended,
    // getByteTimeDomainData returns silence and the mic looks dead. Resume
    // preemptively every tick — cheap when not suspended.
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / buf.length);
    const now = Date.now();
    const threshold = effectiveThreshold();

    if (!recording) {
      // Adapt the noise floor only when we're below threshold (clearly
      // ambient). The EMA pulls the floor toward sustained background noise
      // without letting Jason's voice drag it up.
      if (rms < threshold) {
        noiseFloor = noiseFloor * (1 - NOISE_FLOOR_ALPHA) + rms * NOISE_FLOOR_ALPHA;
      }
      if (rms > threshold) {
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

    if (rms > threshold) lastSoundAt = now;

    const elapsed = now - recordingStartedAt;
    const silent = now - lastSoundAt;
    if ((silent > effectiveSilenceHang() && elapsed > MIN_RECORDING_MS) || elapsed > MAX_RECORDING_MS) {
      stopRec();
    }
  }, 20);
}

async function onRecordingStopped() {
  // Snapshot this recording's state immediately so the live VAD timer can
  // safely start a new recording (which would overwrite the globals) while
  // we transcribe in the background.
  const wasQueued = recordingIsQueued;
  recordingIsQueued = false;
  const chunks = recordedChunks;
  recordedChunks = [];
  if (state === "idle") return;
  if (!chunks.length) {
    resumeVadForContext(wasQueued);
    return;
  }

  // Don't override "thinking"/"speaking"/"recording" with "transcribing" —
  // those are set by other code paths and the VAD may already be capturing
  // a new utterance.
  if (state === "listening") setState("transcribing");
  const blob = new Blob(chunks, { type: recordingMime || "audio/webm" });

  let text = "";
  let isJason = true;
  try {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type },
      body: blob,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    text = cleanTranscript(json.text || "");
    if (typeof json.isJason === "boolean") isJason = json.isJason;
  } catch (err) {
    console.error("transcribe failed", err);
    text = "";
  }

  // Voice-print gate: drop chunks that aren't Jason's voice (passenger,
  // GPS, music, TV in the background). When no reference is enrolled, the
  // server returns isJason=true and this is a no-op.
  if (!isJason) {
    resumeVadForContext(wasQueued);
    return;
  }

  if (!text || text.length < 2) {
    resumeVadForContext(wasQueued);
    return;
  }

  // While muted OR while Claude is currently speaking, only voice commands
  // matter — discard everything else. (Mic stays open during speak so Jason
  // can interject with mute/unmute/close commands, but Claude's own TTS
  // bleeding back into the mic must not be processed as a real turn.)
  if (muted || state === "speaking") {
    if (looksLikeUnmute(text)) { doUnmute(); return; }
    if (CLOSE_RE.test(text)) { doClose(); return; }
    if (RESET_MIC_RE.test(text)) { await doResetMic(); return; }
    resumeVadForContext(wasQueued);
    return;
  }

  // Global voice commands — take precedence over queueing/over-mode so they
  // fire immediately even when captured during Claude's turn.
  if (CLOSE_RE.test(text)) { doClose(); return; }
  if (RESET_MIC_RE.test(text)) { await doResetMic(); return; }
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

function commitSendBuffer() {
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
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
  // Auto-mute for the duration of Claude's turn so background noise isn't
  // picked up. Jason resumes with the voice "unmute" command.
  doMute({ silent: true });
  sendTurn(finalText).catch((e) => console.warn("sendTurn failed", e));
}

async function processTranscript(text) {
  // Any new speech cancels a pending send timer (Jason kept talking).
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }

  // Voice edit commands modify the buffer in place and DON'T get added to it.
  if (tryApplyEditCommand(text)) {
    if (state !== "idle" && !muted) startVoiceLoop();
    return;
  }

  const endsWithSend = SEND_TAIL_RE.test(text);
  const cleaned = endsWithSend ? text.replace(SEND_STRIP_RE, "").trim() : text;

  if (cleaned) {
    const smoothed = smoothBufferPiece(cleaned, overBuffer.length > 0);
    if (smoothed) overBuffer.push(smoothed);
    const combined = overBuffer.join(" ");
    if (!pendingUserLine) {
      pendingUserLine = appendLine("user pending", "you");
      makePendingLineEditable(pendingUserLine);
    }
    setLineText(pendingUserLine, combined);
  }

  if (endsWithSend) {
    sendTimer = setTimeout(() => {
      sendTimer = null;
      commitSendBuffer();
    }, SEND_SILENCE_MS);
  }

  if (state !== "idle" && !muted) startVoiceLoop();
}

// --- Tap-to-edit on the pending user line ---------------------------------
// Make the body of pendingUserLine contenteditable so Jason can manually
// fix transcription mistakes if he's stopped at a light. Voice still flows
// through processTranscript and overwrites via setLineText, so manual edits
// during active dictation will get clobbered — fine for now.
function makePendingLineEditable(line) {
  const body = line?.querySelector(".body");
  if (!body) return;
  body.setAttribute("contenteditable", "true");
  body.setAttribute("spellcheck", "true");
  body.style.outline = "none";
  body.style.cursor = "text";
  body.addEventListener("input", () => {
    const text = body.textContent;
    overBuffer = text.trim() ? [text] : [];
  });
  // Tapping the line also pauses the auto-send if one is pending — Jason
  // probably wants to edit before letting it fire.
  body.addEventListener("focus", () => {
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
  });
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
  startDripping();
  startQueueListening();
  currentTurn = new AbortController();
  let assistantText = "";
  let lastSpokenIdx = 0;
  let micClosedForSpeech = false;
  let streamDone = false;
  const ttsQueue = [];
  let ttsRunner = null;

  // While the model is still streaming text, drip during gaps between TTS
  // sentences so Jason hears something is happening even when no chunk is
  // ready to speak yet. Stop dripping once a chunk is actually playing.
  const runTTSQueue = async () => {
    while (true) {
      if (ttsQueue.length === 0) {
        if (streamDone) {
          ttsRunner = null;
          return;
        }
        startDripping();
        await new Promise((r) => setTimeout(r, 80));
        continue;
      }
      stopDripping();
      const chunk = ttsQueue.shift();
      try { await speak(chunk); } catch (e) { console.warn("speak failed", e); }
    }
  };

  const ensureMicClosedForSpeech = () => {
    if (micClosedForSpeech) return;
    micClosedForSpeech = true;
    stopDripping(); // TTS is about to play — no more drip
    if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
    // Keep the mic open during TTS so Jason can say "unmute mic" or start
    // cueing the next message hands-free. forceSpeakerRouting() in speak()
    // keeps iOS from sending audio to the earpiece while the mic is live.
    // onRecordingStopped's speaking/muted branch ignores Claude's own voice
    // bleeding back into the mic.
    setState(muted ? "muted" : "speaking");
    startQueueListening();
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
    // Suppress the apology when iOS aborts the fetch because Jason
    // backgrounded Safari, or when we deliberately aborted on stop/close.
    // The visibilitychange handler will force-reset the mic on return.
    const wasAbort = err.name === "AbortError" || /aborted|cancelled/i.test(err.message || "");
    const hidden = document.visibilityState === "hidden";
    if (!wasAbort && !hidden && !wasHiddenSinceLastVisible) {
      assistantText += (assistantText ? " " : "") + "sorry — something went wrong. " + (err.message || "");
      setLineText(currentAssistantLine, assistantText);
    }
  }

  // Speak any trailing text that didn't end with sentence punctuation
  const tail = assistantText.slice(lastSpokenIdx);
  const tailSpoken = cleanForTTS(tail);
  if (tailSpoken) {
    ensureMicClosedForSpeech();
    ttsQueue.push(tailSpoken);
    if (!ttsRunner) ttsRunner = runTTSQueue();
  }
  // Signal to the TTS runner that no more chunks will arrive — once the
  // queue drains it can exit instead of polling for more.
  streamDone = true;

  if (ttsRunner) await ttsRunner;
  stopDripping(); // belt-and-suspenders for edge cases (no TTS emitted, errors, etc)

  currentAssistantLine = null;

  if (state === "idle") return;
  const reopened = await openMic();
  if (!reopened) return;
  if (muted) {
    setState("muted");
    startQueueListening();
    playReadyChime(); // even when muted, signal "I'm done, your turn"
    startReadyChime(); // recurring 30s reminder while he's still muted
    return;
  }
  startVoiceLoop();
  playReadyChime();
  startReadyChime();

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
  // Prime the FX AudioContext so drip/beep sounds can play without another
  // user gesture.
  ensureFxCtx();
  // Pre-arm the audio session for mic capture. Setting "playback" here was
  // the original intent (route TTS to speaker), but it makes the upcoming
  // getUserMedia throw InvalidStateError on iOS — speak() flips back to
  // playback when TTS is about to play.
  prepareAudioSessionForMic();

  splashEl.classList.add("hidden");
  stateEl.textContent = "requesting mic...";

  (async () => {
    try {
      const ok = await openMic();
      if (!ok) return; // openMic already set error state
      await acquireWakeLock();
      startVoiceLoop();
      startWatchdog();
    } catch (err) {
      console.error("start failed", err);
      setState("error");
      stateEl.textContent = `start failed: ${err.name || err.message || err}`;
    }
  })();
});

// Tap the orb to manually force a mic reset — handy if the VAD got stuck.
if (orbEl) {
  orbEl.addEventListener("click", () => {
    if (state === "idle" || state === "error") return;
    forceMicReset("orb tap");
  });
  orbEl.style.cursor = "pointer";
}

stopBtn.addEventListener("click", () => {
  // Fire-and-forget: ask Claude to drop a session memory note before we tear
  // everything down. The browser keepalive flag + the Mac Mini server's
  // spawned claude process keep the work going even after the page transitions
  // back to the splash, so the memory file gets written without holding up
  // the UI.
  saveSessionMemory();

  setState("idle");
  muted = false;
  muteBtn.setAttribute("aria-pressed", "false");
  muteBtn.textContent = "mute mic";
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
  queuedTurns = [];
  for (const el of queuedLineEls) el.remove();
  queuedLineEls = [];
  stopDripping();
  stopWatchdog();
  try { audioEl?.pause(); } catch {}
  try { currentTurn?.abort(); } catch {}
  closeMic();
  releaseWakeLock();
  splashEl.classList.remove("hidden");
});

function saveSessionMemory() {
  try {
    const ts = new Date().toISOString().replace(/:/g, "-").slice(0, 16);
    const filename = `session_${ts}.md`;
    const prompt =
      `Before we end this Call Claude session, please save a memory note summarizing what we worked on, what was completed, and any pending or follow-up items. Use the Write tool to save it to /Users/jasonslagel/.claude/projects/-Users-jasonslagel-projects-black-box/memory/${filename}. Include enough detail that another conversation could pick up the thread. After saving, reply with just "session saved" and nothing else.`;
    fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ text: prompt }),
    }).catch(() => {});
  } catch (e) {
    console.warn("session-memory save failed", e);
  }
}

muteBtn.addEventListener("click", () => {
  if (state === "idle" || state === "error") return;
  if (!muted) doMute();
  else doUnmute();
});

setState("idle");

// ---------- auto-reload on server update ----------
//
// On cold open, compare window.__BUILD_VERSION (injected into the HTML by
// server.mjs at request time) against /api/version. If iOS handed us a
// cached old bundle, those won't match and we reload to fresh.
//
// While the page stays open, poll every 10s for new deploys. Never reload
// mid-conversation — defer until state goes back to idle/error.
(function setupAutoReload() {
  const POLL_MS = 10_000;
  const RELOAD_GUARD_KEY = "callClaudeAutoReload:lastReloadTo";
  const bundleVersion = window.__BUILD_VERSION || "dev";
  let bootApiVersion = null;
  let pendingTarget = null;

  function safeToReloadNow() {
    return state === "idle" || state === "error";
  }

  function reloadOnceFor(target) {
    try {
      const last = sessionStorage.getItem(RELOAD_GUARD_KEY);
      if (last === target) return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, target);
    } catch {}
    window.location.reload();
  }

  function attempt(target) {
    if (!target) return;
    if (safeToReloadNow()) reloadOnceFor(target);
    else pendingTarget = target;
  }

  async function fetchVersion() {
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data?.version === "string" ? data.version : null;
    } catch {
      return null;
    }
  }

  async function check() {
    const latest = await fetchVersion();
    if (!latest) return;
    if (bootApiVersion === null) {
      bootApiVersion = latest;
      if (bundleVersion !== "dev" && latest !== bundleVersion) attempt(latest);
      return;
    }
    if (latest !== bootApiVersion) attempt(latest);
  }

  function drainPending() {
    if (pendingTarget && safeToReloadNow()) {
      const t = pendingTarget;
      pendingTarget = null;
      reloadOnceFor(t);
    }
  }

  check();
  setInterval(() => {
    if (document.hidden) return;
    check();
    drainPending();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { check(); drainPending(); }
  });
  window.addEventListener("pageshow", (ev) => {
    if (ev.persisted) window.location.reload();
  });
})();
