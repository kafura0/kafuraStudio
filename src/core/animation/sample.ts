/**
 * Keyframe sampling and scene state resolution.
 *
 * Pure: `(keyframes, time) -> values`. No document access, so it is trivially
 * testable and safe to call from the render loop.
 */

import { lerp } from '../geometry';
import type { Clip, EaseType, Keyframe, KeyframeTarget, Transform2D } from '../types';

/** Channels that must never be interpolated — an expression holds, it does not smear. */
const NUMERIC_CHANNELS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'alpha'] as const;

function applyEase(ease: EaseType, t: number): number {
  switch (ease) {
    case 'step':
      return 0;
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case 'easeOut':
      return 1 - (1 - t) ** 3;
    case 'linear':
    default:
      return t;
  }
}

/**
 * Sample a keyframe list at an absolute time.
 *
 * Segment easing is read from the keyframe the segment *leaves* (the keyframe
 * before `b`), which is the familiar After Effects convention.
 *
 * - Before the first keyframe: hold the first keyframe's values.
 * - After the last keyframe: hold the last keyframe's values.
 * - Discrete channels (pose, expression, visibility, flip) always hold the start of
 *   the segment and switch at the next keyframe, regardless of easing.
 * - A channel present only on the *later* keyframe is absent until that keyframe is
 *   reached, so the underlying rest value applies up to that point.
 */
export function sampleKeyframes(keyframes: Keyframe[], time: number): KeyframeTarget {
  const first = keyframes[0];
  if (!first) return {};
  if (keyframes.length === 1 || time <= first.time) return { ...first.props };

  const last = keyframes[keyframes.length - 1];
  if (!last) return { ...first.props };
  if (time >= last.time) return { ...last.props };

  // Binary search for the segment [a, b) containing `time`.
  let low = 0;
  let high = keyframes.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    const kf = keyframes[mid];
    if (kf && kf.time <= time) low = mid;
    else high = mid;
  }
  const a = keyframes[low];
  const b = keyframes[high];
  if (!a || !b) return {};

  const span = b.time - a.time;
  const rawT = span <= 0 ? 1 : (time - a.time) / span;
  const t = applyEase(a.ease, rawT);

  const out: KeyframeTarget = { ...a.props };
  for (const channel of NUMERIC_CHANNELS) {
    const from = a.props[channel];
    const to = b.props[channel];
    if (typeof from === 'number' && typeof to === 'number') {
      out[channel] = lerp(from, to, t);
    }
  }
  // Discrete channels are carried by the `{ ...a.props }` spread above and are never
  // touched here, so they hold for the whole segment and switch at `b`.
  return out;
}

/** Sample one clip at an absolute time. Out-of-range clips contribute nothing. */
export function sampleClip(clip: Clip, time: number): KeyframeTarget {
  if (time < clip.start || time >= clip.start + clip.duration) return {};
  return sampleKeyframes(clip.keyframes, time);
}

/**
 * Merge every active clip for a target into one value set.
 *
 * Later clips win, so an actor can be animated by several sequential clips and the
 * most recently started one takes precedence.
 */
export function sampleTarget(clips: Clip[], time: number): KeyframeTarget {
  let out: KeyframeTarget = {};
  const active = clips
    .filter((clip) => time >= clip.start && time < clip.start + clip.duration)
    .sort((a, b) => a.start - b.start);
  for (const clip of active) {
    out = { ...out, ...sampleClip(clip, time) };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

export interface ResolvedCamera extends Transform2D {
  zoom: number;
}

/**
 * Resolve the camera at a time: the scene's rest framing, overridden by any active
 * camera keyframes.
 */
export function resolveCamera(
  rest: { x: number; y: number; zoom: number; rotation: number },
  cameraClips: Clip[],
  time: number,
): ResolvedCamera {
  const sampled = sampleTarget(cameraClips, time);
  return {
    x: sampled.x ?? rest.x,
    y: sampled.y ?? rest.y,
    rotation: sampled.rotation ?? rest.rotation,
    // `zoom` is stored on the camera track as `scaleX` for transform compatibility.
    zoom: sampled.scaleX ?? rest.zoom,
    scaleX: sampled.scaleX ?? rest.zoom,
    scaleY: sampled.scaleX ?? rest.zoom,
    alpha: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Talk pulse                                                          */
/* ------------------------------------------------------------------ */

/**
 * A cheap stand-in for lip sync: while an actor has an active line, the mouth
 * cycles through open shapes. Real phoneme sync is Phase 16 work; this is enough
 * to keep a talking character from looking frozen, and it is honest about that.
 */
export function talkPulseAt(time: number, syllablesPerSecond = 4.2): number {
  const phase = time * syllablesPerSecond;
  // Two-step waveform: fast close, slower open, which reads as speech.
  const cycle = phase - Math.floor(phase);
  return cycle < 0.4 ? 0.25 : cycle < 0.75 ? 1 : 0.5;
}
