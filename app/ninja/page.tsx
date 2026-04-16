"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { AnnotationCanvas } from "@/components/ninja/AnnotationCanvas";
import {
  getAllAttempts,
  getAttempt,
  saveAttempt,
  deleteAttempt,
  type Attempt,
  type Shape,
} from "@/components/ninja/storage";

type View = "upload" | "player";
type Tool = "line" | "arrow" | "circle";

function escapeHtml(text: string) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export default function NinjaPage() {
  const [view, setView] = useState<View>("upload");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [playing, setPlaying] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("line");
  const [saveLabel, setSaveLabel] = useState("Save Attempt");
  const [toolsDisabled, setToolsDisabled] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const annotationRef = useRef<AnnotationCanvas | null>(null);
  const currentBlobRef = useRef<Blob | null>(null);
  const currentIdRef = useRef<number | null>(null);

  // Init annotation canvas
  useEffect(() => {
    if (canvasRef.current && videoRef.current) {
      annotationRef.current = new AnnotationCanvas(canvasRef.current, videoRef.current);
    }
  }, []);

  // Load attempts list
  const refreshAttempts = useCallback(() => {
    getAllAttempts().then((all) => {
      setAttempts(all.sort((a, b) => b.id - a.id));
    });
  }, []);

  useEffect(() => {
    refreshAttempts();
  }, [refreshAttempts]);

  // Window resize
  useEffect(() => {
    const onResize = () => annotationRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function loadVideoBlob(blob: Blob) {
    const video = videoRef.current!;
    if (video.src?.startsWith("blob:")) URL.revokeObjectURL(video.src);
    video.src = URL.createObjectURL(blob);
    video.load();
    annotationRef.current?.clear();
    if (notesRef.current) notesRef.current.value = "";
    setSaveLabel("Save Attempt");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    currentBlobRef.current = file;
    currentIdRef.current = null;
    loadVideoBlob(file);
    setView("player");
    e.target.value = "";
  }

  function handleBack() {
    const video = videoRef.current!;
    video.pause();
    if (video.src?.startsWith("blob:")) URL.revokeObjectURL(video.src);
    video.removeAttribute("src");
    video.load();
    currentBlobRef.current = null;
    currentIdRef.current = null;
    setView("upload");
    refreshAttempts();
  }

  function handlePlay() {
    const video = videoRef.current!;
    if (video.paused) video.play();
    else video.pause();
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

  function handleSpeed(rate: number) {
    videoRef.current!.playbackRate = rate;
  }

  function handleToolSelect(tool: Tool) {
    setActiveTool(tool);
    annotationRef.current?.setTool(tool);
  }

  async function openAttempt(id: number) {
    const attempt = await getAttempt(id);
    if (!attempt) return;
    currentIdRef.current = attempt.id;
    currentBlobRef.current = attempt.video;
    loadVideoBlob(attempt.video);
    if (notesRef.current) notesRef.current.value = attempt.notes || "";

    videoRef.current!.addEventListener("loadedmetadata", function onMeta() {
      videoRef.current!.removeEventListener("loadedmetadata", onMeta);
      if (attempt.annotationTime != null) {
        videoRef.current!.currentTime = attempt.annotationTime;
      }
      setTimeout(() => {
        annotationRef.current?.resize();
        annotationRef.current?.setAnnotations(attempt.annotations as Shape[]);
      }, 50);
    });

    setView("player");
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
      const existing = await getAttempt(currentIdRef.current);
      if (existing?.createdAt) attempt.createdAt = existing.createdAt;
    }

    await saveAttempt(attempt);
    currentIdRef.current = attempt.id;
    setSaveLabel("Saved!");
    setTimeout(() => setSaveLabel("Save Attempt"), 1500);
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", background: "#111", minHeight: "100vh" }}>
      {/* Upload View */}
      {view === "upload" && (
        <div style={{ padding: "0 16px 32px" }}>
          <div style={{ marginTop: 16, marginBottom: 4 }}>
            <Link
              href="/"
              style={{ color: "var(--accent)", fontSize: 15, fontWeight: 600, textDecoration: "none" }}
            >
              ← Black Box
            </Link>
          </div>
          <div style={{ textAlign: "center", padding: "24px 16px 12px" }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: 2 }}>NINJA LAB</h1>
            <div style={{ fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: 3, marginTop: 4 }}>
              Replay Analysis
            </div>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: "block", width: "100%", padding: 18, fontSize: 18,
              fontWeight: 600, background: "#2a6aff", color: "#fff",
              border: "none", borderRadius: 12, cursor: "pointer", marginTop: 16,
            }}
          >
            Upload Video
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          <div style={{ fontSize: 13, color: "#666", textTransform: "uppercase", letterSpacing: 1.5, margin: "28px 0 12px" }}>
            Saved Attempts
          </div>

          {attempts.length === 0 ? (
            <p style={{ color: "#444", textAlign: "center", padding: 24, fontSize: 14 }}>
              No saved attempts yet
            </p>
          ) : (
            attempts.map((attempt) => {
              const date = new Date(attempt.createdAt).toLocaleDateString(undefined, {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              });
              const preview = attempt.notes ? attempt.notes.substring(0, 60) : "No notes";
              return (
                <div
                  key={attempt.id}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "14px 12px", background: "#1a1a1a", borderRadius: 10, marginBottom: 8, cursor: "pointer",
                  }}
                >
                  <div
                    style={{ flex: 1, minWidth: 0 }}
                    onClick={() => openAttempt(attempt.id)}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{date}</div>
                    <div style={{
                      fontSize: 13, color: "#777", whiteSpace: "nowrap",
                      overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {preview}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(attempt.id)}
                    style={{ background: "none", border: "none", color: "#555", fontSize: 18, padding: "8px 12px", cursor: "pointer" }}
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Player View */}
      {view === "player" && (
        <div style={{ paddingBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 12 }}>
            <button
              onClick={handleBack}
              style={{ background: "none", border: "none", color: "#2a6aff", fontSize: 16, fontWeight: 600, padding: "8px 0", cursor: "pointer" }}
            >
              ← Back
            </button>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Ninja Lab</span>
          </div>

          <div style={{ position: "relative", width: "100%", background: "#000", lineHeight: 0 }}>
            <video
              ref={videoRef}
              playsInline
              style={{ width: "100%", display: "block" }}
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onLoadedMetadata={handleLoadedMetadata}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute", top: 0, left: 0,
                width: "100%", height: "100%",
                pointerEvents: "none", touchAction: "none",
              }}
            />
          </div>

          {/* Playback controls */}
          <div style={{ display: "flex", gap: 8, padding: "12px 16px 8px" }}>
            {[
              { label: playing ? "Pause" : "Play", onClick: handlePlay },
              { label: "← Frame", onClick: handleFrameBack },
              { label: "Frame →", onClick: handleFrameForward },
            ].map((btn) => (
              <button key={btn.label} onClick={btn.onClick} style={controlBtnStyle}>
                {btn.label}
              </button>
            ))}
          </div>

          {/* Speed controls */}
          <div style={{ display: "flex", gap: 8, padding: "0 16px 8px" }}>
            {([0.25, 0.5, 1] as const).map((rate) => (
              <button
                key={rate}
                onClick={() => handleSpeed(rate)}
                style={{
                  ...controlBtnStyle,
                  borderColor: videoRef.current?.playbackRate === rate ? "#2a6aff" : "#333",
                  background: videoRef.current?.playbackRate === rate ? "#152040" : "#222",
                }}
              >
                {rate}x
              </button>
            ))}
          </div>

          {/* Annotation tools */}
          <div style={{ fontSize: 12, color: "#555", textTransform: "uppercase", letterSpacing: 1, padding: "4px 16px 6px" }}>
            Draw on paused frame
          </div>
          <div style={{
            display: "flex", gap: 8, padding: "0 16px 12px",
            opacity: toolsDisabled ? 0.25 : 1,
            pointerEvents: toolsDisabled ? "none" : "auto",
          }}>
            {(["line", "arrow", "circle"] as Tool[]).map((tool) => (
              <button
                key={tool}
                onClick={() => handleToolSelect(tool)}
                style={{
                  ...toolBtnStyle,
                  borderColor: activeTool === tool ? "#ff3333" : "#333",
                  background: activeTool === tool ? "#301515" : "#222",
                }}
              >
                {tool.charAt(0).toUpperCase() + tool.slice(1)}
              </button>
            ))}
            <button onClick={() => annotationRef.current?.undo()} style={toolBtnStyle}>Undo</button>
            <button onClick={() => annotationRef.current?.clear()} style={toolBtnStyle}>Clear</button>
          </div>

          <textarea
            ref={notesRef}
            placeholder="Coach notes..."
            style={{
              display: "block", width: "calc(100% - 32px)", margin: "0 16px 12px",
              padding: 12, fontSize: 16, fontFamily: "inherit",
              background: "#1a1a1a", color: "#eee",
              border: "2px solid #333", borderRadius: 10,
              resize: "vertical", minHeight: 56,
            }}
          />

          <button
            onClick={handleSave}
            style={{
              display: "block", width: "calc(100% - 32px)", margin: "0 16px",
              padding: 16, fontSize: 17, fontWeight: 700,
              background: saveLabel === "Saved!" ? "#2a6aff" : "#1a9a3a",
              color: "#fff", border: "none", borderRadius: 12, cursor: "pointer",
            }}
          >
            {saveLabel}
          </button>
        </div>
      )}
    </main>
  );
}

const controlBtnStyle: React.CSSProperties = {
  flex: 1, padding: "14px 4px", fontSize: 15, fontWeight: 600,
  background: "#222", color: "#eee", border: "2px solid #333",
  borderRadius: 10, cursor: "pointer",
};

const toolBtnStyle: React.CSSProperties = {
  flex: 1, padding: "12px 4px", fontSize: 13, fontWeight: 600,
  background: "#222", color: "#eee", border: "2px solid #333",
  borderRadius: 10, cursor: "pointer", minWidth: 0,
};
