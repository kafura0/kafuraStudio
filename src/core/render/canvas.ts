/**
 * A minimal structural view of the Canvas 2D API.
 *
 * Declaring it here rather than using the DOM's `CanvasRenderingContext2D` keeps
 * `src/core` free of DOM types (AGENTS.md RULE 5) and is what lets the render
 * function be driven by a recording stub in unit tests — no browser, no GPU.
 *
 * The browser's real context satisfies this interface structurally.
 */

/**
 * A canvas gradient. The real `CanvasGradient` satisfies this, so it can be assigned
 * straight back to `fillStyle` without a cast.
 */
export interface GradientLike {
  addColorStop(offset: number, color: string): void;
}

/**
 * A canvas pattern (a repeating image fill).
 *
 * The real `CanvasPattern` is an opaque native object with no members, so it cannot
 * be described structurally. `unknown` is the honest type: the renderer only ever
 * assigns a pattern straight back to `fillStyle`, and never inspects it. The test
 * stub records whatever it is given by value, which keeps a pattern comparable in
 * a recorded call log.
 */
export type PatternLike = unknown;

/**
 * A decoded bitmap.
 *
 * `HTMLImageElement`, `ImageBitmap` and `HTMLCanvasElement` all satisfy this, and
 * all three are accepted by the real `drawImage`. Declaring the parameter as
 * `unknown` (rather than `ImageLike`) is what lets a real `CanvasRenderingContext2D`
 * satisfy this interface: `drawImage` is an overloaded method, and overload sets
 * are checked bivariantly under `strictFunctionTypes`, so a narrower declaration
 * here would reject the real context.
 */
export type ImageLike = unknown;

export interface TextMetricsLike {
  width: number;
}

export interface Canvas2DLike {
  // State
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: string | GradientLike | PatternLike;
  strokeStyle: string | GradientLike | PatternLike;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  imageSmoothingEnabled: boolean;

  // Transform stack
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;

  // Path construction
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;

  // Painting
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): TextMetricsLike;
  drawImage(image: ImageLike, dx: number, dy: number, dWidth: number, dHeight: number): void;

  // Effects
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): GradientLike;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): GradientLike;
  createPattern?(image: ImageLike, repetition: string): PatternLike | null;
  setLineDash(segments: number[]): void;
}
