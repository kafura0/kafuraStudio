/**
 * RemoveClip — remove a clip (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7b).
 */
import type { Id } from '../types';
import { removeClip as removeClipOp } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface RemoveClipCommand extends Command {
  kind: 'RemoveClip';
  sceneId: Id;
  trackId: Id;
  clipId: Id;
}

defineCommand<RemoveClipCommand>('RemoveClip', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  const track = scene.tracks.find((t) => t.id === command.trackId);
  if (!track) return { ok: false, error: notFound('track', command.trackId) };
  if (!track.clips.some((c) => c.id === command.clipId)) return { ok: false, error: notFound('clip', command.clipId) };
  return { ok: true, project: removeClipOp(ctx.project, command.sceneId, command.trackId, command.clipId, ctx.now) };
});
