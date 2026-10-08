/**
 * The adaptive undo cap (ARCHITECTURE_SPEC.md §22.4).
 *
 * Snapshot history retains whole documents. One hundred snapshots is fine while a
 * document stays seed-sized, but a real episode project with attached audio can reach
 * megabytes, and 100 × a few MB is real memory on a 16 GB box. Rather than trim, the
 * cap shrinks with the document: the larger the serialized document, the fewer
 * snapshots are kept, so the retained history stays under a roughly constant budget.
 * The floor of `HISTORY_LIMIT_MIN` keeps undo useful no matter how large the document
 * gets, and the ceiling is `HISTORY_LIMIT` as before.
 *
 * The size signal is `JSON.stringify(document).length` — UTF-16 code units, used as a
 * proxy for bytes. It is measured per commit, which is a user action rather than a
 * per-frame cost, and it is the same serialization the autosave already performs.
 * UTF-16 length tracks an ASCII-heavy JSON document almost exactly; the distinction
 * is far below the uncertainty in "how much memory does a JS object graph really use",
 * which is the quantity these constants approximate.
 */

import { HISTORY_LIMIT } from '../constants';
import type { Project } from '../types';

/** Retained-history budget, in serialized JSON code units (§22.4: `2_000_000` bytes). */
const HISTORY_BUDGET_UNITS = 2_000_000;

/** No matter how large the document, undo never drops below this many steps. */
export const HISTORY_LIMIT_MIN = 20;

/** How many undo steps the document at hand is allowed to keep. */
export function historyLimitFor(document: Project): number {
  const units = JSON.stringify(document).length;
  return Math.min(
    HISTORY_LIMIT,
    Math.max(HISTORY_LIMIT_MIN, Math.floor(HISTORY_BUDGET_UNITS / Math.max(units, 1))),
  );
}