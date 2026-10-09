/**
 * SetDialogueCue — re-time a line's cue by line id (ARCHITECTURE_SPEC.md §7.2, Phase 16
 * P6).
 *
 * The panel names a line, never a clip or a track; this command resolves the line's cue
 * inside `setDialogueCue` and routes through the very `moveClip` / `trimClip` the
 * timeline drag uses, so a number typed here and a drag there are one edit. A line with
 * no cue, or a cue already sitting where it was asked, is a no-op that returns the same
 * document object — the fold stays pure and no undo step is burned.
 *
 * The op normalises (start is clamped to 0, duration to at least a frame); the command
 * only refuses the shapes that mean the caller got something wrong.
 */
import type { Id } from '../types';
import { setDialogueCue } from '../document/dialogueOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface SetDialogueCueCommand extends Command {
  kind: 'SetDialogueCue';
  sceneId: Id;
  lineId: Id;
  cue: { start?: number; duration?: number };
}

defineCommand<SetDialogueCueCommand>('SetDialogueCue', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) {
    return {
      ok: false,
      error: notFound('scene', command.sceneId, `scenes[${command.sceneId}]`),
    };
  }
  if (!scene.dialogue.some((l) => l.id === command.lineId)) {
    return { ok: false, error: notFound('dialogue line', command.lineId) };
  }
  if (command.cue.start === undefined && command.cue.duration === undefined) {
    return {
      ok: false,
      error: commandError('invalid-argument', 'A cue edit needs a start, a duration, or both.'),
    };
  }
  return {
    ok: true,
    project: setDialogueCue(ctx.project, command.sceneId, command.lineId, command.cue, ctx.now),
  };
});