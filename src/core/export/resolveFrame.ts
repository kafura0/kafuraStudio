/**
 * Resolving an export time to a scene and a local time.
 *
 * The pure half of a frame export, and the part worth testing hardest. The browser half
 * in `exportImages.browser.ts` turns this into PNG bytes; this decides *what* each frame
 * shows, and does it with no canvas involved so it can be checked in a plain unit test.
 *
 * The resolution itself is not new arithmetic: it is `sceneAtTime` from the episode
 * transport, called the same way the stage calls it. That is deliberate. An exporter that
 * worked out for itself which scene a frame belongs to would be a second implementation
 * of the cut, and the one defect that matters most in an export is a frame drawn from the
 * wrong scene, at a time that looks plausible enough to pass inspection.
 */

import { sceneAtTime, flattenCut, type EpisodeTimeline } from '../timeline/episode';
import type { Id, Project, Scene } from '../types';

/** A frame, resolved but not yet rasterised. */
export interface ResolvedFrame {
  /** Position in the sequence, from `frameSequence`. */
  index: number;
  /** Episode time the frame was sampled at, in seconds. */
  time: number;
  /** The scene that owns this instant, resolved from the cut. */
  scene: Scene;
  /** Time local to `scene`, which is what `renderScene` takes. */
  sceneTime: number;
  /** The flattened cut this came from, so a caller drawing many frames need not re-flatten. */
  timeline: EpisodeTimeline;
}

/**
 * The cut for an episode, or `null` if the episode is not in the document.
 *
 * Exported because exporting many frames should flatten the cut once, not once per frame.
 */
export function exportTimeline(project: Project, episodeId: Id): EpisodeTimeline | null {
  const episode = project.episodes.find((e) => e.id === episodeId);
  if (!episode) return null;
  return flattenCut(project, episode);
}

/** Resolve one frame of an episode to a scene and a scene-local time. */
export function resolveExportFrame(
  project: Project,
  timeline: EpisodeTimeline,
  index: number,
  time: number,
): ResolvedFrame {
  const position = sceneAtTime(timeline, time);
  return {
    index,
    time,
    scene: position.scene,
    sceneTime: position.sceneTime,
    timeline,
  };
}
