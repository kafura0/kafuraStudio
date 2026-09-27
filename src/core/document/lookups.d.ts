/**
 * Read-only lookups over the project.
 *
 * These run in the render hot path, so they are written as plain scans over small
 * arrays rather than building indexes. An MVP project holds tens of scenes and
 * hundreds of assets; a Map index would cost more to maintain than it saves.
 */
import type { AudioDef, CharacterDef, Clip, DialogueLine, EnvironmentDef, ExpressionDef, Id, PoseDef, PropDef, Project, Scene, SceneActor, SceneProp, Track, TrackKind } from '../types';
export declare function findScene(project: Project, sceneId: Id): Scene | undefined;
export declare function requireScene(project: Project, sceneId: Id): Scene;
export declare function findActor(scene: Scene, actorId: Id): SceneActor | undefined;
export declare function requireActor(scene: Scene, actorId: Id): SceneActor;
export declare function findSceneProp(scene: Scene, propId: Id): SceneProp | undefined;
export declare function findCharacter(project: Project, id: Id): CharacterDef | undefined;
export declare function findEnvironment(project: Project, id: Id): EnvironmentDef | undefined;
export declare function findPose(project: Project, id: Id): PoseDef | undefined;
export declare function findExpression(project: Project, id: Id): ExpressionDef | undefined;
export declare function findPropDef(project: Project, id: Id): PropDef | undefined;
export declare function findAudioDef(project: Project, id: Id): AudioDef | undefined;
export declare function findDialogueLine(scene: Scene, id: Id): DialogueLine | undefined;
export declare function findTrack(scene: Scene, id: Id): Track | undefined;
export declare function requireTrack(scene: Scene, id: Id): Track;
export declare function requireClip(track: Track, clipId: Id): Clip;
export declare function findEpisode(project: Project, id: Id): import("../types").Episode | undefined;
export declare function requireEpisode(project: Project, id: Id): import("../types").Episode;
/** All clips on a scene, paired with the track that owns them. */
export declare function allClips(scene: Scene): {
    track: Track;
    clip: Clip;
}[];
/** Clips whose [start, start + duration) window contains `time`. */
export declare function activeClips(scene: Scene, time: number, kind?: TrackKind): {
    track: Track;
    clip: Clip;
}[];
/** Clips matching a specific target (an actor, prop, camera, or dialogue line). */
export declare function clipsForTarget(scene: Scene, kind: TrackKind, targetId: Id): Clip[];
/** The environment backing a scene, or undefined if the reference is dangling. */
export declare function sceneEnvironment(project: Project, scene: Scene): EnvironmentDef | undefined;
export declare function scenesOfEpisode(project: Project, episodeId: Id): Scene[];
