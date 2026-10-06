/**
 * Constructors for every persisted shape.
 *
 * Every document mutation in the app starts here, which is what guarantees that a
 * newly created node has every field populated and a unique id.
 */

import { createId, ID_PREFIX } from '../id';
import { CURRENT_FORMAT_VERSION, DEFAULT_SCENE_DURATION, STAGE_FPS, STAGE_HEIGHT, STAGE_WIDTH } from '../constants';
import { transform } from '../types';
import type {
  AssetLibrary,
  Camera,
  CameraPreset,
  Clip,
  DialogueLine,
  EaseType,
  Episode,
  EnvironmentDef,
  Id,
  Keyframe,
  KeyframeTarget,
  Project,
  ProjectSettings,
  RenderSettings,
  Scene,
  SceneActor,
  SceneProp,
  SeriesDef,
  StagingAnchor,
  Track,
  TrackKind,
} from '../types';

export function emptyAssetLibrary(): AssetLibrary {
  return {
    characters: [],
    environments: [],
    poses: [],
    expressions: [],
    props: [],
    audio: [],
  };
}

/**
 * A new series with an empty library.
 *
 * There is deliberately no starter content here. A `Project` gets a scaffold
 * (`starterAssetLibrary`) because an empty project cannot hold a scene, and there is no
 * asset-authoring UI; a series with nothing in it is simply an empty show, and the fastest
 * path to a second one is to create it and then point at assets that already exist.
 */
export function createSeries(name: string, description = ''): SeriesDef {
  const now = new Date().toISOString();
  return {
    id: createId(ID_PREFIX.series),
    name,
    description,
    createdAt: now,
    updatedAt: now,
    formatVersion: CURRENT_FORMAT_VERSION,
    assets: emptyAssetLibrary(),
    metadata: {},
  };
}

export function defaultProjectSettings(): ProjectSettings {
  return {
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    fps: STAGE_FPS,
    autosave: true,
  };
}

export function defaultRenderSettings(): RenderSettings {
  return {
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    fps: STAGE_FPS,
    format: 'webm',
  };
}

export function defaultCamera(environment?: EnvironmentDef): Camera {
  if (environment) {
    return {
      x: environment.width / 2,
      y: environment.height / 2,
      zoom: 1,
      rotation: 0,
    };
  }
  return { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2, zoom: 1, rotation: 0 };
}

/** The width/height pair shared by an environment, a frame and a viewport. */
export interface FrameSize {
  width: number;
  height: number;
}

/**
 * A new production document.
 *
 * `seriesId` is an argument rather than a default, because a project without an owner is a
 * decision and not an oversight: `null` is the free project (§5.3), and every other caller
 * in this codebase has a series in hand. Making it explicit at the call site is what stops
 * a second, accidental way of ending up series-less.
 */
export function createProject(
  name: string,
  seriesId: Id | null = null,
  description = '',
): Project {
  const now = new Date().toISOString();
  return {
    id: createId(ID_PREFIX.project),
    name,
    description,
    createdAt: now,
    updatedAt: now,
    formatVersion: CURRENT_FORMAT_VERSION,
    seriesId,
    settings: defaultProjectSettings(),
    assets: emptyAssetLibrary(),
    cameraPresets: [],
    episodes: [],
    scenes: [],
    metadata: { archived: null, duplicatedFrom: null, snapshotOf: null },
  };
}

/**
 * A named framing. The id is generated here so a caller cannot accidentally hand two
 * presets the same one.
 */
export function createCameraPreset(
  name: string,
  camera: Camera,
  extras: {
    description?: string | undefined;
    tags?: string[] | undefined;
    id?: Id | undefined;
    authoredFor?: FrameSize | undefined;
  } = {},
): CameraPreset {
  // Spreads rather than assigns so an absent `authoredFor` is absent from the object,
  // which `exactOptionalPropertyTypes` requires: `{ authoredFor: undefined }` is not the
  // same type as `{}` when a caller is asking whether the preset was composed for a size.
  return {
    id: extras.id ?? createId(ID_PREFIX.cameraPreset),
    name,
    description: extras.description ?? '',
    tags: extras.tags ?? [],
    camera,
    ...(extras.authoredFor ? { authoredFor: extras.authoredFor } : {}),
  };
}

export function createEpisode(title: string, description = ''): Episode {
  return {
    id: createId(ID_PREFIX.episode),
    title,
    description,
    sceneIds: [],
    renderSettings: defaultRenderSettings(),
    metadata: {},
  };
}

export function createScene(
  name: string,
  environmentId: string,
  options: { description?: string; duration?: number; camera?: Camera } = {},
): Scene {
  return {
    id: createId(ID_PREFIX.scene),
    name,
    description: options.description ?? '',
    environmentId,
    actors: [],
    props: [],
    dialogue: [],
    tracks: [],
    camera: options.camera ?? { x: 0, y: 0, zoom: 1, rotation: 0 },
    duration: options.duration ?? DEFAULT_SCENE_DURATION,
    backgroundColor: '#0b0d12',
    metadata: {},
  };
}

export function createAnchor(
  name: string,
  x: number,
  y: number,
  options: Partial<Omit<StagingAnchor, 'id' | 'name' | 'x' | 'y'>> = {},
): StagingAnchor {
  return {
    id: createId(ID_PREFIX.anchor),
    name,
    x,
    y,
    scale: options.scale ?? 1,
    rotation: options.rotation ?? 0,
    flipX: options.flipX ?? false,
    facing: options.facing ?? 'right',
    kind: options.kind ?? 'stand',
    tags: options.tags ?? [],
  };
}

export function createActor(
  characterId: string,
  displayName: string,
  poseId: string,
  expressionId: string,
  transformOverrides: Partial<SceneActor['transform']> = {},
): SceneActor {
  return {
    id: createId(ID_PREFIX.actor),
    characterId,
    poseId,
    expressionId,
    displayName,
    transform: transform(transformOverrides),
    flipX: false,
    z: 0,
    visible: true,
    anchorId: null,
  };
}

export function createSceneProp(propId: string, transformOverrides: Partial<SceneProp['transform']> = {}): SceneProp {
  return {
    id: createId(ID_PREFIX.propInstance),
    propId,
    transform: transform(transformOverrides),
    flipX: false,
    z: 0,
    visible: true,
  };
}

export function createTrack(kind: TrackKind, targetId: string, name: string, color: string): Track {
  return {
    id: createId(ID_PREFIX.track),
    kind,
    targetId,
    name,
    muted: false,
    locked: false,
    color,
    clips: [],
  };
}

export function createClip(
  start: number,
  duration: number,
  extras: { audioId?: string | null; dialogueLineId?: string | null; gain?: number } = {},
): Clip {
  return {
    id: createId(ID_PREFIX.clip),
    start,
    duration,
    keyframes: [],
    audioId: extras.audioId ?? null,
    dialogueLineId: extras.dialogueLineId ?? null,
    gain: extras.gain ?? 1,
  };
}

export function createKeyframe(time: number, props: KeyframeTarget, ease: EaseType = 'linear'): Keyframe {
  return {
    id: createId(ID_PREFIX.keyframe),
    time,
    ease,
    props,
  };
}

export function createDialogueLine(speaker: string, text: string, actorId: string | null = null): DialogueLine {
  return {
    id: createId(ID_PREFIX.dialogue),
    speaker,
    actorId,
    text,
    emotion: 'neutral',
    voiceAudioId: null,
    subtitle: null,
  };
}
