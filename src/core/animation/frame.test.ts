import { describe, expect, it } from 'vitest';

import { frameBounds, unionBounds, type FrameSubject } from './frame';
import { applyTransform, fitScale } from '../geometry';
import { transform, type Camera, type Transform2D, type Vec2 } from '../types';

const FRAME = { width: 1920, height: 1080 };

/** A standing figure `height` tall, on the frame's centre line, feet at y=900. */
function standing(x: number, height = 400, overrides: Partial<Transform2D> = {}): FrameSubject {
  return { transform: transform({ x, y: 900, ...overrides }), height };
}

/** A wide prop — the case where the horizontal axis is the tight one. */
function wide(x: number, width: number, height: number): FrameSubject {
  return { transform: transform({ x, y: 900 }), height, width };
}

/**
 * Mirror of the renderer's camera application (`render.ts:114-117`).
 *
 * Deliberately transcribed rather than imported: the point of these tests is that the
 * framing arithmetic agrees with the transform that will actually be drawn, and an
 * import of the renderer's own helper would make the assertion circular.
 */
function project(camera: Camera, world: Vec2, frame = FRAME, viewport = FRAME): Vec2 {
  const fit = fitScale(frame.width, frame.height, viewport.width, viewport.height);
  const s = camera.zoom * fit;
  const dx = (world.x - camera.x) * s;
  const dy = (world.y - camera.y) * s;
  const cos = Math.cos(camera.rotation);
  const sin = Math.sin(camera.rotation);
  return {
    x: viewport.width / 2 + dx * cos - dy * sin,
    y: viewport.height / 2 + dx * sin + dy * cos,
  };
}

function cornersOf(subject: FrameSubject): Vec2[] {
  const halfWidth = (subject.width ?? subject.height * 0.5) / 2;
  const local: Vec2[] = [
    { x: -halfWidth, y: -subject.height },
    { x: halfWidth, y: -subject.height },
    { x: -halfWidth, y: 0 },
    { x: halfWidth, y: 0 },
  ];
  return local.map((point) => applyTransform(point, subject.transform));
}

function expectClose(
  actual: { minX: number; minY: number; maxX: number; maxY: number } | null,
  expected: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  expect(actual).not.toBeNull();
  expect(actual!.minX).toBeCloseTo(expected.minX, 6);
  expect(actual!.minY).toBeCloseTo(expected.minY, 6);
  expect(actual!.maxX).toBeCloseTo(expected.maxX, 6);
  expect(actual!.maxY).toBeCloseTo(expected.maxY, 6);
}

/** Every corner of every subject lands inside the viewport. */function expectAllVisible(
  camera: Camera,
  subjects: FrameSubject[],
  frame = FRAME,
  viewport = FRAME,
): void {
  for (const subject of subjects) {
    for (const corner of cornersOf(subject)) {
      const screen = project(camera, corner, frame, viewport);
      expect(screen.x).toBeGreaterThanOrEqual(0);
      expect(screen.x).toBeLessThanOrEqual(viewport.width);
      expect(screen.y).toBeGreaterThanOrEqual(0);
      expect(screen.y).toBeLessThanOrEqual(viewport.height);
    }
  }
}

describe('unionBounds', () => {
  it('measures a single subject from its feet upward, centred on x', () => {
    const bounds = unionBounds([standing(960, 400)]);
    // Default aspect 0.5, so 400 tall is 200 wide.
    expect(bounds).toEqual({ minX: 860, minY: 500, maxX: 1060, maxY: 900 });
  });

  it('unions several subjects into one box', () => {
    const bounds = unionBounds([standing(500), standing(1400, 200)]);
    // The taller figure sets the top at 500; the shorter one's box ends at 1450.
    expect(bounds).toEqual({ minX: 400, minY: 500, maxX: 1450, maxY: 900 });
  });

  it('honours an explicit width', () => {
    const bounds = unionBounds([{ transform: transform({ x: 0, y: 0 }), height: 100, width: 40 }]);
    expect(bounds).toEqual({ minX: -20, minY: -100, maxX: 20, maxY: 0 });
  });

  it('measures subjects entirely outside the authored frame', () => {
    expect(unionBounds([standing(-5000)])?.maxX).toBe(-4900);
  });

  it('returns null when there is nothing to measure', () => {
    expect(unionBounds([])).toBeNull();
  });

  it('skips a non-finite subject instead of poisoning the box with NaN', () => {
    const bounds = unionBounds([
      { transform: transform({ x: NaN, y: 0 }), height: 400 },
      standing(960),
    ]);
    expect(bounds).toEqual({ minX: 860, minY: 500, maxX: 1060, maxY: 900 });
  });

  it('scales the box with a non-uniformly scaled subject', () => {
    const bounds = unionBounds([
      { transform: transform({ x: 0, y: 0, scaleX: 2, scaleY: 0.5 }), height: 400 },
    ]);
    // 200 wide x 400 tall at scale 1, doubled in x and halved in y.
    expect(bounds).toEqual({ minX: -200, minY: -200, maxX: 200, maxY: 0 });
  });

  it('swings the box with a rotated subject', () => {
    const bounds = unionBounds([standing(0, 400, { rotation: Math.PI / 2 })]);
    // Turned 90 degrees the 400-tall body lies along x, growing right from the feet.
    expectClose(bounds, { minX: 0, minY: 800, maxX: 400, maxY: 1000 });
  });
});

describe('frameBounds', () => {
  it('returns the default framing when given no subjects', () => {
    expect(frameBounds([], { frame: FRAME })).toEqual({ x: 960, y: 540, zoom: 1, rotation: 0 });
  });

  it('keeps a tilt the caller asked for, even with no subjects', () => {
    expect(frameBounds([], { frame: FRAME, rotation: 0.4 }).rotation).toBe(0.4);
  });

  it('centres the camera on the subjects', () => {
    const camera = frameBounds([standing(400, 400), standing(1500, 400)], { frame: FRAME });
    expect(camera.x).toBeCloseTo(950, 6);
    expect(camera.y).toBeCloseTo(700, 6);
  });

  it('drives the zoom from the tighter of the two axes', () => {
    // A landscape frame and a standing figure: height is the tighter axis.
    const open = { frame: FRAME, minZoom: 0 } as const;
    expect(frameBounds([standing(960, 400)], open).zoom).toBeCloseTo((400 * 1.24) / 1080, 6);
    // A wide prop: width is the tighter axis.
    expect(frameBounds([wide(960, 1200, 100)], open).zoom).toBeCloseTo((1200 * 1.24) / 1920, 6);
  });

  it('shows a single subject', () => {
    expectAllVisible(frameBounds([standing(960, 400)], { frame: FRAME }), [standing(960, 400)]);
  });

  it('shows a pair', () => {
    const subjects = [standing(400, 400), standing(1500, 400)];
    expectAllVisible(frameBounds(subjects, { frame: FRAME }), subjects);
  });

  it('shows a subject standing well off the authored frame', () => {
    const subjects = [standing(2600, 300)];
    expectAllVisible(frameBounds(subjects, { frame: FRAME }), subjects);
  });

  it('shows a subject under a different viewport aspect', () => {
    const subjects = [standing(700, 500), standing(1300, 350)];
    const viewport = { width: 1920, height: 1440 };
    expectAllVisible(frameBounds(subjects, { frame: FRAME, viewport }), subjects, FRAME, viewport);
  });

  it('shows the subjects under a tilt', () => {
    const rotation = Math.PI / 5;
    const subjects = [standing(700, 500), standing(1300, 350)];
    const camera = frameBounds(subjects, { frame: FRAME, rotation, minZoom: 0 });
    expectAllVisible(camera, subjects);
    expect(camera.rotation).toBeCloseTo(rotation, 6);
  });

  it('never frames wider than the authored frame by default', () => {
    // A small subject already fits, so the authored frame is the tightest correct
    // framing. Widening past it would show area the artist never drew.
    const camera = frameBounds([standing(960, 20)], { frame: FRAME });
    expect(camera.zoom).toBe(1);
    expectAllVisible(camera, [standing(960, 20)]);
  });

  it('respects an explicit minZoom', () => {
    expect(frameBounds([standing(960, 400)], { frame: FRAME, minZoom: 2 }).zoom).toBe(2);
  });

  it('caps the zoom so one small far-flung subject cannot fill the screen', () => {
    expect(frameBounds([standing(960, 4000)], { frame: FRAME }).zoom).toBe(4);
    expect(frameBounds([standing(960, 4000)], { frame: FRAME, maxZoom: 2.5 }).zoom).toBe(2.5);
  });

  it('applies the renderer fit factor, so framing matches what is drawn', () => {
    // A 4:3 authored frame (1920x1440) in a 16:9 viewport letterboxes to fit 0.75.
    // Ignoring the factor would promise a third more world than the renderer shows.
    const frame = { width: 1920, height: 1440 };
    const viewport = FRAME;
    const subjects = [wide(960, 1200, 100)];
    const camera = frameBounds(subjects, { frame, viewport, minZoom: 0 });
    expect(camera.zoom).toBeCloseTo((1200 * 1.24) / (1920 * 0.75), 6);
    expectAllVisible(camera, subjects, frame, viewport);
  });

  it('is unaffected by a horizontal flip, which mirrors the box about its own centre', () => {
    const plain = frameBounds([standing(960, 400)], { frame: FRAME });
    const flipped = frameBounds(
      [{ transform: transform({ x: 960, y: 900, scaleX: -1 }), height: 400 }],
      { frame: FRAME },
    );
    expect(flipped).toEqual(plain);
  });

  it('honours the requested margin', () => {
    const open = { frame: FRAME, minZoom: 0 } as const;
    const tight = frameBounds([standing(960, 400)], { ...open, margin: 0 });
    const loose = frameBounds([standing(960, 400)], { ...open, margin: 0.5 });
    expect(loose.zoom).toBeGreaterThan(tight.zoom);
  });

  it('is deterministic', () => {
    const subjects = [standing(700, 500), standing(1300, 350, { rotation: 0.2 })];
    const options = { frame: FRAME, margin: 0.2 };
    expect(frameBounds(subjects, options)).toEqual(frameBounds(subjects, options));
  });
});
