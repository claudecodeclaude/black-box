// Vanilla port of the Black Box QR Generator. Uses kazuhikoarase's
// qrcode-generator library (loaded via /apps/qr/qrcode.min.js as a global
// `qrcode` factory). Renders the QR to a canvas, optionally overlays a
// user-supplied logo at center, and exposes a PNG download link.

const form = document.getElementById("qrForm");
const result = document.getElementById("result");
const canvas = document.getElementById("qrCanvas");
const downloadLink = document.getElementById("downloadLink");

const QR_SIZE = 400;
const QUIET_ZONE = 4;
const LOGO_FRACTION = 0.22;

function safeFilename(s) {
  return (s || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "qr-code";
}

async function generate(text, logoFile) {
  // qrcode-generator: create with auto type number (0) and high error correction.
  const qr = qrcode(0, "H");
  qr.addData(text);
  qr.make();
  const cells = qr.getModuleCount();
  const cellSize = (QR_SIZE - QUIET_ZONE * 2) / cells;

  canvas.width = QR_SIZE;
  canvas.height = QR_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, QR_SIZE, QR_SIZE);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(
          QUIET_ZONE + c * cellSize,
          QUIET_ZONE + r * cellSize,
          cellSize,
          cellSize
        );
      }
    }
  }

  if (logoFile) {
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxSize = QR_SIZE * LOGO_FRACTION;
        let w = img.width;
        let h = img.height;
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const x = Math.round((QR_SIZE - w) / 2);
        const y = Math.round((QR_SIZE - h) / 2);
        ctx.drawImage(img, x, y, w, h);
        URL.revokeObjectURL(img.src);
        resolve();
      };
      img.onerror = resolve;
      img.src = URL.createObjectURL(logoFile);
    });
  }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = form.querySelector("button");
  const text = form.text.value.trim();
  if (!text) return;
  btn.disabled = true;
  btn.textContent = "Generating...";
  try {
    const logoFile = form.logo.files[0];
    await generate(text, logoFile);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = safeFilename(form.filename.value) + ".png";
      result.hidden = false;
    }, "image/png");
  } catch (e) {
    alert("Generate failed: " + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate QR Code";
  }
});
