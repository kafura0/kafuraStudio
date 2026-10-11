/**
 * AttachAudioMedia — point an audio slot at a stored media file (ARCHITECTURE_SPEC.md §7.2, Phase 16 P8).
 *
 * The bytes live in the media store, not in the document; this command writes the
 * *reference* — the media id and the measured duration — into the project, creating a
 * project override when the slot belongs to the series. `ctx.assets` is the resolved
 * library the store derives from project + series, which is exactly what `attachAudioMedia`
 * needs to find a series-owned slot rather than silently miss it.
 */
import type { Id } from '../types';
import { attachAudioMedia } from '../document/projectOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface AttachAudioMediaCommand extends Command {
  kind: 'AttachAudioMedia';
  audioId: Id;
  mediaId: Id;
  duration: number;
}

defineCommand<AttachAudioMediaCommand>('AttachAudioMedia', (command, ctx: CommandContext) => {
  const library = ctx.assets ?? ctx.project.assets;
  if (!library.audio.some((a) => a.id === command.audioId)) {
    return { ok: false, error: notFound('audio', command.audioId) };
  }
  if (!Number.isFinite(command.duration)) {
    return {
      ok: false,
      error: commandError('invalid-argument', 'An attachment needs a finite duration.'),
    };
  }
  return {
    ok: true,
    project: attachAudioMedia(ctx.project, command.audioId, command.mediaId, command.duration, ctx.assets),
  };
});
