import type { Shape } from "./storage";

export type PinchCallback = (zoom: number, panX: number, panY: number) => void;

export class AnnotationCanvas {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  ctx: CanvasRenderingContext2D;
  shapes: Shape[];
  currentTool: "line" | "arrow" | "circle";
  drawing: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  enabled: boolean;
  multiTouch: boolean;
  color: string;
  lineWidth: number;
  onPinch: PinchCallback | null;
  private _pinch: { active: boolean; initialDist: number; initialZoom: number; initialPanX: number; initialPanY: number; centerX: number; centerY: number };
  private _zoom: number;
  private _panX: number;
  private _panY: number;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext("2d")!;
    this.shapes = [];
    this.currentTool = "line";
    this.drawing = false;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.enabled = false;
    this.multiTouch = false;
    this.color = "#ff2222";
    this.lineWidth = 3;
    this.onPinch = null;
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

  private _touchDist(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private _onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      this.multiTouch = true;
      if (this.drawing) { this.drawing = false; this.redraw(); }
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

  _getPos(e: PointerEvent) {
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
    this.startX = pos.x;
    this.startY = pos.y;
    this.currentX = pos.x;
    this.currentY = pos.y;
    this.canvas.setPointerCapture(e.pointerId);
  }

  _onMove(e: PointerEvent) {
    if (!this.drawing || this.multiTouch) return;
    e.preventDefault();
    const pos = this._getPos(e);
    this.currentX = pos.x;
    this.currentY = pos.y;
    this.redraw();
    this._drawShape(this.ctx, {
      type: this.currentTool,
      x1: this.startX,
      y1: this.startY,
      x2: this.currentX,
      y2: this.currentY,
    });
  }

  _onUp(e: PointerEvent) {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.multiTouch) { this.redraw(); return; }
    const pos = this._getPos(e);
    const dx = pos.x - this.startX;
    const dy = pos.y - this.startY;
    if (Math.sqrt(dx * dx + dy * dy) > 0.008) {
      this.shapes.push({
        type: this.currentTool,
        x1: this.startX,
        y1: this.startY,
        x2: pos.x,
        y2: pos.y,
      });
    }
    this.redraw();
  }

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
    ctx.lineWidth = this.lineWidth;
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
      const headLen = 14;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    } else if (shape.type === "circle") {
      const rx = Math.abs(x2 - x1);
      const ry = Math.abs(y2 - y1);
      const r = Math.sqrt(rx * rx + ry * ry);
      ctx.beginPath();
      ctx.arc(x1, y1, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  setTool(tool: "line" | "arrow" | "circle") { this.currentTool = tool; }

  // Called by the pinch handler to suppress drawing during zoom gestures
  setMultiTouch(active: boolean) {
    this.multiTouch = active;
    if (active && this.drawing) {
      this.drawing = false;
      this.redraw();
    }
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    this.drawing = false;
  }

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
