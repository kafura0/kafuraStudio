/**
 * Sparse-keyframe regressions.
 *
 * A keyframe only states the channels it cares about. These tests pin what happens
 * when one end of a segment is silent about a channel — the case where a channel
 * existed before the hold was fixed, and where it vanished again afterwards.
 */

import { describe, expect, it } from 'vitest';
import { sampleKeyframes } from './sample';
import type { Keyframe } from '../core/types';

function kf(time: number, props: Keyframe['props']): Keyframe {
  return { id: `kf${time}`, time, ease: 'linear', props };
}

describe('sparse keyframe channels', () => {
  it('leaves a channel absent until the keyframe that first states it', () => {
    // alpha is keyed only at t=1. Before that it does not exist, so the rest value
    // applies. Keying only a destination is a hold at that value from the keyframe
    // onward, not a ramp from zero — the renderer falls back to the actor's static
    // transform for the rest of the segment.
    expect('alpha' in sampleKeyframes([kf(0, { x: 0 }), kf(1, { x: 100, alpha: 0.5 })], 0.5)).toBe(
      false,
    );
    expect(sampleKeyframes([kf(0, { x: 0 }), kf(1, { x: 100, alpha: 0.5 })], 1).alpha).toBe(0.5);
  });

  it('holds a keyed channel across a keyframe that omits it, then ramps on the next', () => {
    const sampled = sampleKeyframes(
      [kf(0, { alpha: 0.25 }), kf(1, {}), kf(2, { alpha: 1 })],
      1.5,
    );
    // Between t=1 and t=2 alpha must ramp from the held 0.25, not from undefined.
    expect(sampled.alpha).toBeCloseTo(0.625, 5);
  });

  it('holds a keyed channel before the segment that re-keys it', () => {
    const sampled = sampleKeyframes([kf(0, { x: 0, alpha: 0 }), kf(2, { x: 10 })], 1);
    // alpha keyed at t=0, silent at t=2, so it holds 0 through the segment.
    expect(sampled.x).toBeCloseTo(5, 5);
    expect(sampled.alpha).toBe(0);
  });

  it('leaves a never-keyed channel absent rather than inventing one', () => {
    const sampled = sampleKeyframes([kf(0, { x: 0 }), kf(1, { x: 10 })], 0.5);
    expect('alpha' in sampled).toBe(false);
    expect('rotation' in sampled).toBe(false);
  });

  it('resolves every numeric channel independently', () => {
    const track = [
      kf(0, { x: 0, alpha: 0, rotation: 0 }),
      kf(1, { x: 10, rotation: 1 }),
      kf(2, { x: 20, alpha: 1 }),
    ];
    // At t=0.5, inside the first segment: x and rotation are keyed at both ends so
    // both ramp; alpha is keyed only at t=0 so it holds 0.
    const early = sampleKeyframes(track, 0.5);
    expect(early.x).toBeCloseTo(5, 5);
    expect(early.alpha).toBe(0);
    expect(early.rotation).toBeCloseTo(0.5, 5);

    // At t=1.5, inside the second segment: x ramps, alpha ramps from the value it
    // held, and rotation is silent at t=2 so it holds 1.
    const later = sampleKeyframes(track, 1.5);
    expect(later.x).toBeCloseTo(15, 5);
    expect(later.alpha).toBeCloseTo(0.5, 5);
    expect(later.rotation).toBeCloseTo(1, 5);
  });
});
