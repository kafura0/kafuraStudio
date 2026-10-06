/**
 * Read-only lookups over the project.
 *
 * These run in the render hot path, so they are written as plain scans over small
 * arrays rather than building indexes. An MVP project holds tens of scenes and
 * hundreds of assets; a Map index would cost more to maintain than it saves.
 *
 * Note the split in what these take. Scene, episode and clip lookups take a `Project`,
 * because that is where production lives. The six *asset* lookups take a resolved
 * `AssetLibrary`, because that is where art lives — and taking a library rather than a
 * project is what makes it impossible to resolve an id against the project's override
 * collection alone and silently miss the series asset it was meant to find. A project with
 * no overrides of its own has, by construction, no characters.
 */

import type {
  AssetLibrary,
  AudioDef,
  CameraPreset,
  CharacterDef,
  Clip,
  DialogueLine,
  EnvironmentDef,
  ExpressionDef,
  Id,
  PoseDef,
  PropDef,
  Project,
  Scene,
  SceneActor,
  SceneProp,
  SeriesDef,
  Track,
  TrackKind,
} from '../types';

export function findScene(project: Project, sceneId: Id): Scene | undefined {
  return project.scenes.find((s) => s.id === sceneId);
}

export function requireScene(project: Project, sceneId: Id): Scene {
  const scene = findScene(project, sceneId);
  if (!scene) throw new Error(`Scene not found: ${sceneId}`);
  return scene;
}

export function findActor(scene: Scene, actorId: Id): SceneActor | undefined {
  return scene.actors.find((a) => a.id === actorId);
}

export function requireActor(scene: Scene, actorId: Id): SceneActor {
  const actor = findActor(scene, actorId);
  if (!actor) throw new Error(`Actor not found in scene ${scene.id}: ${actorId}`);
  return actor;
}

export function findSceneProp(scene: Scene, propId: Id): SceneProp | undefined {
  return scene.props.find((p) => p.id === propId);
}

export function findCharacter(assets: AssetLibrary, id: Id): CharacterDef | undefined {
  return assets.characters.find((c) => c.id === id);
}

export function findEnvironment(assets: AssetLibrary, id: Id): EnvironmentDef | undefined {
  return assets.environments.find((e) => e.id === id);
}

export function findPose(assets: AssetLibrary, id: Id): PoseDef | undefined {
  return assets.poses.find((p) => p.id === id);
}

export function findExpression(assets: AssetLibrary, id: Id): ExpressionDef | undefined {
  return assets.expressions.find((e) => e.id === id);
}

export function findPropDef(assets: AssetLibrary, id: Id): PropDef | undefined {
  return assets.props.find((p) => p.id === id);
}

export function findAudioDef(assets: AssetLibrary, id: Id): AudioDef | undefined {
  return assets.audio.find((a) => a.id === id);
}

export function findDialogueLine(scene: Scene, id: Id): DialogueLine | undefined {
  return scene.dialogue.find((d) => d.id === id);
}

export function findTrack(scene: Scene, id: Id): Track | undefined {
  return scene.tracks.find((t) => t.id === id);
}

export function requireTrack(scene: Scene, id: Id): Track {
  const track = findTrack(scene, id);
  if (!track) throw new Error(`Track not found in scene ${scene.id}: ${id}`);
  return track;
}

export function requireClip(track: Track, clipId: Id): Clip {
  const clip = track.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`Clip not found on track ${track.id}: ${clipId}`);
  return clip;
}

export function findEpisode(project: Project, id: Id) {
  return project.episodes.find((e) => e.id === id);
}

export function requireEpisode(project: Project, id: Id) {
  const episode = findEpisode(project, id);
  if (!episode) throw new Error(`Episode not found: ${id}`);
  return episode;
}

/** All clips on a scene, paired with the track that owns them. */
export function allClips(scene: Scene): { track: Track; clip: Clip }[] {
  const out: { track: Track; clip: Clip }[] = [];
  for (const track of scene.tracks) {
    for (const clip of track.clips) out.push({ track, clip });
  }
  return out;
}

/** Clips whose [start, start + duration) window contains `time`. */
export function activeClips(
  scene: Scene,
  time: number,
  kind?: TrackKind,
): { track: Track; clip: Clip }[] {
  return allClips(scene).filter(
    ({ track, clip }) =>
      (kind === undefined || track.kind === kind) &&
      !track.muted &&
      time >= clip.start &&
      time < clip.start + clip.duration,
  );
}

/** Clips matching a specific target (an actor, prop, camera, or dialogue line). */
export function clipsForTarget(scene: Scene, kind: TrackKind, targetId: Id): Clip[] {
  const out: Clip[] = [];
  for (const track of scene.tracks) {
    if (track.kind !== kind || track.targetId !== targetId) continue;
    for (const clip of track.clips) out.push(clip);
  }
  return out;
}

/** The environment backing a scene, or undefined if the reference is dangling. */
export function sceneEnvironment(assets: AssetLibrary, scene: Scene): EnvironmentDef | undefined {
  return findEnvironment(assets, scene.environmentId);
}

/**
 * Every camera preset available to this project.
 *
 * Series first, then the project's own entries overriding **by name**. The seam was
 * declared in advance of the work ("Phase 14 moves the library to the series"), and it is
 * kept as one function so that every caller — the camera panel today — resolves the
 * override rule in exactly one place rather than re-implementing it.
 *
 * Overriding by name rather than by id is deliberate. A preset is a *value*, not an asset:
 * it has no id a show would want to keep stable across projects, and its name is what an
 * author recognises ("the wide establishing"). Matching on name is also what lets a project
 * change the framing of a house preset without having to know which id the series gave it.
 *
 * Returning a fresh array keeps callers from sorting the document's own array in place.
 */
export function resolveCameraPresets(project: Project, series: SeriesDef | null = null): CameraPreset[] {
  const own = project.cameraPresets ?? [];
  // Short-circuit only for a free project. Returning early when the *project* happens to be
  // empty reads like an optimisation and is the opposite: a project that overrides nothing
  // is the normal case, and taking that branch discarded the show's entire shot vocabulary.
  // The library being empty is the only condition under which there is nothing to merge.
  if (series === null || (series.cameraPresets ?? []).length === 0) return [...own];
  const ownByName = new Map(own.map((preset) => [preset.name, preset]));
  const merged: CameraPreset[] = [];
  const claimed = new Set<string>();
  for (const preset of series.cameraPresets ?? []) {
    const override = ownByName.get(preset.name);
    if (override !== undefined) {
      merged.push(override);
      claimed.add(preset.name);
    } else {
      merged.push(preset);
    }
  }
  for (const preset of own) {
    if (!claimed.has(preset.name)) merged.push(preset);
  }
  return merged;
}

export function findCameraPreset(
  presets: CameraPreset[],
  id: Id,
): CameraPreset | undefined {
  return presets.find((preset) => preset.id === id);
}

export function scenesOfEpisode(project: Project, episodeId: Id): Scene[] {
  const episode = findEpisode(project, episodeId);
  if (!episode) return [];
  const out: Scene[] = [];
  for (const id of episode.sceneIds) {
    const scene = findScene(project, id);
    if (scene) out.push(scene);
  }
  return out;
}
