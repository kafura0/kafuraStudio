/**
 * MoveKeyframe — move a keyframe (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7b).
 */
import type { Id } from '../types';
import { moveKeyframe as moveKeyframeOp } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface MoveKeyframeCommand extends Command {
  kind: 'MoveKeyframe';
  sceneId: Id;
  trackId: Id;
  clipId: Id;
  keyframeId: Id;
  time: number;
}

defineCommand<MoveKeyframeCommand>('MoveKeyframe', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  const track = scene.tracks.find((t) => t.id === command.trackId);
  if (!track) return { ok: false, error: notFound('track', command.trackId) };
  const clip = track.clips.find((c) => c.id === command.clipId);
  if (!clip) return { ok: false, error: notFound('clip', command.clipId) };
  if (!clip.keyframes.some((kf) => kf.id === command.keyframeId)) return { ok: false, error: notFound('keyframe', command.keyframeId) };
  if (!Number.isFinite(command.time) || command.time < 0) {
    return { ok: false, error: commandError('invalid-argument', 'Keyframe time must be non-negative.') };
  }
  return { ok: true, project: moveKeyframeOp(ctx.project, command.sceneId, command.trackId, command.clipId, command.keyframeId, command.time, ctx.now) };
});
