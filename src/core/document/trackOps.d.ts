/**
 * Timeline operations: tracks, clips, keyframes.
 *
 * Tracks, clips and keyframes use one uniform model for actors, props, camera,
 * dialogue and audio. That uniformity is why the timeline UI is written once.
 */
import type { Clip, EaseType, Id, Keyframe, KeyframeTarget, Project, Scene, Track, TrackKind } from '../types';
/** Default track label colours, keyed by kind. */
export declare const TRACK_COLORS: Record<TrackKind, string>;
export declare function findOrCreateTrack(scene: Scene, kind: TrackKind, targetId: Id, name: string): {
    scene: Scene;
    track: Track;
    created: boolean;
};
export declare function addTrack(project: Project, sceneId: Id, kind: TrackKind, targetId: Id, name: string): Project;
export declare function updateTrack(project: Project, sceneId: Id, trackId: Id, patch: Partial<Omit<Track, 'id' | 'kind' | 'targetId'>>): Project;
export declare function removeTrack(project: Project, sceneId: Id, trackId: Id): Project;
export declare function addClip(project: Project, sceneId: Id, trackId: Id, clip: Clip): Project;
export declare function addSimpleClip(project: Project, sceneId: Id, kind: TrackKind, targetId: Id, name: string, start: number, duration: number, extras?: {
    audioId?: string | null;
    dialogueLineId?: string | null;
    gain?: number;
}): Project;
export declare function removeClip(project: Project, sceneId: Id, trackId: Id, clipId: Id): Project;
/** Move a clip in time, keeping its duration. Snaps to nearby clip edges. */
export declare function moveClip(project: Project, sceneId: Id, trackId: Id, clipId: Id, start: number, options?: {
    snap?: boolean;
}): Project;
/** Trim a clip from either edge. At least `MIN_CLIP_DURATION` must remain. */
export declare const MIN_CLIP_DURATION: number;
export declare function trimClip(project: Project, sceneId: Id, trackId: Id, clipId: Id, edge: 'start' | 'end', time: number): Project;
export declare function setClipGain(project: Project, sceneId: Id, trackId: Id, clipId: Id, gain: number): Project;
export declare function addKeyframe(project: Project, sceneId: Id, trackId: Id, clipId: Id, time: number, props: KeyframeTarget, ease?: EaseType): Project;
export declare function updateKeyframe(project: Project, sceneId: Id, trackId: Id, clipId: Id, keyframeId: Id, patch: Partial<Omit<Keyframe, 'id'>>): Project;
export declare function removeKeyframe(project: Project, sceneId: Id, trackId: Id, clipId: Id, keyframeId: Id): Project;
export declare function moveKeyframe(project: Project, sceneId: Id, trackId: Id, clipId: Id, keyframeId: Id, time: number): Project;
/** Drop keyframes that the clip's duration no longer covers. */
export declare function pruneKeyframesToClip(project: Project, sceneId: Id, trackId: Id, clipId: Id): Project;
export declare function snapToEdges(time: number, edges: number[], _clipDuration?: number): number;
export declare function sortClips(clips: Clip[]): Clip[];
export declare function sortKeyframes(keyframes: Keyframe[]): Keyframe[];
export declare function findClipLocation(scene: Scene, clipId: Id): {
    trackId: Id;
    clip: Clip;
} | undefined;
export declare function findKeyframeLocation(scene: Scene, keyframeId: Id): {
    trackId: Id;
    clipId: Id;
    keyframe: Keyframe;
} | undefined;
