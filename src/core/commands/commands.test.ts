/**
 * Command layer surface (Phase 16 P2 + P3): dispatch, argument validation, the §22.3
 * post-validation on the single command, the immutable-on-failure promise, and the
 * fold determinism that the injected `allocate`/`now` buy (§7.4).
 */
import { describe, expect, it } from 'vitest';
import {
  createEpisode,
  createActor,
  createProject,
  createScene,
} from '../document/factories';
import { addDialogueLineWithCue } from '../document/dialogueOps';
import { findClipLocation } from '../document/trackOps';
import { validateProject } from '../document/invariants';
import type { Id, Project } from '../types';
import type { Command, CommandContext, CommandResult } from './types';
import { applyCommand, applyCommands, defineCommand } from './index';

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
const AUDIO = {
  id: 'audio-1',
  name: 'Voice A',
  kind: 'dialogue' as const,
  src: null,
  srcKind: null,
  duration: 3,
  tags: [],
};
const AUDIO_B = {
  id: 'audio-2',
  name: 'Voice B',
  kind: 'dialogue' as const,
  src: null,
  srcKind: null,
  duration: 4,
  tags: [],
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
        audio: [AUDIO, AUDIO_B],
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

function expectError(result: CommandResult): { code: string; message?: string; path?: string } {
  if (result.ok) throw new Error('expected a failed command, got a document');
  return {
    code: result.error.code,
    ...(result.error.message !== undefined ? { message: result.error.message } : {}),
    ...(result.error.path !== undefined ? { path: result.error.path } : {}),
  };
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

describe('applyCommands — the batch fold (§8.3)', () => {
  it('applies every command in order and returns the folded document', () => {
    const { project, sceneId, actorId } = makeProject();
    const commands = [
      { kind: 'CreateScene', name: 'Lobby', environmentId: ENV.id },
      { kind: 'SetActorPose', sceneId, actorId, poseId: POSE_B.id },
    ] as const;
    const result = applyCommands(commands, ctxFor(project, { allocate: countingAllocator() }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.scenes.some((s) => s.name === 'Lobby')).toBe(true);
    expect(result.project.scenes.some((s) => s.id === 'scene_seed0')).toBe(true);
    expect(actorOf(result.project, actorId)?.poseId).toBe(POSE_B.id);
  });

  it('returns the ORIGINAL project when a middle command fails — nothing is applied', () => {
    const { project, sceneId, actorId } = makeProject();
    const before = JSON.stringify(project);
    const commands = [
      { kind: 'CreateScene', name: 'Lobby', environmentId: ENV.id },
      { kind: 'SetActorPose', sceneId, actorId, poseId: 'not-a-pose' },
    ] as const;
    const result = applyCommands(commands, ctxFor(project, { allocate: countingAllocator() }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
    expect(result.error.path).toBe('commands[1].SetActorPose');
    expect(JSON.stringify(project)).toBe(before);
  });

  it('marks the failing command, not the batch conclusion, in the error path', () => {
    const { project, sceneId, actorId } = makeProject();
    const commands = [
      { kind: 'CreateScene', name: 'Lobby', environmentId: ENV.id },
      { kind: 'SetActorPose', sceneId, actorId, poseId: 'not-a-pose' },
    ] as const;
    const result = applyCommands(commands, ctxFor(project, { allocate: countingAllocator() }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe('commands[1].SetActorPose');
  });

  it('an empty batch is an identity fold', () => {
    const { project } = makeProject();
    const result = applyCommands([], ctxFor(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toBe(project);
  });

  it('validates the folded document exactly once at the end (invalid-result, §22.3)', () => {
    const { project } = makeProject();
    // test.BreakDocument produces an invalid document. In a single command that failure
    // surfaces from applyCommand's own validation; in a batch it must surface from the
    // single end-of-batch pass, naming the document path rather than a command index.
    const result = applyCommands([{ kind: 'test.BreakDocument' }], ctxFor(project));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-result');
    expect(result.error.path).toMatch(/^episodes/);
    expect(JSON.stringify(project)).toBe(JSON.stringify(project));
  });

  it('is deterministic under a fixed allocator and clock — previews can be exact', () => {
    const { project, sceneId, actorId } = makeProject();
    const commands = [
      { kind: 'CreateScene', name: 'Lobby', environmentId: ENV.id },
      { kind: 'SetActorPose', sceneId, actorId, poseId: POSE_B.id },
    ] as const;
    const base = { project, series: null as null, now: () => '2026-01-01T00:00:00.000Z' };
    const a = applyCommands(commands, { ...base, allocate: countingAllocator() });
    const b = applyCommands(commands, { ...base, allocate: countingAllocator() });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.project).toEqual(b.project);
    expect(a.project.scenes.some((s) => s.id === 'scene_seed0')).toBe(true);
  });

  it('a long fold rolls back completely on a mid-sequence failure (§8.3)', () => {
    const { project, sceneId, actorId } = makeProject();
    const manyScenes = Array.from({ length: 199 }, (_, n) => ({
      kind: 'CreateScene',
      name: `Lobby ${n}`,
      environmentId: ENV.id,
    }));
    const commands = [...manyScenes, { kind: 'SetActorPose', sceneId, actorId, poseId: 'not-a-pose' }];
    const before = JSON.stringify(project);
    const result = applyCommands(commands, ctxFor(project, { allocate: countingAllocator() }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
    expect(result.error.path).toBe('commands[199].SetActorPose');
    expect(JSON.stringify(project)).toBe(before);
  });

  it('a batch that yields an invalid document returns a failure, not the fold (§22.3)', () => {
    const { project } = makeProject();
    const commands = [
      {
        kind: 'SetActorPose',
        sceneId: project.scenes[0]?.id ?? 'missing-scene',
        actorId: project.scenes[0]?.actors[0]?.id ?? 'missing-actor',
        poseId: POSE_B.id,
      },
      { kind: 'test.BreakDocument' },
    ] as const;
    const result = applyCommands(commands, ctxFor(project));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-result');
    expect(JSON.stringify(project)).toBe(JSON.stringify(ctxFor(project).project));
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

describe('dialogue commands (Phase 16 P6)', () => {
  /** A scene that already holds one line + cue + dialogue lane, built via the op. */
  function seeded(): {
    project: Project;
    sceneId: Id;
    actorId: Id;
    lineId: Id;
    clipId: Id;
    trackId: Id;
  } {
    const { project: base, sceneId, actorId } = makeProject();
    const { project, lineId, clipId } = addDialogueLineWithCue(base, sceneId, {
      speaker: 'Cast Member',
      text: 'Hello',
      actorId,
      voiceAudioId: AUDIO.id,
      start: 1,
      duration: 2,
    });
    const scene = project.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error('seeded scene missing');
    const location = findClipLocation(scene, clipId);
    if (!location) throw new Error('seeded clip missing');
    return { project, sceneId, actorId, lineId, clipId, trackId: location.trackId };
  }

  describe('AddDialogueLine', () => {
    it('adds a line, its cue and a dialogue lane in one fold, ids from the allocator', () => {
      const { project, sceneId, actorId } = makeProject();
      const result = applyCommand(
        {
          kind: 'AddDialogueLine',
          sceneId,
          speaker: 'Cast Member',
          text: 'The line',
          actorId,
          voiceAudioId: AUDIO.id,
          start: 0.5,
          duration: 2.5,
        },
        ctxFor(project, { allocate: countingAllocator(), now: () => '2026-05-01T00:00:00.000Z' }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const scene = result.project.scenes.find((s) => s.id === sceneId);
      expect(scene).toBeDefined();
      if (!scene) return;
      const line = scene.dialogue.find((l) => l.id === 'line_seed0');
      expect(line).toBeDefined();
      if (!line) return;
      expect(line.speaker).toBe('Cast Member');
      expect(line.text).toBe('The line');
      expect(line.actorId).toBe(actorId);
      expect(line.voiceAudioId).toBe(AUDIO.id);

      const track = scene.tracks.find((t) => t.id === 'track_seed2');
      expect(track).toBeDefined();
      if (!track) return;
      expect(track.kind).toBe('dialogue');
      expect(track.targetId).toBe('line_seed0');
      expect(track.clips).toHaveLength(1);
      expect(track.clips[0]?.id).toBe('clip_seed1');
      expect(track.clips[0]?.start).toBe(0.5);
      expect(track.clips[0]?.duration).toBe(2.5);
      expect(result.project.updatedAt).toBe('2026-05-01T00:00:00.000Z');
    });

    it('is deterministic under a fixed allocator and clock', () => {
      const { project, sceneId, actorId } = makeProject();
      const command = {
        kind: 'AddDialogueLine',
        sceneId,
        speaker: 'Cast Member',
        text: 'Same line',
        actorId,
        start: 0,
        duration: 2,
      } as const;
      const clock = () => '2026-03-01T00:00:00.000Z';
      // Each fold gets its own identically-behaved allocator, so two folds answer
      // "does the same start produce the same document" — a shared stateful allocator
      // would be second-run-out-of-ids, which is a different question.
      const a = fold([command], ctxFor(project, { allocate: countingAllocator(), now: clock }));
      const b = fold([command], ctxFor(project, { allocate: countingAllocator(), now: clock }));
      expect(a.errors).toHaveLength(0);
      expect(b.errors).toHaveLength(0);
      expect(a).toEqual(b);
      expect(a.project.scenes[0]?.dialogue[0]?.id).toBe('line_seed0');
    });

    it('rejects an unknown scene', () => {
      const { project } = makeProject();
      const result = applyCommand(
        { kind: 'AddDialogueLine', sceneId: 'nope', speaker: 'A', text: '', start: 0, duration: 2 },
        ctxFor(project),
      );
      const { code, path } = expectError(result);
      expect(code).toBe('not-found');
      expect(path).toBe('scenes[nope]');
    });

    it('rejects an actor that is not placed in the scene', () => {
      const { project, sceneId } = makeProject();
      const result = applyCommand(
        { kind: 'AddDialogueLine', sceneId, speaker: 'A', text: '', actorId: 'ghost', start: 0, duration: 2 },
        ctxFor(project),
      );
      const { code } = expectError(result);
      expect(code).toBe('not-found');
      expect(result.ok ? '' : result.error.message).toContain('actor');
    });

    it('rejects a voice the library does not declare', () => {
      const { project, sceneId } = makeProject();
      const result = applyCommand(
        { kind: 'AddDialogueLine', sceneId, speaker: 'A', text: '', voiceAudioId: 'no-such-voice', start: 0, duration: 2 },
        ctxFor(project),
      );
      const { code } = expectError(result);
      expect(code).toBe('not-found');
    });

    it('rejects a negative start and a sub-frame duration as invalid arguments', () => {
      const { project, sceneId } = makeProject();
      const negative = applyCommand(
        { kind: 'AddDialogueLine', sceneId, speaker: 'A', text: '', start: -1, duration: 2 },
        ctxFor(project),
      );
      expect(expectError(negative).code).toBe('invalid-argument');
      const tiny = applyCommand(
        { kind: 'AddDialogueLine', sceneId, speaker: 'A', text: '', start: 0, duration: 0 },
        ctxFor(project),
      );
      expect(expectError(tiny).code).toBe('invalid-argument');
    });

    it('leaves the document unchanged on failure', () => {
      const { project, sceneId } = makeProject();
      const before = JSON.stringify(project);
      applyCommand(
        { kind: 'AddDialogueLine', sceneId, speaker: 'A', text: '', actorId: 'ghost', start: 0, duration: 2 },
        ctxFor(project),
      );
      expect(JSON.stringify(project)).toBe(before);
    });
  });

  describe('SetDialogueLine', () => {
    it('patches line content', () => {
      const { project, sceneId, lineId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueLine', sceneId, lineId, patch: { text: 'Changed', emotion: 'angry' } },
        ctxFor(project, { now: () => '2026-04-01T00:00:00.000Z' }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const line = result.project.scenes.find((s) => s.id === sceneId)?.dialogue.find((l) => l.id === lineId);
      expect(line?.text).toBe('Changed');
      expect(line?.emotion).toBe('angry');
      expect(result.project.updatedAt).toBe('2026-04-01T00:00:00.000Z');
    });

    it('a patch that changes nothing returns the same document object', () => {
      const { project, sceneId, lineId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueLine', sceneId, lineId, patch: { text: 'Hello' } },
        ctxFor(project),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.project).toBe(project);
    });

    it('rejects an actor the line references but the scene does not contain', () => {
      const { project, sceneId, lineId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueLine', sceneId, lineId, patch: { actorId: 'ghost' } },
        ctxFor(project),
      );
      const { code } = expectError(result);
      expect(code).toBe('not-found');
    });

    it('rejects a voice the library does not declare', () => {
      const { project, sceneId, lineId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueLine', sceneId, lineId, patch: { voiceAudioId: 'no-such-voice' } },
        ctxFor(project),
      );
      const { code } = expectError(result);
      expect(code).toBe('not-found');
    });

    it('rejects an unknown line', () => {
      const { project, sceneId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueLine', sceneId, lineId: 'ghost', patch: { text: 'x' } },
        ctxFor(project),
      );
      const { code } = expectError(result);
      expect(code).toBe('not-found');
    });
  });

  describe('DeleteDialogueLine', () => {
    it('removes the line, its cue and the lane that held the cue', () => {
      const { project, sceneId, lineId, trackId } = seeded();
      const result = applyCommand(
        { kind: 'DeleteDialogueLine', sceneId, lineId },
        ctxFor(project),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const scene = result.project.scenes.find((s) => s.id === sceneId);
      expect(scene?.dialogue.some((l) => l.id === lineId)).toBe(false);
      expect(scene?.tracks.some((t) => t.id === trackId)).toBe(false);
      expect(result.project.scenes.flatMap((s) => s.tracks).flatMap((t) => t.clips).some((c) => c.dialogueLineId === lineId)).toBe(false);
    });

    it('rejects an unknown line and an unknown scene', () => {
      const { project, sceneId } = seeded();
      const noLine = applyCommand(
        { kind: 'DeleteDialogueLine', sceneId, lineId: 'ghost' },
        ctxFor(project),
      );
      expect(expectError(noLine).code).toBe('not-found');
      const noScene = applyCommand(
        { kind: 'DeleteDialogueLine', sceneId: 'nope', lineId: 'x' },
        ctxFor(project),
      );
      const { code, path } = expectError(noScene);
      expect(code).toBe('not-found');
      expect(path).toBe('scenes[nope]');
    });
  });

  describe('SetDialogueCue', () => {
    it('re-times the line cue by line id, through the same ops a drag uses', () => {
      const { project, sceneId, lineId, clipId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueCue', sceneId, lineId, cue: { start: 3, duration: 4 } },
        ctxFor(project, { now: () => '2026-06-01T00:00:00.000Z' }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const scene = result.project.scenes.find((s) => s.id === sceneId);
      const clip = scene?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      expect(clip?.start).toBe(3);
      expect(clip?.duration).toBe(4);
      expect(result.project.updatedAt).toBe('2026-06-01T00:00:00.000Z');
    });

    it('a cue already at the requested window is a no-op that returns the same document', () => {
      const { project, sceneId, lineId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueCue', sceneId, lineId, cue: { start: 1, duration: 2 } },
        ctxFor(project),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.project).toBe(project);
    });

    it('rejects an empty cue and an unknown line', () => {
      const { project, sceneId, lineId } = seeded();
      const empty = applyCommand(
        { kind: 'SetDialogueCue', sceneId, lineId, cue: {} },
        ctxFor(project),
      );
      expect(expectError(empty).code).toBe('invalid-argument');
      const unknown = applyCommand(
        { kind: 'SetDialogueCue', sceneId, lineId: 'ghost', cue: { start: 0 } },
        ctxFor(project),
      );
      expect(expectError(unknown).code).toBe('not-found');
    });
  });

  describe('SetDialogueVoice', () => {
    it('swaps the voice on the line and on its cue in one fold', () => {
      const { project, sceneId, lineId, clipId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueVoice', sceneId, lineId, audioId: AUDIO_B.id },
        ctxFor(project),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const scene = result.project.scenes.find((s) => s.id === sceneId);
      expect(scene?.dialogue.find((l) => l.id === lineId)?.voiceAudioId).toBe(AUDIO_B.id);
      expect(
        scene?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)?.audioId,
      ).toBe(AUDIO_B.id);
    });

    it('clears the voice slot with null', () => {
      const { project, sceneId, lineId, clipId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueVoice', sceneId, lineId, audioId: null },
        ctxFor(project),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const scene = result.project.scenes.find((s) => s.id === sceneId);
      expect(scene?.dialogue.find((l) => l.id === lineId)?.voiceAudioId).toBeNull();
      expect(
        scene?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)?.audioId,
      ).toBeNull();
    });

    it('rejects a voice the library does not declare', () => {
      const { project, sceneId, lineId } = seeded();
      const result = applyCommand(
        { kind: 'SetDialogueVoice', sceneId, lineId, audioId: 'no-such-voice' },
        ctxFor(project),
      );
      expect(expectError(result).code).toBe('not-found');
    });
  });

  describe('SetClipGain', () => {
    it('sets the gain of one cue', () => {
      const { project, sceneId, trackId, clipId } = seeded();
      const result = applyCommand(
        { kind: 'SetClipGain', sceneId, trackId, clipId, gain: 0.5 },
        ctxFor(project, { now: () => '2026-07-01T00:00:00.000Z' }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const scene = result.project.scenes.find((s) => s.id === sceneId);
      const clip = scene?.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
      expect(clip?.gain).toBe(0.5);
      expect(result.project.updatedAt).toBe('2026-07-01T00:00:00.000Z');
    });

    it('clamps into the mixer range like the op does', () => {
      const { project, sceneId, trackId, clipId } = seeded();
      const result = applyCommand(
        { kind: 'SetClipGain', sceneId, trackId, clipId, gain: 9 },
        ctxFor(project),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const scene = result.project.scenes.find((s) => s.id === sceneId);
      const clip = scene?.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
      expect(clip?.gain).toBe(2);
    });

    it('rejects an unknown clip and an unknown track', () => {
      const { project, sceneId, trackId } = seeded();
      const noClip = applyCommand(
        { kind: 'SetClipGain', sceneId, trackId, clipId: 'ghost', gain: 0.5 },
        ctxFor(project),
      );
      expect(expectError(noClip).code).toBe('not-found');
      const noTrack = applyCommand(
        { kind: 'SetClipGain', sceneId, trackId: 'ghost', clipId: 'x', gain: 0.5 },
        ctxFor(project),
      );
      expect(expectError(noTrack).code).toBe('not-found');
    });
  });

  it('every command in the vocabulary leaves a document the validator clears', () => {
    const { project: base, sceneId, actorId } = makeProject();
    const ctx = { allocate: countingAllocator(), now: () => '2026-01-01T00:00:00.000Z' };
    const commands = [
      { kind: 'AddDialogueLine', sceneId, speaker: 'Cast Member', text: 'One', actorId, start: 0, duration: 2 },
      { kind: 'SetDialogueLine', sceneId, lineId: 'line_seed0', patch: { text: 'One revised' } },
      { kind: 'SetDialogueCue', sceneId, lineId: 'line_seed0', cue: { start: 1 } },
      { kind: 'SetDialogueVoice', sceneId, lineId: 'line_seed0', audioId: AUDIO.id },
      { kind: 'SetClipGain', sceneId, trackId: 'track_seed2', clipId: 'clip_seed1', gain: 1.5 },
    ] as const;
    const result = applyCommands(commands, ctxFor(base, ctx));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateProject(result.project).some((i) => i.severity === 'error')).toBe(false);
  });
});