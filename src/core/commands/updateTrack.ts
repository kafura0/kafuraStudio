/**
 * UpdateTrack — mutate track fields (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7b).
 */
import type { Id, Track } from '../types';
import { updateTrack as updateTrackOp } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface UpdateTrackCommand extends Command {
  kind: 'UpdateTrack';
  sceneId: Id;
  trackId: Id;
  patch: Partial<Omit<Track, 'id' | 'kind' | 'targetId'>>;
}

defineCommand<UpdateTrackCommand>('UpdateTrack', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  if (!scene.tracks.some((t) => t.id === command.trackId)) return { ok: false, error: notFound('track', command.trackId) };
  return { ok: true, project: updateTrackOp(ctx.project, command.sceneId, command.trackId, command.patch, ctx.now) };
});
