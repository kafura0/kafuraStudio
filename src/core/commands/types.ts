import type { AssetLibrary, Id, Project, SeriesDef } from '../types';

/**
 * Command types (ARCHITECTURE_SPEC.md §7.3, Phase 16).
 *
 * A command is the single vocabulary the UI, the plan compiler and the AI boundary all
 * share. It is a plain data structure — a `kind` plus the fields that specific command
 * needs — and `applyCommand` / `applyCommands` (src/core/commands/registry.ts) turn one
 * into a new document via the operations in src/core/document/.
 *
 * Fields:
 * - `kind` — the command's name; the registry dispatches on it.
 * - `label` — an optional human history label. `commit(result.project, label)` keeps it
 *   in HistoryEntry (Phase 16 P5); when absent, the store falls back to its default.
 */
export interface Command {
  kind: string;
  label?: string;
}

/**
 * Everything `applyCommand` needs beyond the command itself.
 *
 * - `project` — the document the command is applied against. `applyCommands` feeds the
 *   previous result back in, so a batch is a fold, not a fan-out.
 * - `assets` — the merged library the handler resolves arguments against. In series
 *   ownership this is `resolveAssets(project, series)`, which is why the arg validation
 *   fights nothing structural. Invariant: whenever `assets` is a view the project does
 *   not itself own (anything other than `project.assets`), `series` MUST be passed too —
 *   the fold's post-validation resolves references through the same merged view, and a
 *   free project (series === null) is validated against `project.assets` alone.
 * - `series` — the Phase 14 addition to the spec's context. End-of-batch validation runs
 *   `validateProject(project, series)` with the same parity the store's `commit` already
 *   has. Absent (or null) means a free project, and the validator answers against that
 *   project's own library.
 * - `allocate` / `now` — the ONLY sources of fresh ids and timestamps inside a command
 *   fold (§8.3). They are injectable so a fold is deterministic in tests and in the plan
 *   preview: given the same allocator and clock, the same commands produce the same
 *   document. Production passes `createId` and a `new Date().toISOString()` writer.
 */
export interface CommandContext {
  project: Project;
  assets?: AssetLibrary;
  series?: SeriesDef | null;
  allocate: (prefix: string) => Id;
  now: () => string;
}

export type CommandErrorCode = 'not-found' | 'invalid-argument' | 'invalid-result' | 'internal';

export interface CommandError {
  code: CommandErrorCode;
  message: string;
  path?: string;
}

export type CommandResult =
  | { ok: true; project: Project }
  | { ok: false; error: CommandError };