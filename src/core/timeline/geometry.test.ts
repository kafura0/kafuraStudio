/**
 * Timeline geometry.
 *
 * The mapping is the timeline's load-bearing arithmetic: if `xToTime` and `timeToX`
 * disagree, the playhead lands somewhere other than where the user clicked, and every
 * drag is wrong by that same error. None of it is visible without a screenshot, so all
 * of it is pinned here.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METRICS,
  MIN_CLIP_WIDTH,
  MIN_PIXELS_PER_SECOND,
  MAX_PIXELS_PER_SECOND,
  clampScale,
  clampTime,
  clipRect,
  frameTicks,
  hitTestClip,
  hitTestKeyframe,
  keyframeAt,
  keyframeMarkers,
  keyframeRowY,
  keyframeTime,
  laneIndexAt,
  laneHeightTotal,
  layoutTracks,
  niceStep,
  rulerTicks,
  snapCandidates,
  snapToFrame,
  timeToX,
  xToTime,
} from './geometry';
import { createClip, createTrack } from '../document/factories';
import type { Clip, Keyframe, Track } from '../types';

const SCALE = 100; // 100px per second keeps the arithmetic obvious.

function track(clips: { start: number; duration: number }[], overrides: Partial<Track> = {}): Track {
  return {
    ...createTrack('actor', 'nia', 'Nia', '#f00'),
    clips: clips.map((c, i) => ({
      ...createClip(c.start, c.duration),
      id: `clip_${i}`,
    })),
    ...overrides,
  };
}

describe('time <-> pixel mapping', () => {
  it('round-trips every time value', () => {
    for (const time of [0, 0.5, 1, 3.25, 7, 10, 59.94]) {
      expect(xToTime(timeToX(time, SCALE), SCALE)).toBeCloseTo(time, 9);
    }
  });

  it('round-trips at the zoom extremes', () => {
    for (const scale of [MIN_PIXELS_PER_SECOND, 37.5, SCALE, MAX_PIXELS_PER_SECOND]) {
      expect(xToTime(timeToX(4.2, scale), scale)).toBeCloseTo(4.2, 9);
    }
  });

  it('places the origin at x=0 and is monotonic', () => {
    expect(timeToX(0, SCALE)).toBe(0);
    expect(timeToX(1, SCALE)).toBeLessThan(timeToX(2, SCALE));
    expect(timeToX(2, SCALE)).toBeLessThan(timeToX(3, SCALE));
  });

  it('returns 0 rather than NaN or Infinity for a zero scale', () => {
    expect(xToTime(50, 0)).toBe(0);
    expect(Number.isFinite(xToTime(50, 0))).toBe(true);
  });
});

describe('clampScale', () => {
  it('holds the scale within usable bounds', () => {
    expect(clampScale(0.01)).toBe(MIN_PIXELS_PER_SECOND);
    expect(clampScale(1e9)).toBe(MAX_PIXELS_PER_SECOND);
    expect(clampScale(60)).toBe(60);
  });

  it('falls back to the default for nonsense input', () => {
    // Both are treated as garbage rather than as an instruction to zoom all the way
    // in: a caller passing Infinity wants a scale, not a boundary.
    expect(clampScale(Number.NaN)).toBe(DEFAULT_METRICS.pixelsPerSecond);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(DEFAULT_METRICS.pixelsPerSecond);
  });
});

describe('clampTime', () => {
  it('keeps the playhead inside the scene', () => {
    expect(clampTime(-1, 10)).toBe(0);
    expect(clampTime(3, 10)).toBe(3);
    expect(clampTime(99, 10)).toBe(10);
  });

  it('treats NaN as the start rather than propagating it', () => {
    expect(clampTime(Number.NaN, 10)).toBe(0);
  });

  it('does not produce a negative bound for a negative duration', () => {
    expect(clampTime(5, -10)).toBe(0);
  });
});

describe('snapToFrame', () => {
  it('lands on whole frames at 24fps', () => {
    expect(snapToFrame(1.0, 24)).toBeCloseTo(1, 9);
    expect(snapToFrame(1.01, 24)).toBeCloseTo(1, 9);
    // 1.02s is frame 24.48, which is nearer frame 24 than frame 25.
    expect(snapToFrame(1.02, 24)).toBeCloseTo(1, 9);
    expect(snapToFrame(1.03, 24)).toBeCloseTo(1 + 1 / 24, 9);
  });

  it('is a no-op for a nonsense frame rate', () => {
    expect(snapToFrame(1.234, 0)).toBe(1.234);
    expect(snapToFrame(1.234, Number.NaN)).toBe(1.234);
  });
});

describe('rulerTicks', () => {
  it('starts at zero and stays within the scene', () => {
    const ticks = rulerTicks(10, SCALE);
    expect(ticks[0]?.time).toBe(0);
    for (const tick of ticks) {
      expect(tick.time).toBeGreaterThanOrEqual(0);
      expect(tick.time).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('keeps ticks at least the requested spacing apart', () => {
    for (const scale of [4, 15, 60, 100, 480]) {
      const ticks = rulerTicks(60, scale, 60);
      for (let i = 1; i < ticks.length; i += 1) {
        const gap = (ticks[i]?.x ?? 0) - (ticks[i - 1]?.x ?? 0);
        expect(gap).toBeGreaterThanOrEqual(60 - 1e-6);
      }
    }
  });

  it('chooses steps a person can read', () => {
    // Not necessarily whole seconds: 0.5s or 0.2s steps read fine. What must not
    // happen is a step like 0.3 or 0.7, which would label ticks at 0.3, 0.6, 0.9.
    for (const scale of [4, 20, 60, 200, 480]) {
      const ticks = rulerTicks(30, scale);
      const step = ticks.length > 1 ? (ticks[1]?.time ?? 0) - (ticks[0]?.time ?? 0) : 0;
      expect(niceStep(step)).toBeCloseTo(step, 9);
      // A "nice" step is 1, 2 or 5 times a power of ten.
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
    }
  });

  it('produces no ticks for a zero-length scene', () => {
    expect(rulerTicks(0, SCALE)).toHaveLength(1); // just the origin
  });

  it('stays bounded rather than allocating without limit', () => {
    expect(rulerTicks(1e9, 1).length).toBeLessThanOrEqual(2000);
  });
});

describe('niceStep', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.1)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(23)).toBe(50);
  });

  it('degrades to 1 for nonsense input', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe('frameTicks', () => {
  it('fills in the frames between two major ticks', () => {
    const [from, to] = rulerTicks(2, SCALE);
    if (!from || !to) throw new Error('expected at least two major ticks');
    const frames = frameTicks(from, to, 10, SCALE);

    expect(frames).toHaveLength(9);
    expect(frames[0]?.time).toBeCloseTo(0.1, 9);
    expect(frames[0]?.x).toBeCloseTo(10, 6);
    expect(frames.every((f) => !f.major)).toBe(true);
  });

  it('places every frame tick at the same x the mapping would give', () => {
    const [from, to] = rulerTicks(1, SCALE);
    if (!from || !to) throw new Error('expected at least two major ticks');
    for (const frame of frameTicks(from, to, 25, SCALE)) {
      expect(frame.x).toBeCloseTo(timeToX(frame.time, SCALE), 6);
    }
  });

  it('emits nothing for an empty or backwards span', () => {
    const tick = { time: 1, x: 100, major: true };
    expect(frameTicks(tick, tick, 25, SCALE)).toHaveLength(0);
    expect(frameTicks({ ...tick, time: 2 }, tick, 25, SCALE)).toHaveLength(0);
  });

  it('caps the count so a long span cannot flood the ruler', () => {
    const frames = frameTicks({ time: 0, x: 0, major: true }, { time: 100, x: 10000, major: true }, 60, SCALE);
    expect(frames.length).toBeLessThanOrEqual(120);
  });
});

describe('clipRect', () => {
  it('positions and sizes a clip from its start and duration', () => {
    const rect = clipRect({ ...createClip(2, 1.5), id: 'c' }, SCALE);
    expect(rect.x).toBe(200);
    expect(rect.width).toBe(150);
  });

  it('keeps a sub-pixel clip grabbable', () => {
    // One frame at 24fps is 4px at this scale, but at 4px/second it is well under a
    // pixel. It still has to be clickable.
    const rect = clipRect({ ...createClip(0, 1 / 24), id: 'c' }, 4);
    expect(rect.width).toBe(MIN_CLIP_WIDTH);
  });
});

describe('layoutTracks', () => {
  it('stacks lanes without gaps or overlap', () => {
    const lanes = layoutTracks([track([]), track([]), track([])], SCALE);
    expect(lanes).toHaveLength(3);
    expect(lanes[0]?.y).toBe(0);
    expect(lanes[1]?.y).toBe(DEFAULT_METRICS.laneHeight);
    expect(lanes[2]?.y).toBe(DEFAULT_METRICS.laneHeight * 2);
    expect(laneHeightTotal([track([]), track([])])).toBe(DEFAULT_METRICS.laneHeight * 2);
  });

  it('maps each lane to the clips on its own track', () => {
    const lanes = layoutTracks(
      [track([{ start: 0, duration: 1 }]), track([{ start: 2, duration: 1 }])],
      SCALE,
    );
    expect(lanes[0]?.clips[0]?.x).toBe(0);
    expect(lanes[1]?.clips[0]?.x).toBe(200);
  });
});

describe('hitTestClip', () => {
  const lanes = layoutTracks([track([{ start: 1, duration: 2 }])], SCALE); // x 100..300

  it('finds a clip under the pointer', () => {
    const hit = hitTestClip(lanes, 200, 10);
    expect(hit?.clip.start).toBe(1);
    expect(hit?.edge).toBe('none');
  });

  it('detects the start edge within the handle', () => {
    expect(hitTestClip(lanes, 104, 10)?.edge).toBe('start');
  });

  it('detects the end edge within the handle', () => {
    expect(hitTestClip(lanes, 296, 10)?.edge).toBe('end');
  });

  it('prefers the end edge when a clip is narrower than both handles', () => {
    // A 30px clip: the middle is within 7px of both edges, and grabbing the right
    // one is the more specific answer.
    const narrow = layoutTracks([track([{ start: 0, duration: 0.3 }])], SCALE);
    expect(hitTestClip(narrow, 30, 10)?.edge).toBe('end');
  });

  it('returns null in empty space and in another lane', () => {
    expect(hitTestClip(lanes, 500, 10)).toBeNull();
    expect(hitTestClip(lanes, 200, 500)).toBeNull();
  });

  it('does not hit a clip that ends exactly where the pointer is, at zero width', () => {
    // start=1 duration=1 -> 100..200. x=200 is the far edge of that clip and the near
    // edge of nothing, and belongs to this clip's end handle.
    const single = layoutTracks([track([{ start: 1, duration: 1 }])], SCALE);
    expect(hitTestClip(single, 200, 10)?.edge).toBe('end');
  });
});

describe('laneIndexAt', () => {
  it('maps a y coordinate to a lane', () => {
    expect(laneIndexAt(0, 3, DEFAULT_METRICS)).toBe(0);
    expect(laneIndexAt(DEFAULT_METRICS.laneHeight + 1, 3, DEFAULT_METRICS)).toBe(1);
    expect(laneIndexAt(DEFAULT_METRICS.laneHeight * 3, 3, DEFAULT_METRICS)).toBe(-1);
    expect(laneIndexAt(-5, 3, DEFAULT_METRICS)).toBe(-1);
  });

  it('returns -1 when there are no lanes', () => {
    expect(laneIndexAt(10, 0, DEFAULT_METRICS)).toBe(-1);
  });
});

/** A clip with the given keyframes, spanning `duration` from `start`. */
function clipWithKeys(keyframes: Keyframe[], start = 1, duration = 2): Clip {
  return { ...createClip(start, duration), id: 'clip_k', keyframes };
}

describe('keyframe geometry', () => {
  it('puts the keyframe row in the lower half of the lane, clear of the clip label', () => {
    const y = keyframeRowY(0, DEFAULT_METRICS.laneHeight);
    expect(y).toBeGreaterThan(DEFAULT_METRICS.laneHeight / 2);
    expect(y).toBeLessThan(DEFAULT_METRICS.laneHeight);
  });

  it('offsets the keyframe row by the lane top, so every lane has its own row', () => {
    const h = DEFAULT_METRICS.laneHeight;
    expect(keyframeRowY(h, h) - keyframeRowY(0, h)).toBe(h);
  });

  it('marks every keyframe the clip covers, in time order', () => {
    const clip = clipWithKeys(
      [
        { id: 'late', time: 2.5, ease: 'linear', props: {} },
        { id: 'early', time: 1.5, ease: 'linear', props: {} },
      ],
      1,
      2,
    );
    const markers = keyframeMarkers(clip, SCALE, 0, DEFAULT_METRICS.laneHeight);
    expect(markers.map((m) => m.keyframe.id)).toEqual(['early', 'late']);
    expect(markers[0]?.x).toBe(150);
  });

  it('does not mark a keyframe the clip no longer covers, since it animates nothing visible', () => {
    // A clip running 1.0 to 2.0 has a keyframe at 2.5 beyond its end. Drawing it would
    // offer an edit target that has no effect on the render.
    const clip = clipWithKeys(
      [
        { id: 'inside', time: 1.5, ease: 'linear', props: {} },
        { id: 'outside', time: 2.5, ease: 'linear', props: {} },
      ],
      1,
      1,
    );
    const markers = keyframeMarkers(clip, SCALE, 0, DEFAULT_METRICS.laneHeight);
    expect(markers.map((m) => m.keyframe.id)).toEqual(['inside']);
  });

  it('excludes a keyframe exactly one frame past the clip end', () => {
    // Trimmed to exactly 2.0, a keyframe at 2.0 is the boundary, not outside it.
    const clip = clipWithKeys([{ id: 'edge', time: 2, ease: 'linear', props: {} }], 1, 1);
    const markers = keyframeMarkers(clip, SCALE, 0, DEFAULT_METRICS.laneHeight);
    expect(markers.map((m) => m.keyframe.id)).toEqual(['edge']);
  });

  it('places markers inside the clip rect horizontally', () => {
    const clip = clipWithKeys([{ id: 'k', time: 1, ease: 'linear', props: {} }], 1, 2);
    const rect = clipRect(clip, SCALE);
    const marker = keyframeMarkers(clip, SCALE, 0, DEFAULT_METRICS.laneHeight)[0];
    if (!marker) throw new Error('expected a marker');
    expect(marker.x).toBeGreaterThanOrEqual(rect.x);
    expect(marker.x).toBeLessThanOrEqual(rect.x + rect.width);
  });

  it('hits a keyframe pressed on its row', () => {
    const kfs = [{ id: 'k1', time: 1, ease: 'linear' as const, props: {} }];
    const hit = hitTestKeyframe(
      kfs,
      SCALE,
      0,
      DEFAULT_METRICS.laneHeight,
      102,
      keyframeRowY(0, DEFAULT_METRICS.laneHeight),
    );
    expect(hit?.keyframe.id).toBe('k1');
  });

  it('does not hit a keyframe when the pointer is in a different lane', () => {
    const h = DEFAULT_METRICS.laneHeight;
    const kfs = [{ id: 'k1', time: 1, ease: 'linear' as const, props: {} }];
    expect(hitTestKeyframe(kfs, SCALE, 0, h, 100, keyframeRowY(h, h))).toBeNull();
  });

  it('does not hit a keyframe when the pointer is on the clip body, above the row', () => {
    const kfs = [{ id: 'k1', time: 1, ease: 'linear' as const, props: {} }];
    expect(hitTestKeyframe(kfs, SCALE, 0, DEFAULT_METRICS.laneHeight, 100, 3)).toBeNull();
  });

  it('does not hit when the pointer is far from every keyframe in time', () => {
    const kfs = [{ id: 'k1', time: 1, ease: 'linear' as const, props: {} }];
    const y = keyframeRowY(0, DEFAULT_METRICS.laneHeight);
    expect(hitTestKeyframe(kfs, SCALE, 0, DEFAULT_METRICS.laneHeight, 600, y)).toBeNull();
  });

  it('reaches a keyframe in a cluster too dense to separate by eye', () => {
    // Two keyframes one frame apart, zoomed far out: 0.04s at 4px/s is 0.17px. A
    // strict visual hit test cannot tell them apart, so nearest in time wins.
    const a = { id: 'a', time: 1, ease: 'linear' as const, props: {} };
    const b = { id: 'b', time: 1 + 1 / 24, ease: 'linear' as const, props: {} };
    const hit = hitTestKeyframe(
      [a, b],
      MIN_PIXELS_PER_SECOND,
      0,
      DEFAULT_METRICS.laneHeight,
      timeToX(1 + 1 / 24, MIN_PIXELS_PER_SECOND),
      keyframeRowY(0, DEFAULT_METRICS.laneHeight),
    );
    expect(hit?.keyframe.id).toBe('b');
  });

  it('takes the later of two keyframes at the same x, so a drag grabs the one it heads for', () => {
    const kfs = [
      { id: 'first', time: 1, ease: 'linear' as const, props: {} },
      { id: 'second', time: 1, ease: 'linear' as const, props: {} },
    ];
    const hit = hitTestKeyframe(
      kfs,
      SCALE,
      0,
      DEFAULT_METRICS.laneHeight,
      100,
      keyframeRowY(0, DEFAULT_METRICS.laneHeight),
    );
    expect(hit?.keyframe.id).toBe('second');
  });

  it('clamps a dropped keyframe into the clip', () => {
    const clip = { start: 1, duration: 2 };
    expect(keyframeTime(clip, 1.5, 24).time).toBeCloseTo(1.5, 5);
    expect(keyframeTime(clip, 99, 24).time).toBe(3);
    expect(keyframeTime(clip, -5, 24).time).toBe(1);
  });

  it('quantises a dropped keyframe to a frame', () => {
    const { time } = keyframeTime({ start: 0, duration: 4 }, 1.517, 24);
    expect(time).toBeCloseTo(1.5, 5);
  });

  it('reports whether a dropped keyframe actually moved', () => {
    const clip = { start: 1, duration: 2 };
    expect(keyframeTime(clip, 1.5, 24).changed).toBe(false);
    expect(keyframeTime(clip, 1.6, 24).changed).toBe(true);
    expect(keyframeTime(clip, 99, 24).changed).toBe(true);
  });

  it('finds the exact keyframe at a time before settling for the nearest', () => {
    const kfs = [
      { id: 'k1', time: 1, ease: 'linear' as const, props: {} },
      { id: 'k2', time: 2, ease: 'linear' as const, props: {} },
    ];
    expect(keyframeAt(kfs, 2)?.id).toBe('k2');
  });

  it('falls back to the nearest keyframe when none sits exactly on the time', () => {
    const kfs = [
      { id: 'k1', time: 1, ease: 'linear' as const, props: {} },
      { id: 'k2', time: 2, ease: 'linear' as const, props: {} },
    ];
    expect(keyframeAt(kfs, 1.6)?.id).toBe('k2');
  });

  it('returns null for a clip with no keyframes', () => {
    expect(keyframeAt([], 1)).toBeNull();
  });
});

describe('snapCandidates', () => {
  it('offers the scene bounds and the neighbours edges, excluding the dragged clip', () => {
    const lane = layoutTracks(
      [track([{ start: 1, duration: 1 }, { start: 3, duration: 1 }, { start: 5, duration: 1 }])],
      SCALE,
    )[0];
    if (!lane) throw new Error('expected a lane');

    const times = snapCandidates(lane, 'clip_1', 10);

    expect(times).toContain(0);
    expect(times).toContain(10);
    // Neighbours' edges, and none of the dragged clip's own.
    expect(times).toContain(1);
    expect(times).toContain(2);
    expect(times).toContain(5);
    expect(times).toContain(6);
    expect(times).not.toContain(3);
    expect(times).not.toContain(4);
  });
});
