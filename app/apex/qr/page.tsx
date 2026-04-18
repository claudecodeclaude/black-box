"use client";

import { useState, useRef } from "react";
import QRCode from "qrcode";
import Link from "next/link";

export default function QRPage() {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("qr-code");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);

    // Generate QR to canvas
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, text.trim(), {
      errorCorrectionLevel: "H",
      width: 400,
      margin: 4,
      color: { dark: "#000000", light: "#ffffff" },
    });

    const ctx = canvas.getContext("2d")!;
    const logoFile = logoRef.current?.files?.[0];

    if (logoFile) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const maxSize = canvas.width * 0.22;
          let w = img.width;
          let h = img.height;
          if (w > maxSize || h > maxSize) {
            const ratio = Math.min(maxSize / w, maxSize / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const x = Math.round((canvas.width - w) / 2);
          const y = Math.round((canvas.height - h) / 2);
          ctx.drawImage(img, x, y, w, h);
          resolve();
        };
        img.src = URL.createObjectURL(logoFile);
      });
    }

    // Clean up old URLs
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setDownloadUrl(url);
      setLoading(false);
    }, "image/png");
  }

  const safeFilename =
    filename.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "qr-code";

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ marginBottom: 24 }}>
        <Link
          href="/"
          style={{ color: "var(--accent)", fontSize: 15, fontWeight: 600, textDecoration: "none" }}
        >
          ← Black Box
        </Link>
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
        QR Generator
      </h1>

      <form onSubmit={generate} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text or URL"
          required
          style={inputStyle}
        />

        <input
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="Filename (default: qr-code)"
          style={inputStyle}
        />

        <label style={{ fontSize: 13, color: "var(--muted)" }}>
          Optional logo (PNG/JPG):
        </label>
        <input
          ref={logoRef}
          type="file"
          accept="image/png,image/jpeg"
          style={{ fontSize: 14, color: "var(--text)" }}
        />

        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? "Generating..." : "Generate QR Code"}
        </button>
      </form>

      {previewUrl && (
        <div style={{ marginTop: 28, textAlign: "center" }}>
          <img
            src={previewUrl}
            alt="QR Code"
            style={{ maxWidth: 280, borderRadius: 8, border: "1px solid var(--border)" }}
          />
          <div style={{ marginTop: 14 }}>
            <a
              href={downloadUrl!}
              download={safeFilename + ".png"}
              style={{ color: "var(--accent)", fontWeight: 600, fontSize: 15 }}
            >
              Download PNG
            </a>
          </div>
        </div>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  fontSize: 16,
  background: "var(--surface)",
  color: "var(--text)",
  border: "2px solid var(--border)",
  borderRadius: 8,
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  marginTop: 4,
  padding: "14px",
  fontSize: 16,
  fontWeight: 600,
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};
