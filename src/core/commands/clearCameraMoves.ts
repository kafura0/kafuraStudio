/**
 * ClearCameraMoves — drop every camera clip, returning to the rest framing
 * (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7a).
 *
 * `clearCameraMoves` already returns the document untouched when the scene has no camera
 * clips, so pressing this where there is nothing to remove records no history step.
 */
import type { Id } from '../types';
import { clearCameraMoves } from '../document/cameraOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface ClearCameraMovesCommand extends Command {
  kind: 'ClearCameraMoves';
  sceneId: Id;
}

defineCommand<ClearCameraMovesCommand>('ClearCameraMoves', (command, ctx: CommandContext) => {
  if (!ctx.project.scenes.some((s) => s.id === command.sceneId)) {
    return { ok: false, error: notFound('scene', command.sceneId) };
  }
  return {
    ok: true,
    project: clearCameraMoves(ctx.project, command.sceneId, ctx.now),
  };
});