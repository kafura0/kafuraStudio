/**
 * EPISODE AUDIO PLAN — pure core.
 *
 * `audioPlan` returns windows on a *scene* timeline. The transport and the exporter both
 * need windows on an *episode* timeline, and that is an offset rather than a redesign
 * (spec §19.5):
 *
 *     episode time = sceneOffset[i] + sceneTime
 *
 * So this module calls `audioPlan` per scene and shifts each segment by the scene's
 * offset in the cut. It is the single place that does this: Phase 12's mixdown drives
 * its `OfflineAudioContext` from this function, which is why the offsets live here and
 * are not re-derived when export arrives.
 *
 * Nothing here plays anything. The engine in `audioEngine.browser.ts` remains the only
 * module that touches `AudioContext`.
 *
 * Takes both the project and the resolved `SceneContext`. The two answer different
 * questions and neither is a superset of the other: the project owns the cut and the scene
 * timings, the context owns the audio definitions. Since `Project` satisfies `SceneContext`
 * structurally, a single-argument version would compile while quietly planning an episode
 * against the project's own — normally empty — library.
 *
 * Two properties are worth stating because they are what a mixdown would silently get
 * wrong if they were not deliberate:
 *
 *  - Gain and `loop` are carried through untouched. An offset changes *when* a segment
 *    is heard, never how loud it is.
 *  - Segments are ordered by episode time after the shift, so a consumer can walk the
 *    list once instead of sorting per scene.
 */

import { audioPlan, type AudioSegment } from './audioPlan';
import { buildEpisodeTimeline, sceneAtTime, type EpisodePosition } from '../timeline/episode';
import type { Id, Project, SceneContext } from '../types';

export interface EpisodeAudioSegment extends AudioSegment {
  /** The scene this segment belongs to. */
  sceneId: Id;
  /** Episode time at which the sound starts. */
  episodeStart: number;
}

/** A segment plus the timing a consumer needs, without recomputing anything. */
export interface EpisodeAudioPlan {
  /** Episode time at which this position starts. */
  offset: number;
  /** Local time within the scene, for anything that addresses the scene's own clock. */
  sceneTime: number;
  ended: boolean;
  duration: number;
}

/**
 * Every audible window in the episode, in episode time.
 *
 * Empty for an unresolvable episode, and empty for a cut whose scenes declare no audio
 * — the seed project is exactly that case, since every slot has `src: null`. Silence
 * is the honest result there, not a failure.
 */
export function episodeAudioPlan(
  project: Project,
  context: SceneContext,
  episodeId: Id,
): EpisodeAudioSegment[] {
  const timeline = buildEpisodeTimeline(project, episodeId);
  if (!timeline) return [];

  const out: EpisodeAudioSegment[] = [];
  for (const segment of timeline.segments) {
    // The resolved context, not the project. The cut and the scene times come from the
    // project; the *assets* come from the library, which after Phase 14 lives on the series.
    // Passing `project` here would compile — `Project` satisfies `SceneContext` — and then
    // plan an episode with no audio at all, silently.
    for (const audio of audioPlan(context, segment.scene)) {
      out.push({
        ...audio,
        sceneId: segment.scene.id,
        episodeStart: segment.offset + audio.start,
      });
    }
  }

  // Clips are already ordered per scene and scenes are visited in cut order, so this is
  // normally a no-op. It is here because "sorted" is a property a mixdown depends on
  // and a sort that costs nothing is cheaper than discovering the assumption was wrong.
  return out.sort((a, b) => a.episodeStart - b.episodeStart || a.trackId.localeCompare(b.trackId));
}

/**
 * The position a given episode time resolves to, in the shape the audio channel wants.
 *
 * A thin adapter over `sceneAtTime` rather than a second resolution, so "which scene is
 * playing" has exactly one answer in the system.
 */
export function episodePositionAt(
  project: Project,
  episodeId: Id,
  episodeTime: number,
): EpisodePosition & EpisodeAudioPlan {
  const position = sceneAtTime(buildEpisodeTimeline(project, episodeId), episodeTime);
  return {
    ...position,
    offset: position.offset,
    sceneTime: position.sceneTime,
    ended: position.ended,
    duration: position.duration,
  };
}
