/**
 * Project, episode and scene operations.
 *
 * Every function is `(project, ...) => Project`. Nothing mutates in place, so undo
 * is a matter of keeping the previous reference (see ARCHITECTURE.md §3).
 */
import type { Camera, Episode, Id, Project, Scene } from '../types';
export declare function touch(project: Project): Project;
export declare function renameProject(project: Project, name: string): Project;
export declare function updateProjectSettings(project: Project, patch: Partial<Project['settings']>): Project;
export declare function addEpisode(project: Project, title: string, description?: string): Project;
export declare function updateEpisode(project: Project, episodeId: Id, patch: Partial<Omit<Episode, 'id' | 'sceneIds'>>): Project;
export declare function removeEpisode(project: Project, episodeId: Id): Project;
/** Append a scene to an episode's cut list, at `index` (or the end). */
export declare function addSceneToEpisode(project: Project, episodeId: Id, sceneId: Id, index?: number): Project;
export declare function removeSceneFromEpisode(project: Project, episodeId: Id, sceneId: Id): Project;
export declare function reorderEpisodeScene(project: Project, episodeId: Id, fromIndex: number, toIndex: number): Project;
export declare function createSceneInProject(project: Project, options: {
    name: string;
    environmentId: string;
    description?: string;
    duration?: number;
}): {
    project: Project;
    sceneId: Id;
};
/** Delete a scene, and drop it from every episode that referenced it. */
export declare function deleteScene(project: Project, sceneId: Id): Project;
type ScenePatch = Partial<Omit<Scene, 'id'>>;
export declare function updateScene(project: Project, sceneId: Id, patch: ScenePatch): Project;
export declare function setSceneCamera(project: Project, sceneId: Id, patch: Partial<Camera>): Project;
export declare function setSceneDuration(project: Project, sceneId: Id, duration: number): Project;
/** Replace one scene wholesale. Used by document-level editor operations. */
export declare function replaceScene(project: Project, next: Scene): Project;
/** Transform helper for scene-level state that lives outside a specific array. */
export declare function mapScene(project: Project, sceneId: Id, fn: (scene: Scene) => Scene): Project;
type AssetCollection = 'characters' | 'environments' | 'poses' | 'expressions' | 'props' | 'audio';
export declare function addAsset<K extends AssetCollection>(project: Project, collection: K, item: Project['assets'][K][number]): Project;
export declare function updateAsset<K extends AssetCollection>(project: Project, collection: K, id: Id, patch: Partial<Project['assets'][K][number]>): Project;
export declare function removeAsset(project: Project, collection: AssetCollection, id: Id): Project;
/** Total runtime of an episode, in seconds. */
export declare function episodeDuration(project: Project, episodeId: Id): number;
/** Every scene in an episode, in cut order. */
export declare function episodeScenes(project: Project, episodeId: Id): Scene[];
export declare function duplicateScene(project: Project, sceneId: Id): {
    project: Project;
    sceneId: Id;
};
export {};
