/**
 * Transform math. Pure — no allocation in `composeTransform` beyond the returned
 * object, and the render loop is expected to call it in a hot path.
 */

import type { Transform2D, Vec2 } from './types';
import { IDENTITY_TRANSFORM } from './types';

export const TAU = Math.PI * 2;

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function identityTransform(): Transform2D {
  return { ...IDENTITY_TRANSFORM };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Normalise an angle to (-PI, PI]. */
export function wrapAngle(radians: number): number {
  let a = radians % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/**
 * Compose a child transform onto a parent transform: `parent` then `child`.
 *
 * Returns a new object; callers that need to avoid allocation in a hot path should
 * reuse the out-parameter, which is why this accepts one.
 */
export function composeTransform(
  parent: Transform2D,
  child: Transform2D,
  out: Transform2D = { ...IDENTITY_TRANSFORM },
): Transform2D {
  const cos = Math.cos(parent.rotation);
  const sin = Math.sin(parent.rotation);
  const sx = parent.scaleX;
  const sy = parent.scaleY;

  // Translation: the parent's origin, offset by the child translation mapped
  // through the parent's rotate+scale.
  out.x = parent.x + child.x * sx * cos - child.y * sy * sin;
  out.y = parent.y + child.x * sx * sin + child.y * sy * cos;

  // Decomposed back into rotation + scale. Exact when the scale is uniform (the
  // normal case for rig joints); an approximation under non-uniform scale combined
  // with rotation. Acceptable, and it keeps the transform a plain 6-number record.
  out.rotation = parent.rotation + child.rotation;
  out.scaleX = sx * child.scaleX;
  out.scaleY = sy * child.scaleY;
  out.alpha = parent.alpha * child.alpha;
  return out;
}

/**
 * The scale that fits a `sourceWidth x sourceHeight` frame inside a target box.
 *
 * Shared, not private to the renderer, because the camera has to reason about it: the
 * renderer multiplies the camera zoom by this fit, so a framing calculation that
 * computed its own value would silently disagree with what is drawn.
 */
export function fitScale(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): number {
  if (sourceWidth <= 0 || sourceHeight <= 0) return 1;
  return Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
}

/** Interpolate two transforms. `t` is clamped to 0..1. */
export function lerpTransform(a: Transform2D, b: Transform2D, t: number): Transform2D {
  const k = clamp(t, 0, 1);
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    rotation: lerp(a.rotation, b.rotation, k),
    scaleX: lerp(a.scaleX, b.scaleX, k),
    scaleY: lerp(a.scaleY, b.scaleY, k),
    alpha: lerp(a.alpha, b.alpha, k),
  };
}

/** Apply a transform to a point. Used for hit-testing and label placement. */
export function applyTransform(point: Vec2, t: Transform2D): Vec2 {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return {
    x: t.x + (point.x * cos - point.y * sin) * t.scaleX,
    y: t.y + (point.x * sin + point.y * cos) * t.scaleY,
  };
}

/** Screen point -> world point, undoing a camera transform. */
export function screenToWorld(
  screen: Vec2,
  viewport: { width: number; height: number },
  camera: Transform2D,
): Vec2 {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const dx = (screen.x - cx) / (camera.scaleX || 1);
  const dy = (screen.y - cy) / (camera.scaleY || 1);
  const cos = Math.cos(-camera.rotation);
  const sin = Math.sin(-camera.rotation);
  return {
    x: camera.x + (dx * cos - dy * sin),
    y: camera.y + (dx * sin + dy * cos),
  };
}

/** World point -> screen point, applying a camera transform. */
export function worldToScreen(
  world: Vec2,
  viewport: { width: number; height: number },
  camera: Transform2D,
): Vec2 {
  const cos = Math.cos(camera.rotation);
  const sin = Math.sin(camera.rotation);
  const px = (world.x - camera.x) * cos - (world.y - camera.y) * sin;
  const py = (world.x - camera.x) * sin + (world.y - camera.y) * cos;
  return {
    x: viewport.width / 2 + px * camera.scaleX,
    y: viewport.height / 2 + py * camera.scaleY,
  };
}
