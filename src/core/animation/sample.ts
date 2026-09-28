/**
 * Keyframe sampling and scene state resolution.
 *
 * Pure: `(keyframes, time) -> values`. No document access, so it is trivially
 * testable and safe to call from the render loop.
 */

import { lerp } from '../geometry';
import type {
  Clip,
  EaseType,
  Id,
  Keyframe,
  KeyframeTarget,
  Scene,
  TrackKind,
  Transform2D,
} from '../types';

/** Channels that must never be interpolated — an expression holds, it does not smear. */
const NUMERIC_CHANNELS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'alpha'] as const;

/**
 * The length of a scene, in seconds.
 *
 * The timeline ruler, the playhead loop and the exporter all need this number, and
 * they must agree: it is the authored `duration`, never the extent of the clips.
 * A clip that overhangs the scene is a validation error, not a longer scene.
 */
export function sceneDuration(scene: Scene): number {
  return scene.duration;
}

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
 * - A numeric channel is resolved per channel, not per segment: if a later keyframe
 *   does not mention a channel, that channel holds its most recent keyed value
 *   rather than reverting. A channel is only absent before it is first keyed, so the
 *   underlying rest value applies until then.
 */
export function sampleKeyframes(keyframes: Keyframe[], time: number): KeyframeTarget {
  const first = keyframes[0];
  if (!first) return {};
  if (keyframes.length === 1 || time <= first.time) return withHeldChannels(keyframes, first, 0);

  const lastIndex = keyframes.length - 1;
  const last = keyframes[lastIndex];
  if (!last) return {};
  if (time >= last.time) return withHeldChannels(keyframes, last, lastIndex);

  // Binary search for the segment [a, b) containing `time`.
  let low = 0;
  let high = lastIndex;
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
    const to = b.props[channel];
    // The value the channel held on entering this segment: either keyed at `a`, or the
    // most recent *earlier* keyframe that keyed it. Resolving the `from` side this way
    // is what lets a channel ramp through a keyframe that happens to be silent about
    // it, instead of vanishing for that segment and snapping back at `b`.
    //
    // `high - 1`, not `high`: the search is inclusive of its upper bound, and `high`
    // would be `b` itself, defeating the purpose.
    const from =
      typeof a.props[channel] === 'number'
        ? (a.props[channel] as number)
        : lastKeyedNumberBefore(keyframes, high - 1, channel);

    if (from === undefined) {
      // Never keyed before `b`, so the channel does not exist yet and the rest value
      // applies. Keying only the destination is a deliberate "hold" at that value from
      // `b` onward, not a ramp from zero.
      delete out[channel];
    } else if (typeof to === 'number') {
      out[channel] = lerp(from, to, t);
    } else {
      // `b` is silent about this channel, so it holds whatever was last keyed.
      out[channel] = from;
    }
  }
  // Discrete channels are carried by the `{ ...a.props }` spread above and are never
  // touched here, so they hold for the whole segment and switch at `b`.
  return out;
}

/**
 * A keyframe's value set, with any numeric channel the keyframe is silent about
 * filled in from the most recent earlier keyframe that did key it.
 *
 * Used when a keyframe is being *held* rather than interpolated — before the track
 * starts, or at/after its end — so the hold behaves the same on every path.
 */
function withHeldChannels(keyframes: Keyframe[], at: Keyframe, index: number): KeyframeTarget {
  const out: KeyframeTarget = { ...at.props };
  for (const channel of NUMERIC_CHANNELS) {
    if (typeof out[channel] === 'number') continue;
    const held = lastKeyedNumberBefore(keyframes, index, channel);
    if (held !== undefined) out[channel] = held;
  }
  return out;
}

/**
 * The most recent keyed value for a channel at or before index `upTo`, or undefined
 * if the channel has never been keyed. Walks backwards, which is fine because
 * sparse keyframe lists are short and this only runs for channels `b` omits.
 */
function lastKeyedNumberBefore(
  keyframes: Keyframe[],
  upTo: number,
  channel: (typeof NUMERIC_CHANNELS)[number],
): number | undefined {
  for (let i = Math.min(upTo, keyframes.length - 1); i >= 0; i -= 1) {
    const value = keyframes[i]?.props[channel];
    if (typeof value === 'number') return value;
  }
  return undefined;
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

/**
 * Scene-level convenience: sample every track driving one target.
 *
 * The renderer and the editor both need "what is this actor doing right now",
 * expressed against a Scene rather than a hand-assembled clip list, so that lookup
 * lives here instead of being repeated (and getting subtly different) at each site.
 */
export function sampleSceneTarget(
  scene: Scene,
  kind: TrackKind,
  targetId: Id,
  time: number,
): KeyframeTarget {
  const clips: Clip[] = [];
  for (const track of scene.tracks) {
    if (track.kind !== kind || track.targetId !== targetId) continue;
    clips.push(...track.clips);
  }
  return sampleTarget(clips, time);
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
