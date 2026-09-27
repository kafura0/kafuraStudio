/**
 * Constructors for every persisted shape.
 *
 * Every document mutation in the app starts here, which is what guarantees that a
 * newly created node has every field populated and a unique id.
 */
import type { AssetLibrary, Camera, Clip, DialogueLine, EaseType, Episode, EnvironmentDef, Keyframe, KeyframeTarget, Project, ProjectSettings, RenderSettings, Scene, SceneActor, SceneProp, StagingAnchor, Track, TrackKind } from '../types';
export declare function emptyAssetLibrary(): AssetLibrary;
export declare function defaultProjectSettings(): ProjectSettings;
export declare function defaultRenderSettings(): RenderSettings;
export declare function defaultCamera(environment?: EnvironmentDef): Camera;
export declare function createProject(name: string, description?: string): Project;
export declare function createEpisode(title: string, description?: string): Episode;
export declare function createScene(name: string, environmentId: string, options?: {
    description?: string;
    duration?: number;
    camera?: Camera;
}): Scene;
export declare function createAnchor(name: string, x: number, y: number, options?: Partial<Omit<StagingAnchor, 'id' | 'name' | 'x' | 'y'>>): StagingAnchor;
export declare function createActor(characterId: string, displayName: string, poseId: string, expressionId: string, transformOverrides?: Partial<SceneActor['transform']>): SceneActor;
export declare function createSceneProp(propId: string, transformOverrides?: Partial<SceneProp['transform']>): SceneProp;
export declare function createTrack(kind: TrackKind, targetId: string, name: string, color: string): Track;
export declare function createClip(start: number, duration: number, extras?: {
    audioId?: string | null;
    dialogueLineId?: string | null;
    gain?: number;
}): Clip;
export declare function createKeyframe(time: number, props: KeyframeTarget, ease?: EaseType): Keyframe;
export declare function createDialogueLine(speaker: string, text: string, actorId?: string | null): DialogueLine;
