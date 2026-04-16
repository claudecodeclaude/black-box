import type { Shape } from "./storage";

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
  color: string;
  lineWidth: number;

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
    this.color = "#ff2222";
    this.lineWidth = 3;

    canvas.addEventListener("pointerdown", (e) => this._onDown(e));
    canvas.addEventListener("pointermove", (e) => this._onMove(e));
    canvas.addEventListener("pointerup", (e) => this._onUp(e));
    canvas.addEventListener("pointercancel", (e) => this._onUp(e));
  }

  _getPos(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  _onDown(e: PointerEvent) {
    if (!this.enabled) return;
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
    if (!this.drawing) return;
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
      ctx.lineTo(
        x2 - headLen * Math.cos(angle - Math.PI / 6),
        y2 - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLen * Math.cos(angle + Math.PI / 6),
        y2 - headLen * Math.sin(angle + Math.PI / 6)
      );
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

  setTool(tool: "line" | "arrow" | "circle") {
    this.currentTool = tool;
  }

  enable() {
    this.enabled = true;
    this.canvas.style.pointerEvents = "auto";
  }

  disable() {
    this.enabled = false;
    this.drawing = false;
    this.canvas.style.pointerEvents = "none";
  }

  undo() {
    this.shapes.pop();
    this.redraw();
  }

  clear() {
    this.shapes = [];
    this.redraw();
  }

  getAnnotations(): Shape[] {
    return this.shapes.slice();
  }

  setAnnotations(annotations: Shape[]) {
    this.shapes = annotations ? annotations.slice() : [];
    this.redraw();
  }

  resize() {
    // Use offsetWidth/Height (layout size) not getBoundingClientRect (visual size)
    // so canvas pixel dimensions are correct regardless of CSS zoom transforms on parent
    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }
}
