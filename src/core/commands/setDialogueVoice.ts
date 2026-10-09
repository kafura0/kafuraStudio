/**
 * SetDialogueVoice — attach or clear a line's voice asset (ARCHITECTURE_SPEC.md §7.2,
 * Phase 16 P6).
 *
 * One command, two writes: the line's voice slot and the audio id of every cue that
 * carries the line, kept in lockstep by `setDialogueVoice`. A voice that no asset in the
 * merged library declares is `not-found` — the command never frees the document to point
 * at a voice that does not exist.
 */
import type { Id } from '../types';
import { setDialogueVoice } from '../document/dialogueOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface SetDialogueVoiceCommand extends Command {
  kind: 'SetDialogueVoice';
  sceneId: Id;
  lineId: Id;
  /** `null` clears the voice slot. */
  audioId: Id | null;
}

defineCommand<SetDialogueVoiceCommand>('SetDialogueVoice', (command, ctx: CommandContext) => {
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
  if (command.audioId != null) {
    const library = ctx.assets ?? ctx.project.assets;
    if (!library.audio.some((a) => a.id === command.audioId)) {
      return { ok: false, error: notFound('voice', command.audioId) };
    }
  }
  return {
    ok: true,
    project: setDialogueVoice(ctx.project, command.sceneId, command.lineId, command.audioId, ctx.now),
  };
});