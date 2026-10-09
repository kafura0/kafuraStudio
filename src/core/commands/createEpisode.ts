/**
 * CreateEpisode — add an episode to the project (ARCHITECTURE_SPEC.md §7.2, Phase 16 P7a).
 *
 * One allocating command, in the same fold-safe shape as `CreateScene`: the episode's id
 * comes from `ctx.allocate` and its timestamp from `ctx.now`, never from the operation
 * itself (§7.4, §8.3). A blank title is refused rather than kept — an episode called
 * nothing would export a cut nothing can name.
 */
import { ID_PREFIX } from '../id';
import { addEpisode } from '../document/projectOps';
import type { Command, CommandContext } from './types';
import { commandError } from './errors';
import { defineCommand } from './registry';

export interface CreateEpisodeCommand extends Command {
  kind: 'CreateEpisode';
  title: string;
  description?: string;
}

defineCommand<CreateEpisodeCommand>('CreateEpisode', (command, ctx: CommandContext) => {
  if (command.title.trim() === '') {
    return { ok: false, error: commandError('invalid-argument', 'An episode needs a title.') };
  }
  const project = addEpisode(ctx.project, command.title, command.description ?? '', {
    id: ctx.allocate(ID_PREFIX.episode),
    clock: ctx.now,
  });
  return { ok: true, project };
});