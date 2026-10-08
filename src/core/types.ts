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
  /**
   * The rig slot the talk pulse opens while the actor has a live dialogue line.
   *
   * `'mouth'` is the convention every current rig uses (the normaliser fills it in,
   * so older documents need no migration), but naming it here rather than inside the
   * renderer is what lets a rig call its mouth something else and still animate. A
   * character whose rig has no matching slot simply never pulses — silent, not wrong
   * (ARCHITECTURE_SPEC.md §18.2 R2).
   */
  mouthSlot: string;
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
  /**
   * What `src` means, stated rather than sniffed.
   *
   * `'local'` - `src` is a media id, and the bytes are in the media store.
   * `'external'` - `src` is a path the operator supplies; the editor never reads it.
   * `null` - no file, which is the honest state for a declared slot.
   *
   * Document format v2. A v1 record has no such field, so it migrates to `null`
   * everywhere and every slot stays honestly "missing" rather than being guessed at
   * from a string that looks like a path.
   */
  srcKind: 'local' | 'external' | null;
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

/**
 * A named framing a user can start a shot from.
 *
 * A preset is a **value, not an asset**: it is not in `AssetLibrary`, no scene
 * references it by id, and applying one *copies* its camera into the scene. That is
 * deliberate. A referenced preset means a project-level edit to "the wide two-shot"
 * silently changes every finished scene shot with it; a copied one means the scene
 * stays self-describing, which is what a production tool needs.
 *
 * `authoredFor` records the environment size the numbers were composed against, so a
 * later pass can tell a preset composed for a 1920x1080 frame from one composed for
 * something else. It is advisory: nothing depends on it yet.
 */
export interface CameraPreset {
  id: Id;
  name: string;
  description: string;
  tags: string[];
  camera: Camera;
  /** Optional recommended framing for a given environment size. */
  authoredFor?: { width: number; height: number };
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

/**
 * Facts about a project that are not part of the production itself.
 *
 * Nothing here changes what renders. It exists so the browser can hide an archived
 * project, name where a duplicate came from, and label a snapshot — all without
 * inventing a second document type or a side-car database of its own.
 */
export interface ProjectMetadata {
  /** ISO 8601. Hidden from the default list; never deleted by archiving. */
  archived: string | null;
  /** Project id this one was duplicated from. */
  duplicatedFrom: Id | null;
  /** Project id this one is a point-in-time copy of. */
  snapshotOf: Id | null;
}

/**
 * Facts about a series that are not part of the production itself.
 *
 * Empty on purpose. The one thing that was ever proposed here — a structured show bible —
 * was deferred for a reason that has nothing to do with storage: it is prose, and the
 * system has no text store, no search and no reader (ARCHITECTURE_SPEC.md §28.5). When
 * that phase arrives it is a documents table beside this field, not a field full of text.
 *
 * It is a record rather than `{}` so that adding a fact is a deliberate, type-checked act
 * instead of a silent shape widening.
 */
export type SeriesMetadata = Record<string, unknown>;

/**
 * The reusable content of one show.
 *
 * A series owns the asset library; a project owns the production document that references
 * it. This is the whole of Phase 14's architectural claim: ZANZA is a `SeriesDef` row,
 * and "Nia" is a row inside `assets.characters` rather than a fact about the engine
 * (ARCHITECTURE_SPEC.md §29.1).
 *
 * What does **not** belong here, because it is production state rather than vocabulary:
 * scenes, episodes, tracks, clips, keyframes, camera state and dialogue placement. Those
 * stay in `Project` and stay scene-local (§4.2).
 */
export interface SeriesDef {
  id: Id;
  name: string;
  description: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  formatVersion: number;
  assets: AssetLibrary;
  /**
   * Named framings a series' projects may start a shot from.
   *
   * Presets are *values*, not assets (§4.2), so they live outside `assets` on both scopes
   * and are resolved series-first with a project entry winning by name. A series' presets
   * are the house framings — the establishing shot every episode opens on — and a project
   * overrides one only when this production wants it differently.
   *
   * Optional rather than required because a series with no house framings is normal, and
   * because the v2→v3 migration cannot invent one: a pre-series document kept its presets
   * on the project, so they are still there after migrating.
   */
  cameraPresets?: CameraPreset[] | undefined;
  metadata: SeriesMetadata;
}

/**
 * Everything the renderer and the audio planner are allowed to read.
 *
 * This is the seam that makes Series a scope change rather than a behaviour change. Both
 * `SeriesDef`-resolved assets and `Project.settings` are needed to draw a frame, so the
 * render path is re-typed to this and nothing else. `Project` satisfies it structurally,
 * which is why every existing call site compiles unchanged — that is the compiler proof
 * the specification relies on (§24.5), and `src/arch/multiseries.test.ts` is the
 * behavioural one.
 *
 * It deliberately does **not** carry the series or the project. A frame drawn from this
 * value cannot tell which show it belongs to, which is exactly the property §29.5 requires.
 */
export interface SceneContext {
  /** Series assets with project overrides merged over them. See `resolveAssets`. */
  assets: AssetLibrary;
  settings: ProjectSettings;
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
  /**
   * The series that owns this production's reusable assets.
   *
   * `null` is a legitimate state, not a broken one: it is a free project with no series,
   * and its `assets` are then the whole library (§5.3). It is *not* the state a migrated
   * project is in — the v2→v3 migration always derives a series, because a pre-series
   * document carried its library inline and somebody has to adopt it.
   *
   * A non-null id that no `SeriesDef` satisfies is a dangling reference, and a project in
   * that state is refused at open rather than rendered against a half-empty library
   * (§23.5). `validateProject` enforces it against the merged library, not this field
   * alone, because a null here is legal and a non-null that resolves to nothing is not.
   */
  seriesId: Id | null;
  settings: ProjectSettings;
  /**
   * Overrides of the series library, and nothing else.
   *
   * A project with an empty override library is the normal case, not a broken one: most
   * episodes use the show's own assets unchanged (§4.3.1). The collection is kept because
   * "this production redraws Nia for a season finale" is a real and expressible variation,
   * and an asset is owned at the narrowest scope that can express it (§4.1).
   */
  assets: AssetLibrary;
  /**
   * Named framings a shot can be started from. Project-scope, resolved against the series
   * first with a project entry overriding a series entry by name. Not in `assets` on
   * purpose — presets are values, not assets (§4.2).
   */
  cameraPresets: CameraPreset[];
  episodes: Episode[];
  /** Flat pool. Episodes reference scenes by id and hold the order. */
  scenes: Scene[];
  /**
   * Lifecycle facts. Absent in a v1 document and defaulted on read, so this is additive:
   * an old project opens with `archived: null` and is neither hidden nor claimed to be
   * a copy of anything.
   */
  metadata: ProjectMetadata;
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
