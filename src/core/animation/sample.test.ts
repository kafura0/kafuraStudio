/**
 * PURE DOMAIN LOGIC.
 *
 * These are the rules the whole editor rests on: sampling, geometry, and the
 * immutable document operations. They are tested directly against plain data, with
 * no DOM and no store, because that is the property that makes them trustworthy.
 */

import { describe, expect, it } from 'vitest';
import { sampleKeyframes, sampleTarget, talkPulseAt } from './sample';
import { composeTransform, lerp, lerpTransform, screenToWorld, worldToScreen } from '../geometry';
import { createKeyframe } from '../document/factories';
import type { Clip, Keyframe, KeyframeTarget } from '../types';

const kf = (time: number, props: KeyframeTarget, ease: Keyframe['ease'] = 'linear'): Keyframe =>
  createKeyframe(time, props, ease);

describe('sampleKeyframes', () => {
  it('holds the first keyframe before the track starts', () => {
    const keys = [kf(2, { x: 100 }), kf(4, { x: 200 })];
    expect(sampleKeyframes(keys, 0)).toEqual({ x: 100 });
  });

  it('holds the last keyframe after the track ends', () => {
    const keys = [kf(2, { x: 100 }), kf(4, { x: 200 })];
    expect(sampleKeyframes(keys, 99)).toEqual({ x: 200 });
  });

  it('interpolates numeric channels linearly', () => {
    const keys = [kf(0, { x: 0 }), kf(10, { x: 100 })];
    expect(sampleKeyframes(keys, 5).x).toBe(50);
  });

  it('never interpolates a discrete channel', () => {
    const keys = [kf(0, { poseId: 'a' }), kf(10, { poseId: 'b' })];
    // A pose holds for the whole segment and switches only at the later keyframe.
    expect(sampleKeyframes(keys, 9.9).poseId).toBe('a');
    expect(sampleKeyframes(keys, 10).poseId).toBe('b');
  });

  it('honours a step ease', () => {
    const keys = [kf(0, { x: 0 }, 'step'), kf(10, { x: 100 })];
    expect(sampleKeyframes(keys, 9.9).x).toBe(0);
  });

  it('holds a channel the later keyframe omits, rather than resetting it', () => {
    // Regression test. Kito's walk-in keys alpha 0 -> 1, then later keyframes only
    // move x and switch pose. Dropping `alpha` on those keyframes used to make him
    // fade back out for the rest of the scene.
    const keys = [
      kf(0, { x: 1330, alpha: 0 }),
      kf(0.2, { alpha: 1 }),
      kf(1.6, { x: 1120, poseId: 'pose.standing' }),
      kf(3.9, { x: 1120, poseId: 'pose.armsCrossed' }, 'step'),
    ];

    expect(sampleKeyframes(keys, 1.6).alpha).toBe(1);
    expect(sampleKeyframes(keys, 3.0).alpha).toBe(1);
    expect(sampleKeyframes(keys, 3.9).alpha).toBe(1);
  });

  it('leaves a channel absent until it is first keyed', () => {
    const keys = [kf(0, { x: 0 }), kf(5, { x: 10, alpha: 0.5 })];
    // Before alpha is ever keyed, the rest value must apply.
    expect(sampleKeyframes(keys, 1).alpha).toBeUndefined();
    expect(sampleKeyframes(keys, 5).alpha).toBe(0.5);
  });

  it('returns an empty target for an empty track', () => {
    expect(sampleKeyframes([], 3)).toEqual({});
  });

  it('resolves a single-keyframe track', () => {
    expect(sampleKeyframes([kf(3, { x: 42 })], 99)).toEqual({ x: 42 });
  });
});

describe('sampleTarget', () => {
  const clip = (start: number, duration: number, props: KeyframeTarget): Clip => ({
    id: `clip_${start}`,
    start,
    duration,
    keyframes: [kf(0, props)],
    audioId: null,
    dialogueLineId: null,
    gain: 1,
  });

  it('merges overlapping clips, with the later-starting clip winning', () => {
    const a = clip(0, 10, { x: 0, alpha: 1 });
    const b = clip(5, 10, { x: 500 });
    const out = sampleTarget([a, b], 7);
    expect(out.x).toBe(500);
    expect(out.alpha).toBe(1);
  });

  it('treats clips as half-open, so adjacent clips do not double-cover', () => {
    const a = clip(0, 5, { x: 1 });
    const b = clip(5, 5, { x: 2 });
    expect(sampleTarget([a, b], 5).x).toBe(2);
    expect(sampleTarget([a, b], 4.999).x).toBe(1);
  });

  it('ignores clips outside the sampled time', () => {
    expect(sampleTarget([clip(10, 5, { x: 1 })], 0)).toEqual({});
  });
});

describe('talkPulseAt', () => {
  it('stays within the mouth-shape range', () => {
    for (let t = 0; t < 5; t += 0.01) {
      const pulse = talkPulseAt(t);
      expect(pulse).toBeGreaterThan(0);
      expect(pulse).toBeLessThanOrEqual(1);
    }
  });

  it('actually moves, so a talking character is not frozen', () => {
    const samples = new Set(Array.from({ length: 40 }, (_, i) => talkPulseAt(i * 0.02)));
    expect(samples.size).toBeGreaterThan(1);
  });
});

describe('geometry', () => {
  it('lerps linearly', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it('round-trips a point through world and screen space', () => {
    const viewport = { width: 1920, height: 1080 };
    const camera = { x: 960, y: 540, rotation: 0, scaleX: 1.5, scaleY: 1.5, alpha: 1 };
    const world = { x: 400, y: 700 };
    const screen = worldToScreen(world, viewport, camera);
    const back = screenToWorld(screen, viewport, camera);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it('round-trips through a rotated camera', () => {
    const viewport = { width: 1920, height: 1080 };
    const camera = { x: 960, y: 540, rotation: 0.4, scaleX: 1.2, scaleY: 1.2, alpha: 1 };
    const world = { x: 300, y: 800 };
    const back = screenToWorld(worldToScreen(world, viewport, camera), viewport, camera);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it('composes a parent and child transform', () => {
    const parent = { x: 100, y: 200, rotation: 0, scaleX: 2, scaleY: 2, alpha: 1 };
    const child = { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 1 };
    const out = composeTransform(parent, child);
    expect(out.x).toBeCloseTo(120, 6);
    expect(out.y).toBeCloseTo(200, 6);
  });

  it('propagates alpha multiplicatively', () => {
    const parent = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 0.5 };
    const child = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 0.5 };
    expect(composeTransform(parent, child).alpha).toBeCloseTo(0.25, 6);
  });

  it('lerps two whole transforms', () => {
    const a = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 1 };
    const b = { x: 100, y: 50, rotation: 0, scaleX: 2, scaleY: 2, alpha: 0 };
    const mid = lerpTransform(a, b, 0.5);
    expect(mid.x).toBe(50);
    expect(mid.y).toBe(25);
    expect(mid.scaleX).toBeCloseTo(1.5, 6);
    expect(mid.alpha).toBeCloseTo(0.5, 6);
  });
});
