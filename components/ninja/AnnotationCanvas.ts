import type { Shape } from "./storage";

export type PinchCallback = (zoom: number, panX: number, panY: number) => void;

interface Point { x: number; y: number }

export class AnnotationCanvas {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  ctx: CanvasRenderingContext2D;
  shapes: Shape[];
  drawing: boolean;
  enabled: boolean;
  multiTouch: boolean;
  color: string;
  lineWidth: number;
  onPinch: PinchCallback | null;
  private _strokePoints: Point[];
  private _pinch: { active: boolean; initialDist: number; initialZoom: number; initialPanX: number; initialPanY: number; centerX: number; centerY: number };
  private _zoom: number;
  private _panX: number;
  private _panY: number;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext("2d")!;
    this.shapes = [];
    this.drawing = false;
    this.enabled = false;
    this.multiTouch = false;
    this.color = "#ff2222";
    this.lineWidth = 3;
    this.onPinch = null;
    this._strokePoints = [];
    this._pinch = { active: false, initialDist: 0, initialZoom: 1, initialPanX: 0, initialPanY: 0, centerX: 0, centerY: 0 };
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;

    canvas.addEventListener("pointerdown", (e) => this._onDown(e));
    canvas.addEventListener("pointermove", (e) => this._onMove(e));
    canvas.addEventListener("pointerup", (e) => this._onUp(e));
    canvas.addEventListener("pointercancel", (e) => this._onUp(e));

    canvas.addEventListener("touchstart", (e) => this._onTouchStart(e), { passive: false });
    canvas.addEventListener("touchmove", (e) => this._onTouchMove(e), { passive: false });
    canvas.addEventListener("touchend", (e) => this._onTouchEnd(e));
  }

  // ── Touch / Pinch ──

  private _touchDist(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private _onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      this.multiTouch = true;
      if (this.drawing) { this.drawing = false; this._strokePoints = []; this.redraw(); }
      const rect = this.canvas.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      this._pinch = {
        active: true,
        initialDist: this._touchDist(e.touches),
        initialZoom: this._zoom,
        initialPanX: this._panX,
        initialPanY: this._panY,
        centerX: cx,
        centerY: cy,
      };
    } else if (e.touches.length === 1 && this.enabled) {
      e.preventDefault();
    }
  }

  private _onTouchMove(e: TouchEvent) {
    if (e.touches.length === 2 && this._pinch.active) {
      e.preventDefault();
      const p = this._pinch;
      const container = this.canvas.parentElement!;
      const W = container.clientWidth;
      const H = container.clientHeight;
      const newZoom = Math.min(Math.max(p.initialZoom * this._touchDist(e.touches) / p.initialDist, 1), 5);

      const rect = this.canvas.getBoundingClientRect();
      const currentCX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const currentCY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      const dragX = currentCX - p.centerX;
      const dragY = currentCY - p.centerY;

      const contentX = (p.centerX - p.initialPanX) / p.initialZoom;
      const contentY = (p.centerY - p.initialPanY) / p.initialZoom;
      let newPanX = p.centerX - contentX * newZoom + dragX;
      let newPanY = p.centerY - contentY * newZoom + dragY;

      newPanX = Math.min(0, Math.max(newPanX, W * (1 - newZoom)));
      newPanY = Math.min(0, Math.max(newPanY, H * (1 - newZoom)));

      this._zoom = newZoom;
      this._panX = newPanX;
      this._panY = newPanY;
      if (this.onPinch) this.onPinch(newZoom, newPanX, newPanY);
    } else if (e.touches.length === 1 && this.enabled) {
      e.preventDefault();
    }
  }

  private _onTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) {
      this._pinch.active = false;
      this.multiTouch = false;
      if (this._zoom < 1.05) {
        this._zoom = 1;
        this._panX = 0;
        this._panY = 0;
        if (this.onPinch) this.onPinch(1, 0, 0);
      }
    }
  }

  setZoomState(zoom: number, panX: number, panY: number) {
    this._zoom = zoom;
    this._panX = panX;
    this._panY = panY;
  }

  // ── Pointer / Drawing ──

  private _getPos(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  _onDown(e: PointerEvent) {
    if (!this.enabled || this.multiTouch) return;
    e.preventDefault();
    this.drawing = true;
    const pos = this._getPos(e);
    this._strokePoints = [pos];
    this.canvas.setPointerCapture(e.pointerId);
  }

  _onMove(e: PointerEvent) {
    if (!this.drawing || this.multiTouch) return;
    e.preventDefault();
    const pos = this._getPos(e);
    this._strokePoints.push(pos);
    this.redraw();
    this._drawFreehand();
  }

  _onUp(e: PointerEvent) {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.multiTouch) { this._strokePoints = []; this.redraw(); return; }

    const pos = this._getPos(e);
    this._strokePoints.push(pos);

    const shape = this._recognize(this._strokePoints);
    if (shape) this.shapes.push(shape);
    this._strokePoints = [];
    this.redraw();
  }

  // ── Freehand preview ──

  private _drawFreehand() {
    const pts = this._strokePoints;
    if (pts.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    const ctx = this.ctx;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lineWidth / this._zoom;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * w, pts[i].y * h);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Shape Recognition ──

  private _dist(a: Point, b: Point): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  private _pathLength(pts: Point[]): number {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += this._dist(pts[i], pts[i - 1]);
    return len;
  }

  private _sample(pts: Point[], n: number): Point[] {
    if (pts.length <= n) return pts.slice();
    const total = this._pathLength(pts);
    const step = total / (n - 1);
    const out: Point[] = [pts[0]];
    let acc = 0;
    let j = 1;
    for (let i = 1; i < n - 1; i++) {
      const target = i * step;
      while (j < pts.length) {
        const seg = this._dist(pts[j - 1], pts[j]);
        if (acc + seg >= target) {
          const t = (target - acc) / seg;
          out.push({ x: pts[j - 1].x + t * (pts[j].x - pts[j - 1].x), y: pts[j - 1].y + t * (pts[j].y - pts[j - 1].y) });
          break;
        }
        acc += seg;
        j++;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  private _segmentStraightness(pts: Point[]): number {
    if (pts.length < 2) return 1;
    const direct = this._dist(pts[0], pts[pts.length - 1]);
    const path = this._pathLength(pts);
    return path > 0 ? direct / path : 1;
  }

  private _recognize(raw: Point[]): Shape | null {
    if (raw.length < 3) return null;
    const pathLen = this._pathLength(raw);
    if (pathLen < 0.015 / this._zoom) return null;

    const first = raw[0];
    const last = raw[raw.length - 1];
    const closeDist = this._dist(first, last);

    // ── Closed loop → circle or oval ──
    if (closeDist < pathLen * 0.3 && pathLen > 0.05) {
      // Compute bounding box center and radii
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of raw) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rx = (maxX - minX) / 2;
      const ry = (maxY - minY) / 2;

      if (rx > 0.01 && ry > 0.01) {
        // Check how well points fit the ellipse
        let totalErr = 0;
        const avgR = (rx + ry) / 2;
        for (const p of raw) {
          // Normalized distance from ellipse (1.0 = on the ellipse)
          const nx = (p.x - cx) / rx;
          const ny = (p.y - cy) / ry;
          const ellipseDist = Math.sqrt(nx * nx + ny * ny);
          totalErr += Math.abs(ellipseDist - 1);
        }
        const avgErr = totalErr / raw.length;

        if (avgErr < 0.4) {
          // If roughly circular (aspect ratio close to 1), use circle
          const aspect = Math.max(rx, ry) / Math.min(rx, ry);
          if (aspect < 1.3) {
            return { type: "circle", x1: cx, y1: cy, x2: cx + avgR, y2: cy };
          }
          // Otherwise oval: encode center + radii (x2 = rx, y2 = ry)
          return { type: "oval", x1: cx, y1: cy, x2: rx, y2: ry };
        }
      }
    }

    // ── Arrow: straight stroke with any hook/flick back at the end ──
    // Find the point furthest from start — that's the arrow tip
    let maxD = 0, tipIdx = 0;
    for (let i = 0; i < raw.length; i++) {
      const d = this._dist(raw[i], first);
      if (d > maxD) { maxD = d; tipIdx = i; }
    }

    // Arrow if: the tip is past the halfway point, is NOT the very last point
    // (meaning the stroke continued/hooked back after reaching the tip),
    // and the path from start to tip is reasonably straight
    if (tipIdx >= raw.length * 0.4 && tipIdx < raw.length - 1) {
      const toTip = raw.slice(0, tipIdx + 1);
      const tipStraightness = this._segmentStraightness(toTip);

      if (tipStraightness > 0.75) {
        const tip = raw[tipIdx];
        return { type: "arrow", x1: first.x, y1: first.y, x2: tip.x, y2: tip.y };
      }
    }

    // ── Angle: V-shape with bend ──
    const sampled = this._sample(raw, 24);
    if (sampled.length >= 7) {
      let bestIdx = -1;
      let bestAngle = Math.PI;

      const lo = Math.max(3, Math.floor(sampled.length * 0.2));
      const hi = Math.min(sampled.length - 3, Math.ceil(sampled.length * 0.8));

      for (let i = lo; i < hi; i++) {
        const a = sampled[i - 3];
        const b = sampled[i];
        const c = sampled[i + 3];
        const ba = { x: a.x - b.x, y: a.y - b.y };
        const bc = { x: c.x - b.x, y: c.y - b.y };
        const dot = ba.x * bc.x + ba.y * bc.y;
        const mag = Math.sqrt(ba.x ** 2 + ba.y ** 2) * Math.sqrt(bc.x ** 2 + bc.y ** 2);
        if (mag > 0.0001) {
          const angle = Math.acos(Math.max(-1, Math.min(1, dot / mag)));
          if (angle < bestAngle) { bestAngle = angle; bestIdx = i; }
        }
      }

      // Accept angles up to ~175°
      if (bestAngle < Math.PI * 0.97 && bestIdx >= 0) {
        const arm1 = sampled.slice(0, bestIdx + 1);
        const arm2 = sampled.slice(bestIdx);
        const arm1Len = this._pathLength(arm1);
        const arm2Len = this._pathLength(arm2);
        const minArm = pathLen * 0.1;

        if (arm1Len > minArm && arm2Len > minArm &&
            this._segmentStraightness(arm1) > 0.7 && this._segmentStraightness(arm2) > 0.7) {
          return {
            type: "angle",
            x1: sampled[0].x, y1: sampled[0].y,
            x2: sampled[bestIdx].x, y2: sampled[bestIdx].y,
            x3: sampled[sampled.length - 1].x, y3: sampled[sampled.length - 1].y,
          };
        }
      }
    }

    // ── Default: line ──
    return { type: "line", x1: first.x, y1: first.y, x2: last.x, y2: last.y };
  }

  // ── Rendering ──

  redraw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    this.ctx.clearRect(0, 0, w, h);
    for (const shape of this.shapes) {
      this._drawShape(this.ctx, shape);
    }
  }

  _drawShape(ctx: CanvasRenderingContext2D, shape: Shape) {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    const x1 = shape.x1 * w;
    const y1 = shape.y1 * h;
    const x2 = shape.x2 * w;
    const y2 = shape.y2 * h;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lineWidth / this._zoom;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (shape.type === "line") {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (shape.type === "arrow") {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 14 / this._zoom;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    } else if (shape.type === "circle") {
      const r = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      ctx.beginPath();
      ctx.arc(x1, y1, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape.type === "oval") {
      // x1,y1 = center (normalized), x2 = rx (normalized), y2 = ry (normalized)
      const rx = shape.x2 * w;
      const ry = shape.y2 * h;
      ctx.beginPath();
      ctx.ellipse(x1, y1, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape.type === "angle" && shape.x3 != null && shape.y3 != null) {
      const x3 = shape.x3 * w;
      const y3 = shape.y3 * h;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.stroke();

      // Calculate the angle in degrees
      const a1 = Math.atan2(y1 - y2, x1 - x2);
      const a2 = Math.atan2(y3 - y2, x3 - x2);
      let sweep = a2 - a1;
      if (sweep < -Math.PI) sweep += Math.PI * 2;
      if (sweep > Math.PI) sweep -= Math.PI * 2;
      const degrees = Math.round(Math.abs(sweep) * (180 / Math.PI));

      // Draw arc at vertex
      const arcStart = Math.min(a1, a2);
      const arcEnd = Math.max(a1, a2);
      // Pick the smaller arc
      const arcSweep = arcEnd - arcStart;
      if (arcSweep < Math.PI) {
        ctx.beginPath();
        ctx.arc(x2, y2, 20 / this._zoom, arcStart, arcEnd);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x2, y2, 20 / this._zoom, arcEnd, arcStart + Math.PI * 2);
        ctx.stroke();
      }

      // Draw degree text
      const midAngle = a1 + sweep / 2;
      const textR = 36 / this._zoom;
      const tx = x2 + Math.cos(midAngle) * textR;
      const ty = y2 + Math.sin(midAngle) * textR;
      ctx.font = `bold ${14 / this._zoom}px sans-serif`;
      ctx.fillStyle = this.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${degrees}°`, tx, ty);
    }
  }

  // ── Public API ──

  setMultiTouch(active: boolean) {
    this.multiTouch = active;
    if (active && this.drawing) {
      this.drawing = false;
      this._strokePoints = [];
      this.redraw();
    }
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; this.drawing = false; }
  undo() { this.shapes.pop(); this.redraw(); }
  clear() { this.shapes = []; this.redraw(); }
  getAnnotations(): Shape[] { return this.shapes.slice(); }

  setAnnotations(annotations: Shape[]) {
    this.shapes = annotations ? annotations.slice() : [];
    this.redraw();
  }

  resize() {
    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }
}
