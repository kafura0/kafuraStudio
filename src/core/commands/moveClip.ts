/**
 * MoveClip � move a clip in time, keeping its duration (ARCHITECTURE_SPEC.md �7.2, Phase 16 P7b).
 */
import type { Id } from '../types';
import { moveClip as moveClipOp } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface MoveClipCommand extends Command {
  kind: 'MoveClip';
  sceneId: Id;
  trackId: Id;
  clipId: Id;
  start: number;
  snap?: boolean;
}

defineCommand<MoveClipCommand>('MoveClip', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  const track = scene.tracks.find((t) => t.id === command.trackId);
  if (!track) return { ok: false, error: notFound('track', command.trackId) };
  if (!track.clips.some((c) => c.id === command.clipId)) return { ok: false, error: notFound('clip', command.clipId) };
  if (!Number.isFinite(command.start) || command.start < 0) {
    return { ok: false, error: commandError('invalid-argument', 'A clip start cannot be negative.') };
  }
  return {
    ok: true,
    project: moveClipOp(
      ctx.project,
      command.sceneId,
      command.trackId,
      command.clipId,
      command.start,
      command.snap !== undefined ? { snap: command.snap } : {},
      ctx.now,
    ),
  };
});
