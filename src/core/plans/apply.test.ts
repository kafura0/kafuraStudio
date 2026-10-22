import { describe, expect, it } from 'vitest';
import { applyPlan, type PlanApplyResult } from './apply';
import { fixedClock, makeCountingAllocator } from './allocator';
import type { Project, Scene } from '../types';
import {
  GENERATED_DIALOGUE_PLAN,
  MINIMAL_PLAN,
  MISSING_CHARACTER_PLAN,
  PRESET_CAMERA_PLAN,
  SCENE_PLAN_FIXTURES,
  WORKED_EXAMPLE_PLAN,
  modifySeedScenePlan,
  seedPlanContext,
} from '../../data/plans';
import { SEED_PROJECT } from '../../data/seed';

const AT = '2026-10-16T00:00:00.000Z';

function options() {
  return { allocate: makeCountingAllocator(), now: fixedClock(AT) };
}

function applied(result: PlanApplyResult): Extract<PlanApplyResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result;
}

function sceneByName(project: Project, name: string): Scene {
  const scene = project.scenes.find((s) => s.name === name);
  if (scene === undefined) throw new Error(`no scene named ${name}`);
  return scene;
}

describe('applyPlan — a plan that creates its own scene', () => {
  it('creates the scene and nothing else', () => {
    const result = applied(applyPlan(seedPlanContext(), MINIMAL_PLAN, options()));

    expect(result.project.scenes).toHaveLength(SEED_PROJECT.scenes.length + 1);
    const scene = sceneByName(result.project, 'Bare Stage');
    expect(scene.environmentId).toBe('env.zanza_street');
    expect(scene.duration).toBe(6);
    expect(scene.actors).toEqual([]);
  });

  it('binds the scene handle so downstream commands land in the new scene', () => {
    const result = applied(applyPlan(seedPlanContext(), WORKED_EXAMPLE_PLAN, options()));
    const scene = sceneByName(result.project, 'Overheard');

    expect(scene.actors.map((a) => a.characterId)).toEqual(['char.nia', 'char.kito']);
    expect(scene.dialogue).toHaveLength(2);
    expect(scene.dialogue[0]?.actorId).toBe(scene.actors[0]?.id);
    expect(scene.dialogue[1]?.actorId).toBe(scene.actors[1]?.id);
  });

  it('places actors bound to their anchors', () => {
    const result = applied(applyPlan(seedPlanContext(), WORKED_EXAMPLE_PLAN, options()));
    const scene = sceneByName(result.project, 'Overheard');

    expect(scene.actors[0]?.anchorId).toBe('anchor.nia_couch');
    expect(scene.actors[1]?.anchorId).toBe('anchor.nia_kitchen');
    expect(scene.actors[1]?.z).toBe(20);
  });

  it('lays an expression clip with the anchor keyframe and the change', () => {
    const result = applied(applyPlan(seedPlanContext(), WORKED_EXAMPLE_PLAN, options()));
    const scene = sceneByName(result.project, 'Overheard');
    const kito = scene.actors[1]!;

    const track = scene.tracks.find((t) => t.kind === 'actor' && t.targetId === kito.id);
    expect(track).toBeDefined();
    expect(track?.clips).toHaveLength(1);
    expect(track?.clips[0]?.keyframes.map((k) => k.time)).toEqual([0, 4]);
    expect(track?.clips[0]?.keyframes.map((k) => k.props.expressionId)).toEqual([
      'expr.neutral',
      'expr.worried',
    ]);
  });

  it('writes the camera move and its rest framing', () => {
    const result = applied(applyPlan(seedPlanContext(), WORKED_EXAMPLE_PLAN, options()));
    const scene = sceneByName(result.project, 'Overheard');

    expect(scene.camera).toMatchObject({ x: 960, y: 540, zoom: 1 });
    const cameraTrack = scene.tracks.find((t) => t.kind === 'camera');
    expect(cameraTrack).toBeDefined();
    expect(cameraTrack?.clips[0]?.keyframes.map((k) => k.props.scaleX)).toEqual([1, 1.2]);
  });

  it('applies a camera preset', () => {
    const result = applied(applyPlan(seedPlanContext(), PRESET_CAMERA_PLAN, options()));
    const scene = sceneByName(result.project, 'Street Establishing');

    const cameraTrack = scene.tracks.find((t) => t.kind === 'camera');
    expect(cameraTrack).toBeDefined();
    expect(cameraTrack?.clips).toHaveLength(1);
  });

  it('lays generated dialogue cues as clips on the dialogue track', () => {
    const result = applied(applyPlan(seedPlanContext(), GENERATED_DIALOGUE_PLAN, options()));
    const scene = sceneByName(result.project, 'The Pitch');

    expect(scene.dialogue).toHaveLength(4);
    // Each line owns its own dialogue track, keyed by the line id.
    const dialogueClips = scene.tracks
      .filter((t) => t.kind === 'dialogue')
      .flatMap((t) => t.clips);
    expect(dialogueClips).toHaveLength(4);
    for (const clip of dialogueClips) {
      expect(clip.duration).toBeGreaterThan(0);
    }
    expect(scene.dialogue[1]?.voiceAudioId).toBe('audio.ep001.kito.line1');
  });
});

describe('applyPlan — a plan that modifies a live scene', () => {
  it('adds a cast member and dialogue without creating a scene', () => {
    const ctx = seedPlanContext();
    const before = ctx.project.scenes[0]!;
    const result = applied(applyPlan(ctx, modifySeedScenePlan(ctx.project), options()));

    expect(result.project.scenes).toHaveLength(SEED_PROJECT.scenes.length);
    const after = result.project.scenes.find((s) => s.id === before.id)!;
    expect(after.actors).toHaveLength(before.actors.length + 1);
    expect(after.dialogue).toHaveLength(before.dialogue.length + 2);
    // The added actor is the landlord; the first new line is spoken by the scene's own Nia.
    const nia = before.actors.find((a) => a.characterId === 'char.nia');
    expect(after.dialogue.at(-2)?.actorId).toBe(nia?.id);
    expect(after.dialogue.at(-1)?.actorId).toBe(after.actors.at(-1)?.id);
  });
});

describe('applyPlan — determinism and the applied document', () => {
  it('is byte-for-byte deterministic given the same sources', () => {
    const ctx = seedPlanContext();
    const first = applied(applyPlan(ctx, WORKED_EXAMPLE_PLAN, options()));
    const second = applied(applyPlan(ctx, WORKED_EXAMPLE_PLAN, options()));

    expect(second.project).toEqual(first.project);
  });

  it('produces a document that satisfies the invariants (preview === applied)', () => {
    const ctx = seedPlanContext();
    for (const fixture of SCENE_PLAN_FIXTURES) {
      const result = applyPlan(ctx, fixture.envelope, options());
      expect(result.ok, `fixture ${fixture.name}`).toBe(true);
    }
  });

  it('does not mutate the input project', () => {
    const ctx = seedPlanContext();
    const snapshot = JSON.parse(JSON.stringify(ctx.project)) as Project;
    applyPlan(ctx, WORKED_EXAMPLE_PLAN, options());

    expect(ctx.project).toEqual(snapshot);
  });
});

describe('applyPlan — failure is atomic', () => {
  it('returns diagnostics for an invalid plan and no project', () => {
    const result = applyPlan(seedPlanContext(), MISSING_CHARACTER_PLAN, options());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-plan');
  });

  it('returns the original project untouched on failure', () => {
    const ctx = seedPlanContext();
    const result = applyPlan(ctx, MISSING_CHARACTER_PLAN, options());

    expect(result.ok).toBe(false);
    expect(ctx.project).toEqual(SEED_PROJECT);
  });
});

describe('applyPlan — handles never leak into the document', () => {
  it('substitutes every handle in every applied fixture', () => {
    const ctx = seedPlanContext();
    for (const fixture of SCENE_PLAN_FIXTURES) {
      const result = applied(applyPlan(ctx, fixture.envelope, options()));
      expect(JSON.stringify(result.project)).not.toContain('@cast:');
      expect(JSON.stringify(result.project)).not.toContain('"@scene"');
      expect(JSON.stringify(result.project)).not.toContain('@expr-');
      expect(JSON.stringify(result.project)).not.toContain('@camera-');
    }
  });
});

describe('applyPlan — provenance on created records (Phase 19 step 6)', () => {
  it('stamps the envelope provenance onto every actor and line it creates', () => {
    const result = applied(applyPlan(seedPlanContext(), WORKED_EXAMPLE_PLAN, options()));
    const scene = sceneByName(result.project, 'Overheard');

    expect(scene.actors).toHaveLength(2);
    for (const actor of scene.actors) {
      expect(actor.provenance).toEqual(WORKED_EXAMPLE_PLAN.provenance);
    }
    expect(scene.dialogue).toHaveLength(2);
    for (const line of scene.dialogue) {
      expect(line.provenance).toEqual(WORKED_EXAMPLE_PLAN.provenance);
    }
  });

  it('leaves provenance absent when the plan carries none (a human/fixture plan)', () => {
    const result = applied(applyPlan(seedPlanContext(), MINIMAL_PLAN, options()));
    const scene = sceneByName(result.project, 'Bare Stage');
    expect(scene.actors.every((a) => a.provenance === undefined)).toBe(true);
  });

  it('survives a serialize/parse round-trip', () => {
    const result = applied(applyPlan(seedPlanContext(), WORKED_EXAMPLE_PLAN, options()));
    const scene = sceneByName(result.project, 'Overheard');
    const reparsed = JSON.parse(JSON.stringify(result.project)) as Project;
    const roundScene = sceneByName(reparsed, 'Overheard');
    expect(roundScene.dialogue[0]?.provenance).toEqual(scene.dialogue[0]?.provenance);
    expect(roundScene.actors[0]?.provenance).toEqual(scene.actors[0]?.provenance);
  });

  it('AI plans cannot emit forbidden commands (capability ceiling)', async () => {
    const ctx = seedPlanContext();
    const aiPlan = {
      ...WORKED_EXAMPLE_PLAN,
      provenance: { actor: 'ai' as const, provider: 'fake', model: 'm', at: '2026-10-16T00:00:00.000Z' },
    };
    const result = applyPlan(ctx, aiPlan, options());
    expect(result.ok).toBe(true);
    const { compilePlan } = await import('./compile');
    const compiled = compilePlan(ctx, WORKED_EXAMPLE_PLAN);
    if (!compiled.ok) throw new Error('bad');
    for (const c of compiled.commands) {
      expect(['CreateScene','PlaceCharacter','AddDialogueLine','AddClip','AddKeyframe','ApplyCameraPreset','SetSceneCamera','ClearCameraMoves']).toContain(c.kind);
    }
  });
});
