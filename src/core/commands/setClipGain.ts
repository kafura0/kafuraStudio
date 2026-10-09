/**
 * SetClipGain — the mix level of one cue (ARCHITECTURE_SPEC.md §7.2, Phase 16 P6).
 *
 * The panel hands a cue's track and clip ids, which it already holds from its cue
 * search — naming a clip here is honest, because the gain belongs to the clip, not the
 * line. `setClipGain` clamps into the 0..2 range the mixer offers.
 */
import type { Id } from '../types';
import { setClipGain } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface SetClipGainCommand extends Command {
  kind: 'SetClipGain';
  sceneId: Id;
  trackId: Id;
  clipId: Id;
  gain: number;
}

defineCommand<SetClipGainCommand>('SetClipGain', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) {
    return {
      ok: false,
      error: notFound('scene', command.sceneId, `scenes[${command.sceneId}]`),
    };
  }
  const track = scene.tracks.find((t) => t.id === command.trackId);
  if (!track) {
    return {
      ok: false,
      error: notFound('track', command.trackId, `scenes[${command.sceneId}].tracks[${command.trackId}]`),
    };
  }
  if (!track.clips.some((c) => c.id === command.clipId)) {
    return { ok: false, error: notFound('clip', command.clipId) };
  }
  if (!Number.isFinite(command.gain)) {
    return { ok: false, error: commandError('invalid-argument', 'Gain must be a number.') };
  }
  return {
    ok: true,
    project: setClipGain(ctx.project, command.sceneId, command.trackId, command.clipId, command.gain, ctx.now),
  };
});