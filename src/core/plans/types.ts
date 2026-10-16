/**
 * Plan types (ARCHITECTURE_SPEC.md §9, §10, §11 — Phase 17).
 *
 * A plan is an *instruction* and never a fact: it names ids the document does not
 * contain yet, and it never embeds a definition (§9.3). This module is pure type
 * vocabulary — no logic, no imports from `state`, `ui`, `ai` or `data`.
 *
 * `PlanEnvelope.body` stays `unknown` on purpose (§9.1): `parsePlan` is total, and an
 * unknown `kind` is a clean error rather than a crash. For `kind: 'scene'` the body is
 * checked against `ScenePlan` by `parseScenePlan`, which both `parsePlan` and the
 * validator/compiler call, so an envelope that never went through `parsePlan` still
 * cannot reach `compilePlan` unchecked.
 */
import type { AssetLibrary, EaseType, Id, KeyframeTarget, Project, SeriesDef, Transform2D } from '../types';
import type { Command } from '../commands/types';

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

/** Total-function result. `parsePlan` never throws (§9.6). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/* ------------------------------------------------------------------ */
/* Envelope (§9.1, §9.4)                                               */
/* ------------------------------------------------------------------ */

export interface Provenance {
  actor: 'human' | 'ai' | 'system' | 'import';
  /** Optional strings with no union — provider-agnostic by design (§9.4, D10). */
  provider?: string;
  model?: string;
  /** ISO 8601. */
  at: string;
  note?: string;
}

export interface PlanEnvelope {
  /** Schema version of the plan format, separate from the document's. */
  planVersion: 1;
  kind: 'scene' | 'episode' | 'production';
  title: string;
  provenance?: Provenance;
  parentPlanId?: string;
  createdAt: string;
  /** Narrowed by `kind`; only `scene` is implemented in Phase 17. */
  body: unknown;
}

/* ------------------------------------------------------------------ */
/* ScenePlan body (§9.2)                                               */
/* ------------------------------------------------------------------ */

export interface CastEntry {
  characterId: Id;
  displayName?: string;
  poseId?: Id;
  expressionId?: Id;
  /** An anchor of the chosen environment; mutually usable with `transform`. */
  anchorId?: Id;
  transform?: Partial<Transform2D>;
  z?: number;
  flipX?: boolean;
  /** Expression changes over the scene, as { at, expressionId } steps. */
  expressionChanges?: { at: number; expressionId: Id }[];
}

export interface PlannedLine {
  speaker: string;
  /** Resolved against plan cast entries first, then existing scene actors. */
  actorRef: string;
  text: string;
  emotion: string;
  subtitle?: string;
  /** Explicit cue window. Omit and the compiler lays it out (§11.2). */
  start?: number;
  duration?: number;
  /** -> AudioDef. */
  voiceId?: Id;
}

export interface PlannedCamera {
  /** A preset id or name, resolved against camera presets. */
  preset?: string;
  keyframes?: { at: number; x?: number; y?: number; zoom?: number; rotation?: number; ease?: EaseType }[];
}

/**
 * Reusable animation requests (§9.2). Phase 20+ — accepted, existence-checked when an
 * `AnimationAsset` kind exists, and ignored by the Phase 17 compiler (RULE 9).
 */
export interface PlannedAnimation {
  clipId: Id;
  /** Seconds on the scene timeline. */
  at?: number;
}

export interface ScenePlan {
  /** Existing scene to modify. Omit together with `newScene` to create (§10.3). */
  sceneId?: Id;
  newScene?: {
    name: string;
    environmentId: Id;
    duration: number;
    backgroundColor?: string;
  };
  /** Order is significant: it determines z. */
  cast?: CastEntry[];
  /** Dialogue, in intended order. */
  dialogue?: PlannedLine[];
  camera?: PlannedCamera;
  animation?: PlannedAnimation[];
  /** Explicit timing overrides for generated cues. */
  timing?: { dialogueStart?: number; dialogueGap?: number };
}

/* ------------------------------------------------------------------ */
/* Parse errors (§9.6)                                                 */
/* ------------------------------------------------------------------ */

export type PlanParseError =
  | { code: 'not-json'; message: string }
  | { code: 'unknown-kind'; kind: string }
  | { code: 'schema'; path: string; message: string }
  | { code: 'unsupported-version'; planVersion: number };

/** The only kind `parseScenePlan` emits — body shape is all it checks. */
export type SchemaParseError = Extract<PlanParseError, { code: 'schema' }>;

/* ------------------------------------------------------------------ */
/* Validation (§10.2)                                                  */
/* ------------------------------------------------------------------ */

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'missing-character' | 'missing-environment' | 'missing-pose' | 'missing-expression'
  | 'missing-prop' | 'missing-voice' | 'missing-anchor' | 'missing-audio'
  | 'unknown-actor-ref' | 'unknown-scene' | 'unknown-series' | 'unknown-preset'
  | 'invalid-timing' | 'invalid-duration' | 'negative-value' | 'out-of-range'
  | 'duplicate-id' | 'unknown-field' | 'cycle'
  | 'pose-incompatible' | 'voice-incompatible' | 'style-mismatch' | 'wardrobe-mismatch';

export interface PlanDiagnostic {
  severity: Severity;
  /** Dotted path into the plan, body-relative: `dialogue[2].actorRef` (§10.2). */
  path: string;
  code: DiagnosticCode;
  message: string;
  hint?: string;
}

/** A decision the compiler made that the author did not specify (§11.1). */
export interface Assumption {
  path: string;
  decision: string;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Resolved references — the validator's work, the compiler's input    */
/* ------------------------------------------------------------------ */

export interface ResolvedCastEntry {
  /** Index into `ScenePlan.cast`; the plan-local handle a command ref-outs as `@cast:N`. */
  index: number;
  characterId: Id;
  displayName: string;
  poseId: Id;
  expressionId: Id;
  anchorId: Id | null;
  transform: Partial<Transform2D> | null;
  z: number | null;
  flipX: boolean;
  /** Plan order; the compiler sorts by `at` with the index as tiebreak. */
  expressionChanges: { at: number; expressionId: Id }[];
}

export type ResolvedLineActor =
  | { source: 'cast'; castIndex: number }
  | { source: 'scene-actor'; actorId: Id }
  | { source: 'none' };

export interface ResolvedCue {
  start: number;
  duration: number;
  /** True when the compiler assigned the window (§11.1 assumptions). */
  generated: boolean;
  /** True when the window was shortened to fit the scene end. */
  truncated: boolean;
}

export interface ResolvedLine {
  speaker: string;
  text: string;
  emotion: string;
  subtitle: string | null;
  voiceAudioId: Id | null;
  actor: ResolvedLineActor;
  cue: ResolvedCue;
}

export type ResolvedCamera =
  | { mode: 'preset'; presetId: Id }
  | {
      mode: 'move';
      /** Absolute scene time, camera props already mapped (zoom -> scaleX). */
      keyframes: { time: number; props: KeyframeTarget; ease: EaseType }[];
      rest: { x?: number; y?: number; zoom?: number; rotation?: number };
      clipStart: number;
      clipDuration: number;
    };

/**
 * Ids the plan references, resolved, plus the timing the compiler will emit —
 * computed exactly once by `validatePlan` so the compiler can never disagree with the
 * validator (§11.3 rule 4).
 */
export interface ResolvedPlanReferences {
  /** Existing target scene, or null when the plan creates one. */
  sceneId: Id | null;
  createsScene: boolean;
  /** Effective duration: `newScene.duration` possibly extended to fit generated cues. */
  sceneDuration: number;
  environmentId: Id;
  /** null keeps the scene factory default; the compiler records the default as an assumption. */
  backgroundColor: string | null;
  cast: ResolvedCastEntry[];
  /** Aligned with `ScenePlan.dialogue`. */
  lines: ResolvedLine[];
  camera: ResolvedCamera | null;
  assumptions: Assumption[];
}

export interface PlanValidation {
  /** True iff there are zero `error` diagnostics (§10.2). */
  ok: boolean;
  diagnostics: PlanDiagnostic[];
  resolved: ResolvedPlanReferences;
}

/* ------------------------------------------------------------------ */
/* Compile (§11.1)                                                     */
/* ------------------------------------------------------------------ */

export type CompileResult =
  | { ok: true; commands: Command[]; warnings: PlanDiagnostic[]; assumptions: Assumption[] }
  | { ok: false; diagnostics: PlanDiagnostic[] };

/* ------------------------------------------------------------------ */
/* Shared context + plan-local handles                                 */
/* ------------------------------------------------------------------ */

/** What `validatePlan`, `compilePlan` and `applyPlan` all read. */
export interface PlanContext {
  project: Project;
  assets: AssetLibrary;
  /** Phase 14 merged-view parity; presets resolve series-first when present (same as the command layer). */
  series?: SeriesDef | null;
}

/**
 * Plan-local handle for the scene a plan's `CreateScene` produces. Compiled commands
 * carry it in id fields; `applyPlan` substitutes the real id after the command that
 * ref-outs it has run (ARCHITECTURE_SPEC.md §11.5 correction, Phase 17). Real ids are
 * `<prefix>_<chunk>` (id.ts), so a handle can never collide with one.
 */
export const PLAN_SCENE_HANDLE = '@scene';

/** Plan-local handle for the actor placed by the Nth `PlaceCharacter` of one plan. */
export function planCastHandle(index: number): string {
  return `@cast:${index}`;
}
