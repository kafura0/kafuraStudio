/**
 * ApplyCameraPreset — adopt a preset's framing as the scene's rest framing and lay one
 * camera move holding it (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7a).
 *
 * The panel names the preset by id; this command resolves it against the merged series
 * view (`ctx.series`, exactly the view the camera panel renders) so preset-resolution
 * lives in one place. Applying a stop writes a track, a clip and a keyframe — three ids
 * that come from `ctx.allocate` in a fixed order, so a fold preview is deterministic
 * whether or not the scene already has a camera track (§7.4, §8.3).
 */
import type { Id } from '../types';
import { ID_PREFIX } from '../id';
import { applyCameraPreset as applyCameraPresetOp } from '../document/cameraOps';
import { resolveCameraPresets } from '../document/lookups';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface ApplyCameraPresetCommand extends Command {
  kind: 'ApplyCameraPreset';
  sceneId: Id;
  presetId: Id;
}

defineCommand<ApplyCameraPresetCommand>('ApplyCameraPreset', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) {
    return { ok: false, error: notFound('scene', command.sceneId) };
  }
  const preset = resolveCameraPresets(ctx.project, ctx.series ?? null).find(
    (p) => p.id === command.presetId,
  );
  if (!preset) {
    return { ok: false, error: notFound('camera preset', command.presetId) };
  }

  // Allocation order matches what the op will consume: a track only when the scene has no
  // camera track yet, then the clip, then the keyframe inside it.
  const trackId = scene.tracks.some((t) => t.kind === 'camera')
    ? undefined
    : ctx.allocate(ID_PREFIX.track);
  const clipId = ctx.allocate(ID_PREFIX.clip);
  const keyframeId = ctx.allocate(ID_PREFIX.keyframe);

  return {
    ok: true,
    project: applyCameraPresetOp(ctx.project, command.sceneId, preset, {
      ...(trackId !== undefined ? { trackId } : {}),
      clipId,
      keyframeId,
      clock: ctx.now,
    }),
  };
});