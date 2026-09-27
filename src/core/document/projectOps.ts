/**
 * Project, episode and scene operations.
 *
 * Every function is `(project, ...) => Project`. Nothing mutates in place, so undo
 * is a matter of keeping the previous reference (see ARCHITECTURE.md §3).
 */

import { createId, ID_PREFIX } from '../id';
import type { Camera, Episode, Id, Project, Scene } from '../types';
import { createEpisode, createScene, defaultCamera } from './factories';
import { findEnvironment, findScene, requireScene, scenesOfEpisode } from './lookups';

/* ------------------------------------------------------------------ */
/* Project                                                             */
/* ------------------------------------------------------------------ */

export function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

export function renameProject(project: Project, name: string): Project {
  return touch({ ...project, name });
}

export function updateProjectSettings(
  project: Project,
  patch: Partial<Project['settings']>,
): Project {
  return touch({ ...project, settings: { ...project.settings, ...patch } });
}

/* ------------------------------------------------------------------ */
/* Episode                                                             */
/* ------------------------------------------------------------------ */

export function addEpisode(project: Project, title: string, description = ''): Project {
  const episode = createEpisode(title, description);
  return touch({ ...project, episodes: [...project.episodes, episode] });
}

export function updateEpisode(
  project: Project,
  episodeId: Id,
  patch: Partial<Omit<Episode, 'id' | 'sceneIds'>>,
): Project {
  return touch({
    ...project,
    episodes: project.episodes.map((e) => (e.id === episodeId ? { ...e, ...patch } : e)),
  });
}

export function removeEpisode(project: Project, episodeId: Id): Project {
  return touch({
    ...project,
    episodes: project.episodes.filter((e) => e.id !== episodeId),
  });
}

/** Append a scene to an episode's cut list, at `index` (or the end). */
export function addSceneToEpisode(
  project: Project,
  episodeId: Id,
  sceneId: Id,
  index?: number,
): Project {
  if (!findScene(project, sceneId)) throw new Error(`Cannot add unknown scene: ${sceneId}`);
  return touch({
    ...project,
    episodes: project.episodes.map((episode) => {
      if (episode.id !== episodeId) return episode;
      if (episode.sceneIds.includes(sceneId)) return episode;
      const next = [...episode.sceneIds];
      const at = index === undefined ? next.length : Math.max(0, Math.min(index, next.length));
      next.splice(at, 0, sceneId);
      return { ...episode, sceneIds: next };
    }),
  });
}

export function removeSceneFromEpisode(project: Project, episodeId: Id, sceneId: Id): Project {
  return touch({
    ...project,
    episodes: project.episodes.map((episode) =>
      episode.id === episodeId
        ? { ...episode, sceneIds: episode.sceneIds.filter((id) => id !== sceneId) }
        : episode,
    ),
  });
}

export function reorderEpisodeScene(
  project: Project,
  episodeId: Id,
  fromIndex: number,
  toIndex: number,
): Project {
  return touch({
    ...project,
    episodes: project.episodes.map((episode) => {
      if (episode.id !== episodeId) return episode;
      const next = [...episode.sceneIds];
      const from = next[fromIndex];
      if (from === undefined) return episode;
      next.splice(fromIndex, 1);
      const to = Math.max(0, Math.min(toIndex, next.length));
      next.splice(to, 0, from);
      return { ...episode, sceneIds: next };
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export function createSceneInProject(
  project: Project,
  options: { name: string; environmentId: string; description?: string; duration?: number },
): { project: Project; sceneId: Id } {
  const environment = findEnvironment(project, options.environmentId);
  const camera: Camera = environment ? defaultCamera(environment) : { x: 0, y: 0, zoom: 1, rotation: 0 };
  const scene = createScene(options.name, options.environmentId, {
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    camera,
  });
  return {
    project: touch({ ...project, scenes: [...project.scenes, scene] }),
    sceneId: scene.id,
  };
}

/** Delete a scene, and drop it from every episode that referenced it. */
export function deleteScene(project: Project, sceneId: Id): Project {
  return touch({
    ...project,
    scenes: project.scenes.filter((s) => s.id !== sceneId),
    episodes: project.episodes.map((e) => ({ ...e, sceneIds: e.sceneIds.filter((id) => id !== sceneId) })),
  });
}

type ScenePatch = Partial<Omit<Scene, 'id'>>;

export function updateScene(project: Project, sceneId: Id, patch: ScenePatch): Project {
  return touch({
    ...project,
    scenes: project.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
  });
}

export function setSceneCamera(project: Project, sceneId: Id, patch: Partial<Camera>): Project {
  const scene = requireScene(project, sceneId);
  return updateScene(project, sceneId, { camera: { ...scene.camera, ...patch } });
}

export function setSceneDuration(project: Project, sceneId: Id, duration: number): Project {
  const clamped = Math.max(0.1, duration);
  return updateScene(project, sceneId, { duration: clamped });
}

/** Replace one scene wholesale. Used by document-level editor operations. */
export function replaceScene(project: Project, next: Scene): Project {
  return touch({
    ...project,
    scenes: project.scenes.map((scene) => (scene.id === next.id ? next : scene)),
  });
}

/** Transform helper for scene-level state that lives outside a specific array. */
export function mapScene(project: Project, sceneId: Id, fn: (scene: Scene) => Scene): Project {
  return touch({
    ...project,
    scenes: project.scenes.map((scene) => (scene.id === sceneId ? fn(scene) : scene)),
  });
}

/* ------------------------------------------------------------------ */
/* Asset library                                                       */
/* ------------------------------------------------------------------ */

type AssetCollection = 'characters' | 'environments' | 'poses' | 'expressions' | 'props' | 'audio';

export function addAsset<K extends AssetCollection>(
  project: Project,
  collection: K,
  item: Project['assets'][K][number],
): Project {
  return touch({
    ...project,
    assets: {
      ...project.assets,
      [collection]: [...project.assets[collection], item],
    },
  });
}

export function updateAsset<K extends AssetCollection>(
  project: Project,
  collection: K,
  id: Id,
  patch: Partial<Project['assets'][K][number]>,
): Project {
  return touch({
    ...project,
    assets: {
      ...project.assets,
      [collection]: project.assets[collection].map((item) =>
        item.id === id ? ({ ...item, ...patch } as Project['assets'][K][number]) : item,
      ),
    },
  });
}

export function removeAsset(
  project: Project,
  collection: AssetCollection,
  id: Id,
): Project {
  return touch({
    ...project,
    assets: {
      ...project.assets,
      [collection]: project.assets[collection].filter((item) => item.id !== id),
    },
  });
}

/* ------------------------------------------------------------------ */
/* Derived                                                             */
/* ------------------------------------------------------------------ */

/** Total runtime of an episode, in seconds. */
export function episodeDuration(project: Project, episodeId: Id): number {
  return scenesOfEpisode(project, episodeId).reduce((total, scene) => total + scene.duration, 0);
}

/** Every scene in an episode, in cut order. */
export function episodeScenes(project: Project, episodeId: Id): Scene[] {
  return scenesOfEpisode(project, episodeId);
}

export function duplicateScene(project: Project, sceneId: Id): { project: Project; sceneId: Id } {
  const source = requireScene(project, sceneId);
  const copy: Scene = {
    ...structuredClone(source),
    id: createId(ID_PREFIX.scene),
    name: `${source.name} copy`,
  };
  // Nested node ids must be unique too, or selection and keyframe lookup collide.
  const actorIdMap = new Map<string, string>();
  copy.actors = copy.actors.map((actor) => {
    const nextId = createId(ID_PREFIX.actor);
    actorIdMap.set(actor.id, nextId);
    return { ...actor, id: nextId };
  });
  copy.props = copy.props.map((prop) => ({ ...prop, id: createId(ID_PREFIX.propInstance) }));
  copy.dialogue = copy.dialogue.map((line) => ({
    ...line,
    id: createId(ID_PREFIX.dialogue),
    actorId: line.actorId ? (actorIdMap.get(line.actorId) ?? null) : null,
  }));
  copy.tracks = copy.tracks.map((track) => {
    const remappedTarget =
      track.kind === 'actor' ? (actorIdMap.get(track.targetId) ?? track.targetId) : track.targetId;
    return {
      ...track,
      id: createId(ID_PREFIX.track),
      targetId: remappedTarget,
      clips: track.clips.map((clip) => ({
        ...clip,
        id: createId(ID_PREFIX.clip),
        keyframes: clip.keyframes.map((kf) => ({ ...kf, id: createId(ID_PREFIX.keyframe) })),
      })),
    };
  });
  return { project: touch({ ...project, scenes: [...project.scenes, copy] }), sceneId: copy.id };
}
