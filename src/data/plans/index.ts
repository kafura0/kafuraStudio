/**
 * Plan fixtures (ARCHITECTURE_SPEC.md §24.8 — Phase 17).
 *
 * A fixture plan must be *true* against the real ZANZA library: every id it names
 * exists in `createSeedSeries()`, every anchor belongs to the environment it stages
 * into, and every cue fits its scene. The invalid envelopes at the bottom are the
 * shapes G7 names: a made-up character, a zero duration, and responses that are not
 * plans at all.
 *
 * Timestamps are literal and fixed — a fixture that read a clock would fail its own
 * determinism tests.
 */
import type { PlanContext, PlanEnvelope } from '../../core/plans/types';
import type { Project } from '../../core/types';
import { SEED_PROJECT, SEED_SERIES } from '../seed';

export interface PlanFixture {
  name: string;
  envelope: PlanEnvelope;
}

const CREATED_AT = '2026-10-16T00:00:00.000Z';

/**
 * The §11.6 worked example, pointed at real library ids: two cast members on anchors,
 * one explicit cue, one generated cue, an expression beat, and a two-keyframe push.
 */
export const WORKED_EXAMPLE_PLAN: PlanEnvelope = {
  planVersion: 1,
  kind: 'scene',
  title: 'EP001 s2 — Nia overhears the plan',
  provenance: { actor: 'ai', provider: 'anthropic', model: 'claude-sonnet-4', at: CREATED_AT },
  createdAt: CREATED_AT,
  body: {
    newScene: { name: 'Overheard', environmentId: 'env.nia_apartment', duration: 12 },
    cast: [
      { characterId: 'char.nia', anchorId: 'anchor.nia_couch', poseId: 'pose.sittingSofa', z: 10 },
      {
        characterId: 'char.kito',
        anchorId: 'anchor.nia_kitchen',
        poseId: 'pose.standing',
        z: 20,
        expressionChanges: [{ at: 4.0, expressionId: 'expr.worried' }],
      },
    ],
    dialogue: [
      { speaker: 'NIA', actorRef: 'char.nia', text: "You're not building an empire.", emotion: 'flat' },
      { speaker: 'KITO', actorRef: 'char.kito', text: 'I am building a very good napkin.', emotion: 'defensive', start: 3.0 },
    ],
    camera: {
      keyframes: [
        { at: 0, x: 960, y: 540, zoom: 1 },
        { at: 12, x: 900, y: 520, zoom: 1.2, ease: 'easeInOut' },
      ],
    },
  },
};

/** The smallest legal plan: create a scene and nothing else. */
export const MINIMAL_PLAN: PlanEnvelope = {
  planVersion: 1,
  kind: 'scene',
  title: 'Bare stage',
  createdAt: CREATED_AT,
  body: {
    newScene: { name: 'Bare Stage', environmentId: 'env.zanza_street', duration: 6 },
  },
};

/** All four lines get generated cues, and one carries a voice. */
export const GENERATED_DIALOGUE_PLAN: PlanEnvelope = {
  planVersion: 1,
  kind: 'scene',
  title: 'The pitch',
  createdAt: CREATED_AT,
  body: {
    newScene: { name: 'The Pitch', environmentId: 'env.nia_apartment', duration: 16 },
    cast: [
      { characterId: 'char.nia', anchorId: 'anchor.nia_floor', poseId: 'pose.standing' },
      { characterId: 'char.kito', anchorId: 'anchor.kito_door', poseId: 'pose.standing', flipX: true },
    ],
    dialogue: [
      { speaker: 'NIA', actorRef: 'char.nia', text: 'Hear me out. We sell the napkins.', emotion: 'earnest' },
      { speaker: 'KITO', actorRef: 'char.kito', text: 'We do not have napkins.', emotion: 'flat', voiceId: 'audio.ep001.kito.line1' },
      { speaker: 'NIA', actorRef: 'char.nia', text: 'We have a vision. The napkins follow the vision.', emotion: 'pushy' },
      { speaker: 'KITO', actorRef: 'char.kito', text: 'The vision has never once followed anything.', emotion: 'deadpan' },
    ],
  },
};

/** Named preset instead of explicit keyframes; every cue window is explicit. */
export const PRESET_CAMERA_PLAN: PlanEnvelope = {
  planVersion: 1,
  kind: 'scene',
  title: 'Establishing beat',
  createdAt: CREATED_AT,
  body: {
    newScene: { name: 'Street Establishing', environmentId: 'env.zanza_street', duration: 8 },
    cast: [{ characterId: 'char.landlord', anchorId: 'anchor.street_door', poseId: 'pose.handsOnHips' }],
    dialogue: [
      { speaker: 'The Landlord', actorRef: 'char.landlord', text: 'Rent.', emotion: 'flat', start: 1, duration: 1.5, subtitle: 'Rent.' },
    ],
    camera: { preset: 'camp.establishing' },
  },
};

/** Static fixtures: every id in them exists without consulting a live project. */
export const SCENE_PLAN_FIXTURES: readonly PlanFixture[] = [
  { name: 'worked-example', envelope: WORKED_EXAMPLE_PLAN },
  { name: 'minimal', envelope: MINIMAL_PLAN },
  { name: 'generated-dialogue', envelope: GENERATED_DIALOGUE_PLAN },
  { name: 'preset-camera', envelope: PRESET_CAMERA_PLAN },
];

/**
 * A plan against the first scene of a live seed project: it stages one new cast member
 * on an anchor the scene's environment owns, and one line is delivered by an actor the
 * scene *already* contains — the `scene-actor` resolution path, as distinct from the
 * plan-cast path every new-scene fixture exercises.
 */
export function modifySeedScenePlan(project: Project): PlanEnvelope {
  const sceneId = project.scenes[0]?.id ?? 'scene_missing';
  return {
    planVersion: 1,
    kind: 'scene',
    title: 'Landlord knocks',
    createdAt: CREATED_AT,
    body: {
      sceneId,
      cast: [{ characterId: 'char.landlord', anchorId: 'anchor.kito_door', poseId: 'pose.handsOnHips', z: 30 }],
      dialogue: [
        { speaker: 'NIA', actorRef: 'char.nia', text: 'That is the landlord.', emotion: 'wary', start: 8, duration: 1 },
        { speaker: 'The Landlord', actorRef: 'char.landlord', text: 'Rent.', emotion: 'flat', start: 9.1, duration: 0.85 },
      ],
    },
  };
}

/** The plan context every test previews and applies against. */
export function seedPlanContext(): PlanContext {
  return { project: SEED_PROJECT, assets: SEED_SERIES.assets, series: SEED_SERIES };
}

/* ------------------------------------------------------------------ */
/* Invalid responses — the G7 shapes (§33 G7)                          */
/* ------------------------------------------------------------------ */

/** Made-up character referenced by both `cast` and `actorRef`. */
export const MISSING_CHARACTER_PLAN: PlanEnvelope = {
  planVersion: 1,
  kind: 'scene',
  title: 'Ghost scene',
  createdAt: CREATED_AT,
  body: {
    newScene: { name: 'Ghost', environmentId: 'env.nia_apartment', duration: 6 },
    cast: [{ characterId: 'char.ghost' }],
    dialogue: [{ speaker: 'GHOST', actorRef: 'char.ghost', text: 'Boo.', emotion: 'spooky' }],
  },
};

/** A duration of zero cannot hold a frame (G7 test 2). */
export const ZERO_DURATION_PLAN: PlanEnvelope = {
  planVersion: 1,
  kind: 'scene',
  title: 'No time',
  createdAt: CREATED_AT,
  body: { newScene: { name: 'Instant', environmentId: 'env.nia_apartment', duration: 0 } },
};

/** Prose where a plan was expected (G7 test 3). */
export const PROSE_RESPONSE =
  'Nia should walk in, see the mess, and decide to fix everything. Make it funny.';

/** Truncated JSON where a plan was expected (G7 test 3). */
export const TRUNCATED_JSON_RESPONSE = '{"planVersion": 1, "kind": "scen';

/** A kind a future version might invent (G7 test 3). */
export const UNKNOWN_KIND_RESPONSE: unknown = {
  planVersion: 1,
  kind: 'season',
  title: 'Future kind',
  createdAt: CREATED_AT,
  body: {},
};

/** A planVersion from the future (G7 test 3). */
export const FUTURE_VERSION_RESPONSE: unknown = {
  planVersion: 2,
  kind: 'scene',
  title: 'Future format',
  createdAt: CREATED_AT,
  body: {},
};
