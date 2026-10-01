/**
 * EPISODE TIMING — pure core.
 *
 * An episode is a cut list of scenes (`Episode.sceneIds`), and the editor needs to know
 * two different things about time:
 *
 *   episode time   continuous, starts at 0 at the first frame of the cut
 *   scene time     local to one scene, starts at 0 at that scene's first frame
 *
 * Everything here is the arithmetic relating them. There is no clock, no state and no
 * wall-clock time: the same episode and the same episode time always produce the same
 * answer, which is what lets the store advance a playhead and lets the Phase 12
 * exporter place a frame without either of them re-deriving the mapping.
 *
 * ## Boundary semantics: half-open intervals
 *
 * A scene of `duration` d occupies `[offset, offset + d)`, NOT `[offset, offset + d]`.
 * The instant a scene ends is already the first instant of the next one. So with
 * scenes A=10s, B=8s, C=12s:
 *
 *     0  .. 10      scene A, local = t
 *     10 .. 18      scene B, local = t - 10
 *     18 .. 30      scene C, local = t - 18
 *     t = 10   ->  B at local 0
 *     t = 30   ->  past the end (see below)
 *
 * The alternative — letting the final frame of a scene belong to that scene — was
 * rejected for two reasons. It makes every scene boundary a value that belongs to two
 * scenes, so a scrub to exactly 10s has no single right answer. And it makes "the end
 * of the episode" identical to "the end of the last scene", which leaves the transport
 * unable to tell "finished" from "still going" without a special case per scene.
 *
 * ## What happens outside the cut
 *
 *   t < 0        clamped to 0; the first scene, its first frame
 *   t >= total   the last scene at its final frame, flagged `ended`
 *
 * Time past the end resolves to the *last frame* rather than to nothing. The renderer
 * takes a scene and a time and has no concept of an episode, so handing it nothing
 * would mean the stage went black for the last frame of a cut. `ended` lets the caller
 * decide what "finished" means — wrap the episode, or stop — without this module
 * choosing on its behalf.
 *
 * ## Degenerate scenes
 *
 * A zero-length or missing scene must not be able to hang the resolver. Scans here are
 * over a precomputed segment list with no `while` loop, so a zero-length scene is
 * skipped and costs one comparison. `Scene.duration` is clamped to 0.1s by
 * `setSceneDuration`, so this is a hand-edited or imported document at worst, not
 * something the editor can author.
 */

import type { Episode, Id, Project, Scene } from '../types';
import { findEpisode, findScene } from '../document/lookups';

/**
 * One scene's place in the episode.
 *
 * `end` is exclusive: it is the `offset` of the following scene, or the episode
 * duration for the last one.
 */
export interface EpisodeSegment {
  scene: Scene;
  /** Zero-based position in the cut. */
  index: number;
  /** Episode time at this scene's first frame. */
  offset: number;
  /** Episode time at the next scene's first frame, or the episode duration. */
  end: number;
  duration: number;
}

export interface EpisodeTimeline {
  episode: Episode;
  /** Scenes that resolved, in cut order. Zero-length scenes are dropped. */
  segments: EpisodeSegment[];
  /** Sum of the segment durations. 0 for an empty or fully degenerate cut. */
  duration: number;
}

/**
 * The resolution of one episode time.
 *
 * `sceneTime` is the value the renderer is given, and it is always in
 * `[0, scene.duration]`. `ended` means the requested time was at or past the end of the
 * cut.
 *
 * `scene` is null only for a cut with nothing playable in it. That is not a theoretical
 * case: the document is validated on load and on commit, but a caller can hold a
 * reference to a project whose episode has been emptied, and "which scene is at 3s" has
 * to have an answer even when the answer is "none". `index === -1` is the same signal
 * for callers that would rather test a number than a reference.
 */
export interface EpisodePosition {
  scene: Scene | null;
  sceneId: Id;
  index: number;
  /** Episode time at the start of the resolved scene. */
  offset: number;
  /** Local time within the resolved scene. */
  sceneTime: number;
  /** True when the requested time was at or past the end of the cut. */
  ended: boolean;
  /** The episode duration, so a caller does not have to recompute it. */
  duration: number;
}

/** What an empty cut resolves to: no scene, and every number zero. */
const EMPTY_POSITION = {
  scene: null,
  sceneId: '',
  index: -1,
  offset: 0,
  sceneTime: 0,
  ended: true,
  duration: 0,
} as const;

/**
 * A scene can only occupy time if it is a real scene with a positive duration.
 *
 * The duration check is a floor rather than a filter on the document: validation
 * already requires every `sceneIds` entry to resolve, but a hand-edited file can still
 * carry `duration: 0`, and a zero-length segment would make two boundaries coincide and
 * leave "which scene is at 3s" genuinely ambiguous.
 */
function isPlayable(scene: Scene | undefined): scene is Scene {
  return !!scene && Number.isFinite(scene.duration) && scene.duration > 0;
}

/**
 * Flatten a cut into timed segments.
 *
 * This is the one place scene offsets are computed. `audioPlan` (§19.5) and the
 * exporter apply this same function rather than keeping their own running totals, so
 * picture and sound cannot disagree about where a scene starts.
 */
export function buildEpisodeTimeline(project: Project, episodeId: Id): EpisodeTimeline | null {
  const episode = findEpisode(project, episodeId);
  if (!episode) return null;
  return flattenCut(project, episode);
}

/**
 * Flatten a cut the caller already holds, without a lookup by id.
 *
 * Separate from `buildEpisodeTimeline` because the two differ in *which* episode they
 * read: that one resolves the project's copy from an id, this one takes the object it is
 * given. Passing an episode that is not the project's current copy is a legitimate case
 * for the exporter, which must render the document it was handed rather than whichever
 * copy happens to be committed, so a silently different answer here would mean exporting
 * frames from a cut nobody asked for.
 */
export function flattenCut(project: Project, episode: Episode): EpisodeTimeline {
  const segments: EpisodeSegment[] = [];
  let cursor = 0;

  episode.sceneIds.forEach((sceneId) => {
    const scene = findScene(project, sceneId);
    if (!isPlayable(scene)) return;
    segments.push({
      scene,
      index: segments.length,
      offset: cursor,
      end: cursor + scene.duration,
      duration: scene.duration,
    });
    cursor += scene.duration;
  });

  return { episode, segments, duration: cursor };
}

/** The episodes in a project, in document order. */
export function episodeList(project: Project): Episode[] {
  return project.episodes;
}

/**
 * Total episode length in seconds, or 0 for an empty or unresolvable cut.
 *
 * Exported separately because the transport needs the number on every render and has no
 * reason to build the segment list to get it.
 */
export function episodeDuration(timeline: EpisodeTimeline | null): number {
  return timeline?.duration ?? 0;
}

/**
 * Resolve one episode time to a scene and its local time.
 *
 * Total, deterministic, and impossible to hang: the segment list is walked at most
 * once, and a missing or zero-length scene was already removed by the builder.
 *
 * Times outside the cut resolve as described at the top of this file: below zero
 * clamps to the first frame, at or past the end resolves to the last frame with
 * `ended: true`, and an empty cut resolves to the empty position.
 */
export function sceneAtTime(
  timeline: EpisodeTimeline | null,
  episodeTime: number,
): EpisodePosition {
  if (!timeline || timeline.segments.length === 0) {
    return { ...EMPTY_POSITION, duration: timeline?.duration ?? 0 };
  }

  // A NaN playhead would fail every comparison below and fall out of the loop as if it
  // were the end of the cut, which is a silent wrong answer rather than a loud one.
  const t = Number.isFinite(episodeTime) ? Math.max(0, episodeTime) : 0;
  const last = timeline.segments[timeline.segments.length - 1];
  // `last` is defined whenever segments is non-empty, which was just checked.
  if (!last) return { ...EMPTY_POSITION, duration: timeline.duration };

  const ended = t >= timeline.duration;

  if (ended) {
    // The final frame of the last scene, not a time past its end: handing the renderer
    // a time outside the scene would draw whatever clamping it does internally.
    return {
      scene: last.scene,
      sceneId: last.scene.id,
      index: last.index,
      offset: last.offset,
      sceneTime: last.duration,
      ended: true,
      duration: timeline.duration,
    };
  }

  for (const segment of timeline.segments) {
    if (t < segment.end) {
      return {
        scene: segment.scene,
        sceneId: segment.scene.id,
        index: segment.index,
        offset: segment.offset,
        sceneTime: t - segment.offset,
        ended: false,
        duration: timeline.duration,
      };
    }
  }

  // Unreachable: a time below the duration always lands in some segment. Kept so a
  // future change to the segment arithmetic cannot fall through with a hole.
  return { ...EMPTY_POSITION, duration: timeline.duration };
}

/**
 * The episode time at which a given scene starts, or 0 when it is not in the cut.
 *
 * Used by the store when the user picks a scene from the list: the transport then sits
 * at that scene's first frame rather than resetting the episode to 0.
 */
export function timeOfScene(timeline: EpisodeTimeline | null, sceneId: Id): number {
  return timeline?.segments.find((s) => s.scene.id === sceneId)?.offset ?? 0;
}

/**
 * A non-finite time, replaced with a usable one.
 *
 * Shared by the store's clock so "what does a NaN playhead do" is answered once. The
 * fallback is 0 — the first frame — because a scrub that cannot be read should show the
 * start of the cut, not an arbitrary frame somewhere in the middle.
 */
export function safeEpisodeTime(episodeTime: number, duration: number): number {
  if (!Number.isFinite(episodeTime)) return 0;
  if (episodeTime < 0) return 0;
  // Clamp to the end rather than letting the clock accumulate past it: the caller
  // decides whether the end wraps, and a value beyond the end would make "has the
  // episode finished" depend on how long the tab was backgrounded.
  return Math.min(episodeTime, Math.max(duration, 0));
}
