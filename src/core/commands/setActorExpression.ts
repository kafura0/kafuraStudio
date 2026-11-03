/**
 * SetActorExpression — change a placed actor's expression (ARCHITECTURE_SPEC.md §7.2,
 * Phase 16 P2). Row 9 of the MVP capability table ("Change character expression")
 * needs a UI; this command is the model half of it.
 *
 * The handler validates the scene and actor exist, and that the expression id resolves
 * against the merged library, then applies `setActorExpression`.
 */
import type { Id } from '../types';
import { setActorExpression } from '../document/sceneOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface SetActorExpressionCommand extends Command {
  kind: 'SetActorExpression';
  sceneId: Id;
  actorId: Id;
  expressionId: Id;
}

defineCommand<SetActorExpressionCommand>('SetActorExpression', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) {
    return {
      ok: false,
      error: notFound('scene', command.sceneId, `scenes[${command.sceneId}]`),
    };
  }
  if (!scene.actors.some((a) => a.id === command.actorId)) {
    return { ok: false, error: notFound('actor', command.actorId) };
  }
  const library = ctx.assets ?? ctx.project.assets;
  if (!library.expressions.some((e) => e.id === command.expressionId)) {
    return { ok: false, error: notFound('expression', command.expressionId) };
  }
  return {
    ok: true,
    project: setActorExpression(ctx.project, command.sceneId, command.actorId, command.expressionId),
  };
});
