/**
 * A recording Canvas 2D stub.
 *
 * `renderScene` is a pure function of (ctx, project, scene, time), so a test can
 * assert exactly what would have been painted without a browser, a GPU, or a
 * single pixel comparison. This is the payoff of keeping `src/core` DOM-free.
 */

import type { Canvas2DLike, GradientLike, ImageLike, TextMetricsLike } from '../core/render/canvas';
import { renderScene } from '../core/render/render';
import type { Id, Project } from '../core/types';

export interface DrawOp {
  op: string;
  args: unknown[];
}

/**
 * A single shared gradient stub.
 *
 * Must be one object, not a fresh one per call: the renderer assigns gradients to
 * `fillStyle`, and a recording that captured object identity would report two
 * identical frames as different. Determinism is the property under test here, so
 * the stub has to preserve it.
 */
const gradient: GradientLike = { addColorStop: () => {} };

/** Reduce a recorded argument to something comparable by value. */
function normalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalise);
  if ('addColorStop' in value) return '[Gradient]';
  if (typeof (value as { width?: unknown }).width === 'number') return '[Image]';
  // Plain data object, e.g. a Vec2 or a Transform2D.
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, normalise(v)]),
  );
}

/**
 * A Canvas2DLike that records every call. Property sets are recorded too, since
 * fill colour is as much a part of the output as the geometry.
 */
export class RecordingContext implements Canvas2DLike {
  readonly calls: DrawOp[] = [];

  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle: string | GradientLike = '#000';
  strokeStyle: string | GradientLike = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  imageSmoothingEnabled = true;

  /** Depth counter, so tests can prove the context is balanced (no leaked state). */
  private depth = 0;

  constructor() {
    for (const key of [
      'globalAlpha',
      'globalCompositeOperation',
      'fillStyle',
      'strokeStyle',
      'lineWidth',
      'lineCap',
      'lineJoin',
      'font',
      'textAlign',
      'textBaseline',
      'imageSmoothingEnabled',
    ] as const) {
      let current = this[key] as unknown;
      Object.defineProperty(this, key, {
        get: () => current,
        set: (value: unknown) => {
          current = value;
          this.calls.push({ op: `set:${key}`, args: [normalise(value)] });
        },
        configurable: true,
      });
    }
  }

  private record(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args: args.map(normalise) });
  }

  save(): void {
    this.depth += 1;
    this.record('save');
  }

  restore(): void {
    this.depth -= 1;
    this.record('restore');
  }

  translate(x: number, y: number): void {
    this.record('translate', x, y);
  }

  rotate(angle: number): void {
    this.record('rotate', angle);
  }

  scale(x: number, y: number): void {
    this.record('scale', x, y);
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.record('setTransform', a, b, c, d, e, f);
  }

  beginPath(): void {
    this.record('beginPath');
  }

  closePath(): void {
    this.record('closePath');
  }

  moveTo(x: number, y: number): void {
    this.record('moveTo', x, y);
  }

  lineTo(x: number, y: number): void {
    this.record('lineTo', x, y);
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, ccw?: boolean): void {
    this.record('arc', x, y, radius, startAngle, endAngle, ccw);
  }

  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw?: boolean,
  ): void {
    this.record('ellipse', x, y, rx, ry, rotation, start, end, ccw);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.record('rect', x, y, w, h);
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.record('arcTo', x1, y1, x2, y2, radius);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.record('quadraticCurveTo', cpx, cpy, x, y);
  }

  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void {
    this.record('bezierCurveTo', a, b, c, d, x, y);
  }

  fill(): void {
    this.record('fill');
  }

  stroke(): void {
    this.record('stroke');
  }

  clip(): void {
    this.record('clip');
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.record('fillRect', x, y, w, h);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.record('clearRect', x, y, w, h);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.record('strokeRect', x, y, w, h);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.record('fillText', text, x, y, maxWidth);
  }

  strokeText(text: string, x: number, y: number): void {
    this.record('strokeText', text, x, y);
  }

  measureText(text: string): TextMetricsLike {
    return { width: text.length * 8 };
  }

  drawImage(image: ImageLike, dx: number, dy: number, dw: number, dh: number): void {
    this.record('drawImage', image, dx, dy, dw, dh);
  }

  createLinearGradient(...args: unknown[]): GradientLike {
    this.record('createLinearGradient', ...args);
    return gradient;
  }

  createRadialGradient(...args: unknown[]): GradientLike {
    this.record('createRadialGradient', ...args);
    return gradient;
  }

  setLineDash(segments: number[]): void {
    this.record('setLineDash', segments);
  }

  /* -------------------------------------------------- assertions --- */

  countOf(op: string): number {
    return this.calls.filter((c) => c.op === op).length;
  }

  opsFor(op: string): DrawOp[] {
    return this.calls.filter((c) => c.op === op);
  }

  textDrawn(): string[] {
    return this.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
  }

  /** True when every `save` has a matching `restore` — i.e. no state leaked. */
  isBalanced(): boolean {
    return this.depth === 0;
  }
}

/** Render one scene at one time and return the recording context. */
export function renderToRecording(
  project: Project,
  sceneId: Id,
  time: number,
): RecordingContext {
  const ctx = new RecordingContext();
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`No scene ${sceneId} in project`);
  renderScene(ctx, project, scene, time);
  return ctx;
}
