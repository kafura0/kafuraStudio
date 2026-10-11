/**
 * DetachAudioMedia — forget an audio slot's stored file (ARCHITECTURE_SPEC.md §7.2, Phase 16 P8).
 *
 * Only the reference is cleared; the bytes stay in the media store so an undo can bring the
 * attachment back (see `detachAudioMedia`). `ctx.assets` is the resolved library, so a
 * series-owned slot is overridden in the project rather than silently left untouched.
 */
import type { Id } from '../types';
import { detachAudioMedia } from '../document/projectOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface DetachAudioMediaCommand extends Command {
  kind: 'DetachAudioMedia';
  audioId: Id;
}

defineCommand<DetachAudioMediaCommand>('DetachAudioMedia', (command, ctx: CommandContext) => {
  const library = ctx.assets ?? ctx.project.assets;
  if (!library.audio.some((a) => a.id === command.audioId)) {
    return { ok: false, error: notFound('audio', command.audioId) };
  }
  return {
    ok: true,
    project: detachAudioMedia(ctx.project, command.audioId, ctx.assets),
  };
});
