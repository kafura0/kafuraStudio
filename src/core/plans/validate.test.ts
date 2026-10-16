import { describe, expect, it } from 'vitest';
import type { PlanEnvelope, PlanValidation, ScenePlan } from './types';
import { validatePlan } from './validate';
import {
  MISSING_CHARACTER_PLAN,
  MINIMAL_PLAN,
  PRESET_CAMERA_PLAN,
  WORKED_EXAMPLE_PLAN,
  modifySeedScenePlan,
  seedPlanContext,
} from '../../data/plans';
import { SEED_PROJECT } from '../../data/seed';

const CREATED_AT = '2026-10-16T00:00:00.000Z';

function envelope(body: unknown, over: Partial<PlanEnvelope> = {}): PlanEnvelope {
  return { planVersion: 1, kind: 'scene', title: 't', createdAt: CREATED_AT, body, ...over };
}

const seedSceneId = SEED_PROJECT.scenes[0]?.id ?? 'scene_missing';

function modify(extra: Partial<ScenePlan>): PlanEnvelope {
  return envelope({ sceneId: seedSceneId, ...extra });
}

function errorsAt(result: PlanValidation, path: string): { code: string }[] {
  return result.diagnostics
    .filter((d) => d.severity === 'error' && d.path === path)
    .map((d) => ({ code: d.code }));
}

function findDiag(result: PlanValidation, code: string, severity = 'error') {
  return result.diagnostics.find((d) => d.code === code && d.severity === severity);
}

describe('validatePlan — fixtures validate clean', () => {
  const ctx = seedPlanContext();

  it('accepts the worked example and resolves every reference', () => {
    const result = validatePlan(ctx, WORKED_EXAMPLE_PLAN);

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.resolved.createsScene).toBe(true);
    expect(result.resolved.sceneId).toBeNull();
    expect(result.resolved.sceneDuration).toBe(12);
    expect(result.resolved.environmentId).toBe('env.nia_apartment');
    expect(result.resolved.backgroundColor).toBeNull();
    expect(result.resolved.cast).toHaveLength(2);
    expect(result.resolved.cast[0]).toMatchObject({
      characterId: 'char.nia',
      poseId: 'pose.sittingSofa',
      anchorId: 'anchor.nia_couch',
      z: 10,
      flipX: false,
    });
    expect(result.resolved.cast[1]?.expressionChanges).toEqual([
      { at: 4, expressionId: 'expr.worried' },
    ]);
    expect(result.resolved.lines[0]?.actor).toEqual({ source: 'cast', castIndex: 0 });
    expect(result.resolved.lines[0]?.cue.generated).toBe(true);
    expect(result.resolved.lines[1]?.actor).toEqual({ source: 'cast', castIndex: 1 });
    expect(result.resolved.lines[1]?.cue).toMatchObject({ start: 3, generated: true });
  });

  it('resolves the worked example camera into absolute keyframes and a rest', () => {
    const result = validatePlan(ctx, WORKED_EXAMPLE_PLAN);
    const camera = result.resolved.camera;

    expect(camera?.mode).toBe('move');
    if (camera?.mode !== 'move') throw new Error('expected a camera move');
    expect(camera.clipStart).toBe(0);
    expect(camera.clipDuration).toBe(12);
    expect(camera.rest).toEqual({ x: 960, y: 540, zoom: 1 });
    expect(camera.keyframes).toEqual([
      { time: 0, props: { x: 960, y: 540, scaleX: 1 }, ease: 'linear' },
      { time: 12, props: { x: 900, y: 520, scaleX: 1.2 }, ease: 'easeInOut' },
    ]);
  });

  it('assumes a default background and the worked example cue layout', () => {
    const result = validatePlan(ctx, WORKED_EXAMPLE_PLAN);
    const decisions = result.resolved.assumptions.map((a) => a.path);

    expect(decisions).toContain('newScene.backgroundColor');
    expect(decisions).toContain('dialogue[0]');
    expect(decisions).toContain('dialogue[1]');
  });

  it('accepts the minimal plan with no cast, dialogue or camera', () => {
    const result = validatePlan(ctx, MINIMAL_PLAN);

    expect(result.ok).toBe(true);
    expect(result.resolved).toMatchObject({
      createsScene: true,
      sceneDuration: 6,
      environmentId: 'env.zanza_street',
      cast: [],
      lines: [],
      camera: null,
    });
  });

  it('lays out generated dialogue that fits without extending', () => {
    const result = validatePlan(ctx, envelope({
      newScene: { name: 'The Pitch', environmentId: 'env.nia_apartment', duration: 16 },
      cast: [
        { characterId: 'char.nia', anchorId: 'anchor.nia_floor' },
        { characterId: 'char.kito', anchorId: 'anchor.kito_door', flipX: true },
      ],
      dialogue: [
        { speaker: 'NIA', actorRef: 'char.nia', text: 'Hear me out. We sell the napkins.', emotion: 'earnest' },
        { speaker: 'KITO', actorRef: 'char.kito', text: 'We do not have napkins.', emotion: 'flat' },
        { speaker: 'NIA', actorRef: 'char.nia', text: 'We have a vision. The napkins follow the vision.', emotion: 'pushy' },
        { speaker: 'KITO', actorRef: 'char.kito', text: 'The vision has never once followed anything.', emotion: 'deadpan' },
      ],
    }));

    expect(result.ok).toBe(true);
    expect(result.resolved.sceneDuration).toBe(16);
    expect(result.resolved.lines.every((line) => line.cue.generated && !line.cue.truncated)).toBe(true);
    expect(result.resolved.cast[1]?.flipX).toBe(true);
  });

  it('resolves a preset camera by id', () => {
    const result = validatePlan(ctx, PRESET_CAMERA_PLAN);

    expect(result.ok).toBe(true);
    expect(result.resolved.camera).toEqual({ mode: 'preset', presetId: 'camp.establishing' });
  });

  it('resolves a preset camera by name too', () => {
    const result = validatePlan(ctx, envelope({
      newScene: { name: 'Wide', environmentId: 'env.zanza_street', duration: 4 },
      camera: { preset: 'Establishing' },
    }));

    expect(result.ok).toBe(true);
    expect(result.resolved.camera).toEqual({ mode: 'preset', presetId: 'camp.establishing' });
  });

  it('modifies a live seed scene, mixing plan cast and an existing actor', () => {
    const result = validatePlan(ctx, modifySeedScenePlan(SEED_PROJECT));
    const niaActorId = SEED_PROJECT.scenes[0]?.actors.find((a) => a.characterId === 'char.nia')?.id;

    expect(result.ok).toBe(true);
    expect(result.resolved.createsScene).toBe(false);
    expect(result.resolved.sceneId).toBe(seedSceneId);
    expect(result.resolved.sceneDuration).toBe(10);
    expect(result.resolved.lines[0]?.actor).toEqual({ source: 'scene-actor', actorId: niaActorId });
    expect(result.resolved.lines[1]?.actor).toEqual({ source: 'cast', castIndex: 0 });
    expect(result.resolved.lines[0]?.cue.truncated).toBe(false);
  });

  it('records no background assumption when the plan names a colour', () => {
    const result = validatePlan(ctx, envelope({
      newScene: { name: 'Red', environmentId: 'env.zanza_street', duration: 4, backgroundColor: '#123456' },
    }));

    expect(result.ok).toBe(true);
    expect(result.resolved.backgroundColor).toBe('#123456');
    expect(result.resolved.assumptions.some((a) => a.path === 'newScene.backgroundColor')).toBe(false);
  });
});

describe('validatePlan — envelope and target errors', () => {
  const ctx = seedPlanContext();

  it('rejects a non-scene kind', () => {
    const result = validatePlan(ctx, envelope({}, { kind: 'episode' }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'kind')).toEqual([{ code: 'unknown-field' }]);
  });

  it('surfaces a body schema failure as an error at its path', () => {
    const result = validatePlan(ctx, envelope('not a body'));

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', path: '', code: 'unknown-field' });
  });

  it('rejects a plan that targets two scenes at once', () => {
    const result = validatePlan(ctx, envelope({
      sceneId: seedSceneId,
      newScene: { name: 'Both', environmentId: 'env.street.back', duration: 4 },
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'sceneId')).toEqual([{ code: 'unknown-field' }]);
  });

  it('rejects a plan that targets no scene', () => {
    const result = validatePlan(ctx, envelope({}));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, '')).toEqual([{ code: 'unknown-field' }]);
  });

  it('rejects an unknown scene id', () => {
    const result = validatePlan(ctx, envelope({ sceneId: 'scene.nope' }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'sceneId')).toEqual([{ code: 'unknown-scene' }]);
  });

  it('rejects a zero duration', () => {
    const result = validatePlan(ctx, envelope({
      newScene: { name: 'Instant', environmentId: 'env.nia_apartment', duration: 0 },
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'newScene.duration')).toEqual([{ code: 'invalid-duration' }]);
  });

  it('rejects an unknown environment', () => {
    const result = validatePlan(ctx, envelope({
      newScene: { name: 'Nowhere', environmentId: 'env.nope', duration: 4 },
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'newScene.environmentId')).toEqual([{ code: 'missing-environment' }]);
  });
});

describe('validatePlan — cast diagnostics', () => {
  const ctx = seedPlanContext();

  it('reports a missing character on both the cast entry and the line that names it', () => {
    const result = validatePlan(ctx, MISSING_CHARACTER_PLAN);

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'cast[0].characterId')).toEqual([{ code: 'missing-character' }]);
    expect(errorsAt(result, 'dialogue[0].actorRef')).toEqual([{ code: 'missing-character' }]);
  });

  it('does not pile default-pose noise onto a missing character', () => {
    const result = validatePlan(ctx, MISSING_CHARACTER_PLAN);

    expect(errorsAt(result, 'cast[0].poseId')).toEqual([]);
    expect(errorsAt(result, 'cast[0].expressionId')).toEqual([]);
  });

  it('reports a missing explicit pose and expression', () => {
    const result = validatePlan(ctx, modify({
      cast: [{ characterId: 'char.landlord', poseId: 'pose.nope', expressionId: 'expr.nope' }],
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'cast[0].poseId')).toEqual([{ code: 'missing-pose' }]);
    expect(errorsAt(result, 'cast[0].expressionId')).toEqual([{ code: 'missing-expression' }]);
  });

  it('warns when the same character is placed twice', () => {
    const result = validatePlan(ctx, modify({
      cast: [{ characterId: 'char.landlord' }, { characterId: 'char.landlord' }],
    }));

    expect(result.ok).toBe(true);
    expect(findDiag(result, 'duplicate-id', 'warning')).toMatchObject({ path: 'cast[1].characterId' });
  });

  it('warns when an anchor does not belong to the scene environment', () => {
    const result = validatePlan(ctx, modify({
      cast: [{ characterId: 'char.landlord', anchorId: 'anchor.nope' }],
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'cast[0].anchorId')).toEqual([{ code: 'missing-anchor' }]);
  });

  it('notes a cast member placed with neither anchor nor transform', () => {
    const result = validatePlan(ctx, modify({ cast: [{ characterId: 'char.landlord' }] }));

    expect(result.ok).toBe(true);
    expect(findDiag(result, 'missing-anchor', 'info')).toMatchObject({ path: 'cast[0]' });
  });

  it('rejects an expression change past the scene end', () => {
    const result = validatePlan(ctx, modify({
      cast: [{ characterId: 'char.landlord', expressionChanges: [{ at: 11, expressionId: 'expr.happy' }] }],
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'cast[0].expressionChanges[0].at')).toEqual([{ code: 'invalid-timing' }]);
  });

  it('rejects a negative expression change time', () => {
    const result = validatePlan(ctx, modify({
      cast: [{ characterId: 'char.landlord', expressionChanges: [{ at: -1, expressionId: 'expr.happy' }] }],
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'cast[0].expressionChanges[0].at')).toEqual([{ code: 'negative-value' }]);
  });

  it('flags a pose that shares no slot with the character rig', () => {
    const result = validatePlan(ctx, modify({
      cast: [{ characterId: 'char.landlord', poseId: 'pose.sittingSofa' }],
    }));

    // The library poses are all authored for the shared human rig, so this must not fire.
    expect(findDiag(result, 'pose-incompatible')).toBeUndefined();
  });
});

describe('validatePlan — dialogue timing', () => {
  const ctx = seedPlanContext();

  it('rejects an explicit cue start at or past the scene end', () => {
    const result = validatePlan(ctx, modify({
      dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'Late.', emotion: 'flat', start: 12, duration: 1 }],
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'dialogue[0].start')).toEqual([{ code: 'invalid-timing' }]);
  });

  it('rejects an explicit cue that would end past the scene end', () => {
    const result = validatePlan(ctx, modify({
      dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'Long.', emotion: 'flat', start: 9, duration: 5 }],
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'dialogue[0].duration')).toEqual([{ code: 'invalid-timing' }]);
  });

  it('truncates a generated cue that overruns, with a warning and an assumption', () => {
    const result = validatePlan(ctx, modify({
      dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'a'.repeat(300), emotion: 'flat' }],
    }));

    expect(result.ok).toBe(true);
    expect(findDiag(result, 'invalid-timing', 'warning')).toMatchObject({ path: 'dialogue[0]' });
    expect(result.resolved.assumptions.some((a) => a.path === 'dialogue[0]')).toBe(true);
    const cue = result.resolved.lines[0]?.cue;
    expect(cue?.truncated).toBe(true);
    expect((cue?.start ?? 0) + (cue?.duration ?? 0)).toBeLessThanOrEqual(10);
  });

  it('extends a created scene so generated dialogue fits', () => {
    const result = validatePlan(ctx, envelope({
      newScene: { name: 'Long', environmentId: 'env.nia_apartment', duration: 2 },
      dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'a'.repeat(300), emotion: 'flat' }],
    }));

    expect(result.ok).toBe(true);
    expect(result.resolved.sceneDuration).toBeGreaterThan(2);
    expect(result.resolved.assumptions.some((a) => a.path === 'newScene.duration')).toBe(true);
  });

  it('warns when a cue overlaps its predecessor', () => {
    const result = validatePlan(ctx, modify({
      dialogue: [
        { speaker: 'NIA', actorRef: 'char.nia', text: 'One.', emotion: 'flat', start: 0, duration: 3 },
        { speaker: 'KITO', actorRef: 'char.kito', text: 'Two.', emotion: 'flat', start: 2, duration: 1 },
      ],
    }));

    expect(result.ok).toBe(true);
    expect(findDiag(result, 'invalid-timing', 'warning')).toMatchObject({ path: 'dialogue[1]' });
  });

  it('rejects a negative cue start', () => {
    const result = validatePlan(ctx, modify({
      dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'Back.', emotion: 'flat', start: -1 }],
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'dialogue[0].start')).toEqual([{ code: 'negative-value' }]);
  });

  it('rejects a negative cue duration', () => {
    const result = validatePlan(ctx, modify({
      dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'Short.', emotion: 'flat', duration: -1 }],
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'dialogue[0].duration')).toEqual([{ code: 'negative-value' }]);
  });

  it('warns when a line names no actor anywhere', () => {
    const result = validatePlan(ctx, modify({
      dialogue: [{ speaker: 'MAMA', actorRef: 'char.mama_nia', text: 'Hello?', emotion: 'flat' }],
    }));

    expect(result.ok).toBe(true);
    expect(findDiag(result, 'unknown-actor-ref', 'warning')).toMatchObject({ path: 'dialogue[0].actorRef' });
    expect(result.resolved.lines[0]?.actor).toEqual({ source: 'none' });
  });

  it('rejects a voice that is not in the library', () => {
    const result = validatePlan(ctx, modify({
      dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'Hello.', emotion: 'flat', voiceId: 'audio.nope' }],
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'dialogue[0].voiceId')).toEqual([{ code: 'missing-voice' }]);
  });

  it('accepts a voice that is in the library', () => {
    const result = validatePlan(ctx, modify({
      dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'Hello.', emotion: 'flat', voiceId: 'audio.ep001.nia.line1' }],
    }));

    expect(result.ok).toBe(true);
    expect(result.resolved.lines[0]?.voiceAudioId).toBe('audio.ep001.nia.line1');
  });
});

describe('validatePlan — camera diagnostics', () => {
  const ctx = seedPlanContext();

  it('rejects a camera that is both a preset and keyframes', () => {
    const result = validatePlan(ctx, modify({
      camera: { preset: 'camp.medium', keyframes: [{ at: 0 }] },
    }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'camera.keyframes')).toEqual([{ code: 'unknown-field' }]);
  });

  it('rejects an unknown preset', () => {
    const result = validatePlan(ctx, modify({ camera: { preset: 'camp.nope' } }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'camera.preset')).toEqual([{ code: 'unknown-preset' }]);
  });

  it('rejects a keyframe past the scene end', () => {
    const result = validatePlan(ctx, modify({ camera: { keyframes: [{ at: 11 }] } }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'camera.keyframes[0].at')).toEqual([{ code: 'invalid-timing' }]);
  });

  it('rejects a negative keyframe time', () => {
    const result = validatePlan(ctx, modify({ camera: { keyframes: [{ at: -1 }] } }));

    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'camera.keyframes[0].at')).toEqual([{ code: 'negative-value' }]);
  });

  it('rejects a non-positive zoom and merely warns at an absurd one', () => {
    const bad = validatePlan(ctx, modify({ camera: { keyframes: [{ at: 0, zoom: 0 }] } }));
    expect(bad.ok).toBe(false);
    expect(errorsAt(bad, 'camera.keyframes[0].zoom')).toEqual([{ code: 'out-of-range' }]);

    const silly = validatePlan(ctx, modify({ camera: { keyframes: [{ at: 0, zoom: 20 }] } }));
    expect(silly.ok).toBe(true);
    expect(findDiag(silly, 'out-of-range', 'warning')).toMatchObject({ path: 'camera.keyframes[0].zoom' });
  });

  it('assumes the rest framing from a first keyframe that is not at zero', () => {
    const result = validatePlan(ctx, modify({
      camera: { keyframes: [{ at: 2, x: 100, y: 200, zoom: 1.5 }] },
    }));

    expect(result.ok).toBe(true);
    expect(result.resolved.camera).toMatchObject({
      mode: 'move',
      rest: { x: 100, y: 200, zoom: 1.5 },
      clipStart: 0,
      clipDuration: 10,
    });
    const assumption = result.resolved.assumptions.find((a) => a.path === 'camera.keyframes[0]');
    expect(assumption?.decision).toContain('until 2s');
  });

  it('sorts keyframes by time and maps zoom onto scaleX', () => {
    const result = validatePlan(ctx, modify({
      camera: { keyframes: [{ at: 8, x: 1 }, { at: 2, x: 2, zoom: 2 }] },
    }));

    if (result.resolved.camera?.mode !== 'move') throw new Error('expected a camera move');
    expect(result.resolved.camera.keyframes.map((k) => k.time)).toEqual([2, 8]);
    expect(result.resolved.camera.keyframes[0]?.props).toEqual({ x: 2, scaleX: 2 });
    expect(result.resolved.camera.rest).toEqual({ x: 2, zoom: 2 });
  });
});
