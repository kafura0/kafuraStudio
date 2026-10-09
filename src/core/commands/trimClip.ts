/**
 * TrimClip � trim a clip from either edge (ARCHITECTURE_SPEC.md �7.2, Phase 16 P7b).
 */
import type { Id } from '../types';
import { trimClip as trimClipOp } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface TrimClipCommand extends Command {
  kind: 'TrimClip';
  sceneId: Id;
  trackId: Id;
  clipId: Id;
  edge: 'start' | 'end';
  time: number;
}

defineCommand<TrimClipCommand>('TrimClip', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  const track = scene.tracks.find((t) => t.id === command.trackId);
  if (!track) return { ok: false, error: notFound('track', command.trackId) };
  if (!track.clips.some((c) => c.id === command.clipId)) return { ok: false, error: notFound('clip', command.clipId) };
  if (!Number.isFinite(command.time)) {
    return { ok: false, error: commandError('invalid-argument', 'Trim time must be a number.') };
  }
  return { ok: true, project: trimClipOp(ctx.project, command.sceneId, command.trackId, command.clipId, command.edge, command.time, ctx.now) };
});
