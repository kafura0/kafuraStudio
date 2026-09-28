/**
 * TIMELINE GEOMETRY.
 *
 * Pure time-to-pixel arithmetic. No DOM, no canvas, no state.
 *
 * This exists as a separate module because the mapping is the part of a timeline that
 * is easy to get subtly wrong and impossible to check by eye. A hit test that is one
 * pixel off puts the playhead in the wrong place when the user clicks; a trim that
 * measures from the wrong edge loses a frame per drag. All of it is arithmetic, so
 * all of it is tested as arithmetic.
 *
 * The invariant the rest of the timeline depends on:
 *
 *     timeToX(xToTime(x)) == x
 *
 * for every x. Everything else - snapping, clamping, dragging - is built on that.
 */

import type { Clip, Track } from '../types';

export interface TimelineMetrics {
  /** CSS pixels per second. */
  pixelsPerSecond: number;
  /** Lane height in CSS pixels, including its border. */
  laneHeight: number;
  /** Width of the fixed track-name column, which does not scroll. */
  labelWidth: number;
}

export const DEFAULT_METRICS: TimelineMetrics = {
  pixelsPerSecond: 60,
  laneHeight: 30,
  labelWidth: 148,
};

/** Smallest useful zoom, so the ruler cannot collapse into unreadable ticks. */
export const MIN_PIXELS_PER_SECOND = 4;
/** Largest zoom before a single frame is wider than a lane. */
export const MAX_PIXELS_PER_SECOND = 480;

export function clampScale(pixelsPerSecond: number): number {
  if (!Number.isFinite(pixelsPerSecond)) return DEFAULT_METRICS.pixelsPerSecond;
  return Math.min(MAX_PIXELS_PER_SECOND, Math.max(MIN_PIXELS_PER_SECOND, pixelsPerSecond));
}

/** Seconds -> pixels from the left edge of the lane area. */
export function timeToX(time: number, pixelsPerSecond: number): number {
  return time * pixelsPerSecond;
}

/**
 * Pixels -> seconds. The inverse of `timeToX`.
 *
 * Deliberately not clamped: a drag past either end of the ruler should be able to
 * report that it went past, and clamping here would make "hold at the edge" and
 * "clamp to the edge" indistinguishable at the point where the decision is made.
 */
export function xToTime(x: number, pixelsPerSecond: number): number {
  if (pixelsPerSecond === 0) return 0;
  return x / pixelsPerSecond;
}

export function clampTime(time: number, duration: number): number {
  if (Number.isNaN(time)) return 0;
  return Math.min(Math.max(time, 0), Math.max(duration, 0));
}

/** Snap a time to the nearest frame boundary, so a dragged clip lands on whole frames. */
export function snapToFrame(time: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return time;
  return Math.round(time * fps) / fps;
}

export interface RulerTick {
  time: number;
  x: number;
  /** Whole seconds get a label and a tall tick; fractions get a short one. */
  major: boolean;
}

/**
 * Tick marks for a scene of `duration` seconds.
 *
 * The step is chosen so ticks are at least `minSpacing` pixels apart, which is the
 * difference between a readable ruler and a solid grey line. Steps go 1, 2, 5, 10, 25,
 * 50, 100... so a label never lands on a fraction like 2.5s.
 */
export function rulerTicks(
  duration: number,
  pixelsPerSecond: number,
  minSpacing = 60,
): RulerTick[] {
  const safeDuration = Math.max(duration, 0);
  const spacing = Math.max(minSpacing, 1);
  const roughStep = spacing / Math.max(pixelsPerSecond, Number.EPSILON);
  const step = niceStep(roughStep);

  const ticks: RulerTick[] = [];
  // Guard the count as well as the step: a pathological duration must not allocate an
  // unbounded array.
  const maxTicks = 2000;
  for (let time = 0; time <= safeDuration + 1e-9 && ticks.length < maxTicks; time += step) {
    ticks.push({ time, x: timeToX(time, pixelsPerSecond), major: true });
  }
  return ticks;
}

/** Round `value` up to the next 1 / 2 / 5 x 10^n. */
export function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Sub-frame ticks between two major ticks, for the frame-accurate look. */
export function frameTicks(
  fromTick: RulerTick,
  toTick: RulerTick,
  fps: number,
  pixelsPerSecond: number,
): RulerTick[] {
  const span = toTick.time - fromTick.time;
  if (span <= 0 || fps <= 0 || !Number.isFinite(fps)) return [];
  const frames = Math.min(Math.round(span * fps), 120);
  const ticks: RulerTick[] = [];
  for (let i = 1; i < frames; i += 1) {
    const time = fromTick.time + i / fps;
    ticks.push({ time, x: timeToX(time, pixelsPerSecond), major: false });
  }
  return ticks;
}

export interface ClipRect {
  clip: Clip;
  x: number;
  /** Always at least `MIN_CLIP_WIDTH` so a one-frame clip stays clickable. */
  width: number;
}

/** A clip narrower than this is still drawn wide enough to grab. */
export const MIN_CLIP_WIDTH = 6;

export function clipRect(clip: Clip, pixelsPerSecond: number): ClipRect {
  return {
    clip,
    x: timeToX(clip.start, pixelsPerSecond),
    width: Math.max(timeToX(clip.duration, pixelsPerSecond), MIN_CLIP_WIDTH),
  };
}

export interface TrackLane {
  track: Track;
  index: number;
  /** Y of the lane's top edge, in the lane area. */
  y: number;
  height: number;
  clips: ClipRect[];
}

export function layoutTracks(
  tracks: readonly Track[],
  pixelsPerSecond: number,
  metrics: TimelineMetrics = DEFAULT_METRICS,
): TrackLane[] {
  return tracks.map((track, index) => ({
    track,
    index,
    y: index * metrics.laneHeight,
    height: metrics.laneHeight,
    clips: track.clips.map((clip) => clipRect(clip, pixelsPerSecond)),
  }));
}

export function laneHeightTotal(
  tracks: readonly Track[],
  metrics: TimelineMetrics = DEFAULT_METRICS,
): number {
  return tracks.length * metrics.laneHeight;
}

/** How far the playhead must be dragged before it grabs a clip edge, in pixels. */
export const TRIM_HANDLE_PX = 7;

export type Edge = 'start' | 'end' | 'none';

export function hitTestClip(
  lanes: readonly TrackLane[],
  x: number,
  y: number,
  trimHandlePx = TRIM_HANDLE_PX,
): { track: Track; clip: Clip; edge: Edge } | null {
  for (const lane of lanes) {
    if (y < lane.y || y >= lane.y + lane.height) continue;
    for (const rect of lane.clips) {
      const end = rect.x + rect.width;
      // Right edge first: a clip wider than the handle has an ambiguous midpoint,
      // and the handle is the more specific target.
      if (Math.abs(x - end) <= trimHandlePx) {
        return { track: lane.track, clip: rect.clip, edge: 'end' };
      }
      if (Math.abs(x - rect.x) <= trimHandlePx) {
        return { track: lane.track, clip: rect.clip, edge: 'start' };
      }
      if (x > rect.x && x < end) return { track: lane.track, clip: rect.clip, edge: 'none' };
    }
  }
  return null;
}

/** Which lane a y coordinate falls in, or -1. */
export function laneIndexAt(y: number, trackCount: number, metrics: TimelineMetrics): number {
  if (trackCount <= 0) return -1;
  const index = Math.floor(y / metrics.laneHeight);
  return index >= 0 && index < trackCount ? index : -1;
}

/**
 * Every time a dragged clip should snap to: the scene start and end, and the edges of
 * its neighbours in the same lane.
 */
export function snapCandidates(
  lane: TrackLane,
  excludingClipId: string,
  sceneDuration: number,
): number[] {
  const times: number[] = [0, sceneDuration];
  for (const rect of lane.clips) {
    if (rect.clip.id === excludingClipId) continue;
    times.push(rect.clip.start, rect.clip.start + rect.clip.duration);
  }
  return times;
}
