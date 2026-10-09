/**
 * SetActorPose — set a placed actor's pose (ARCHITECTURE_SPEC.md §7.2, Phase 16 P2).
 *
 * The first command, chosen because it exercises the full §7.1 stack without allocating
 * anything: handler validates its own arguments against the merged library, applies
 * `setActorPose`, and the registry's post-validation keeps the "command reads its own
 * arguments, the document answers" rule honest.
 */
import type { Id } from '../types';
import type { Command, CommandContext } from './types';
import { setActorPose } from '../document/sceneOps';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface SetActorPoseCommand extends Command {
  kind: 'SetActorPose';
  sceneId: Id;
  actorId: Id;
  poseId: Id;
}

defineCommand<SetActorPoseCommand>('SetActorPose', (command, ctx: CommandContext) => {
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
  if (!library.poses.some((p) => p.id === command.poseId)) {
    return { ok: false, error: notFound('pose', command.poseId) };
  }
  return {
    ok: true,
    project: setActorPose(ctx.project, command.sceneId, command.actorId, command.poseId, ctx.now),
  };
});