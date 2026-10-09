/**
 * Command layer surface (Phase 16 P2 + P3): dispatch, argument validation, the §22.3
 * post-validation on the single command, the immutable-on-failure promise, and the
 * fold determinism that the injected `allocate`/`now` buy (§7.4).
 */
import { describe, expect, it } from 'vitest';
import { createEpisode, createActor, createProject, createScene } from '../document/factories';
import { validateProject } from '../document/invariants';
import type { Project } from '../types';
import type { Command, CommandContext, CommandResult } from './types';
import { applyCommand, defineCommand } from './index';

const POSE_A = { id: 'pose-a', name: 'A', description: '', tags: [], slots: {} };
const POSE_B = { id: 'pose-b', name: 'B', description: '', tags: [], slots: {} };
const EXPR = { id: 'expr-1', name: 'X', description: '', tags: [], slots: {} };
const CHARACTER = {
  id: 'char-1',
  name: 'Cast Member',
  description: '',
  tags: [],
  palette: {},
  rig: [],
  mouthSlot: 'mouth',
  height: 100,
  defaultPoseId: POSE_A.id,
  defaultExpressionId: EXPR.id,
};
const ENV = {
  id: 'env-1',
  name: 'E',
  description: '',
  tags: [],
  width: 1280,
  height: 720,
  layers: [],
  anchors: [],
  lighting: { ambient: '#ffffff', overlayColor: null, vignette: 0 },
};

function makeProject(): { project: Project; sceneId: string; actorId: string } {
  const base = createProject('Commands test');
  const scene = createScene('S1', ENV.id, { duration: 10 });
  const actor = createActor(CHARACTER.id, CHARACTER.name, POSE_A.id, EXPR.id);
  return {
    project: {
      ...base,
      episodes: [createEpisode('E1', '')],
      scenes: [{ ...scene, actors: [actor] }],
      assets: {
        ...base.assets,
        characters: [CHARACTER],
        environments: [ENV],
        poses: [POSE_A, POSE_B],
        expressions: [EXPR],
      },
    },
    sceneId: scene.id,
    actorId: actor.id,
  };
}

function ctxFor(project: Project, patches: Partial<CommandContext> = {}): CommandContext {
  return {
    project,
    series: null,
    allocate: (prefix) => `alloc-${prefix}`,
    now: () => 'fixed-time',
    ...patches,
  };
}

function actorOf(project: Project, actorId: string) {
  return project.scenes[0]?.actors.find((a) => a.id === actorId);
}

/** A deterministic id allocator: separate calls (same seed) produce the same sequence. */
function countingAllocator(startAt = 0): (prefix: string) => string {
  let i = startAt;
  return (prefix) => `${prefix}_seed${i++}`;
}

/** Fold a command sequence with `applyCommand`, as the plan layer will (§8.3). */
function fold(commands: readonly Command[], ctx: CommandContext): { project: Project; errors: string[] } {
  let project = ctx.project;
  for (const command of commands) {
    const result = applyCommand(command, { ...ctx, project });
    if (!result.ok) return { project: ctx.project, errors: [result.error.message] };
    project = result.project;
  }
  return { project, errors: [] };
}

// Throwaway kinds exercised only by the tests below. Registered once per file — the
// registry is module-local, so these cannot leak into app kinds.
defineCommand<Command>('test.Throws', () => {
  throw new Error('boom');
});
defineCommand<Command>('test.BreakDocument', (_command, ctx) => {
  const episode = ctx.project.episodes[0];
  return episode
    ? {
        ok: true,
        project: {
          ...ctx.project,
          episodes: [{ ...episode, sceneIds: [...episode.sceneIds, 'missing-scene'] }],
        },
      }
    : { ok: false, error: { code: 'invalid-argument', message: 'no episode' } };
});

function expectError(result: CommandResult): { code: string; message?: string } {
  if (result.ok) throw new Error('expected a failed command, got a document');
  return { code: result.error.code, message: result.error.message };
}

describe('applyCommand — the SetActorPose reference command', () => {
  it('applies the command and returns a new document', () => {
    const { project, sceneId, actorId } = makeProject();
    const result = applyCommand({ kind: 'SetActorPose', sceneId, actorId, poseId: POSE_B.id }, ctxFor(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).not.toBe(project);
    expect(actorOf(result.project, actorId)?.poseId).toBe(POSE_B.id);
    expect(actorOf(project, actorId)?.poseId).toBe(POSE_A.id);
  });

  it('treats ctx.assets as the authority for argument existence, not the project alone', () => {
    const { project, sceneId, actorId } = makeProject();
    // The project owns pose-a and pose-b, but a series-owned merged view could still
    // not expose them. The command must reject on what it was handed, not on the
    // project's own library.
    const merged = { ...project.assets, poses: [] };
    const rejected = applyCommand(
      { kind: 'SetActorPose', sceneId, actorId, poseId: POSE_B.id },
      ctxFor(project, { assets: merged }),
    );
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('not-found');
    expect(rejected.error.message).toContain('No such pose');

    const accepted = applyCommand(
      { kind: 'SetActorPose', sceneId, actorId, poseId: POSE_B.id },
      ctxFor(project, { assets: { ...merged, poses: [POSE_B] } }),
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(actorOf(accepted.project, actorId)?.poseId).toBe(POSE_B.id);
  });

  it('rejects an unknown kind without touching the document', () => {
    const { project, actorId } = makeProject();
    const result = applyCommand({ kind: 'No.Such.Kind' }, ctxFor(project));
    expect(result).toEqual({
      ok: false,
      error: { code: 'not-found', message: `No command registered under kind 'No.Such.Kind'` },
    });
    expect(actorOf(project, actorId)?.poseId).toBe(POSE_A.id);
  });

  it('rejects an unknown scene', () => {
    const { project, actorId } = makeProject();
    const result = applyCommand({ kind: 'SetActorPose', sceneId: 'nope', actorId, poseId: POSE_B.id }, ctxFor(project));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
    expect(result.error.path).toBe('scenes[nope]');
  });

  it('rejects an unknown actor', () => {
    const { project, sceneId } = makeProject();
    const result = applyCommand({ kind: 'SetActorPose', sceneId, actorId: 'nope', poseId: POSE_B.id }, ctxFor(project));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
  });

  it('rejects a pose that is in neither the project library nor ctx.assets', () => {
    const { project, sceneId, actorId } = makeProject();
    const result = applyCommand({ kind: 'SetActorPose', sceneId, actorId, poseId: 'not-a-pose' }, ctxFor(project));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
    expect(result.error.message).toContain('No such pose');
  });

  it('returns the document unchanged when a command fails', () => {
    const { project, sceneId } = makeProject();
    const before = JSON.stringify(project);
    applyCommand({ kind: 'SetActorPose', sceneId, actorId: 'nope', poseId: POSE_B.id }, ctxFor(project));
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe('applyCommand — failure modes that are the infrastructure', () => {
  it('surfaces a throwing handler as an internal error', () => {
    const { project } = makeProject();
    const { code } = expectError(applyCommand({ kind: 'test.Throws' }, ctxFor(project)));
    expect(code).toBe('internal');
    expect(project.scenes[0]?.actors[0]?.poseId).toBe(POSE_A.id);
  });

  it('rejects a document the command itself left invalid (invalid-result, §22.3)', () => {
    const { project } = makeProject();
    // Guard: the crafted broken document really is invalid, or this test asserts nothing.
    const broken = {
      ...project,
      episodes: [{ ...project.episodes[0]!, sceneIds: [...(project.episodes[0]?.sceneIds ?? []), 'missing-scene'] }],
    };
    expect(validateProject(broken).some((i) => i.severity === 'error')).toBe(true);

    const { code } = expectError(applyCommand({ kind: 'test.BreakDocument' }, ctxFor(project)));
    expect(code).toBe('invalid-result');
  });

  it('passes an otherwise clean command through the same validator untouched', () => {
    const { project, sceneId, actorId } = makeProject();
    const result = applyCommand({ kind: 'SetActorPose', sceneId, actorId, poseId: POSE_B.id }, ctxFor(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateProject(result.project).some((i) => i.severity === 'error')).toBe(false);
  });
});

describe('defineCommand', () => {
  it('refuses to register the same kind twice', () => {
    expect(() => defineCommand<Command>('test.Throws', () => ({ ok: false, error: { code: 'internal', message: 'x' } }))).toThrow(
      /already registered/,
    );
  });
});

describe('CreateScene — the first allocating command', () => {
  it('asks the allocator for the scene id and the clock for the timestamp', () => {
    const { project } = makeProject();
    const result = applyCommand(
      { kind: 'CreateScene', name: 'Lobby', environmentId: ENV.id, duration: 6 },
      ctxFor(project, { allocate: countingAllocator(), now: () => '2026-05-01T00:00:00.000Z' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scene = result.project.scenes.find((s) => s.id === 'scene_seed0');
    expect(scene).toBeDefined();
    if (!scene) return;
    expect(scene.name).toBe('Lobby');
    expect(scene.environmentId).toBe(ENV.id);
    expect(scene.duration).toBe(6);
    expect(result.project.updatedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('rejects an environment that is in neither the project library nor ctx.assets', () => {
    const { project } = makeProject();
    const result = applyCommand({ kind: 'CreateScene', name: 'Void', environmentId: 'env.nope' }, ctxFor(project));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
  });

  it('treats ctx.assets as the authority for the environment, not the project alone', () => {
    const { project } = makeProject();
    // The project owns env-1, but a series-owned merged view might not expose it.
    const merged = { ...project.assets, environments: [] };
    const rejected = applyCommand(
      { kind: 'CreateScene', name: 'Lobby', environmentId: ENV.id },
      ctxFor(project, { assets: merged }),
    );
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('not-found');

    const accepted = applyCommand(
      { kind: 'CreateScene', name: 'Lobby', environmentId: ENV.id },
      ctxFor(project, { assets: { ...merged, environments: [ENV] } }),
    );
    expect(accepted.ok).toBe(true);
  });

  it('leaves the document unchanged when it fails', () => {
    const { project } = makeProject();
    const before = JSON.stringify(project);
    applyCommand({ kind: 'CreateScene', name: 'Void', environmentId: 'env.nope' }, ctxFor(project));
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe('fold determinism — injected allocate/now (§7.4, §8.3)', () => {
  const stableClock = () => '2026-01-01T00:00:00.000Z';

  const sequence = (sceneId: string, actorId: string) =>
    [
      { kind: 'CreateScene', name: 'Lobby', environmentId: ENV.id },
      { kind: 'SetActorPose', sceneId, actorId, poseId: POSE_B.id },
    ] as const;

  it('two folds with the same allocator and clock produce identical documents', () => {
    const { project, sceneId, actorId } = makeProject();
    const ctx = {
      project,
      series: null,
      allocate: countingAllocator(),
      now: stableClock,
    };
    const a = fold(sequence(sceneId, actorId), ctx);
    const b = fold(sequence(sceneId, actorId), { ...ctx, allocate: countingAllocator() });
    expect(a).toEqual(b);
    expect(a.errors).toHaveLength(0);
    expect(b.errors).toHaveLength(0);
    // And the allocated id really came from the injected allocator.
    expect(a.project.scenes.some((s) => s.id === 'scene_seed0')).toBe(true);
  });

  it('a different allocator produces a different document', () => {
    const { project, sceneId, actorId } = makeProject();
    const ctx = { project, series: null, allocate: countingAllocator(100), now: stableClock };
    const result = fold(sequence(sceneId, actorId), ctx);
    expect(result.errors).toHaveLength(0);
    expect(result.project.scenes.some((s) => s.id === 'scene_seed100')).toBe(true);
    expect(result.project.scenes.some((s) => s.id === 'scene_seed0')).toBe(false);
  });

  it('a different clock produces a different timestamp but the same shape', () => {
    const { project, sceneId, actorId } = makeProject();
    const base = { project, series: null as null, now: stableClock };
    const a = fold(sequence(sceneId, actorId), { ...base, allocate: countingAllocator() });
    const b = fold(sequence(sceneId, actorId), { ...base, allocate: countingAllocator(), now: () => '2026-02-01T00:00:00.000Z' });
    expect(a.errors).toHaveLength(0);
    expect(b.errors).toHaveLength(0);
    expect(a.project.scenes).toEqual(b.project.scenes);
    expect(a.project.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(b.project.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });
});