"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { AnnotationCanvas } from "@/components/ninja/AnnotationCanvas";
import {
  getAllAttempts,
  getAttempt,
  saveAttempt,
  deleteAttempt,
  clearDraft,
  type Attempt,
  type Shape,
} from "@/components/ninja/storage";

type View = "upload" | "camera" | "player";
type Tool = "line" | "arrow" | "circle";

function getBestMimeType() {
  const types = ["video/webm;codecs=vp9", "video/webm", "video/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export default function NinjaPage() {
  const [view, setView] = useState<View>("upload");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [playing, setPlaying] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("line");
  const [saveLabel, setSaveLabel] = useState("Save Attempt");
  const [toolsDisabled, setToolsDisabled] = useState(false);

  // Camera / recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Player
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);
  const annotationRef = useRef<AnnotationCanvas | null>(null);
  const currentBlobRef = useRef<Blob | null>(null);
  const currentIdRef = useRef<number | null>(null);

  // Zoom / pan — updated directly via DOM refs for smooth gesture performance
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const pinchStateRef = useRef({
    active: false,
    initialDist: 0,
    initialZoom: 1,
    initialPanX: 0,
    initialPanY: 0,
    centerX: 0,
    centerY: 0,
  });
  const singleTouchRef = useRef({ active: false, lastX: 0, lastY: 0 });

  function applyTransform(z: number, px: number, py: number) {
    zoomRef.current = z;
    panXRef.current = px;
    panYRef.current = py;
    if (zoomLayerRef.current) {
      zoomLayerRef.current.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
    }
  }

  function resetZoom() {
    applyTransform(1, 0, 0);
  }

  // Init annotation canvas
  useEffect(() => {
    if (canvasRef.current && videoRef.current) {
      annotationRef.current = new AnnotationCanvas(canvasRef.current, videoRef.current);
    }
  }, []);

  const refreshAttempts = useCallback(() => {
    getAllAttempts().then((all) => {
      setAttempts(all.filter((a) => a.id !== -1).sort((a, b) => b.id - a.id));
    });
  }, []);

  useEffect(() => { refreshAttempts(); }, [refreshAttempts]);

  useEffect(() => {
    const onResize = () => annotationRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Pinch-to-zoom touch handler on the video container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function touchDist(touches: TouchList) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        // Tell canvas to stop drawing — fingers are pinching, not drawing
        annotationRef.current?.setMultiTouch(true);
        const rect = container!.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        pinchStateRef.current = {
          active: true,
          initialDist: touchDist(e.touches),
          initialZoom: zoomRef.current,
          initialPanX: panXRef.current,
          initialPanY: panYRef.current,
          centerX: cx,
          centerY: cy,
        };
        singleTouchRef.current.active = false;
      } else if (e.touches.length === 1 && zoomRef.current > 1 && videoRef.current?.paused === false) {
        // Pan only while video is playing (not while drawing)
        singleTouchRef.current = {
          active: true,
          lastX: e.touches[0].clientX,
          lastY: e.touches[0].clientY,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && pinchStateRef.current.active) {
        e.preventDefault();
        const p = pinchStateRef.current;
        const W = container!.clientWidth;
        const H = container!.clientHeight;
        const newZoom = Math.min(Math.max(p.initialZoom * touchDist(e.touches) / p.initialDist, 1), 5);

        // Keep the pinch center fixed in content space
        const contentX = (p.centerX - p.initialPanX) / p.initialZoom;
        const contentY = (p.centerY - p.initialPanY) / p.initialZoom;
        let newPanX = p.centerX - contentX * newZoom;
        let newPanY = p.centerY - contentY * newZoom;

        // Clamp so video doesn't go out of bounds
        newPanX = Math.min(0, Math.max(newPanX, W * (1 - newZoom)));
        newPanY = Math.min(0, Math.max(newPanY, H * (1 - newZoom)));

        applyTransform(newZoom, newPanX, newPanY);
      } else if (e.touches.length === 1 && singleTouchRef.current.active) {
        e.preventDefault();
        const s = singleTouchRef.current;
        const dx = e.touches[0].clientX - s.lastX;
        const dy = e.touches[0].clientY - s.lastY;
        s.lastX = e.touches[0].clientX;
        s.lastY = e.touches[0].clientY;

        const W = container!.clientWidth;
        const H = container!.clientHeight;
        const z = zoomRef.current;
        const newPanX = Math.min(0, Math.max(panXRef.current + dx, W * (1 - z)));
        const newPanY = Math.min(0, Math.max(panYRef.current + dy, H * (1 - z)));
        applyTransform(z, newPanX, newPanY);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        pinchStateRef.current.active = false;
        // Re-enable drawing once pinch is released
        annotationRef.current?.setMultiTouch(false);
      }
      if (e.touches.length === 0) {
        singleTouchRef.current.active = false;
        if (zoomRef.current < 1.05) resetZoom();
      }
    }

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // --- Camera ---

  const [showPermissionHelp, setShowPermissionHelp] = useState(false);

  async function openCamera() {
    // Check if camera permission is already permanently granted
    let alreadyGranted = false;
    try {
      const perm = await navigator.permissions.query({ name: "camera" as PermissionName });
      alreadyGranted = perm.state === "granted";
    } catch {
      // Permissions API not available — fall through and try anyway
    }

    if (!alreadyGranted) {
      // Show instructions before the system prompt so user knows how to make it permanent
      setShowPermissionHelp(true);
      return;
    }

    await doOpenCamera();
  }

  async function doOpenCamera() {
    setShowPermissionHelp(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });
      streamRef.current = stream;
      setRecordedBlob(null);
      setIsRecording(false);
      setView("camera");
      setTimeout(() => {
        if (cameraPreviewRef.current) {
          cameraPreviewRef.current.srcObject = stream;
          cameraPreviewRef.current.play();
        }
      }, 50);
    } catch {
      // Still denied — show instructions again
      setShowPermissionHelp(true);
    }
  }

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = getBestMimeType();
    const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || "video/mp4" });
      setIsRecording(false);
      loadIntoPlayer(blob);
    };
    recorder.start();
    setIsRecording(true);
  }

  function stopRecording() { recorderRef.current?.stop(); }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecordedBlob(null);
    setIsRecording(false);
    setView("upload");
  }

  function useRecordedVideo() {
    if (!recordedBlob) return;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    loadIntoPlayer(recordedBlob);
  }

  // --- File picker ---

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    loadIntoPlayer(file);
    e.target.value = "";
  }

  // --- Player ---

  function loadIntoPlayer(blob: Blob) {
    currentBlobRef.current = blob;
    currentIdRef.current = null;
    resetZoom();
    setView("player");
    setTimeout(() => loadVideoBlob(blob), 0);
  }

  function loadVideoBlob(blob: Blob) {
    const video = videoRef.current!;
    if (video.src?.startsWith("blob:")) URL.revokeObjectURL(video.src);
    video.src = URL.createObjectURL(blob);
    video.load();
    annotationRef.current?.clear();
    if (notesRef.current) notesRef.current.value = "";
    setSaveLabel("Save Attempt");
  }

  function goToUpload() {
    const video = videoRef.current!;
    video.pause();
    if (video.src?.startsWith("blob:")) URL.revokeObjectURL(video.src);
    video.removeAttribute("src");
    video.load();
    currentBlobRef.current = null;
    currentIdRef.current = null;
    resetZoom();
    clearDraft();
    setView("upload");
    refreshAttempts();
  }

  function handlePlay() {
    const video = videoRef.current!;
    if (video.paused) video.play(); else video.pause();
  }

  function handleVideoPlay() {
    setPlaying(true);
    setToolsDisabled(true);
    annotationRef.current?.disable();
  }

  function handleVideoPause() {
    setPlaying(false);
    setToolsDisabled(false);
    annotationRef.current?.enable();
    annotationRef.current?.resize();
  }

  function handleLoadedMetadata() {
    annotationRef.current?.resize();
    annotationRef.current?.enable();
  }

  function handleFrameBack() {
    const video = videoRef.current!;
    video.pause();
    video.currentTime = Math.max(0, video.currentTime - 1 / 30);
  }

  function handleFrameForward() {
    const video = videoRef.current!;
    video.pause();
    video.currentTime = Math.min(video.duration, video.currentTime + 1 / 30);
  }

  function handleSpeed(rate: number) { videoRef.current!.playbackRate = rate; }

  function handleToolSelect(tool: Tool) {
    setActiveTool(tool);
    annotationRef.current?.setTool(tool);
  }

  async function openAttempt(id: number) {
    const attempt = await getAttempt(id);
    if (!attempt) return;
    currentIdRef.current = attempt.id;
    currentBlobRef.current = attempt.video;
    if (notesRef.current) notesRef.current.value = attempt.notes || "";
    resetZoom();
    setView("player");
    setTimeout(() => {
      loadVideoBlob(attempt.video);
      videoRef.current!.addEventListener("loadedmetadata", function onMeta() {
        videoRef.current!.removeEventListener("loadedmetadata", onMeta);
        if (attempt.annotationTime != null) videoRef.current!.currentTime = attempt.annotationTime;
        setTimeout(() => {
          annotationRef.current?.resize();
          annotationRef.current?.setAnnotations(attempt.annotations as Shape[]);
        }, 50);
      });
    }, 0);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this attempt?")) return;
    await deleteAttempt(id);
    refreshAttempts();
  }

  async function handleSave() {
    if (!currentBlobRef.current) return;
    const attempt: Attempt = {
      id: currentIdRef.current || Date.now(),
      video: currentBlobRef.current,
      annotations: annotationRef.current?.getAnnotations() ?? [],
      annotationTime: videoRef.current?.currentTime ?? 0,
      notes: notesRef.current?.value ?? "",
      createdAt: new Date().toISOString(),
    };
    if (currentIdRef.current) {
      try {
        const existing = await getAttempt(currentIdRef.current);
        if (existing?.createdAt) attempt.createdAt = existing.createdAt;
      } catch { /* ignore */ }
    }
    try {
      await saveAttempt(attempt);
    } catch (err) {
      console.error("Save failed:", err);
      alert("Could not save — your device may be out of storage space.");
    }
    clearDraft().catch(() => {});
    goToUpload();
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", background: "#111", minHeight: "100vh" }}>

      {/* ── Upload View ── */}
      <div style={{ display: view === "upload" ? "block" : "none", padding: "0 16px 32px" }}>
        <div style={{ marginTop: 16, marginBottom: 4 }}>
          <Link href="/" style={{ color: "var(--accent)", fontSize: 15, fontWeight: 600, textDecoration: "none" }}>
            ← Black Box
          </Link>
        </div>
        <div style={{ textAlign: "center", padding: "24px 16px 12px" }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: 2 }}>NINJA LAB</h1>
          <div style={{ fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: 3, marginTop: 4 }}>
            Replay Analysis
          </div>
        </div>

        <button onClick={openCamera} style={{ ...uploadBtnStyle, background: "#2a6aff", marginTop: 16 }}>
          Record Video
        </button>
        <button onClick={() => fileInputRef.current?.click()} style={{ ...uploadBtnStyle, background: "#333", marginTop: 10 }}>
          Upload from Library
        </button>
        <input ref={fileInputRef} type="file" accept="video/*" style={{ display: "none" }} onChange={handleFileChange} />

        <div style={{ fontSize: 13, color: "#666", textTransform: "uppercase", letterSpacing: 1.5, margin: "28px 0 12px" }}>
          Saved Attempts
        </div>
        {attempts.length === 0 ? (
          <p style={{ color: "#444", textAlign: "center", padding: 24, fontSize: 14 }}>No saved attempts yet</p>
        ) : attempts.map((attempt) => {
          const date = new Date(attempt.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          const preview = attempt.notes ? attempt.notes.substring(0, 60) : "No notes";
          return (
            <div key={attempt.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 12px", background: "#1a1a1a", borderRadius: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => openAttempt(attempt.id)}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{date}</div>
                <div style={{ fontSize: 13, color: "#777", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview}</div>
              </div>
              <button onClick={() => handleDelete(attempt.id)} style={{ background: "none", border: "none", color: "#555", fontSize: 18, padding: "8px 12px", cursor: "pointer" }}>✕</button>
            </div>
          );
        })}
      </div>

      {/* ── Camera View ── */}
      <div style={{ display: view === "camera" ? "block" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 12 }}>
          <button onClick={stopCamera} style={{ background: "none", border: "none", color: "#2a6aff", fontSize: 16, fontWeight: 600, padding: "8px 0", cursor: "pointer" }}>← Back</button>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{recordedBlob ? "Review" : "Camera"}</span>
        </div>

        <div style={{ display: recordedBlob ? "none" : "block", background: "#000", lineHeight: 0 }}>
          <video ref={cameraPreviewRef} playsInline muted style={{ width: "100%", display: "block" }} />
        </div>
        <div style={{ display: recordedBlob ? "block" : "none", background: "#000", lineHeight: 0 }}>
          <video ref={reviewVideoRef} playsInline controls style={{ width: "100%", display: "block" }} />
        </div>

        <div style={{ padding: 16 }}>
          {!recordedBlob ? (
            !isRecording
              ? <button onClick={startRecording} style={{ ...uploadBtnStyle, background: "#cc2222" }}>Start Recording</button>
              : <button onClick={stopRecording} style={{ ...uploadBtnStyle, background: "#555" }}>Stop Recording</button>
          ) : (
            <>
              <button onClick={useRecordedVideo} style={{ ...uploadBtnStyle, background: "#1a9a3a", marginBottom: 10 }}>Use This Video</button>
              <button onClick={() => setRecordedBlob(null)} style={{ ...uploadBtnStyle, background: "#333" }}>Retake</button>
            </>
          )}
        </div>
      </div>

      {/* ── Player View ── */}
      <div style={{ display: view === "player" ? "flex" : "none", flexDirection: "column", height: "100dvh", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "6px 12px", gap: 8 }}>
          <button onClick={goToUpload} style={{ background: "none", border: "none", color: "#2a6aff", fontSize: 15, fontWeight: 600, padding: "6px 0", cursor: "pointer" }}>← Back</button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Ninja Lab</span>
        </div>

        {/* Pinch-zoomable video container */}
        <div
          ref={containerRef}
          style={{ position: "relative", flex: 1, minHeight: 0, width: "100%", background: "#000", lineHeight: 0, overflow: "hidden" }}
        >
          <div ref={zoomLayerRef} style={{ transformOrigin: "0 0", willChange: "transform", height: "100%" }}>
            <video
              ref={videoRef}
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onLoadedMetadata={handleLoadedMetadata}
            />
            <canvas
              ref={canvasRef}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", touchAction: "none" }}
            />
          </div>
        </div>

        {/* Playback + speed controls */}
        <div style={{ display: "flex", gap: 4, padding: "6px 8px 4px" }}>
          {[{ label: playing ? "⏸" : "▶", fn: handlePlay }, { label: "◀", fn: handleFrameBack }, { label: "▶", fn: handleFrameForward }].map((b, i) => (
            <button key={i} onClick={b.fn} style={controlBtnStyle}>{b.label}</button>
          ))}
          <div style={{ width: 1, background: "#333", margin: "4px 2px" }} />
          {([0.25, 0.5, 1] as const).map((rate) => (
            <button key={rate} onClick={() => handleSpeed(rate)} style={controlBtnStyle}>{rate}x</button>
          ))}
        </div>

        {/* Annotation tools */}
        <div style={{ display: "flex", gap: 4, padding: "0 8px 4px", opacity: toolsDisabled ? 0.25 : 1, pointerEvents: toolsDisabled ? "none" : "auto" }}>
          {(["line", "arrow", "circle"] as Tool[]).map((tool) => (
            <button key={tool} onClick={() => handleToolSelect(tool)} style={{ ...toolBtnStyle, borderColor: activeTool === tool ? "#ff3333" : "#333", background: activeTool === tool ? "#301515" : "#222" }}>
              {tool.charAt(0).toUpperCase() + tool.slice(1)}
            </button>
          ))}
          <button onClick={() => annotationRef.current?.undo()} style={toolBtnStyle}>Undo</button>
          <button onClick={() => annotationRef.current?.clear()} style={toolBtnStyle}>Clear</button>
        </div>

        {/* Notes + Save */}
        <div style={{ display: "flex", gap: 6, padding: "0 8px 8px" }}>
          <input
            ref={notesRef}
            placeholder="Coach notes..."
            style={{ flex: 1, padding: "10px 12px", fontSize: 15, fontFamily: "inherit", background: "#1a1a1a", color: "#eee", border: "2px solid #333", borderRadius: 10, minWidth: 0 }}
          />
          <button onClick={handleSave} style={{ padding: "10px 16px", fontSize: 15, fontWeight: 700, background: "#1a9a3a", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap" }}>
            Save
          </button>
        </div>
      </div>
      {/* Permission help popup */}
      {showPermissionHelp && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24, zIndex: 100,
        }}>
          <div style={{ background: "#1a1a1a", borderRadius: 16, padding: 24, maxWidth: 340, width: "100%" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Allow Camera Access</h2>
            <p style={{ fontSize: 14, color: "#aaa", lineHeight: 1.6, marginBottom: 16 }}>
              To record videos, allow camera and microphone access permanently so you never see this prompt again:
            </p>
            <p style={{ fontSize: 13, color: "#666", lineHeight: 1.5, marginBottom: 12 }}>
              To stop seeing this message, grant permanent access in Settings:
            </p>
            <ol style={{ fontSize: 14, color: "#aaa", lineHeight: 2, paddingLeft: 20, marginBottom: 20 }}>
              <li>Open the iPhone <strong style={{ color: "#eee" }}>Settings</strong> app</li>
              <li>Scroll down and tap <strong style={{ color: "#eee" }}>Safari</strong></li>
              <li>Tap <strong style={{ color: "#eee" }}>Camera</strong> → select <strong style={{ color: "#eee" }}>Allow</strong></li>
              <li>Tap <strong style={{ color: "#eee" }}>Microphone</strong> → select <strong style={{ color: "#eee" }}>Allow</strong></li>
            </ol>
            <button
              onClick={doOpenCamera}
              style={{ display: "block", width: "100%", padding: 14, fontSize: 16, fontWeight: 600, background: "#2a6aff", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", marginBottom: 10 }}
            >
              Continue to Record
            </button>
            <button
              onClick={() => setShowPermissionHelp(false)}
              style={{ display: "block", width: "100%", padding: 14, fontSize: 15, fontWeight: 600, background: "#222", color: "#aaa", border: "none", borderRadius: 10, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

const uploadBtnStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: 18, fontSize: 18,
  fontWeight: 600, color: "#fff", border: "none", borderRadius: 12, cursor: "pointer",
};

const controlBtnStyle: React.CSSProperties = {
  flex: 1, padding: "10px 2px", fontSize: 14, fontWeight: 600,
  background: "#222", color: "#eee", border: "2px solid #333", borderRadius: 8, cursor: "pointer", minWidth: 0,
};

const toolBtnStyle: React.CSSProperties = {
  flex: 1, padding: "10px 2px", fontSize: 13, fontWeight: 600,
  background: "#222", color: "#eee", border: "2px solid #333", borderRadius: 8, cursor: "pointer", minWidth: 0,
};
