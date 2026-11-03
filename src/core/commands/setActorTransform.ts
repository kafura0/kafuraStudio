/**
 * SetActorTransform — move, scale, or rotate a placed actor (ARCHITECTURE_SPEC.md §7.2,
 * Phase 16 P2). Rows 7–9 of the MVP capability table need a UI; this command is the
 * model half of row 7 ("Move and scale characters").
 *
 * The handler validates the scene and actor exist, then applies `setActorTransform`.
 * Transform patches are partial: the panel sends only the fields it changed, and the
 * op merges them onto the actor's existing transform. That keeps a position tweak from
 * clobbering a previously authored scale, and vice versa.
 */
import type { Id, Transform2D } from '../types';
import { setActorTransform } from '../document/sceneOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface SetActorTransformCommand extends Command {
  kind: 'SetActorTransform';
  sceneId: Id;
  actorId: Id;
  transform: Partial<Transform2D>;
}

defineCommand<SetActorTransformCommand>('SetActorTransform', (command, ctx: CommandContext) => {
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
  return {
    ok: true,
    project: setActorTransform(ctx.project, command.sceneId, command.actorId, command.transform),
  };
});
