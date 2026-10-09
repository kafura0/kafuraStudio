/**
 * Command layer surface (Phase 16 P2): dispatch, argument validation, the §22.3
 * post-validation on the single command, and the immutable-on-failure promise.
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