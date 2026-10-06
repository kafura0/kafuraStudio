/**
 * What the mixdown will place, decided without touching Web Audio.
 *
 * The placement half of Phase 12's step 5, split out because it is the half that can be
 * wrong in a way nobody hears: if a segment is scheduled on the scene clock instead of the
 * episode clock, the file renders, plays, and is a scene out of time for every scene after
 * the first. That defect is invisible in a test that only checks the file exists.
 *
 * So the decision — which segments, at which episode time, at what gain, looping or not —
 * is made here, purely, and `mixdown.browser.ts` only executes it. The renderer cannot
 * reinterpret these; it places what it is given.
 *
 * Gain and `loop` are carried through untouched. An offset changes *when* a sound is
 * heard, never how loud or how it repeats.
 */

import { episodeAudioPlan, type EpisodeAudioSegment } from '../audio/episodePlan';
import { exportTimeline } from './resolveFrame';
import type { Id, Project, SceneContext } from '../types';

/** Where a sound sits in the mix, and how it is played. */
export interface MixdownPlacement {
  audioId: Id;
  /** Episode time the source starts, in seconds. */
  start: number;
  /**
   * How long a one-shot plays, in seconds.
   *
   * `null` for a loop, which is deliberately unbounded: the asset repeats until the window
   * it was asked to fill is over. Truncating a loop at one pass would turn a 10s ambience
   * bed into a 2s one and leave the rest of the scene silent.
   */
  duration: number | null;
  /** Linear gain, straight from the clip. */
  gain: number;
  loop: boolean;
  /** Seconds the source's own buffer must be at least, for a loop to avoid a stutter. */
  minimumAssetDuration: number;
  sceneId: Id;
}

export interface MixdownPlan {
  /** Total length of the mix in seconds, which is the episode's duration. */
  duration: number;
  /** Placements in episode-time order, exactly as `episodeAudioPlan` ordered them. */
  placements: MixdownPlacement[];
}

/**
 * Decide the mixdown for an episode.
 *
 * Returns `null` for an episode not in the document, and a zero-length plan for a cut with
 * no playable scenes — which is a real answer (a silent episode), not a failure.
 */
/**
 * The pure projection of the mixdown: what goes where, in episode time.
 *
 * Takes the project *and* the resolved context, for the reason given in `episodeAudioPlan`:
 * the project has the cut, the context has the audio definitions, and only one of them is
 * right about either. Accepting just the project would compile and plan silence.
 */
export function mixdownPlan(
  project: Project,
  context: SceneContext,
  episodeId: Id,
): MixdownPlan | null {
  const timeline = exportTimeline(project, episodeId);
  if (!timeline) return null;

  return {
    duration: timeline.duration,
    placements: episodeAudioPlan(project, context, episodeId).map(toPlacement),
  };
}

function toPlacement(segment: EpisodeAudioSegment): MixdownPlacement {
  return {
    audioId: segment.audioId,
    start: segment.episodeStart,
    duration: segment.loop ? null : segment.duration,
    gain: segment.gain,
    loop: segment.loop,
    minimumAssetDuration: segment.duration,
    sceneId: segment.sceneId,
  };
}
