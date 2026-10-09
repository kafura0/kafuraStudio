/**
 * SetDialogueLine — patch a line's content (ARCHITECTURE_SPEC.md §7.2, Phase 16 P6).
 *
 * The dialogue analogue of `SetActorPose`: the handler validates the parts of a patch
 * that reference other documents (an actor must be placed, a voice must exist), applies
 * `updateDialogueLine`, and leaves the registry to post-validate the whole document.
 *
 * A patch that changes nothing returns the caller's document untouched, so a blur that
 * typed nothing back burns no undo step.
 */
import type { DialogueLine, Id } from '../types';
import { updateDialogueLine } from '../document/dialogueOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface SetDialogueLineCommand extends Command {
  kind: 'SetDialogueLine';
  sceneId: Id;
  lineId: Id;
  patch: Partial<Omit<DialogueLine, 'id'>>;
}

defineCommand<SetDialogueLineCommand>('SetDialogueLine', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) {
    return {
      ok: false,
      error: notFound('scene', command.sceneId, `scenes[${command.sceneId}]`),
    };
  }
  const line = scene.dialogue.find((l) => l.id === command.lineId);
  if (!line) {
    return { ok: false, error: notFound('dialogue line', command.lineId) };
  }
  if (command.patch.actorId != null && !scene.actors.some((a) => a.id === command.patch.actorId)) {
    return { ok: false, error: notFound('actor', command.patch.actorId) };
  }
  if (command.patch.voiceAudioId != null) {
    const library = ctx.assets ?? ctx.project.assets;
    if (!library.audio.some((a) => a.id === command.patch.voiceAudioId)) {
      return { ok: false, error: notFound('voice', command.patch.voiceAudioId) };
    }
  }

  const entries = Object.entries(command.patch) as [keyof DialogueLine, unknown][];
  if (entries.every(([key, value]) => line[key] === value)) {
    return { ok: true, project: ctx.project };
  }

  return {
    ok: true,
    project: updateDialogueLine(ctx.project, command.sceneId, command.lineId, command.patch, ctx.now),
  };
});