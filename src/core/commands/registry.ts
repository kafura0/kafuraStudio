/**
 * The command registry and the apply surface (ARCHITECTURE_SPEC.md §7.3, §8.3, §22.3).
 *
 * Kinds register by importing a command module, so the single public entry point is
 * `src/core/commands/index.ts`: importing it registers every kind as a side effect.
 * Importing this module directly gives you an empty registry, because no command module
 * has run yet. Do not import `./registry` from UI code; import from `./commands`.
 *
 * §22.3 supersedes §8.3: `applyCommand` (a single edit) validates its result every time;
 * `applyCommands` (a batch) validates exactly once, when the fold has finished. Both keep
 * the promise that a failing command returns the document untouched.
 */
import { validateProject } from '../document/invariants';
import { commandError } from './errors';
import type { Command, CommandContext, CommandResult } from './types';

export type CommandHandler = (command: Command, ctx: CommandContext) => CommandResult;

const registry = new Map<string, CommandHandler>();

/** kind -> handler. Readonly by type; mutation happens through `defineCommand` only. */
export const COMMAND_REGISTRY: ReadonlyMap<string, CommandHandler> = registry;

/**
 * Register a command kind. The `K` type parameter lets the handler body see its own
 * command's fields; the narrowing cast lives here, at the one place that knows which
 * kind maps to which shape.
 */
export function defineCommand<K extends Command>(
  kind: K['kind'],
  handler: (command: K, ctx: CommandContext) => CommandResult,
): void {
  if (registry.has(kind)) {
    throw new Error(`Command kind already registered: ${kind}`);
  }
  registry.set(kind, (command, ctx) => handler(command as K, ctx));
}

/**
 * Apply one command. Returns a new document on success, or the original document is left
 * untouched and an error is returned instead.
 *
 * Ordering matters (§7.1): a command validates its own arguments, and then — §22.3 —
 * the resulting document is validated before the success result is returned. A single
 * command is allowed to fail late: it simply did not happen. Plan and replay carry the
 * same cost, which is why `applyCommands` exists for the fold.
 *
 * A handler that throws is a bug in the command, not a reason to crash the caller; it
 * reappears as an `internal` error, the one code that says "this is the command's fault".
 */
export function applyCommand<C extends Command>(command: C, ctx: CommandContext): CommandResult {
  const handler = registry.get(command.kind);
  if (!handler) {
    return {
      ok: false,
      error: commandError('not-found', `No command registered under kind '${command.kind}'`),
    };
  }

  let result: CommandResult;
  try {
    result = handler(command, ctx);
  } catch (err) {
    return {
      ok: false,
      error: commandError(
        'internal',
        `Command '${command.kind}' threw: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }

  if (!result.ok) {
    return result;
  }

  const errors = validateProject(result.project, ctx.series ?? null).filter(
    (issue) => issue.severity === 'error',
  );
  if (errors.length > 0) {
    const first = errors[0];
    return {
      ok: false,
      error: commandError(
        'invalid-result',
        `Command '${command.kind}' left the document invalid: ${first?.message ?? 'unknown validation error'}`,
        first?.path,
      ),
    };
  }

  return result;
}