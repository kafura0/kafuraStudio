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
import { addSimpleClip, findOrCreateTrack, sortClips } from './trackOps';

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
    const { scene: withTrack } = findOrCreateTrack(withLine, 'dialogue', line.id, trackName);
    return {
      ...withTrack,
      tracks: withTrack.tracks.map((track) =>
        track.clips.some((c) => c.dialogueLineId === line.id)
          ? track
          : { ...track, clips: sortClips([...track.clips, clip]) },
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

export function removeDialogueLine(project: Project, sceneId: Id, lineId: Id): Project {
  return mapScene(project, sceneId, (scene) => {
    const track = scene.tracks.find((t) => t.kind === 'dialogue');
    const withoutLine = {
      ...scene,
      dialogue: scene.dialogue.filter((line) => line.id !== lineId),
    };
    if (!track) return withoutLine;
    return {
      ...withoutLine,
      tracks: withoutLine.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: t.clips.filter((c) => c.dialogueLineId !== lineId) } : t,
      ),
    };
  });
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
