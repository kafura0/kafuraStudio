/**
 * Shape rasterisation.
 *
 * Every drawable in ZANZA is a `ShapeDef`. A shape is always drawn in a local space
 * where its bounding box is centred on the origin, then offset by `-pivot` so the
 * declared pivot lands on the transform origin. That single rule is what lets a rig
 * rotate a forearm around its elbow without any per-shape special cases.
 */

import type { Canvas2DLike } from './canvas';
import type { ShapeDef, Vec2 } from '../types';

export interface ShapeBounds {
  width: number;
  height: number;
  /** Centre of the shape inside its own local space, before centring. */
  cx: number;
  cy: number;
}

export function shapeBounds(shape: ShapeDef): ShapeBounds {
  switch (shape.kind) {
    case 'ellipse':
      return { width: shape.rx * 2, height: shape.ry * 2, cx: 0, cy: 0 };
    case 'rect':
    case 'roundRect':
    case 'image':
      return { width: shape.w, height: shape.h, cx: 0, cy: 0 };
    case 'path': {
      const points = shape.points;
      if (points.length === 0) return { width: 0, height: 0, cx: 0, cy: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return { width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    }
    default: {
      const exhaustive: never = shape;
      void exhaustive;
      return { width: 0, height: 0, cx: 0, cy: 0 };
    }
  }
}

/** Build the path for a shape, centred on the origin. Does not fill or stroke. */
export function buildShapePath(ctx: Canvas2DLike, shape: ShapeDef): void {
  switch (shape.kind) {
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(0, 0, shape.rx, shape.ry, 0, 0, Math.PI * 2);
      return;
    case 'rect':
      ctx.beginPath();
      ctx.rect(-shape.w / 2, -shape.h / 2, shape.w, shape.h);
      return;
    case 'roundRect':
      ctx.beginPath();
      roundRectPath(ctx, -shape.w / 2, -shape.h / 2, shape.w, shape.h, shape.radius);
      return;
    case 'path': {
      ctx.beginPath();
      const { cx, cy } = shapeBounds(shape);
      const points = shape.points;
      const first = points[0];
      if (!first) return;
      ctx.moveTo(first.x - cx, first.y - cy);
      for (let i = 1; i < points.length; i += 1) {
        const p = points[i];
        if (p) ctx.lineTo(p.x - cx, p.y - cy);
      }
      if (shape.closed) ctx.closePath();
      return;
    }
    case 'image':
      // Image parts are blitted, not pathed.
      return;
    default: {
      const exhaustive: never = shape;
      void exhaustive;
    }
  }
}

function roundRectPath(
  ctx: Canvas2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* Constructors — used by the seed content to build shapes readably    */
/* ------------------------------------------------------------------ */

export function ellipse(rx: number, ry: number): ShapeDef {
  return { kind: 'ellipse', rx, ry };
}

export function rect(w: number, h: number): ShapeDef {
  return { kind: 'rect', w, h };
}

export function roundRect(w: number, h: number, radius: number): ShapeDef {
  return { kind: 'roundRect', w, h, radius };
}

export function polyline(points: Vec2[], closed = false): ShapeDef {
  return { kind: 'path', points, closed };
}

/** A tapered limb: a quad from a wide root to a narrow tip. */
export function limb(
  rootWidth: number,
  tipWidth: number,
  length: number,
  options: { bend?: number } = {},
): ShapeDef {
  const bend = options.bend ?? 0;
  const r = rootWidth / 2;
  const t = tipWidth / 2;
  return {
    kind: 'path',
    closed: true,
    points: [
      { x: -r, y: 0 },
      { x: r, y: 0 },
      { x: t + bend, y: length },
      { x: -t + bend, y: length },
    ],
  };
}

/** A circle, the most common shape in the rig library. */
export function circle(radius: number): ShapeDef {
  return { kind: 'ellipse', rx: radius, ry: radius };
}
