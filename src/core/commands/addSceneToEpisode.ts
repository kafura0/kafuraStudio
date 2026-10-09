/**
 * AddSceneToEpisode — append (or re-insert) a scene into an episode's cut list
 * (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7a).
 *
 * Adding a scene that is already in the cut returns the document untouched, so a double
 * click records nothing in history — the same no-op rule every other gesture follows.
 * The underlying op throws on an unknown scene, so this command pre-validates both
 * references and returns `not-found` instead of crashing.
 */
import type { Id } from '../types';
import { addSceneToEpisode } from '../document/projectOps';
import type { Command, CommandContext } from './types';
import { notFound } from './errors';
import { defineCommand } from './registry';

export interface AddSceneToEpisodeCommand extends Command {
  kind: 'AddSceneToEpisode';
  episodeId: Id;
  sceneId: Id;
  index?: number;
}

defineCommand<AddSceneToEpisodeCommand>('AddSceneToEpisode', (command, ctx: CommandContext) => {
  const episode = ctx.project.episodes.find((e) => e.id === command.episodeId);
  if (!episode) {
    return { ok: false, error: notFound('episode', command.episodeId) };
  }
  if (!ctx.project.scenes.some((s) => s.id === command.sceneId)) {
    return { ok: false, error: notFound('scene', command.sceneId) };
  }
  if (episode.sceneIds.includes(command.sceneId)) {
    return { ok: true, project: ctx.project };
  }
  return {
    ok: true,
    project: addSceneToEpisode(
      ctx.project,
      command.episodeId,
      command.sceneId,
      command.index,
      ctx.now,
    ),
  };
});