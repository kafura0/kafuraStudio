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
import type { Command, CommandContext, CommandError, CommandResult } from './types';

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
 * Dispatch to the handler with no post-validation.
 *
 * This is the half of `applyCommand` that both apply surfaces share. It resolves the
 * kind, guards the registry, wraps the `internal` failure, and returns the handler's
 * result untouched. Validation is NOT here — §22.3 makes the single command validate and
 * the batch validate once, and the two callers own that difference.
 */
function runHandler(command: Command, ctx: CommandContext): CommandResult {
  const handler = registry.get(command.kind);
  if (!handler) {
    return {
      ok: false,
      error: commandError('not-found', `No command registered under kind '${command.kind}'`),
    };
  }

  try {
    return handler(command, ctx);
  } catch (err) {
    return {
      ok: false,
      error: commandError(
        'internal',
        `Command '${command.kind}' threw: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }
}

/**
 * Apply one command. Returns a new document on success, or the original document is left
 * untouched and an error is returned instead.
 *
 * Ordering matters (§7.1): a command validates its own arguments, and then — §22.3 —
 * the resulting document is validated before the success result is returned. A single
 * command is allowed to fail late: it simply did not happen.
 *
 * A handler that throws is a bug in the command, not a reason to crash the caller; it
 * reappears as an `internal` error, the one code that says "this is the command's fault".
 */
export function applyCommand<C extends Command>(command: C, ctx: CommandContext): CommandResult {
  const result = runHandler(command, ctx);
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

/**
 * Apply a sequence of commands as one fold (§8.3, §22.3).
 *
 * Two promises hold by construction:
 *
 * 1. **Atomicity.** The first failing command aborts the fold and the *original* project
 *    is returned — never a partially-folded one. Because every step is pure and produces
 *    a fresh document, the intermediate documents are unreachable garbage; there is no
 *    per-operation state to roll back.
 * 2. **One validation per batch (§22.3 supervises §8.3).** Each step runs through
 *    `runHandler` — the registry guard and the `internal` wrap, but no validation, because
 *    *every operation is already required to be total and to return a structurally valid
 *    document*. The batch validates exactly once, against the final document. That is what
 *    keeps a 200-command plan at O(200 × handler + document) instead of O(200 × document).
 */
export function applyCommands(commands: readonly Command[], ctx: CommandContext): CommandResult {
  let project = ctx.project;
  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i];
    if (command === undefined) continue;
    const result = runHandler(command, { ...ctx, project });
    if (!result.ok) {
      return { ok: false, error: batchPath(result.error, i, command.kind) };
    }
    project = result.project;
  }

  const errors = validateProject(project, ctx.series ?? null).filter(
    (issue) => issue.severity === 'error',
  );
  if (errors.length > 0) {
    const first = errors[0];
    return {
      ok: false,
      error: commandError(
        'invalid-result',
        `A command in the batch left the document invalid: ${first?.message ?? 'unknown validation error'}`,
        first?.path,
      ),
    };
  }

  return { ok: true, project };
}

/** Prepend the batch location to a per-command error path (`commands[3].Scene...`). */
function batchPath(error: CommandError, index: number, kind: string): CommandError {
  const prefix = `commands[${index}].${kind}`;
  return { ...error, path: error.path === undefined ? prefix : `${prefix}.${error.path}` };
}