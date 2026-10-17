/**
 * CreateScene — add a scene to the project (ARCHITECTURE_SPEC.md §7.2, Phase 16 P3).
 *
 * The first allocating command. The scene's id comes from `ctx.allocate`, never from the
 * operation itself, and its timestamp from `ctx.now` — otherwise the fold determinism the
 * plan preview depends on (§7.4, §8.3) breaks at the command layer. Everything inside the
 * handler is a pure function over `ctx.project`; nothing here touches Date, crypto, the
 * DOM, or the store.
 */
import type { Id } from '../types';
import { ID_PREFIX } from '../id';
import { findEnvironment } from '../document/lookups';
import { createSceneInProject } from '../document/projectOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface CreateSceneCommand extends Command {
  kind: 'CreateScene';
  name: string;
  environmentId: Id;
  description?: string;
  duration?: number;
  backgroundColor?: string;
  /**
   * Plan-compilation handle for the scene this command creates (§11.5 correction).
   * Never set by the UI; `applyPlan` binds it to the new scene id so later compiled
   * commands can refer to a scene that did not exist when they were compiled.
   */
  sceneRef?: string;
}

defineCommand<CreateSceneCommand>('CreateScene', (command, ctx: CommandContext) => {
  const library = ctx.assets ?? ctx.project.assets;
  if (!findEnvironment(library, command.environmentId)) {
    return { ok: false, error: notFound('environment', command.environmentId) };
  }
  const { project } = createSceneInProject(ctx.project, library, {
    id: ctx.allocate(ID_PREFIX.scene),
    clock: ctx.now,
    ...(command.description !== undefined ? { description: command.description } : {}),
    ...(command.duration !== undefined ? { duration: command.duration } : {}),
    ...(command.backgroundColor !== undefined ? { backgroundColor: command.backgroundColor } : {}),
    name: command.name,
    environmentId: command.environmentId,
  });
  return { ok: true, project };
});