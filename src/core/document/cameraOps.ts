/**
 * Camera authoring.
 *
 * The camera was already a first-class part of the document — `Scene.camera` is the
 * rest framing, and the `camera` track's clips carry keyframes that override it during
 * playback. What was missing was any way to author either. This module is that way.
 *
 * Two rules shape everything here.
 *
 * **One gesture, one document, one undo step.** `applyCameraPreset` and
 * `frameSelection` each change several things at once — rest framing, or a rest
 * framing *and* a clip *and* a keyframe. They are composed internally into a single
 * pure operation so the caller still has exactly one thing to `commit()`. Splitting
 * them into three commits would make undo take three presses to un-take a shot, which
 * is the kind of papercut a production tool cannot afford.
 *
 * **The camera rides the transform it already has.** `resolveCamera` samples a
 * keyframe's `x`, `y` and `scaleX` (`sample.ts`), so a camera keyframe is written with
 * the zoom in `scaleX` and the camera track has no keyframe of its own. This module
 * does not change that; it is the existing contract, and renaming `scaleX` to `zoom`
 * would be a schema migration for no behavioural gain.
 */

import { frameBounds, type FrameOptions, type FrameSubject } from '../animation/frame';
import { addKeyframe, addSimpleClip, sortClips } from './trackOps';
import { findCharacter, sceneEnvironment, requireScene } from './lookups';
import { mapScene } from './projectOps';
import type { Camera, CameraPreset, Id, KeyframeTarget, Project, Scene } from '../types';

/** The track target every camera clip hangs off. There is one camera per scene. */
export const CAMERA_TARGET_ID = 'camera';

export const CAMERA_TRACK_NAME = 'Camera';

/* ------------------------------------------------------------------ */
/* Rest framing                                                        */
/* ------------------------------------------------------------------ */

export interface CameraPatch {
  x?: number;
  y?: number;
  zoom?: number;
  rotation?: number;
}

/**
 * Nudge the rest framing. One field, one undo step.
 *
 * A patch that would not change anything returns the project untouched, so a blur
 * after a stray keystroke does not fill the undo stack with a no-op.
 */
export function setSceneCamera(
  project: Project,
  sceneId: Id,
  patch: CameraPatch,
): Project {
  const scene = requireScene(project, sceneId);
  const next: Camera = {
    x: patch.x ?? scene.camera.x,
    y: patch.y ?? scene.camera.y,
    zoom: patch.zoom ?? scene.camera.zoom,
    rotation: patch.rotation ?? scene.camera.rotation,
  };
  // Checked before mapping, because `mapScene` always produces a new project and
  // touches `updatedAt`. A no-op blur after a stray keystroke would otherwise land an
  // identical document in the undo stack, and the next undo press would appear to do
  // nothing.
  if (sameCamera(scene.camera, next)) return project;
  return mapScene(project, sceneId, (s) => ({ ...s, camera: next }));
}

/* ------------------------------------------------------------------ */
/* Camera moves                                                        */
/* ------------------------------------------------------------------ */

/** A camera move as a single clip with a single keyframe. */
export interface CameraMoveHandle {
  trackId: Id;
  clipId: Id;
  keyframeId: Id;
}

/**
 * Lay a camera move over a span of the scene, holding `camera` throughout.
 *
 * One keyframe is enough: `sampleKeyframes` clamps outside a keyframe's neighbours, so
 * a single keyframe is a still hold. This is the "cut here" move — the user drags the
 * rest framing or picks a preset, and the timeline gets a clip that can be trimmed,
 * cut, or replaced with real keyframes later.
 */
export function addCameraMove(
  project: Project,
  sceneId: Id,
  camera: Camera,
  span?: { start: number; duration: number },
): { project: Project; handle: CameraMoveHandle } {
  const scene = requireScene(project, sceneId);
  const start = span?.start ?? 0;
  const duration = Math.max(0.001, span?.duration ?? scene.duration);

  const { project: withClip, trackId, clipId } = addSimpleClip(
    project,
    sceneId,
    'camera',
    CAMERA_TARGET_ID,
    CAMERA_TRACK_NAME,
    start,
    duration,
  );

  const withKeyframe = addKeyframe(
    withClip,
    sceneId,
    trackId,
    clipId,
    start,
    cameraKeyframeProps(camera),
  );

  return {
    project: withKeyframe,
    handle: { trackId, clipId, keyframeId: keyframeAt(withKeyframe, sceneId, trackId, clipId, start) },
  };
}

/** The camera clip the playhead is inside, or `null` outside any clip. */
export function cameraClipAt(scene: Scene, time: number) {
  for (const track of scene.tracks) {
    if (track.kind !== 'camera') continue;
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clip.duration) return { track, clip };
    }
  }
  return null;
}

/** Every camera clip in the scene, timeline order. */
export function cameraClips(scene: Scene) {
  return scene.tracks
    .filter((track) => track.kind === 'camera')
    .flatMap((track) => sortClips(track.clips).map((clip) => ({ track, clip })));
}

/** Drop every camera clip, returning to the rest framing. The track itself stays. */
export function clearCameraMoves(project: Project, sceneId: Id): Project {
  const scene = requireScene(project, sceneId);
  if (cameraClips(scene).length === 0) return project;
  return mapScene(project, sceneId, (s) => ({
    ...s,
    tracks: s.tracks.map((track) =>
      track.kind === 'camera' ? { ...track, clips: [] } : track,
    ),
  }));
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

/**
 * Adopt a preset: its camera becomes the scene's rest framing, and a camera move
 * pinning it is laid over the whole scene.
 *
 * The clip is deliberate. Without it the framing is invisible on the timeline, and a
 * shot the user cannot see or cut is a shot they will re-derive by eye. The existing
 * clips are replaced rather than merged, because a preset is a statement about the
 * whole shot, not an increment on whatever happened to be there.
 */
export function applyCameraPreset(project: Project, sceneId: Id, preset: CameraPreset): Project {
  return applyFraming(project, sceneId, preset.camera);
}

/**
 * Set the rest framing and hold it across the scene as a single camera move.
 *
 * Shared by the preset path and `frameSelection`, which differ only in how they arrive
 * at a `Camera`. Both are one document, so both undo in one step.
 */
export function applyFraming(project: Project, sceneId: Id, camera: Camera): Project {
  const scene = requireScene(project, sceneId);
  const start = scene.tracks.some((t) => t.kind === 'camera') ? firstCameraStart(scene) : 0;

  const withRest = setSceneCamera(project, sceneId, camera);
  const cleared = clearCameraMoves(withRest, sceneId);
  const { project: withMove } = addCameraMove(cleared, sceneId, camera, {
    start,
    duration: scene.duration - start,
  });
  return withMove;
}

/* ------------------------------------------------------------------ */
/* Frame the selection                                                 */
/* ------------------------------------------------------------------ */

/**
 * Frame actors so they all fit the environment.
 *
 * The `SceneActor` shape satisfies `FrameSubject` apart from `height`, which lives on
 * the character. A missing character is skipped rather than framed at zero size: a
 * zero-height box is not a subject, and including one would silently shrink the shot
 * to nothing.
 */
export function frameSelection(
  project: Project,
  sceneId: Id,
  actorIds: Id[],
  options: FrameOptions,
): Project {
  const scene = requireScene(project, sceneId);
  const wanted = new Set(actorIds);
  const subjects: FrameSubject[] = [];

  for (const actor of scene.actors) {
    if (!wanted.has(actor.id)) continue;
    // Through the lookup, not a direct index: `assets.characters` is an array, so
    // indexing it by id yields undefined and every subject would be silently skipped.
    const character = findCharacter(project, actor.characterId);
    if (!character || !Number.isFinite(character.height)) continue;
    subjects.push({ transform: actor.transform, height: character.height });
  }

  if (subjects.length === 0) return project;

  const environment = sceneEnvironment(project, scene);
  const frame = environment
    ? { width: environment.width, height: environment.height }
    : options.frame;

  return applyFraming(
    project,
    sceneId,
    frameBounds(subjects, { ...options, frame, rotation: scene.camera.rotation }),
  );
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

/**
 * The camera is a `Transform2D` to the sampler, so a camera keyframe is written with
 * the zoom in `scaleX`. See the module note.
 */
function cameraKeyframeProps(camera: Camera): KeyframeTarget {
  return { x: camera.x, y: camera.y, scaleX: camera.zoom };
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom && a.rotation === b.rotation;
}

/** The earliest existing camera clip start, so a replace does not jump back to 0. */
function firstCameraStart(scene: Scene): number {
  let start = Number.POSITIVE_INFINITY;
  for (const { clip } of cameraClips(scene)) start = Math.min(start, clip.start);
  return Number.isFinite(start) ? start : 0;
}

function keyframeAt(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  time: number,
): Id {
  const scene = requireScene(project, sceneId);
  const track = scene.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  const keyframe = clip?.keyframes.find((kf) => Math.abs(kf.time - time) < 1e-6);
  if (!keyframe) throw new Error(`camera move keyframe missing at ${time}s in ${clipId}`);
  return keyframe.id;
}
