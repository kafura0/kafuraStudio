/**
 * Dialogue and audio operations.
 *
 * Design rule: **timing lives on the clip, content lives on the line.** A
 * DialogueLine has no start/duration; its Clip does. Dragging the clip moves the
 * line, and there is no second copy of the timing to fall out of sync.
 */
import type { AudioDef, Clip, DialogueLine, Id, Project } from '../types';
/**
 * Add a dialogue line AND its timing clip in a single mutation, so the two can
 * never be created independently and drift apart.
 *
 * Done as a pure scene-level transform, then lifted onto the project, so there is
 * exactly one code path and no partial-construction branch.
 */
export declare function addDialogueLineWithCue(project: Project, sceneId: Id, input: {
    speaker: string;
    text: string;
    actorId?: Id | null;
    emotion?: string;
    subtitle?: string | null;
    voiceAudioId?: Id | null;
    start: number;
    duration: number;
    trackName?: string;
}): {
    project: Project;
    lineId: Id;
    clipId: Id;
};
export declare function updateDialogueLine(project: Project, sceneId: Id, lineId: Id, patch: Partial<Omit<DialogueLine, 'id'>>): Project;
export declare function removeDialogueLine(project: Project, sceneId: Id, lineId: Id): Project;
/** Attach or swap the voice asset for a line, in one mutation. */
export declare function setDialogueVoice(project: Project, sceneId: Id, lineId: Id, audioId: Id | null): Project;
export declare function addAudioAsset(project: Project, audio: AudioDef): Project;
export declare function updateAudioAsset(project: Project, audioId: Id, patch: Partial<Omit<AudioDef, 'id'>>): Project;
export declare function removeAudioAsset(project: Project, audioId: Id): Project;
/** Place an audio asset on the timeline as an audio clip. */
export declare function placeAudioOnTimeline(project: Project, sceneId: Id, audio: AudioDef, start: number, duration?: number): Project;
/** The subtitle text for a line, falling back to the spoken text. */
export declare function subtitleFor(line: DialogueLine): string;
export declare function clipEnd(clip: Clip): number;
