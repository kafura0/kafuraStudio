/**
 * RemoveTrack — delete a track (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7b).
 */
import type { Id } from '../types';
import { removeTrack as removeTrackOp } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface RemoveTrackCommand extends Command {
  kind: 'RemoveTrack';
  sceneId: Id;
  trackId: Id;
}

defineCommand<RemoveTrackCommand>('RemoveTrack', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  if (!scene.tracks.some((t) => t.id === command.trackId)) return { ok: false, error: notFound('track', command.trackId) };
  return { ok: true, project: removeTrackOp(ctx.project, command.sceneId, command.trackId, ctx.now) };
});
