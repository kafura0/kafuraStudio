/**
 * Camera framing: the arithmetic that turns "these are the things I want to see"
 * into a camera.
 *
 * Pure, by the same rule as `sample.ts` — a function of plain data with no document
 * access and no retained state, so it is testable without a canvas and safe to call
 * from a UI handler.
 *
 * Why this is arithmetic and not UI code. Rest-framing guesswork is the reason a
 * scene looks like a scene rather than like a diagram, and "frame the selection" is
 * the one camera affordance that removes the guesswork entirely. Both are the same
 * calculation, so both belong here and neither belongs in a component.
 *
 * The maths the renderer actually performs (`render.ts`):
 *
 *   screen = viewportCentre + rotate(camera) * (zoom * fit) * (world - cameraPoint)
 *
 * Inverting that, the world region the camera shows is a rectangle centred on the
 * camera point whose half-extents are `viewport / (2 * zoom * fit)`, rotated by the
 * camera. To make a subject's bounds fit that rectangle the zoom has to grow until
 * `subjectHalfExtent / (halfExtent * fit)` is satisfied on the tightest axis, which is
 * why the fit factor has to be the renderer's own `fitScale` rather than a second
 * implementation that might disagree with it.
 */

import { applyTransform, fitScale } from '../geometry';
import type { Camera, Transform2D, Vec2 } from '../types';

/** An axis-aligned rectangle in world space. */
export interface FrameBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Something to be framed.
 *
 * The local box is anchored the way the document anchors a character: the origin is
 * the feet, the body extends upward, and the box is centred on x. `SceneActor`
 * satisfies this once its `character.height` is read, which is why the height is a
 * required field rather than something inferred from a rig.
 *
 * `flipX` is deliberately absent: it mirrors the box about its own centre, so it
 * cannot change the bounds. A field that provably does not affect the answer is a
 * field the caller has to keep correct for nothing.
 */
export interface FrameSubject {
  /** World placement, already sampled for the time being framed. */
  transform: Transform2D;
  /** Height at scale 1, growing upward from the origin. */
  height: number;
  /** Width at scale 1, centred on the origin. Defaults to `height * DEFAULT_SUBJECT_ASPECT`. */
  width?: number;
}

/**
 * Width-to-height of a subject's local box when nothing better is known.
 *
 * A standing figure is roughly half as wide as it is tall once arms and hair are
 * counted. Every subject in the document has a `height` and none has a `width`, so
 * this is the assumption a framing calculation has to make, stated once and named.
 */
export const DEFAULT_SUBJECT_ASPECT = 0.5;

export interface FrameOptions {
  /**
   * The authored frame the camera lives in — the environment's size, or the project
   * settings when a scene has no environment. The camera's x/y are in these units.
   */
  frame: { width: number; height: number };
  /** The viewport being framed for. Defaults to `frame`. */
  viewport?: { width: number; height: number };
  /** Breathing room, as a fraction of the subjects' own size. 0.1 = 10%. */
  margin?: number;
  /**
   * Never frame tighter than this. 1 shows the authored frame exactly, so a default
   * of 1 means "frame the subjects, but never crop into the world".
   */
  minZoom?: number;
  /**
   * Never frame wider than this. Without a ceiling, one small prop far from anything
   * else would drive the zoom to nearly zero and the shot would be a grey field.
   */
  maxZoom?: number;
  /**
   * Camera tilt to frame within. Framing accounts for a tilt rather than discarding
   * it, because a Dutch angle the user chose should survive a "frame the selection".
   */
  rotation?: number;
}

export const DEFAULT_FRAME_MARGIN = 0.12;
export const MAX_FRAME_ZOOM = 4;

/**
 * The camera that fits every subject into the frame.
 *
 * Returns the default framing — the authored frame, centred, unzoomed — when there is
 * nothing to frame. That is the honest answer rather than a NaN: "frame nothing" is
 * the same as "frame the world".
 */
export function frameBounds(subjects: FrameSubject[], options: FrameOptions): Camera {
  const frame = options.frame;
  const viewport = options.viewport ?? frame;
  const rotation = options.rotation ?? 0;

  const fallback: Camera = {
    x: frame.width / 2,
    y: frame.height / 2,
    zoom: 1,
    rotation,
  };

  const bounds = unionBounds(subjects);
  if (!bounds) return fallback;

  const margin = options.margin ?? DEFAULT_FRAME_MARGIN;
  const width = (bounds.maxX - bounds.minX) * (1 + margin * 2);
  const height = (bounds.maxY - bounds.minY) * (1 + margin * 2);

  // Half the viewport, expressed in world units at zoom 1 and the renderer's fit.
  const fit = fitScale(frame.width, frame.height, viewport.width, viewport.height);
  const half = rotatedHalfExtents(viewport.width / 2, viewport.height / 2, rotation);

  // `max`, not `min`: a bigger zoom shows *more* world, so the tightest axis is the
  // one that has to grow last, and it is the one that sets the zoom.
  const zoom = Math.max(width / 2 / (half.x * fit), height / 2 / (half.y * fit));
  const min = options.minZoom ?? 1;
  const max = options.maxZoom ?? MAX_FRAME_ZOOM;

  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    zoom: Math.max(min, Math.min(max, zoom)),
    rotation,
  };
}

/**
 * The world-space bounds of a set of subjects.
 *
 * Public because the panel and the tests both need the box, not just the camera, and
 * because "what is actually being framed" is answerable without re-deriving it.
 * `null` when there is nothing to measure.
 */
export function unionBounds(subjects: FrameSubject[]): FrameBounds | null {
  let out: FrameBounds | null = null;

  for (const subject of subjects) {
    if (!Number.isFinite(subject.height) || !Number.isFinite(subject.transform.x)) continue;
    const width = subject.width ?? subject.height * DEFAULT_SUBJECT_ASPECT;
    const halfWidth = width / 2;
    // Local box: centred on x, growing upward from the origin.
    const corners: Vec2[] = [
      { x: -halfWidth, y: -subject.height },
      { x: halfWidth, y: -subject.height },
      { x: -halfWidth, y: 0 },
      { x: halfWidth, y: 0 },
    ];

    for (const corner of corners) {
      const point = applyTransform(corner, subject.transform);
      out = out
        ? {
            minX: Math.min(out.minX, point.x),
            minY: Math.min(out.minY, point.y),
            maxX: Math.max(out.maxX, point.x),
            maxY: Math.max(out.maxY, point.y),
          }
        : { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
    }
  }

  return out;
}

/**
 * The world half-extent of a viewport, in the camera's own rotated frame.
 *
 * A tilted camera shows a rotated rectangle, and the axis-aligned box that contains it
 * is larger on both axes than the viewport itself. Framing a tilted shot with the
 * untilted extents would crop the corners.
 */
function rotatedHalfExtents(halfWidth: number, halfHeight: number, rotation: number): Vec2 {
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  return {
    x: halfWidth * cos + halfHeight * sin,
    y: halfWidth * sin + halfHeight * cos,
  };
}
