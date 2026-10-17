/**
 * Plan application (ARCHITECTURE_SPEC.md §11.5 — Phase 17).
 *
 * `applyPlan` is the third fold surface beside `applyCommand` and `applyCommands`. It
 * exists because a compiled plan needs something neither provides: a plan that creates
 * its own scene compiles commands that refer to the new scene, the placed actors and the
 * fresh tracks *before* those ids exist. The compiler therefore writes plan-local handles
 * (`@scene`, `@cast:0`) into id fields and sets a `*Ref` output field on the command that
 * produces each id. `applyPlan` folds command-by-command, substitutes bound handles, and
 * binds each ref-out to the id the document actually gained.
 *
 * It is atomic and it validates once, like `applyCommands` (§22.3): the first failing
 * command aborts the fold and no document is returned, and the finished document is held
 * to the project invariants before it is handed back.
 *
 * Determinism (§8.3): every fresh id and timestamp comes from the injected allocator and
 * clock, so applying the same plan twice with the same sources yields byte-identical
 * projects — which is what makes the preview-equals-applied gate (G8) an exact check.
 */
import type { Id, Project, Scene } from '../types';
import { commandError, dispatchCommand } from '../commands';
import type { AddClipCommand } from '../commands/addClip';
import type { CreateSceneCommand } from '../commands/createScene';
import type { PlaceCharacterCommand } from '../commands/placeCharacter';
import type { Command, CommandError } from '../commands/types';
import { validateProject } from '../document/invariants';
import { compilePlan } from './compile';
import type { Assumption, PlanContext, PlanDiagnostic, PlanEnvelope } from './types';

export interface PlanApplyOptions {
  /** Fresh-id source for the fold. Must be deterministic for preview === applied. */
  allocate: (prefix: string) => Id;
  /** Clock for the fold. Fixed in preview, the wall clock in production. */
  now: () => string;
}

export type PlanApplyError =
  | { kind: 'invalid-plan'; diagnostics: PlanDiagnostic[] }
  | { kind: 'command-failed'; index: number; command: string; error: CommandError }
  | { kind: 'invalid-result'; error: CommandError };

export type PlanApplyResult =
  | {
      ok: true;
      project: Project;
      commands: Command[];
      warnings: PlanDiagnostic[];
      assumptions: Assumption[];
    }
  | { ok: false; error: PlanApplyError };

export function applyPlan(
  ctx: PlanContext,
  envelope: PlanEnvelope,
  options: PlanApplyOptions,
): PlanApplyResult {
  const compiled = compilePlan(ctx, envelope);
  if (!compiled.ok) {
    return { ok: false, error: { kind: 'invalid-plan', diagnostics: compiled.diagnostics } };
  }

  const bindings = new Map<string, Id>();
  let project = ctx.project;

  for (let index = 0; index < compiled.commands.length; index += 1) {
    const compiledCommand = compiled.commands[index]!;
    const command = substituteHandles(compiledCommand, bindings);
    const result = dispatchCommand(command, {
      project,
      ...(ctx.assets !== undefined ? { assets: ctx.assets } : {}),
      series: ctx.series ?? null,
      allocate: options.allocate,
      now: options.now,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: { kind: 'command-failed', index, command: compiledCommand.kind, error: result.error },
      };
    }
    bindRefOuts(command, project, result.project, bindings);
    project = result.project;
  }

  const violations = validateProject(project, ctx.series ?? null).filter(
    (issue) => issue.severity === 'error',
  );
  const firstViolation = violations[0];
  if (firstViolation !== undefined) {
    return {
      ok: false,
      error: {
        kind: 'invalid-result',
        error: commandError('invalid-result', firstViolation.message, firstViolation.path),
      },
    };
  }

  return {
    ok: true,
    project,
    commands: compiled.commands,
    warnings: compiled.warnings,
    assumptions: compiled.assumptions,
  };
}

/**
 * Replace every bound handle in the command's id fields with the id it names.
 *
 * Only top-level fields whose name ends in `Id` are considered. That is exactly where the
 * compiler puts handles (`sceneId`, `actorId`, `targetId`, `trackId`, `clipId`); `*Ref`
 * fields are outputs and never substituted, and a command's nested props carry real
 * library ids, not handles. An unbound handle is left in place on purpose: the handler
 * then fails with `not-found`, which is the safe failure the design wants (R2).
 */
function substituteHandles(command: Command, bindings: Map<string, Id>): Command {
  const record = command as unknown as Record<string, unknown>;
  let clone: Record<string, unknown> | null = null;
  for (const key of Object.keys(record)) {
    if (!key.endsWith('Id')) continue;
    const value = record[key];
    if (typeof value !== 'string') continue;
    const bound = bindings.get(value);
    if (bound === undefined) continue;
    if (clone === null) clone = { ...record };
    clone[key] = bound;
  }
  return (clone ?? record) as unknown as Command;
}

/**
 * Bind each `*Ref` output of a just-run command to the id the document gained.
 *
 * The producer is keyed by command kind and looks at the before/after documents, not at
 * the command's arguments, so it binds the id that was *actually created* — an id the
 * compiler could not know. A producer that cannot find exactly one added entity binds
 * nothing, which surfaces later as a `not-found` rather than a wrong id.
 */
function bindRefOuts(
  command: Command,
  before: Project,
  after: Project,
  bindings: Map<string, Id>,
): void {
  switch (command.kind) {
    case 'CreateScene': {
      const { sceneRef } = command as CreateSceneCommand;
      if (sceneRef === undefined) return;
      bind(bindings, sceneRef, addedId(before.scenes, after.scenes));
      return;
    }
    case 'PlaceCharacter': {
      const { sceneId, actorRef } = command as PlaceCharacterCommand;
      if (actorRef === undefined) return;
      const beforeScene = before.scenes.find((scene) => scene.id === sceneId);
      const afterScene = after.scenes.find((scene) => scene.id === sceneId);
      if (afterScene === undefined) return;
      bind(bindings, actorRef, addedId(beforeScene?.actors ?? [], afterScene.actors));
      return;
    }
    case 'AddClip': {
      const { sceneId, trackRef, clipRef } = command as AddClipCommand;
      if (trackRef === undefined && clipRef === undefined) return;
      const beforeScene = before.scenes.find((scene) => scene.id === sceneId);
      const afterScene = after.scenes.find((scene) => scene.id === sceneId);
      if (afterScene === undefined) return;
      const clipId = addedId(clipsOf(beforeScene), clipsOf(afterScene));
      if (clipId === null) return;
      if (clipRef !== undefined) bindings.set(clipRef, clipId);
      if (trackRef !== undefined) {
        const track = afterScene.tracks.find((t) => t.clips.some((clip) => clip.id === clipId));
        if (track !== undefined) bindings.set(trackRef, track.id);
      }
      return;
    }
    default:
      return;
  }
}

function bind(bindings: Map<string, Id>, handle: string, id: Id | null): void {
  if (id !== null) bindings.set(handle, id);
}

/** The single entity `after` gained over `before`, or null if it is not exactly one. */
function addedId(before: readonly { id: Id }[], after: readonly { id: Id }[]): Id | null {
  const beforeIds = new Set(before.map((entity) => entity.id));
  const added = after.filter((entity) => !beforeIds.has(entity.id));
  return added.length === 1 ? added[0]!.id : null;
}

function clipsOf(scene: Scene | undefined): readonly { id: Id }[] {
  if (scene === undefined) return [];
  return scene.tracks.flatMap((track) => track.clips);
}
