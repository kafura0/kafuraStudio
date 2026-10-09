/**
 * CommandError builders (ARCHITECTURE_SPEC.md §7.3).
 *
 * `path` is a human-readable locator into the document — e.g. `scenes[abc123]` — not a
 * parsed address. It exists so a downstream UI can anchor the message somewhere useful.
 */
import type { Id } from '../types';
import type { CommandError, CommandErrorCode } from './types';

export function commandError(code: CommandErrorCode, message: string, path?: string): CommandError {
  return path === undefined ? { code, message } : { code, message, path };
}

export function notFound(kind: string, id: Id, path?: string): CommandError {
  return commandError('not-found', `No such ${kind}: ${id}`, path);
}