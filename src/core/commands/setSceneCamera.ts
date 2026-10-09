/**
 * SetSceneCamera — set the rest framing of a scene (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7a).
 *
 * The numeric fields commit on blur, and a blur that changes nothing should not land in
 * history — `setSceneCamera` already returns the document untouched for a no-op patch, and
 * this command chases the one case that needs a refusal rather than a no-op: a patch whose
 * values are not finite numbers, which would hold the shot nowhere.
 */
import type { Id } from '../types';
import { setSceneCamera, type CameraPatch } from '../document/cameraOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface SetSceneCameraCommand extends Command {
  kind: 'SetSceneCamera';
  sceneId: Id;
  patch: CameraPatch;
}

defineCommand<SetSceneCameraCommand>('SetSceneCamera', (command, ctx: CommandContext) => {
  if (!ctx.project.scenes.some((s) => s.id === command.sceneId)) {
    return { ok: false, error: notFound('scene', command.sceneId) };
  }
  for (const key of ['x', 'y', 'zoom', 'rotation'] as const) {
    const value = command.patch[key];
    if (value !== undefined && !Number.isFinite(value)) {
      return {
        ok: false,
        error: commandError('invalid-argument', `A camera ${key} must be a finite number.`),
      };
    }
  }
  return {
    ok: true,
    project: setSceneCamera(ctx.project, command.sceneId, command.patch, ctx.now),
  };
});