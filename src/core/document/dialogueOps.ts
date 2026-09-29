/**
 * Dialogue and audio operations.
 *
 * Design rule: **timing lives on the clip, content lives on the line.** A
 * DialogueLine has no start/duration; its Clip does. Dragging the clip moves the
 * line, and there is no second copy of the timing to fall out of sync.
 */

import { createId, ID_PREFIX } from '../id';
import type { AudioDef, Clip, DialogueLine, Id, Project, Scene } from '../types';
import { createDialogueLine } from './factories';
import { mapScene } from './projectOps';
import {
  MIN_CLIP_DURATION,
  addSimpleClip,
  findOrCreateTrack,
  moveClip,
  sortClips,
  trimClip,
} from './trackOps';

/* ------------------------------------------------------------------ */
/* Dialogue lines                                                      */
/* ------------------------------------------------------------------ */

/**
 * Add a dialogue line AND its timing clip in a single mutation, so the two can
 * never be created independently and drift apart.
 *
 * Done as a pure scene-level transform, then lifted onto the project, so there is
 * exactly one code path and no partial-construction branch.
 */
export function addDialogueLineWithCue(
  project: Project,
  sceneId: Id,
  input: {
    speaker: string;
    text: string;
    actorId?: Id | null;
    emotion?: string;
    subtitle?: string | null;
    voiceAudioId?: Id | null;
    start: number;
    duration: number;
    trackName?: string;
  },
): { project: Project; lineId: Id; clipId: Id } {
  const line: DialogueLine = {
    ...createDialogueLine(input.speaker, input.text, input.actorId ?? null),
    emotion: input.emotion ?? 'neutral',
    voiceAudioId: input.voiceAudioId ?? null,
    subtitle: input.subtitle ?? null,
  };

  const clip: Clip = {
    id: createId(ID_PREFIX.clip),
    start: input.start,
    duration: input.duration,
    keyframes: [],
    audioId: input.voiceAudioId ?? null,
    dialogueLineId: line.id,
    gain: 1,
  };

  const next = mapScene(project, sceneId, (scene) => {
    const withLine: Scene = { ...scene, dialogue: [...scene.dialogue, line] };
    const trackName = input.trackName ?? `Dialogue — ${input.speaker}`;
    const { scene: withTrack, track } = findOrCreateTrack(withLine, 'dialogue', line.id, trackName);
    // Append to the track that was just resolved, and to no other. Each line owns a
    // track keyed by its own id, so broadcasting the clip put every line's cue on
    // every other line's track and the scene rendered each subtitle once per track.
    return {
      ...withTrack,
      tracks: withTrack.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: sortClips([...t.clips, clip]) } : t,
      ),
    };
  });

  return { project: next, lineId: line.id, clipId: clip.id };
}

export function updateDialogueLine(
  project: Project,
  sceneId: Id,
  lineId: Id,
  patch: Partial<Omit<DialogueLine, 'id'>>,
): Project {
  return mapScene(project, sceneId, (scene) => ({
    ...scene,
    dialogue: scene.dialogue.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
  }));
}

/**
 * Delete a line, its timing clip, and the track that existed only to hold that clip.
 *
 * `addDialogueLineWithCue` keys each line's track by the line id, so a scene has one
 * dialogue track per line. Cleaning only the first dialogue track would orphan the
 * clip and leave an empty track behind, which `validateProject` reports as an error.
 */
export function removeDialogueLine(project: Project, sceneId: Id, lineId: Id): Project {
  return mapScene(project, sceneId, (scene) => {
    const remaining = scene.dialogue.filter((line) => line.id !== lineId);
    const withoutLine: Scene = { ...scene, dialogue: remaining };

    const tracks = withoutLine.tracks
      .map((track) =>
        track.kind === 'dialogue'
          ? { ...track, clips: track.clips.filter((c) => c.dialogueLineId !== lineId) }
          : track,
      )
      .filter((track) => !(track.kind === 'dialogue' && track.clips.length === 0));

    return { ...withoutLine, tracks };
  });
}

/**
 * Re-time a line's cue, in one mutation, by line id.
 *
 * Timing lives on the clip, so re-timing a line means finding the clip that carries it.
 * The editor knows the *line* — that is what gets selected — and making the panel
 * search the tracks for the lane would put document structure in the UI. This resolves
 * the cue here and routes through the same `moveClip` / `trimClip` the timeline drags
 * use, so a number typed into the panel and a drag of that clip are the same edit.
 *
 * Snapping is off. `moveClip` snaps to neighbouring clip edges because a pointer drag
 * wants that; a number the user typed is exact, and silently moving it 0.4s to a
 * neighbour's edge would be a lie about what they asked for.
 *
 * A line with no cue, or a cue already sitting at the requested window, returns the
 * same project object, so a no-op edit burns no undo step.
 */
export function setDialogueCue(
  project: Project,
  sceneId: Id,
  lineId: Id,
  cue: { start?: number; duration?: number },
): Project {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return project;

  let trackId: Id | null = null;
  let clip: Clip | null = null;
  for (const track of scene.tracks) {
    const found = track.clips.find((c) => c.dialogueLineId === lineId);
    if (found) {
      trackId = track.id;
      clip = found;
      break;
    }
  }
  if (!trackId || !clip) return project;

  const start = cue.start === undefined ? clip.start : Math.max(0, cue.start);
  const duration = cue.duration === undefined ? clip.duration : Math.max(MIN_CLIP_DURATION, cue.duration);

  let next = project;
  if (Math.abs(start - clip.start) > 1e-6) {
    next = moveClip(next, sceneId, trackId, clip.id, start, { snap: false });
  }
  if (Math.abs(duration - clip.duration) > 1e-6) {
    next = trimClip(next, sceneId, trackId, clip.id, 'end', start + duration);
  }
  return next;
}

/** Attach or swap the voice asset for a line, in one mutation. */
export function setDialogueVoice(
  project: Project,
  sceneId: Id,
  lineId: Id,
  audioId: Id | null,
): Project {
  let result = updateDialogueLine(project, sceneId, lineId, { voiceAudioId: audioId });
  result = mapScene(result, sceneId, (scene) => ({
    ...scene,
    tracks: scene.tracks.map((track) =>
      track.kind !== 'dialogue'
        ? track
        : {
            ...track,
            clips: track.clips.map((clip) =>
              clip.dialogueLineId === lineId ? { ...clip, audioId } : clip,
            ),
          },
    ),
  }));
  return result;
}

/* ------------------------------------------------------------------ */
/* Audio assets                                                        */
/* ------------------------------------------------------------------ */

export function addAudioAsset(project: Project, audio: AudioDef): Project {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    assets: { ...project.assets, audio: [...project.assets.audio, audio] },
  };
}

export function updateAudioAsset(
  project: Project,
  audioId: Id,
  patch: Partial<Omit<AudioDef, 'id'>>,
): Project {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    assets: {
      ...project.assets,
      audio: project.assets.audio.map((a) => (a.id === audioId ? { ...a, ...patch } : a)),
    },
  };
}

export function removeAudioAsset(project: Project, audioId: Id): Project {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    assets: {
      ...project.assets,
      audio: project.assets.audio.filter((a) => a.id !== audioId),
    },
  };
}

/** Place an audio asset on the timeline as an audio clip. */
export function placeAudioOnTimeline(
  project: Project,
  sceneId: Id,
  audio: AudioDef,
  start: number,
  duration?: number,
): Project {
  const { project: next } = addSimpleClip(
    project,
    sceneId,
    'audio',
    audio.id,
    `${audio.name} (${audio.kind})`,
    start,
    duration ?? audio.duration,
    { audioId: audio.id },
  );
  return next;
}

/* ------------------------------------------------------------------ */
/* Derived                                                             */
/* ------------------------------------------------------------------ */

/** The subtitle text for a line, falling back to the spoken text. */
export function subtitleFor(line: DialogueLine): string {
  return line.subtitle ?? line.text;
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}
