/**
 * AddDialogueLine — add a line and its timing clip in one mutation
 * (ARCHITECTURE_SPEC.md §7.2, Phase 16 P6).
 *
 * The second allocating command, and the first that hands the operation a friend: the
 * line id, clip id and track id all come from `ctx.allocate` (in a fixed order) and the
 * scene's timestamp from `ctx.now`, so a plan that adds the same line twice folds to the
 * exact same document (§8.3). The op still lets a direct caller omit the ids.
 */
import { ID_PREFIX } from '../id';
import type { Id } from '../types';
import { addDialogueLineWithCue } from '../document/dialogueOps';
import { MIN_CLIP_DURATION } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface AddDialogueLineCommand extends Command {
  kind: 'AddDialogueLine';
  sceneId: Id;
  speaker: string;
  text: string;
  /** Optional in the payload; present in the panel because a scene actor is usually wanted. */
  actorId?: Id | null;
  emotion?: string;
  subtitle?: string | null;
  voiceAudioId?: Id | null;
  start: number;
  duration: number;
}

defineCommand<AddDialogueLineCommand>('AddDialogueLine', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) {
    return {
      ok: false,
      error: notFound('scene', command.sceneId, `scenes[${command.sceneId}]`),
    };
  }
  if (command.actorId != null && !scene.actors.some((a) => a.id === command.actorId)) {
    return { ok: false, error: notFound('actor', command.actorId) };
  }
  if (command.voiceAudioId != null) {
    const library = ctx.assets ?? ctx.project.assets;
    if (!library.audio.some((a) => a.id === command.voiceAudioId)) {
      return { ok: false, error: notFound('voice', command.voiceAudioId) };
    }
  }
  // The op normalises nothing for a new line: the clip is created verbatim, so the
  // command is the last line of defence against a degenerate cue.
  if (!Number.isFinite(command.start) || command.start < 0) {
    return { ok: false, error: commandError('invalid-argument', 'A cue start cannot be negative.') };
  }
  if (!Number.isFinite(command.duration) || command.duration < MIN_CLIP_DURATION) {
    return {
      ok: false,
      error: commandError('invalid-argument', 'A cue duration must cover at least one frame.'),
    };
  }

  const { project } = addDialogueLineWithCue(
    ctx.project,
    command.sceneId,
    {
      speaker: command.speaker,
      text: command.text,
      ...(command.actorId !== undefined ? { actorId: command.actorId } : {}),
      ...(command.emotion !== undefined ? { emotion: command.emotion } : {}),
      ...(command.subtitle !== undefined ? { subtitle: command.subtitle } : {}),
      ...(command.voiceAudioId !== undefined ? { voiceAudioId: command.voiceAudioId } : {}),
      start: command.start,
      duration: command.duration,
    },
    {
      lineId: ctx.allocate(ID_PREFIX.dialogue),
      clipId: ctx.allocate(ID_PREFIX.clip),
      trackId: ctx.allocate(ID_PREFIX.track),
      clock: ctx.now,
    },
  );
  return { ok: true, project };
});