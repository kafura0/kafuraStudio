/**
 * MoveTrack — reorder a track (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7b).
 */
import type { Id } from '../types';
import { moveTrack as moveTrackOp } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface MoveTrackCommand extends Command {
  kind: 'MoveTrack';
  sceneId: Id;
  trackId: Id;
  toIndex: number;
}

defineCommand<MoveTrackCommand>('MoveTrack', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  if (!scene.tracks.some((t) => t.id === command.trackId)) return { ok: false, error: notFound('track', command.trackId) };
  if (!Number.isInteger(command.toIndex) || command.toIndex < 0) {
    return { ok: false, error: commandError('invalid-argument', 'toIndex must be a non-negative integer.') };
  }
  return { ok: true, project: moveTrackOp(ctx.project, command.sceneId, command.trackId, command.toIndex, ctx.now) };
});
