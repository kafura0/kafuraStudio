/**
 * Timeline operations: tracks, clips, keyframes.
 *
 * Tracks, clips and keyframes use one uniform model for actors, props, camera,
 * dialogue and audio. That uniformity is why the timeline UI is written once.
 */

import { SNAP_THRESHOLD_SECONDS, quantizeToFrame } from '../constants';
import type {
  Clip,
  EaseType,
  Id,
  Keyframe,
  KeyframeTarget,
  Project,
  Scene,
  Track,
  TrackKind,
} from '../types';
import { createClip, createKeyframe, createTrack } from './factories';
import { mapScene } from './projectOps';

/** Default track label colours, keyed by kind. */
export const TRACK_COLORS: Record<TrackKind, string> = {
  actor: '#5b8cff',
  prop: '#7c6cff',
  camera: '#f0a13a',
  dialogue: '#38c793',
  audio: '#9aa4b8',
};

export function findOrCreateTrack(
  scene: Scene,
  kind: TrackKind,
  targetId: Id,
  name: string,
  options: { id?: Id } = {},
): { scene: Scene; track: Track; created: boolean } {
  const existing = scene.tracks.find((t) => t.kind === kind && t.targetId === targetId);
  if (existing) return { scene, track: existing, created: false };
  const track = createTrack(
    kind,
    targetId,
    name,
    TRACK_COLORS[kind],
    { ...(options.id !== undefined ? { id: options.id } : {}) },
  );
  return { scene: { ...scene, tracks: [...scene.tracks, track] }, track, created: true };
}

export function addTrack(
  project: Project,
  sceneId: Id,
  kind: TrackKind,
  targetId: Id,
  name: string,
): Project {
  return mapScene(project, sceneId, (scene) => findOrCreateTrack(scene, kind, targetId, name).scene);
}

export function updateTrack(
  project: Project,
  sceneId: Id,
  trackId: Id,
  patch: Partial<Omit<Track, 'id' | 'kind' | 'targetId'>>,
  now?: () => string,
): Project {
  return mapScene(
    project,
    sceneId,
    (scene) => ({
      ...scene,
      tracks: scene.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
    }),
    now,
  );
}

export function removeTrack(project: Project, sceneId: Id, trackId: Id, now?: () => string): Project {
  return mapScene(
    project,
    sceneId,
    (scene) => ({
      ...scene,
      tracks: scene.tracks.filter((t) => t.id !== trackId),
    }),
    now,
  );
}

/** Move a track to another position, keeping its order relative to the others. */
export function moveTrack(
  project: Project,
  sceneId: Id,
  trackId: Id,
  toIndex: number,
  now?: () => string,
): Project {
  const from = mapSceneLookup(project, sceneId, (scene) =>
    scene.tracks.findIndex((t) => t.id === trackId),
  );
  if (from === undefined || from < 0) return project;
  return mapScene(
    project,
    sceneId,
    (scene) => {
      const tracks = [...scene.tracks];
      const [track] = tracks.splice(from, 1);
      if (!track) return scene;
      const target = Math.max(0, Math.min(toIndex, tracks.length));
      tracks.splice(target, 0, track);
      return { ...scene, tracks };
    },
    now,
  );
}

/* ------------------------------------------------------------------ */
/* Clips                                                               */
/* ------------------------------------------------------------------ */

function mapClip(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  fn: (clip: Clip) => Clip,
  now?: () => string,
): Project {
  return mapScene(
    project,
    sceneId,
    (scene) => ({
      ...scene,
      tracks: scene.tracks.map((track) =>
        track.id !== trackId
          ? track
          : { ...track, clips: track.clips.map((clip) => (clip.id === clipId ? fn(clip) : clip)) },
      ),
    }),
    now,
  );
}

export function addClip(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clip: Clip,
): Project {
  return mapScene(project, sceneId, (scene) => ({
    ...scene,
    tracks: scene.tracks.map((track) =>
      track.id === trackId ? { ...track, clips: sortClips([...track.clips, clip]) } : track,
    ),
  }));
}

/**
 * Add a clip, creating its track if one does not already exist for this target.
 * Returns the ids needed to keep editing the clip.
 */
/** Options threaded through clip-adding so command folds stay deterministic (§8.3). */
export interface AddClipOptions {
  trackId?: Id;
  clipId?: Id;
  clock?: () => string;
}

export function addSimpleClip(
  project: Project,
  sceneId: Id,
  kind: TrackKind,
  targetId: Id,
  name: string,
  start: number,
  duration: number,
  extras: { audioId?: string | null; dialogueLineId?: string | null; gain?: number } = {},
  options: AddClipOptions = {},
): { project: Project; trackId: Id; clipId: Id } {
  const clip = createClip(start, duration, {
    ...extras,
    ...(options.clipId !== undefined ? { id: options.clipId } : {}),
  });

  const next = mapScene(
    project,
    sceneId,
    (scene) => {
      const { scene: withTrack, track } = findOrCreateTrack(scene, kind, targetId, name, {
        ...(options.trackId !== undefined ? { id: options.trackId } : {}),
      });
      return {
        ...withTrack,
        tracks: withTrack.tracks.map((t) =>
          t.id === track.id ? { ...t, clips: sortClips([...t.clips, clip]) } : t,
        ),
      };
    },
    options.clock,
  );

  const trackId = trackIdFor(next, sceneId, kind, targetId);
  return { project: next, trackId, clipId: clip.id };
}

/** The id of the track driving a target, or '' if it does not exist. */
function trackIdFor(project: Project, sceneId: Id, kind: TrackKind, targetId: Id): Id {
  const track = mapSceneLookup(project, sceneId, (scene) =>
    scene.tracks.find((t) => t.kind === kind && t.targetId === targetId),
  );
  return track?.id ?? '';
}

function mapSceneLookup<T>(project: Project, sceneId: Id, fn: (scene: Scene) => T | undefined): T | undefined {
  for (const scene of project.scenes) {
    if (scene.id === sceneId) return fn(scene);
  }
  return undefined;
}

export function removeClip(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  now?: () => string,
): Project {
  return mapScene(
    project,
    sceneId,
    (scene) => ({
      ...scene,
      // A track emptied of clips disappears with the clip, the same rule `removeDialogueLine`
      // already follows: an empty lane is noise the user cannot act on anyway.
      tracks: scene.tracks.flatMap((track) => {
        if (track.id !== trackId) return [track];
        const clips = track.clips.filter((c) => c.id !== clipId);
        return clips.length > 0 ? [{ ...track, clips }] : [];
      }),
    }),
    now,
  );
}

/** Move a clip onto another track of the same kind (e.g. dialogue -> dialogue). */
export function relocateClip(
  project: Project,
  sceneId: Id,
  fromTrackId: Id,
  toTrackId: Id,
  clipId: Id,
  now?: () => string,
): Project {
  if (fromTrackId === toTrackId) return project;
  const kinds = mapSceneLookup(project, sceneId, (scene) => {
    const from = scene.tracks.find((t) => t.id === fromTrackId);
    const to = scene.tracks.find((t) => t.id === toTrackId);
    if (!from || !to) return null;
    return { fromKind: from.kind, toKind: to.kind };
  });
  // No-op and refusal branches keep the caller's object identity, so the drag that
  // landed nowhere does not burn an undo step.
  if (!kinds || kinds.fromKind !== kinds.toKind) return project;
  return mapScene(
    project,
    sceneId,
    (scene) => {
      const from = scene.tracks.find((t) => t.id === fromTrackId);
      const to = scene.tracks.find((t) => t.id === toTrackId);
      if (!from || !to) return scene;
      const clip = from.clips.find((c) => c.id === clipId);
      if (!clip) return scene;

      const withoutClip = from.clips.filter((c) => c.id !== clipId);
      return {
        ...scene,
        tracks: scene.tracks.flatMap((track) => {
          if (track.id === fromTrackId) {
            // Same rule as removeClip: a source emptied of clips disappears.
            return withoutClip.length > 0 ? [{ ...track, clips: withoutClip }] : [];
          }
          if (track.id === toTrackId) {
            return [{ ...track, clips: sortClips([...track.clips, clip]) }];
          }
          return [track];
        }),
      };
    },
    now,
  );
}

/** Move a clip in time, keeping its duration. Snaps to nearby clip edges. */
export function moveClip(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  start: number,
  options: { snap?: boolean } = {},
  now?: () => string,
): Project {
  return mapScene(
    project,
    sceneId,
    (scene) => {
    const track = scene.tracks.find((t) => t.id === trackId);
    if (!track) return scene;
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip) return scene;

    const others = scene.tracks
      .filter((t) => t.kind === track.kind)
      .flatMap((t) => t.clips)
      .filter((c) => c.id !== clipId);

    const edges: number[] = [0];
    for (const other of others) {
      edges.push(other.start, other.start + other.duration);
    }
    const end = clip.start + clip.duration;
    edges.push(end);

    const resolved = options.snap === false ? start : snapToEdges(start, edges, end - clip.start);
    const clamped = Math.max(0, resolved);

    return {
      ...scene,
      tracks: scene.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: sortClips(
                t.clips.map((c) => {
                  if (c.id !== clipId) return c;
                  // The clip's keyframes are piece of its content, exactly as an
                  // animation sits inside the clip and not on the wall behind it. A
                  // start-trim already shifts them; a move must not strand them at the
                  // old absolute times, or sliding the clip silently drops every frame
                  // of movement it was carrying.
                  const shift = clamped - clip.start;
                  return {
                    ...c,
                    start: clamped,
                    keyframes: c.keyframes.map((kf) => ({ ...kf, time: kf.time + shift })),
                  };
                }),
              ),
            }
          : t,
      ),
    };
    },
    now,
  );
}

/** Trim a clip from either edge. At least `MIN_CLIP_DURATION` must remain. */
export const MIN_CLIP_DURATION = 1 / 60;

export function trimClip(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  edge: 'start' | 'end',
  time: number,
  now?: () => string,
): Project {
  return mapClip(project, sceneId, trackId, clipId, (clip) => {
    if (edge === 'start') {
      const end = clip.start + clip.duration;
      const nextStart = Math.min(Math.max(0, time), end - MIN_CLIP_DURATION);
      const shift = nextStart - clip.start;
      return {
        ...clip,
        start: nextStart,
        duration: clip.duration - shift,
        keyframes: clip.keyframes.map((kf) => ({ ...kf, time: kf.time + shift })),
      };
    }
    const nextEnd = Math.max(clip.start + MIN_CLIP_DURATION, time);
    return {
      ...clip,
      duration: nextEnd - clip.start,
      // A start trim slides keyframes with the content; an end trim cuts content,
      // so a keyframe past the cut no longer animates anything and must go with it.
      // Leaving it in the document would make the clip's invisible edge eager to
      // surprise someone later: it would come back the moment the clip is stretched.
      keyframes: clip.keyframes.filter((kf) => kf.time <= nextEnd),
    };
  }, now);
}

export function setClipGain(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  gain: number,
  now?: () => string,
): Project {
  return mapClip(
    project,
    sceneId,
    trackId,
    clipId,
    (clip) => ({
      ...clip,
      gain: Math.max(0, Math.min(2, gain)),
    }),
    now,
  );
}

/* ------------------------------------------------------------------ */
/* Keyframes                                                           */
/* ------------------------------------------------------------------ */

export function addKeyframe(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  time: number,
  props: KeyframeTarget,
  ease: EaseType = 'linear',
  options: { keyframeId?: Id; clock?: () => string } = {},
): Project {
  return mapClip(project, sceneId, trackId, clipId, (clip) => {
    const existing = clip.keyframes.find((kf) => Math.abs(kf.time - time) < 1e-6);
    if (existing) {
      return {
        ...clip,
        keyframes: sortKeyframes(
          clip.keyframes.map((kf) => (kf.id === existing.id ? { ...kf, props, ease } : kf)),
        ),
      };
    }
    return {
      ...clip,
      keyframes: sortKeyframes([
        ...clip.keyframes,
        createKeyframe(time, props, ease, {
          ...(options.keyframeId !== undefined ? { id: options.keyframeId } : {}),
        }),
      ]),
    };
  }, options.clock);
}

export function updateKeyframe(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  keyframeId: Id,
  patch: Partial<Omit<Keyframe, 'id'>>,
): Project {
  return mapClip(project, sceneId, trackId, clipId, (clip) => ({
    ...clip,
    keyframes: sortKeyframes(
      clip.keyframes.map((kf) => (kf.id === keyframeId ? { ...kf, ...patch } : kf)),
    ),
  }));
}

export function removeKeyframe(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  keyframeId: Id,
  now?: () => string,
): Project {
  return mapClip(
    project,
    sceneId,
    trackId,
    clipId,
    (clip) => ({
      ...clip,
      keyframes: clip.keyframes.filter((kf) => kf.id !== keyframeId),
    }),
    now,
  );
}

export function moveKeyframe(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  keyframeId: Id,
  time: number,
  now?: () => string,
): Project {
  return mapClip(
    project,
    sceneId,
    trackId,
    clipId,
    (clip) => {
      const clipEnd = clip.start + clip.duration;
      const clamped = Math.max(clip.start, Math.min(quantizeToFrame(time), clipEnd));
      return {
        ...clip,
        keyframes: sortKeyframes(
          clip.keyframes.map((kf) => (kf.id === keyframeId ? { ...kf, time: clamped } : kf)),
        ),
      };
    },
    now,
  );
}

/** Drop keyframes that the clip's duration no longer covers. */
export function pruneKeyframesToClip(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  now?: () => string,
): Project {
  return mapClip(
    project,
    sceneId,
    trackId,
    clipId,
    (clip) => {
      const end = clip.start + clip.duration;
      return {
        ...clip,
        keyframes: clip.keyframes.filter((kf) => kf.time >= clip.start && kf.time <= end),
      };
    },
    now,
  );
}

/* ------------------------------------------------------------------ */
/* Snapping                                                            */
/* ------------------------------------------------------------------ */

export function snapToEdges(time: number, edges: number[], _clipDuration = 0): number {
  let best = time;
  let bestDistance = SNAP_THRESHOLD_SECONDS;
  for (const edge of edges) {
    const distance = Math.abs(edge - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = edge;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

export function sortKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.time - b.time);
}

export function findClipLocation(
  scene: Scene,
  clipId: Id,
): { trackId: Id; clip: Clip } | undefined {
  for (const track of scene.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { trackId: track.id, clip };
  }
  return undefined;
}

export function findKeyframeLocation(
  scene: Scene,
  keyframeId: Id,
): { trackId: Id; clipId: Id; keyframe: Keyframe } | undefined {
  for (const track of scene.tracks) {
    for (const clip of track.clips) {
      const keyframe = clip.keyframes.find((kf) => kf.id === keyframeId);
      if (keyframe) return { trackId: track.id, clipId: clip.id, keyframe };
    }
  }
  return undefined;
}
