/**
 * AddClip — add a clip, creating its track if needed (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7b).
 */
import { ID_PREFIX } from '../id';
import type { Id, TrackKind } from '../types';
import { addSimpleClip, MIN_CLIP_DURATION } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface AddClipCommand extends Command {
  kind: 'AddClip';
  sceneId: Id;
  trackKind: TrackKind;
  targetId: Id;
  name: string;
  start: number;
  duration: number;
  audioId?: string | null;
  dialogueLineId?: string | null;
  gain?: number;
  trackId?: Id;
  /**
   * Plan-compilation handles for the track and clip this command creates (§11.5
   * correction). Never set by the UI; `applyPlan` binds them to the ids the command
   * just produced so later compiled keyframe commands can address them.
   */
  trackRef?: string;
  clipRef?: string;
}

defineCommand<AddClipCommand>('AddClip', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  if (!Number.isFinite(command.start) || command.start < 0) {
    return { ok: false, error: commandError('invalid-argument', 'A clip start cannot be negative.') };
  }
  if (!Number.isFinite(command.duration) || command.duration < MIN_CLIP_DURATION) {
    return { ok: false, error: commandError('invalid-argument', 'A clip duration must cover at least one frame.') };
  }
  const library = ctx.assets ?? ctx.project.assets;
  if (command.dialogueLineId != null) {
    if (!scene.dialogue.some((l) => l.id === command.dialogueLineId)) return { ok: false, error: notFound('dialogue line', command.dialogueLineId) };
  }
  if (command.audioId != null) {
    if (!library.audio.some((a) => a.id === command.audioId)) return { ok: false, error: notFound('audio', command.audioId) };
  }
  const extras: { audioId?: string | null; dialogueLineId?: string | null; gain?: number } = {};
  if (command.audioId !== undefined) extras.audioId = command.audioId;
  if (command.dialogueLineId !== undefined) extras.dialogueLineId = command.dialogueLineId;
  if (command.gain !== undefined) extras.gain = command.gain;
  // A fresh track's id must come from the allocator too (§8.3): `findOrCreateTrack`
  // would otherwise mint one with crypto when it creates the track. Only allocate when
  // the track really is missing, so the id stream does not depend on track count.
  const trackExists = scene.tracks.some(
    (t) => t.kind === command.trackKind && t.targetId === command.targetId,
  );
  const { project } = addSimpleClip(
    ctx.project,
    command.sceneId,
    command.trackKind,
    command.targetId,
    command.name,
    command.start,
    command.duration,
    extras,
    {
      clipId: ctx.allocate(ID_PREFIX.clip),
      ...(command.trackId !== undefined
        ? { trackId: command.trackId }
        : trackExists
          ? {}
          : { trackId: ctx.allocate(ID_PREFIX.track) }),
      clock: ctx.now,
    },
  );
  return { ok: true, project };
});
