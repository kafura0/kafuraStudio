/**
 * DeleteScene — remove a scene and drop it from every episode (ARCHITECTURE_SPEC.md §7.2,
 * Phase 16 P7a).
 *
 * `projectOps.deleteScene` already cascades the scene out of every episode's cut list, so
 * the caller does not supply the cascade — this command is that caller. A scene that is
 * not in the document is refused with `not-found` instead of committing a no-op touch.
 */
import type { Id } from '../types';
import { deleteScene } from '../document/projectOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface DeleteSceneCommand extends Command {
  kind: 'DeleteScene';
  sceneId: Id;
}

defineCommand<DeleteSceneCommand>('DeleteScene', (command, ctx: CommandContext) => {
  if (!ctx.project.scenes.some((s) => s.id === command.sceneId)) {
    return { ok: false, error: notFound('scene', command.sceneId) };
  }
  const project = deleteScene(ctx.project, command.sceneId, ctx.now);
  return { ok: true, project };
});