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
  type FrameSnapshot,
} from "@/components/ninja/storage";

type View = "upload" | "camera" | "player";

function getBestMimeType() {
  const types = ["video/webm;codecs=vp9", "video/webm", "video/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export default function NinjaPage() {
  const [view, setView] = useState<View>("upload");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [playing, setPlaying] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Save Attempt");
  const [shapeMenu, setShapeMenu] = useState<{ index: number; x: number; y: number; type: Shape["type"]; color: string } | null>(null);
  const [drawColor, setDrawColor] = useState<string>("#ff2222");
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [frames, setFrames] = useState<FrameSnapshot[]>([]);
  const [currentFrameIdx, setCurrentFrameIdx] = useState<number | null>(null);
  const [showFrameGrid, setShowFrameGrid] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const framesRef = useRef<FrameSnapshot[]>([]);
  const currentFrameIdxRef = useRef<number | null>(null);
  useEffect(() => { framesRef.current = frames; }, [frames]);
  useEffect(() => { currentFrameIdxRef.current = currentFrameIdx; }, [currentFrameIdx]);

  // Camera / recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cameraContainerRef = useRef<HTMLDivElement>(null);
  const cameraZoomRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const cameraPinchRef = useRef({ active: false, initialDist: 0, initialZoom: 1, initialPanX: 0, initialPanY: 0, centerX: 0, centerY: 0 });

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
      const ac = new AnnotationCanvas(canvasRef.current, videoRef.current);
      ac.onPinch = (z, px, py) => {
        applyTransform(z, px, py);
        ac.setZoomState(z, px, py);
      };
      ac.onShapeTap = (index, screenX, screenY, shape) => {
        setShapeMenu({ index, x: screenX, y: screenY, type: shape.type, color: shape.color ?? "#ff2222" });
      };
      ac.color = drawColor;
      annotationRef.current = ac;
    }
  }, []);

  useEffect(() => {
    if (annotationRef.current) annotationRef.current.color = drawColor;
  }, [drawColor]);

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

  // Pinch-to-zoom on camera preview
  useEffect(() => {
    const container = cameraContainerRef.current;
    const vid = cameraPreviewRef.current;
    if (!container || !vid) return;

    function touchDist(touches: TouchList) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function applyCameraTransform(z: number, px: number, py: number) {
      cameraZoomRef.current = { zoom: z, panX: px, panY: py };
      vid!.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const z = cameraZoomRef.current;
        cameraPinchRef.current = {
          active: true,
          initialDist: touchDist(e.touches),
          initialZoom: z.zoom,
          initialPanX: z.panX,
          initialPanY: z.panY,
          centerX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          centerY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && cameraPinchRef.current.active) {
        e.preventDefault();
        const p = cameraPinchRef.current;
        const newZoom = Math.min(Math.max(p.initialZoom * touchDist(e.touches) / p.initialDist, 1), 5);
        const contentX = (p.centerX - p.initialPanX) / p.initialZoom;
        const contentY = (p.centerY - p.initialPanY) / p.initialZoom;
        let newPanX = p.centerX - contentX * newZoom;
        let newPanY = p.centerY - contentY * newZoom;
        const W = window.innerWidth;
        const H = window.innerHeight;
        newPanX = Math.min(0, Math.max(newPanX, W * (1 - newZoom)));
        newPanY = Math.min(0, Math.max(newPanY, H * (1 - newZoom)));
        applyCameraTransform(newZoom, newPanX, newPanY);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        cameraPinchRef.current.active = false;
        if (cameraZoomRef.current.zoom < 1.05) {
          applyCameraTransform(1, 0, 0);
        }
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

  // Pinch-to-zoom is now handled by AnnotationCanvas via the onPinch callback

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
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
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
    const recorder = new MediaRecorder(streamRef.current, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 8_000_000,
    });
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
    if (cameraPreviewRef.current) {
      cameraPreviewRef.current.style.transform = "";
      cameraZoomRef.current = { zoom: 1, panX: 0, panY: 0 };
    }
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
    setFrames([]);
    setCurrentFrameIdx(null);
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

  function composeFrameThumbnail(): string {
    const video = videoRef.current!;
    const ann = canvasRef.current!;
    const W = ann.width;
    const H = ann.height;
    const vw = video.videoWidth || W;
    const vh = video.videoHeight || H;
    const scale = Math.min(W / vw, H / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    const tw = 200;
    const th = Math.max(1, Math.round(tw * (H / W)));
    const tc = document.createElement("canvas");
    tc.width = tw;
    tc.height = th;
    const tctx = tc.getContext("2d")!;
    tctx.fillStyle = "#000";
    tctx.fillRect(0, 0, tw, th);
    const sx = tw / W;
    const sy = th / H;
    tctx.drawImage(video, dx * sx, dy * sy, dw * sx, dh * sy);
    tctx.drawImage(ann, 0, 0, tw, th);
    return tc.toDataURL("image/jpeg", 0.7);
  }

  function captureAndClear() {
    const ann = annotationRef.current;
    const video = videoRef.current;
    if (!ann || !video) return;
    const time = video.currentTime;
    const editingIdx = currentFrameIdxRef.current;

    if (ann.shapes.length === 0) {
      // If we were viewing a snapshot and emptied it, remove it
      if (editingIdx !== null) {
        const next = framesRef.current.filter((_, i) => i !== editingIdx);
        framesRef.current = next;
        setFrames(next);
        currentFrameIdxRef.current = null;
        setCurrentFrameIdx(null);
      }
      return;
    }

    const thumbnail = composeFrameThumbnail();
    const shapes = ann.getAnnotations();
    const next = framesRef.current.slice();
    const matchIdx = editingIdx !== null && editingIdx < next.length
      ? editingIdx
      : next.findIndex((f) => Math.abs(f.time - time) < 0.015);
    if (matchIdx >= 0) next[matchIdx] = { time, shapes, thumbnail };
    else next.push({ time, shapes, thumbnail });
    next.sort((a, b) => a.time - b.time);
    framesRef.current = next;
    setFrames(next);
    ann.clear();
    currentFrameIdxRef.current = null;
    setCurrentFrameIdx(null);
  }

  function loadSnapshotAtCurrentTime() {
    const video = videoRef.current!;
    const ann = annotationRef.current;
    if (!ann || ann.shapes.length > 0) return;
    const time = video.currentTime;
    const idx = framesRef.current.findIndex((f) => Math.abs(f.time - time) < 0.015);
    if (idx >= 0) {
      ann.setAnnotations(framesRef.current[idx].shapes);
      setCurrentFrameIdx(idx);
    } else {
      setCurrentFrameIdx(null);
    }
  }

  function handlePlay() {
    const video = videoRef.current!;
    if (video.paused) {
      captureAndClear();
      video.play();
    } else {
      video.pause();
    }
  }

  function handleVideoPlay() {
    setPlaying(true);
    annotationRef.current?.disable();
  }

  function handleVideoPause() {
    setPlaying(false);
    annotationRef.current?.enable();
    annotationRef.current?.resize();
    loadSnapshotAtCurrentTime();
  }

  function handleVideoSeeked() {
    const video = videoRef.current!;
    if (!video.paused) return;
    loadSnapshotAtCurrentTime();
  }

  function handleLoadedMetadata() {
    annotationRef.current?.resize();
    annotationRef.current?.enable();
    setDuration(videoRef.current?.duration ?? 0);
  }

  function handleTimeUpdate() {
    setCurrentTime(videoRef.current?.currentTime ?? 0);
  }

  function seekTimelineToEvent(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = pct * (videoRef.current?.duration ?? 0);
    videoRef.current!.currentTime = target;
  }

  function handleTimelineDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    videoRef.current!.pause();
    captureAndClear();
    seekTimelineToEvent(e);
  }

  function handleTimelineMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      seekTimelineToEvent(e);
    }
  }

  function handleTimelineUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function handleFrameBack() {
    const video = videoRef.current!;
    video.pause();
    captureAndClear();
    video.currentTime = Math.max(0, video.currentTime - 1 / 30);
  }

  function handleFrameForward() {
    const video = videoRef.current!;
    video.pause();
    captureAndClear();
    video.currentTime = Math.min(video.duration, video.currentTime + 1 / 30);
  }

  function handleFrameThumbClick(idx: number) {
    const video = videoRef.current!;
    const ann = annotationRef.current!;
    const frame = framesRef.current[idx];
    if (!frame) return;
    captureAndClear();
    video.pause();
    video.currentTime = frame.time;
    ann.setAnnotations(frame.shapes);
    setCurrentFrameIdx(idx);
    setShowFrameGrid(false);
  }

  function handleFrameDelete(idx: number) {
    setFrames((prev) => prev.filter((_, i) => i !== idx));
    if (currentFrameIdxRef.current === idx) {
      annotationRef.current?.clear();
      setCurrentFrameIdx(null);
    }
  }

  function handleSpeed(rate: number) {
    videoRef.current!.playbackRate = rate;
    setPlaybackRate(rate);
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
      const initialFrames: FrameSnapshot[] = attempt.frames && attempt.frames.length > 0
        ? attempt.frames.slice()
        : (attempt.annotations && attempt.annotations.length > 0
          ? [{ time: attempt.annotationTime ?? 0, shapes: attempt.annotations as Shape[], thumbnail: "" }]
          : []);
      setFrames(initialFrames);
      videoRef.current!.addEventListener("loadedmetadata", function onMeta() {
        videoRef.current!.removeEventListener("loadedmetadata", onMeta);
        if (attempt.annotationTime != null) videoRef.current!.currentTime = attempt.annotationTime;
        setTimeout(() => {
          annotationRef.current?.resize();
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
    // Capture any unsaved drawing into frames before persisting
    captureAndClear();
    const attempt: Attempt = {
      id: currentIdRef.current || Date.now(),
      video: currentBlobRef.current,
      annotations: annotationRef.current?.getAnnotations() ?? [],
      annotationTime: videoRef.current?.currentTime ?? 0,
      notes: notesRef.current?.value ?? "",
      createdAt: new Date().toISOString(),
      frames: framesRef.current.slice(),
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
      <div style={{ display: view === "camera" ? "block" : "none", position: "fixed", inset: 0, background: "#000", zIndex: 50 }}>
        <div ref={cameraContainerRef} style={{ width: "100%", height: "100%", overflow: "hidden", touchAction: "none", display: recordedBlob ? "none" : "block" }}>
          <video ref={cameraPreviewRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transformOrigin: "0 0" }} />
        </div>
        <video ref={reviewVideoRef} playsInline controls style={{ width: "100%", height: "100%", objectFit: "contain", display: recordedBlob ? "block" : "none" }} />

        {/* Fixed header */}
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, padding: "10px 16px", zIndex: 51 }}>
          <button onClick={stopCamera} style={{ background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>← Back</button>
        </div>

        {/* Fixed bottom buttons */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "16px", zIndex: 51 }}>
          {!recordedBlob ? (
            !isRecording
              ? <button onClick={startRecording} style={{ ...uploadBtnStyle, background: "#cc2222" }}>Start Recording</button>
              : <button onClick={stopRecording} style={{ ...uploadBtnStyle, background: "rgba(80,80,80,0.85)" }}>Stop Recording</button>
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
              onSeeked={handleVideoSeeked}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
            />
            <canvas
              ref={canvasRef}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", touchAction: "none" }}
            />
          </div>

          {/* Frame thumbnail stack (bottom-right corner) */}
          {frames.length > 0 && (
            <button
              onClick={() => setShowFrameGrid(true)}
              style={{
                position: "absolute", bottom: 10, right: 10, zIndex: 10,
                padding: 0, background: "none", border: "none", cursor: "pointer",
                display: "flex", alignItems: "flex-end", gap: 4,
              }}
              aria-label={`Open frame grid (${frames.length} frames)`}
            >
              <span style={{
                background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 12, fontWeight: 700,
                padding: "3px 7px", borderRadius: 10, marginBottom: 4,
              }}>{frames.length}</span>
              <div style={{ position: "relative", width: 64, height: 36 }}>
                {frames.slice(-3).map((f, i, arr) => (
                  <img
                    key={i}
                    src={f.thumbnail || ""}
                    alt=""
                    style={{
                      position: "absolute",
                      top: (arr.length - 1 - i) * -3,
                      left: (arr.length - 1 - i) * -3,
                      width: 64, height: 36, objectFit: "cover",
                      border: "2px solid #fff", borderRadius: 4, background: "#000",
                    }}
                  />
                ))}
              </div>
            </button>
          )}
        </div>

        {/* Timeline scrubber */}
        <div
          onPointerDown={handleTimelineDown}
          onPointerMove={handleTimelineMove}
          onPointerUp={handleTimelineUp}
          onPointerCancel={handleTimelineUp}
          style={{ position: "relative", height: 28, padding: "12px 12px", touchAction: "none", cursor: "pointer" }}
        >
          <div style={{ position: "relative", width: "100%", height: 4, background: "#333", borderRadius: 2 }}>
            <div style={{
              position: "absolute", left: 0, top: 0, height: "100%",
              width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
              background: "#fff", borderRadius: 2,
            }} />
            <div style={{
              position: "absolute",
              left: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
              top: "50%", transform: "translate(-50%, -50%)",
              width: 14, height: 14, background: "#fff", borderRadius: "50%",
              boxShadow: "0 0 0 2px rgba(0,0,0,0.5)",
            }} />
          </div>
        </div>

        {/* Playback + speed controls */}
        <div style={{ display: "flex", gap: 4, padding: "6px 8px 4px" }}>
          {[{ label: playing ? "⏸" : "▶", fn: handlePlay }, { label: "|◀", fn: handleFrameBack }, { label: "▶|", fn: handleFrameForward }].map((b, i) => (
            <button key={i} onClick={b.fn} style={controlBtnStyle}>{b.label}</button>
          ))}
          <div style={{ width: 1, background: "#333", margin: "4px 2px" }} />
          {([0.25, 0.5, 1] as const).map((rate) => (
            <button
              key={rate}
              onClick={() => handleSpeed(rate)}
              style={{ ...controlBtnStyle, border: playbackRate === rate ? "3px solid #fff" : controlBtnStyle.border }}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* Annotation tools */}
        <div style={{ display: "flex", gap: 4, padding: "0 8px 4px" }}>
          <button onClick={() => annotationRef.current?.undo()} style={toolBtnStyle}>Undo</button>
          <button onClick={() => annotationRef.current?.clear()} style={toolBtnStyle}>Clear</button>
          {(["#22cc44", "#ffcc00", "#ff2222"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setDrawColor(c)}
              aria-label={`Draw color ${c}`}
              style={{
                flex: 1, padding: "10px 2px", minWidth: 0, cursor: "pointer", borderRadius: 8,
                background: c,
                border: drawColor === c ? "3px solid #fff" : "2px solid #333",
              }}
            />
          ))}
        </div>

        {/* Notes + Save */}
        <div style={{ display: "flex", gap: 6, padding: "0 8px 8px" }}>
          <input
            ref={notesRef}
            placeholder="Coach notes..."
            style={{ flex: 1, padding: "10px 12px", fontSize: 15, fontFamily: "inherit", background: "#1a1a1a", color: "#eee", border: "2px solid #333", borderRadius: 10, minWidth: 0 }}
          />
          <button onClick={handleSave} style={{ padding: "10px 16px", fontSize: 15, fontWeight: 700, background: "#0a84ff", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap" }}>
            Save
          </button>
        </div>
      </div>
      {/* Frame grid */}
      {showFrameGrid && (
        <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.92)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12, borderBottom: "1px solid #222" }}>
            <button onClick={() => setShowFrameGrid(false)} style={{ background: "none", border: "none", color: "#2a6aff", fontSize: 16, fontWeight: 600, padding: "6px 0", cursor: "pointer" }}>← Back</button>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#eee" }}>{frames.length} frame{frames.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {frames.map((f, i) => (
              <div key={i} style={{ position: "relative", background: "#1a1a1a", borderRadius: 8, overflow: "hidden" }}>
                <button
                  onClick={() => handleFrameThumbClick(i)}
                  style={{ display: "block", width: "100%", padding: 0, background: "none", border: "none", cursor: "pointer", position: "relative" }}
                  aria-label={`Go to frame at ${formatTime(f.time)}`}
                >
                  {f.thumbnail
                    ? <img src={f.thumbnail} alt="" style={{ display: "block", width: "100%", aspectRatio: "16 / 9", objectFit: "cover", background: "#000" }} />
                    : <div style={{ width: "100%", aspectRatio: "16 / 9", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 12 }}>no preview</div>}
                  <span style={{
                    position: "absolute", bottom: 6, left: 6,
                    background: "rgba(0,0,0,0.75)", color: "#fff",
                    fontSize: 12, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                  }}>{formatTime(f.time)}</span>
                </button>
                <button
                  onClick={() => handleFrameDelete(i)}
                  aria-label="Delete frame"
                  style={{
                    position: "absolute", top: 6, right: 6, width: 26, height: 26,
                    borderRadius: 13, border: "none", background: "rgba(0,0,0,0.75)",
                    color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                  }}
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shape type menu */}
      {shapeMenu && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 100 }}
          onClick={() => setShapeMenu(null)}
        >
          <div
            style={{
              position: "absolute",
              left: Math.min(shapeMenu.x, window.innerWidth - 160),
              top: Math.max(0, shapeMenu.y - 120),
              background: "#222", borderRadius: 10, border: "2px solid #444",
              padding: 4, minWidth: 120,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(["line", "arrow", "circle", "oval", "angle"] as const).filter((t) => t !== shapeMenu.type).map((type) => (
              <button
                key={type}
                onClick={() => {
                  annotationRef.current?.changeShapeType(shapeMenu.index, type);
                  setShapeMenu(null);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", fontSize: 15, fontWeight: 600,
                  background: "none", color: "#eee", border: "none", borderRadius: 6,
                  textAlign: "left", cursor: "pointer",
                }}
              >
                <ShapeIcon type={type} />
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
            {([["#22cc44", "Green"], ["#ffcc00", "Yellow"], ["#ff2222", "Red"]] as const).filter(([c]) => c !== shapeMenu.color).map(([c, label]) => (
              <button
                key={c}
                onClick={() => {
                  annotationRef.current?.changeShapeColor(shapeMenu.index, c);
                  setShapeMenu(null);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", fontSize: 15, fontWeight: 600,
                  background: "none", color: "#eee", border: "none", borderRadius: 6,
                  textAlign: "left", cursor: "pointer",
                }}
              >
                <span style={{ display: "inline-block", width: 16, height: 16, background: c, borderRadius: 4 }} />
                {label}
              </button>
            ))}
            <button
              onClick={() => {
                annotationRef.current?.deleteShape(shapeMenu.index);
                setShapeMenu(null);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", fontSize: 15, fontWeight: 600,
                background: "none", color: "#eee", border: "none", borderRadius: 6,
                textAlign: "left", cursor: "pointer", borderTop: "1px solid #333",
              }}
            >
              <TrashIcon />
              Delete
            </button>
          </div>
        </div>
      )}
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

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const totalCs = Math.floor(seconds * 100);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const totalM = Math.floor(totalS / 60);
  const m = totalM % 60;
  const h = Math.floor(totalM / 60);
  const pad = (n: number, w: number) => n.toString().padStart(w, "0");
  if (h > 0) return `${h}:${pad(m, 2)}:${pad(s, 2)}`;
  return `${m}:${pad(s, 2)}.${pad(cs, 2)}`;
}

function ShapeIcon({ type }: { type: Shape["type"] }) {
  const common = { width: 18, height: 18, viewBox: "0 0 20 20", stroke: "#eee", strokeWidth: 2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (type === "line") return <svg {...common}><line x1="4" y1="16" x2="16" y2="4" /></svg>;
  if (type === "arrow") return <svg {...common}><line x1="4" y1="16" x2="15" y2="5" /><polyline points="10,5 15,5 15,10" /></svg>;
  if (type === "circle") return <svg {...common}><circle cx="10" cy="10" r="6" /></svg>;
  if (type === "oval") return <svg {...common}><ellipse cx="10" cy="10" rx="7" ry="5" /></svg>;
  if (type === "angle") return <svg {...common}><polyline points="4,5 10,15 16,5" /></svg>;
  return null;
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" stroke="#eee" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6 L16 6" />
      <path d="M8 4 L12 4" />
      <path d="M5.5 6 L6.5 17 L13.5 17 L14.5 6" />
      <line x1="9" y1="9" x2="9" y2="14" />
      <line x1="11" y1="9" x2="11" y2="14" />
    </svg>
  );
}
