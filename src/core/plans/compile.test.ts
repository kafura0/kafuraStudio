import { describe, expect, it } from 'vitest';
import { compilePlan } from './compile';
import type { Command } from '../commands/types';
import type { AddClipCommand } from '../commands/addClip';
import type { AddDialogueLineCommand } from '../commands/addDialogueLine';
import type { AddKeyframeCommand } from '../commands/addKeyframe';
import type { PlaceCharacterCommand } from '../commands/placeCharacter';
import type { SetSceneCameraCommand } from '../commands/setSceneCamera';
import type { CompileResult } from './types';
import {
  MINIMAL_PLAN,
  MISSING_CHARACTER_PLAN,
  PRESET_CAMERA_PLAN,
  SCENE_PLAN_FIXTURES,
  WORKED_EXAMPLE_PLAN,
  modifySeedScenePlan,
  seedPlanContext,
} from '../../data/plans';

function kinds(commands: readonly Command[]): string[] {
  return commands.map((command) => command.kind);
}

function compileOk(result: CompileResult): Extract<CompileResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.diagnostics)}`);
  return result;
}

function keyframesOn(commands: readonly Command[], trackId: string): AddKeyframeCommand[] {
  return commands
    .filter((command) => command.kind === 'AddKeyframe')
    .map((command) => command as AddKeyframeCommand)
    .filter((command) => command.trackId === trackId);
}

function clipsTargeting(commands: readonly Command[], targetId: string): AddClipCommand[] {
  return commands
    .filter((command) => command.kind === 'AddClip')
    .map((command) => command as AddClipCommand)
    .filter((command) => command.targetId === targetId);
}

describe('compilePlan — a free scene', () => {
  const ctx = seedPlanContext();

  it('compiles a bare plan to a single CreateScene', () => {
    const result = compileOk(compilePlan(ctx, MINIMAL_PLAN));

    expect(kinds(result.commands)).toEqual(['CreateScene']);
    expect(result.commands[0]).toMatchObject({
      kind: 'CreateScene',
      name: 'Bare Stage',
      environmentId: 'env.zanza_street',
      duration: 6,
      sceneRef: '@scene',
    });
    // No backgroundColor given -> the field is omitted and the factory default recorded.
    expect('backgroundColor' in (result.commands[0] ?? {})).toBe(false);
    expect(result.assumptions.some((a) => a.path === 'newScene.backgroundColor')).toBe(true);
  });

  it('emits scene, cast, dialogue, camera in §11.6 order', () => {
    const result = compileOk(compilePlan(ctx, WORKED_EXAMPLE_PLAN));

    expect(kinds(result.commands)).toEqual([
      'CreateScene',
      'PlaceCharacter',
      'PlaceCharacter',
      'AddDialogueLine',
      'AddDialogueLine',
      'AddClip',
      'AddKeyframe',
      'AddKeyframe',
      'SetSceneCamera',
      'AddClip',
      'AddKeyframe',
      'AddKeyframe',
    ]);
  });

  it('carries the scene handle into every downstream id field', () => {
    const result = compileOk(compilePlan(ctx, WORKED_EXAMPLE_PLAN));
    const [createScene, ...rest] = result.commands;

    expect(createScene).toMatchObject({ kind: 'CreateScene', sceneRef: '@scene' });
    for (const command of rest) {
      expect((command as { sceneId?: string }).sceneId).toBe('@scene');
    }
  });

  it('gives each cast member an actor handle and points dialogue at it', () => {
    const result = compileOk(compilePlan(ctx, WORKED_EXAMPLE_PLAN));
    const placed = result.commands.filter((c): c is PlaceCharacterCommand => c.kind === 'PlaceCharacter');
    const lines = result.commands.filter((c): c is AddDialogueLineCommand => c.kind === 'AddDialogueLine');

    expect(placed.map((c) => c.actorRef)).toEqual(['@cast:0', '@cast:1']);
    expect(lines.map((c) => c.actorId)).toEqual(['@cast:0', '@cast:1']);
  });

  it('maps camera zoom to scaleX and keeps the rest framing on the scene', () => {
    const result = compileOk(compilePlan(ctx, WORKED_EXAMPLE_PLAN));

    const setCamera = result.commands.find((c): c is SetSceneCameraCommand => c.kind === 'SetSceneCamera');
    expect(setCamera).toMatchObject({ patch: { x: 960, y: 540, zoom: 1 } });

    const cameraKeyframes = keyframesOn(result.commands, '@camera-track');
    expect(cameraKeyframes).toHaveLength(2);
    expect(cameraKeyframes[1]?.props).toEqual({ x: 900, y: 520, scaleX: 1.2 });
  });

  it('anchors an expression clip at 0 with the entry expression', () => {
    const result = compileOk(compilePlan(ctx, WORKED_EXAMPLE_PLAN));

    const expressionClip = clipsTargeting(result.commands, '@cast:1')[0];
    expect(expressionClip).toMatchObject({ trackRef: '@expr-track:1', clipRef: '@expr-clip:1' });

    const expressionKeyframes = keyframesOn(result.commands, '@expr-track:1');
    expect(expressionKeyframes.map((c) => c.time)).toEqual([0, 4]);
    expect(expressionKeyframes[0]?.props).toEqual({ expressionId: 'expr.neutral' });
    expect(expressionKeyframes[1]?.props).toEqual({ expressionId: 'expr.worried' });
    expect(result.assumptions.some((a) => a.path === 'cast[1].expressionChanges')).toBe(true);
  });
});

describe('compilePlan — a camera preset', () => {
  it('compiles a preset to a single ApplyCameraPreset', () => {
    const result = compileOk(compilePlan(seedPlanContext(), PRESET_CAMERA_PLAN));
    const cameraCommands = result.commands.filter(
      (c) => c.kind === 'ApplyCameraPreset' || c.kind === 'ClearCameraMoves' || c.kind === 'SetSceneCamera',
    );

    expect(cameraCommands).toEqual([
      { kind: 'ApplyCameraPreset', sceneId: '@scene', presetId: 'camp.establishing' },
    ]);
  });
});

describe('compilePlan — a live scene', () => {
  it('does not clear camera moves when the plan sets none', () => {
    const ctx = seedPlanContext();
    const result = compileOk(compilePlan(ctx, modifySeedScenePlan(ctx.project)));

    expect(kinds(result.commands)).not.toContain('ClearCameraMoves');
    expect(kinds(result.commands)).not.toContain('CreateScene');
  });

  it('clears existing camera moves before laying a new one over a live scene', () => {
    const ctx = seedPlanContext();
    const base = modifySeedScenePlan(ctx.project);
    const withCamera = {
      ...base,
      body: { ...(base.body as object), camera: { keyframes: [{ at: 0, zoom: 1 }, { at: 9, zoom: 1.4 }] } },
    };
    const result = compileOk(compilePlan(ctx, withCamera));

    const sequence = kinds(result.commands);
    const clearIndex = sequence.indexOf('ClearCameraMoves');
    const cameraClipIndex = sequence.lastIndexOf('AddClip');
    expect(clearIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeLessThan(cameraClipIndex);
  });

  it('targets the existing scene id rather than a handle', () => {
    const ctx = seedPlanContext();
    const sceneId = ctx.project.scenes[0]!.id;
    const result = compileOk(compilePlan(ctx, modifySeedScenePlan(ctx.project)));

    for (const command of result.commands) {
      expect((command as { sceneId?: string }).sceneId).toBe(sceneId);
    }
  });
});

describe('compilePlan — invalid plans compile to diagnostics, not commands', () => {
  it('refuses a plan the validator rejected', () => {
    const result = compilePlan(seedPlanContext(), MISSING_CHARACTER_PLAN);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.code === 'missing-character')).toBe(true);
  });

  it('compiles every static fixture', () => {
    const ctx = seedPlanContext();
    for (const fixture of SCENE_PLAN_FIXTURES) {
      const result = compilePlan(ctx, fixture.envelope);
      expect(result.ok, `fixture ${fixture.name}`).toBe(true);
    }
  });
});
