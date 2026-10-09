/**
 * AddKeyframe — add or update a keyframe at time (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7b).
 */
import { ID_PREFIX } from '../id';
import type { Id, KeyframeTarget, EaseType } from '../types';
import { addKeyframe as addKeyframeOp } from '../document/trackOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface AddKeyframeCommand extends Command {
  kind: 'AddKeyframe';
  sceneId: Id;
  trackId: Id;
  clipId: Id;
  time: number;
  props: KeyframeTarget;
  ease?: EaseType;
}

defineCommand<AddKeyframeCommand>('AddKeyframe', (command, ctx: CommandContext) => {
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };
  const track = scene.tracks.find((t) => t.id === command.trackId);
  if (!track) return { ok: false, error: notFound('track', command.trackId) };
  if (!track.clips.some((c) => c.id === command.clipId)) return { ok: false, error: notFound('clip', command.clipId) };
  if (!Number.isFinite(command.time) || command.time < 0) {
    return { ok: false, error: commandError('invalid-argument', 'Keyframe time must be non-negative.') };
  }
  return {
    ok: true,
    project: addKeyframeOp(ctx.project, command.sceneId, command.trackId, command.clipId, command.time, command.props, command.ease, {
      keyframeId: ctx.allocate(ID_PREFIX.keyframe),
      clock: ctx.now,
    }),
  };
});
