/**
 * DeleteDialogueLine — remove a line, its cue, and the lane that held the cue
 * (ARCHITECTURE_SPEC.md §7.2, Phase 16 P6).
 *
 * `removeDialogueLine` is total: a line with no cue still vanishes cleanly, and an empty
 * dialogue track is swept up with its clip so the document never lands on a lane with no
 * clips in it.
 */
import type { Id } from '../types';
import { removeDialogueLine } from '../document/dialogueOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface DeleteDialogueLineCommand extends Command {
  kind: 'DeleteDialogueLine';
  sceneId: Id;
  lineId: Id;
}

defineCommand<DeleteDialogueLineCommand>('DeleteDialogueLine', (command, ctx: CommandContext) => {
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
  return {
    ok: true,
    project: removeDialogueLine(ctx.project, command.sceneId, command.lineId, ctx.now),
  };
});