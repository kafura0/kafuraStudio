import type { Episode, Project } from '../types';
import { episodeDuration, flattenCut } from '../timeline/episode';

export interface Frame {
  /** 0-based index in the sequence */
  index: number;
  /** Episode time in seconds, on the computed frame boundary */
  time: number;
}

export interface FrameSequenceSettings {
  /**
   * The document the episode's scenes live in.
   *
   * Part of the settings rather than a third positional argument because the spec's
   * signature is `frameSequence(settings, episode)`: the episode names scenes, and only the
   * project knows their durations, so a two-argument call that omitted this would have to
   * look the project up itself and silently fall back to document order — the exact
   * disagreement with the caller that `flattenCut` exists to prevent.
   */
  project: Project;
  /** Frames per second. Defaults to `episode.renderSettings.fps`. */
  fps?: number;
}

/**
 * The frames an episode exports, in episode time.
 *
 * Pure and DOM-free: no canvas, no store, no document mutation. The same episode always
 * yields the same list, which is what makes the exporter's output comparable frame to
 * frame and what lets the draw-log test assert against a golden render.
 *
 * ## Half-open, like the cut itself
 *
 * Frames cover `[0, duration)`, NOT `[0, duration]`, and the two halves of that sentence
 * pull in opposite directions at the end:
 *
 *  - `duration` is already the *first* instant of whatever comes next (`episode.ts`
 *    documents the cut as half-open for exactly this reason). A frame sampled at `t =
 *    duration` is therefore not the last frame of this episode; it is a frame of the next
 *    one, or of nothing.
 *  - Dropping the end outright would not be right either, because the final `1/fps` of
 *    runtime has to be covered by *some* frame.
 *
 * So the last frame is the one that *covers* the end: at 38s and 12fps the sequence is
 * 456 frames, the last at 37.9167s, held on screen until 38s. Forcing that last frame to
 *  sit exactly on 38s would push it off the fps grid and stretch the final interval to
 *  1.5x, which is why frame count is `ceil(duration * fps)` and frame `i` is at `i / fps`
 *  with no special-casing of the tail.
 */
export function frameSequence(settings: FrameSequenceSettings, episode: Episode): Frame[] {
  const duration = episodeDuration(flattenCut(settings.project, episode));

  // A non-finite or non-positive rate has no frame grid to place times on, so it yields
  // nothing rather than throwing. An unresolvable cut has no duration and also yields
  // nothing, which is the honest answer: there is no episode to export yet.
  const fps = settings.fps ?? episode.renderSettings.fps;
  if (!Number.isFinite(fps) || fps <= 0) return [];
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const count = Math.ceil(duration * fps);
  if (count < 1) return [];

  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    // `min` is a guard against float drift, not intent: `i / fps` is already strictly
    // less than `duration` for the largest `i` that `ceil` produces.
    frames.push({ index: i, time: Math.min(i / fps, duration) });
  }
  return frames;
}
