/**
 * FrameSelection — point the camera at the selected actors (ARCHITECTURE_SPEC.md §7.2,
 * Phase 16 P7a).
 *
 * The panel names the actors; this command does the rest: resolves them against the same
 * library the panel renders (never a project-own list, which in series ownership is
 * empty), computes the environment frame, and lays the shot as one move. A selection with
 * no fittable subjects comes back unchanged, so it records nothing in history.
 */
import type { Id } from '../types';
import { ID_PREFIX } from '../id';
import { frameSelection as frameSelectionOp } from '../document/cameraOps';
import { sceneEnvironment } from '../document/lookups';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface FrameSelectionCommand extends Command {
  kind: 'FrameSelection';
  sceneId: Id;
  actorIds: Id[];
}

defineCommand<FrameSelectionCommand>('FrameSelection', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) {
    return { ok: false, error: notFound('scene', command.sceneId) };
  }
  const library = ctx.assets ?? ctx.project.assets;
  const environment = sceneEnvironment(library, scene);

  const trackId = scene.tracks.some((t) => t.kind === 'camera')
    ? undefined
    : ctx.allocate(ID_PREFIX.track);
  const clipId = ctx.allocate(ID_PREFIX.clip);
  const keyframeId = ctx.allocate(ID_PREFIX.keyframe);

  return {
    ok: true,
    project: frameSelectionOp(ctx.project, library, command.sceneId, command.actorIds, {
      frame: {
        width: environment?.width ?? ctx.project.settings.width,
        height: environment?.height ?? ctx.project.settings.height,
      },
    }, {
      ...(trackId !== undefined ? { trackId } : {}),
      clipId,
      keyframeId,
      clock: ctx.now,
    }),
  };
});