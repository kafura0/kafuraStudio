/**
 * MoveClipToTrack — relocate a clip to another track of the same kind (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7b).
 */
import type { Id } from '../types';
import { relocateClip } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface MoveClipToTrackCommand extends Command {
  kind: 'MoveClipToTrack';
  sceneId: Id;
  fromTrackId: Id;
  toTrackId: Id;
  clipId: Id;
}

defineCommand<MoveClipToTrackCommand>('MoveClipToTrack', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  const from = scene.tracks.find((t) => t.id === command.fromTrackId);
  const to = scene.tracks.find((t) => t.id === command.toTrackId);
  if (!from) return { ok: false, error: notFound('track', command.fromTrackId) };
  if (!to) return { ok: false, error: notFound('track', command.toTrackId) };
  if (!from.clips.some((c) => c.id === command.clipId)) return { ok: false, error: notFound('clip', command.clipId) };
  return { ok: true, project: relocateClip(ctx.project, command.sceneId, command.fromTrackId, command.toTrackId, command.clipId, ctx.now) };
});
