/**
 * Canonical domain types for ZANZA STUDIO.
 *
 * These types are the single source of truth for the project document. See
 * `docs/DATA_MODEL.md` for the rationale behind each shape.
 *
 * This module must stay free of React, DOM and browser globals.
 */

export type Id = string;

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Transform2D {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
}

export const IDENTITY_TRANSFORM: Readonly<Transform2D> = Object.freeze({
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  alpha: 1,
});

export function transform(overrides: Partial<Transform2D> = {}): Transform2D {
  return { ...IDENTITY_TRANSFORM, ...overrides };
}

/* ------------------------------------------------------------------ */
/* Vector shapes — the drawing primitives available to a part         */
/* ------------------------------------------------------------------ */

export type ShapeDef =
  | { kind: 'ellipse'; rx: number; ry: number }
  | { kind: 'rect'; w: number; h: number }
  | { kind: 'roundRect'; w: number; h: number; radius: number }
  | { kind: 'path'; points: Vec2[]; closed: boolean }
  | { kind: 'image'; src: string; w: number; h: number };

/**
 * One drawable unit of a rig.
 *
 * `slot` is a free-form string on purpose: poses address slots by name, so a pose
 * written for `armL` works on any character that happens to have an `armL` part and
 * is inert on one that does not. A closed union here would make every new character
 * design a type change.
 */
export interface PartDef {
  id: Id;
  slot: string;
  /** Parent part id, or null for a root part. Nesting is flat + parent pointer. */
  parent: Id | null;
  /** Draw order within the rig. */
  z: number;
  shape: ShapeDef;
  /** Palette slot name, or a literal CSS colour. */
  colorKey: string;
  /** Normalised 0..1 rotation/scale pivot within the shape. */
  pivot: Vec2;
  /** Rest transform, relative to the parent part. */
  rest: Transform2D;
  visible: boolean;
}

/* ------------------------------------------------------------------ */
/* Pose + expression — partial slot override layers                    */
/* ------------------------------------------------------------------ */

export interface SlotOverride {
  x?: number;
  y?: number;
  /** Radians. ADDITIVE to the rest rotation. */
  rotation?: number;
  /** MULTIPLICATIVE on the rest scale. */
  scaleX?: number;
  scaleY?: number;
  /** MULTIPLICATIVE on the rest alpha. */
  alpha?: number;
  visible?: boolean;
  shape?: ShapeDef;
  colorKey?: string;
}

export interface PoseDef {
  id: Id;
  name: string;
  description: string;
  tags: string[];
  slots: Record<string, SlotOverride>;
}

export interface ExpressionDef {
  id: Id;
  name: string;
  description: string;
  tags: string[];
  slots: Record<string, SlotOverride>;
}

/* ------------------------------------------------------------------ */
/* Character                                                           */
/* ------------------------------------------------------------------ */

export interface CharacterDef {
  id: Id;
  name: string;
  description: string;
  tags: string[];
  /** Semantic colour slots, e.g. { skin, hair, top, bottom, accent }. */
  palette: Record<string, string>;
  rig: PartDef[];
  /** Pixel height at scale 1. The character's feet sit at y = 0. */
  height: number;
  defaultPoseId: Id;
  defaultExpressionId: Id;
}

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

export type AnchorKind = 'stand' | 'sit' | 'door' | 'table' | 'floor';
export type Facing = 'left' | 'right';

/** A repeatable place in an environment where an actor can be staged. */
export interface StagingAnchor {
  id: Id;
  name: string;
  /** Where the actor's FEET land. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  facing: Facing;
  kind: AnchorKind;
  tags: string[];
}

export interface EnvPart {
  id?: Id;
  shape: ShapeDef;
  colorKey: string;
  pivot: Vec2;
  transform: Transform2D;
}

/** An environment part as authored in seed content: the id is assigned on load. */
export type AnchoredEnvPart = EnvPart;

export interface EnvLayer {
  id: Id;
  name: string;
  z: number;
  /** 1 = moves with the camera. >1 reads as further away, <1 nearer. */
  parallax: number;
  parts: EnvPart[];
}

export interface Lighting {
  /** Tinted multiply wash over the environment. */
  ambient: string;
  overlayColor: string | null;
  /** 0 = no vignette, 1 = maximum. */
  vignette: number;
}

export interface EnvironmentDef {
  id: Id;
  name: string;
  description: string;
  tags: string[];
  /** The authored camera frame, in px. */
  width: number;
  height: number;
  layers: EnvLayer[];
  anchors: StagingAnchor[];
  lighting: Lighting;
}

/* ------------------------------------------------------------------ */
/* Props + audio                                                       */
/* ------------------------------------------------------------------ */

export interface PropDef {
  id: Id;
  name: string;
  description: string;
  tags: string[];
  parts: PartDef[];
  pivot: Vec2;
  defaultScale: number;
}

export type AudioKind = 'dialogue' | 'sfx' | 'music' | 'ambience';

export interface AudioDef {
  id: Id;
  name: string;
  kind: AudioKind;
  /** null = a declared slot with no file loaded yet. */
  src: string | null;
  /** Seconds. */
  duration: number;
  tags: string[];
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export interface SceneActor {
  id: Id;
  /** -> CharacterDef. A reference; a copy is not representable. */
  characterId: Id;
  /** -> PoseDef. */
  poseId: Id;
  /** -> ExpressionDef. */
  expressionId: Id;
  displayName: string;
  /** Placement only — never rig data. */
  transform: Transform2D;
  flipX: boolean;
  z: number;
  visible: boolean;
  /** Bound StagingAnchor id, or null for free placement. */
  anchorId: Id | null;
}

export interface SceneProp {
  id: Id;
  /** -> PropDef. */
  propId: Id;
  transform: Transform2D;
  flipX: boolean;
  z: number;
  visible: boolean;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export interface DialogueLine {
  id: Id;
  speaker: string;
  /** Links the line to a SceneActor so expression/mouth can react to it. */
  actorId: Id | null;
  text: string;
  emotion: string;
  /** -> AudioDef. */
  voiceAudioId: Id | null;
  /** null => the exporter falls back to `text`. */
  subtitle: string | null;
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export type TrackKind = 'actor' | 'prop' | 'camera' | 'dialogue' | 'audio';
export type EaseType = 'linear' | 'step' | 'easeInOut' | 'easeOut';

export interface KeyframeTarget extends Partial<Transform2D> {
  poseId?: Id;
  expressionId?: Id;
  flipX?: boolean;
  visible?: boolean;
}

export interface Keyframe {
  id: Id;
  /** Absolute time on the scene timeline, in seconds. */
  time: number;
  ease: EaseType;
  props: KeyframeTarget;
}

export interface Clip {
  id: Id;
  /** Seconds on the scene timeline. */
  start: number;
  /** Seconds. */
  duration: number;
  keyframes: Keyframe[];
  /** For kind 'audio' | 'dialogue'. -> AudioDef */
  audioId: Id | null;
  /** For kind 'dialogue'. -> DialogueLine */
  dialogueLineId: Id | null;
  /** Linear audio gain. */
  gain: number;
}

export interface Track {
  id: Id;
  kind: TrackKind;
  /**
   * A SceneActor.id, SceneProp.id, the literal 'camera', a DialogueLine.id, or an
   * AudioDef.id — depending on `kind`.
   */
  targetId: Id;
  name: string;
  muted: boolean;
  locked: boolean;
  color: string;
  /** Always sorted ascending by `start`. */
  clips: Clip[];
}

export interface Scene {
  id: Id;
  name: string;
  description: string;
  /** -> EnvironmentDef */
  environmentId: Id;
  actors: SceneActor[];
  props: SceneProp[];
  dialogue: DialogueLine[];
  tracks: Track[];
  /** Rest framing, used when no camera keyframes are active. */
  camera: Camera;
  /** Seconds. */
  duration: number;
  backgroundColor: string;
  metadata: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Episode + project                                                   */
/* ------------------------------------------------------------------ */

export type ExportFormat = 'webm' | 'png-sequence';

export interface RenderSettings {
  width: number;
  height: number;
  fps: number;
  format: ExportFormat;
}

export interface Episode {
  id: Id;
  title: string;
  description: string;
  /** Cut list. Order matters. */
  sceneIds: Id[];
  renderSettings: RenderSettings;
  metadata: Record<string, string>;
}

export interface AssetLibrary {
  characters: CharacterDef[];
  environments: EnvironmentDef[];
  poses: PoseDef[];
  expressions: ExpressionDef[];
  props: PropDef[];
  audio: AudioDef[];
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  autosave: boolean;
}

export interface Project {
  id: Id;
  name: string;
  description: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  formatVersion: number;
  settings: ProjectSettings;
  assets: AssetLibrary;
  episodes: Episode[];
  /** Flat pool. Episodes reference scenes by id and hold the order. */
  scenes: Scene[];
}

/* ------------------------------------------------------------------ */
/* UI-facing value objects (not persisted on the document)             */
/* ------------------------------------------------------------------ */

export type SelectionKind = 'actor' | 'prop' | 'clip' | 'keyframe' | 'dialogue' | 'none';

export interface Selection {
  kind: SelectionKind;
  id: Id | null;
}

/** A dialogue line joined with the clip that carries its timing. */
export interface DialogueCue {
  line: DialogueLine;
  clip: Clip;
  trackId: Id;
}
