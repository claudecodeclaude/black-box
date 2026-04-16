import type { Shape } from "./storage";

export type PinchCallback = (zoom: number, panX: number, panY: number) => void;
export type ShapeTapCallback = (shapeIndex: number, screenX: number, screenY: number) => void;

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
  onShapeTap: ShapeTapCallback | null;
  private _strokePoints: Point[];
  private _rawStrokes: Point[][];
  private _pinch: { active: boolean; initialDist: number; initialZoom: number; initialPanX: number; initialPanY: number; centerX: number; centerY: number; rectLeft: number; rectTop: number };
  private _zoom: number;
  private _panX: number;
  private _panY: number;
  private _tapStart: { x: number; y: number; time: number; screenX: number; screenY: number } | null;
  private _didMove: boolean;

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
    this.onShapeTap = null;
    this._strokePoints = [];
    this._rawStrokes = [];
    this._pinch = { active: false, initialDist: 0, initialZoom: 1, initialPanX: 0, initialPanY: 0, centerX: 0, centerY: 0, rectLeft: 0, rectTop: 0 };
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
    this._tapStart = null;
    this._didMove = false;

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
        rectLeft: rect.left,
        rectTop: rect.top,
      };
    } else if (e.touches.length === 1 && this.enabled) {
      e.preventDefault();
    }
  }

  private _pendingPinchRAF = 0;

  private _onTouchMove(e: TouchEvent) {
    if (e.touches.length === 2 && this._pinch.active) {
      e.preventDefault();
      const p = this._pinch;
      const container = this.canvas.parentElement!;
      const W = container.clientWidth;
      const H = container.clientHeight;
      const newZoom = Math.min(Math.max(p.initialZoom * this._touchDist(e.touches) / p.initialDist, 1), 5);

      // Use cached rect from pinch start to avoid layout thrashing
      const currentCX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - p.rectLeft;
      const currentCY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - p.rectTop;
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

      // Batch updates to next animation frame
      if (!this._pendingPinchRAF) {
        this._pendingPinchRAF = requestAnimationFrame(() => {
          this._pendingPinchRAF = 0;
          if (this.onPinch) this.onPinch(this._zoom, this._panX, this._panY);
        });
      }
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
    const pos = this._getPos(e);
    this._tapStart = { x: pos.x, y: pos.y, time: Date.now(), screenX: e.clientX, screenY: e.clientY };
    this._didMove = false;
    this._strokePoints = [pos];
    this.canvas.setPointerCapture(e.pointerId);
  }

  _onMove(e: PointerEvent) {
    if (!this._tapStart || this.multiTouch) return;
    e.preventDefault();
    const pos = this._getPos(e);
    const dx = pos.x - this._tapStart.x;
    const dy = pos.y - this._tapStart.y;
    const moveDist = Math.sqrt(dx * dx + dy * dy);

    // Once moved past threshold, commit to drawing
    if (moveDist > 0.005 / this._zoom) {
      this._didMove = true;
      this.drawing = true;
    }

    if (this.drawing) {
      this._strokePoints.push(pos);
      this.redraw();
      this._drawFreehand();
    }
  }

  _onUp(e: PointerEvent) {
    if (!this._tapStart) return;
    const wasTap = !this._didMove && (Date.now() - this._tapStart.time < 300);

    if (wasTap) {
      // It was a tap — check if it hit an existing shape
      this.drawing = false;
      this._strokePoints = [];
      const pos = this._getPos(e);
      const hitIdx = this._hitTest(pos);
      if (hitIdx >= 0 && this.onShapeTap) {
        this.onShapeTap(hitIdx, this._tapStart.screenX, this._tapStart.screenY);
      }
      this._tapStart = null;
      return;
    }

    // It was a draw
    this.drawing = false;
    this._tapStart = null;
    if (this.multiTouch) { this._strokePoints = []; this.redraw(); return; }

    const pos = this._getPos(e);
    this._strokePoints.push(pos);

    const raw = this._strokePoints;
    const shape = this._recognize(raw);
    if (shape) {
      this.shapes.push(shape);
      this._rawStrokes.push(raw.slice());
    }
    this._strokePoints = [];
    this.redraw();
  }

  // ── Hit testing ──

  private _hitTest(pos: Point): number {
    const threshold = 0.025 / this._zoom;
    // Test in reverse order (top shapes first)
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      if (this._isNearShape(pos, this.shapes[i], threshold)) return i;
    }
    return -1;
  }

  private _isNearShape(pos: Point, shape: Shape, threshold: number): boolean {
    if (shape.type === "line" || shape.type === "arrow") {
      return this._distToSegment(pos, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) < threshold;
    }
    if (shape.type === "circle") {
      const r = this._dist({ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 });
      const d = this._dist(pos, { x: shape.x1, y: shape.y1 });
      return Math.abs(d - r) < threshold;
    }
    if (shape.type === "oval") {
      const nx = (pos.x - shape.x1) / shape.x2;
      const ny = (pos.y - shape.y1) / shape.y2;
      const ellipseDist = Math.sqrt(nx * nx + ny * ny);
      return Math.abs(ellipseDist - 1) < threshold / Math.max(shape.x2, shape.y2);
    }
    if (shape.type === "angle" && shape.x3 != null && shape.y3 != null) {
      const d1 = this._distToSegment(pos, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 });
      const d2 = this._distToSegment(pos, { x: shape.x2, y: shape.y2 }, { x: shape.x3, y: shape.y3 });
      return Math.min(d1, d2) < threshold;
    }
    return false;
  }

  private _distToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return this._dist(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return this._dist(p, { x: a.x + t * dx, y: a.y + t * dy });
  }

  // ── Change shape type ──

  changeShapeType(index: number, newType: Shape["type"]) {
    if (index < 0 || index >= this.shapes.length) return;
    const raw = this._rawStrokes[index];
    if (!raw || raw.length < 2) return;

    const shape = this._forceShape(raw, newType);
    if (shape) {
      this.shapes[index] = shape;
      this.redraw();
    }
  }

  private _forceShape(raw: Point[], type: Shape["type"]): Shape | null {
    const first = raw[0];
    const last = raw[raw.length - 1];

    if (type === "line") {
      return { type: "line", x1: first.x, y1: first.y, x2: last.x, y2: last.y };
    }

    if (type === "arrow") {
      return { type: "arrow", x1: first.x, y1: first.y, x2: last.x, y2: last.y };
    }

    if (type === "circle") {
      let cx = 0, cy = 0;
      for (const p of raw) { cx += p.x; cy += p.y; }
      cx /= raw.length;
      cy /= raw.length;
      let avgR = 0;
      for (const p of raw) avgR += this._dist(p, { x: cx, y: cy });
      avgR /= raw.length;
      return { type: "circle", x1: cx, y1: cy, x2: cx + avgR, y2: cy };
    }

    if (type === "oval") {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of raw) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return { type: "oval", x1: cx, y1: cy, x2: (maxX - minX) / 2, y2: (maxY - minY) / 2 };
    }

    if (type === "angle") {
      // Find best vertex
      let bestIdx = -1;
      let bestAngle = Math.PI;
      const lo = Math.max(1, Math.floor(raw.length * 0.1));
      const hi = Math.min(raw.length - 1, Math.ceil(raw.length * 0.9));
      for (let i = lo; i < hi; i++) {
        const v = raw[i];
        const va = { x: first.x - v.x, y: first.y - v.y };
        const vb = { x: last.x - v.x, y: last.y - v.y };
        const dot = va.x * vb.x + va.y * vb.y;
        const mag = Math.sqrt(va.x ** 2 + va.y ** 2) * Math.sqrt(vb.x ** 2 + vb.y ** 2);
        if (mag > 0) {
          const angle = Math.acos(Math.max(-1, Math.min(1, dot / mag)));
          if (angle < bestAngle) { bestAngle = angle; bestIdx = i; }
        }
      }
      if (bestIdx >= 0) {
        return {
          type: "angle",
          x1: first.x, y1: first.y,
          x2: raw[bestIdx].x, y2: raw[bestIdx].y,
          x3: last.x, y3: last.y,
        };
      }
      // Fallback: use midpoint as vertex
      const mid = raw[Math.floor(raw.length / 2)];
      return { type: "angle", x1: first.x, y1: first.y, x2: mid.x, y2: mid.y, x3: last.x, y3: last.y };
    }

    return null;
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
        let totalErr = 0;
        const avgR = (rx + ry) / 2;
        for (const p of raw) {
          const nx = (p.x - cx) / rx;
          const ny = (p.y - cy) / ry;
          const ellipseDist = Math.sqrt(nx * nx + ny * ny);
          totalErr += Math.abs(ellipseDist - 1);
        }
        const avgErr = totalErr / raw.length;

        if (avgErr < 0.4) {
          const aspect = Math.max(rx, ry) / Math.min(rx, ry);
          if (aspect < 1.3) {
            return { type: "circle", x1: cx, y1: cy, x2: cx + avgR, y2: cy };
          }
          return { type: "oval", x1: cx, y1: cy, x2: rx, y2: ry };
        }
      }
    }

    // ── Arrow: straight stroke with hook/flick back at the end ──
    let maxD = 0, tipIdx = 0;
    for (let i = 0; i < raw.length; i++) {
      const d = this._dist(raw[i], first);
      if (d > maxD) { maxD = d; tipIdx = i; }
    }

    if (tipIdx >= raw.length * 0.4 && tipIdx < raw.length - 1) {
      const toTip = raw.slice(0, tipIdx + 1);
      const tipStraightness = this._segmentStraightness(toTip);

      if (tipStraightness > 0.75) {
        const tip = raw[tipIdx];
        return { type: "arrow", x1: first.x, y1: first.y, x2: tip.x, y2: tip.y };
      }
    }

    // ── Angle: V-shape with bend ──
    if (raw.length >= 4) {
      let bestIdx = -1;
      let bestAngle = Math.PI;

      const lo = Math.max(1, Math.floor(raw.length * 0.1));
      const hi = Math.min(raw.length - 1, Math.ceil(raw.length * 0.9));

      for (let i = lo; i < hi; i++) {
        const v = raw[i];
        const va = { x: first.x - v.x, y: first.y - v.y };
        const vb = { x: last.x - v.x, y: last.y - v.y };
        const dot = va.x * vb.x + va.y * vb.y;
        const mag = Math.sqrt(va.x ** 2 + va.y ** 2) * Math.sqrt(vb.x ** 2 + vb.y ** 2);
        if (mag > 0) {
          const angle = Math.acos(Math.max(-1, Math.min(1, dot / mag)));
          if (angle < bestAngle) { bestAngle = angle; bestIdx = i; }
        }
      }

      if (bestAngle < Math.PI * 0.94 && bestIdx >= 0) {
        const vertex = raw[bestIdx];
        return {
          type: "angle",
          x1: first.x, y1: first.y,
          x2: vertex.x, y2: vertex.y,
          x3: last.x, y3: last.y,
        };
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

      const a1 = Math.atan2(y1 - y2, x1 - x2);
      const a2 = Math.atan2(y3 - y2, x3 - x2);
      let sweep = a2 - a1;
      if (sweep < -Math.PI) sweep += Math.PI * 2;
      if (sweep > Math.PI) sweep -= Math.PI * 2;
      const degrees = Math.round(Math.abs(sweep) * (180 / Math.PI));

      const arcStart = Math.min(a1, a2);
      const arcEnd = Math.max(a1, a2);
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

  undo() {
    this.shapes.pop();
    this._rawStrokes.pop();
    this.redraw();
  }

  deleteShape(index: number) {
    if (index >= 0 && index < this.shapes.length) {
      this.shapes.splice(index, 1);
      this._rawStrokes.splice(index, 1);
      this.redraw();
    }
  }

  clear() {
    this.shapes = [];
    this._rawStrokes = [];
    this.redraw();
  }

  getAnnotations(): Shape[] { return this.shapes.slice(); }

  setAnnotations(annotations: Shape[]) {
    this.shapes = annotations ? annotations.slice() : [];
    // No raw strokes for loaded annotations — tap-to-change won't be available
    this._rawStrokes = this.shapes.map(() => []);
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
