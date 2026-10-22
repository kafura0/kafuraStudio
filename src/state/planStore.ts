/**
 * Plan review store — transient UI state for the PlanReviewPanel (ARCHITECTURE_SPEC.md
 * §24.9, §26 Phase 18 step 5).
 *
 * This store deliberately holds *only* the plan under review, never the project. The
 * project lives in the editor store, and keeping a second reference to it here is exactly
 * the "component-local copy of scene state" that AGENTS.md RULE 6 forbids: the review would
 * drift from the document the moment any other edit committed. The panel instead derives
 * its preview and diff from the live project on every render (`reviewPlan` is pure), so
 * "re-validate and re-preview on every change" (§13.4) reads the current document by
 * construction rather than by synchronisation.
 *
 * `original` is the plan as it arrived — from a fixture, a paste, or (Phase 19) a model —
 * and `envelope` is the copy the reviewer is editing. The pair is what makes the per-value
 * `Edited` badge honest (§14.3): "edited" is a fact computed by comparing the two, never an
 * assumption drawn from context. Loading clones both, so a caller cannot mutate the plan it
 * handed in and have the editor believe nothing changed.
 *
 * The review *history* (§9.5, Phase 18 step 7) lives behind a `PlanRepository` that defaults
 * to memory and is swapped for IndexedDB by the app shell. Plans are not part of the
 * document and never are read back into it; a row exists so a proposal closed without
 * applying can be reopened, and is discarded once applied.
 */
import { create } from 'zustand';
import type { PlanEnvelope } from '../core/plans/types';
import {
  MemoryPlanRepository,
  toPlanRecord,
  type PlanRecord,
  type PlanRepository,
  type PlanSummary,
} from '../core/persistence/plans';

/**
 * The store the history reads and writes.
 *
 * Memory by default rather than IndexedDB, for two reasons that are the same reason: the
 * repository is a browser-dependent side effect, so a store that constructed one would drag
 * it into every test that imports this module; and a review history that cannot be written
 * must never stop a review. The app shell swaps in IndexedDB where it exists.
 */
let repository: PlanRepository = new MemoryPlanRepository();

/** Point the history at a different store. Called once by the app shell. */
export function setPlanRepository(next: PlanRepository): void {
  repository = next;
}

export interface PlanReviewState {
  /** The plan as the reviewer is editing it, or `null` when nothing is under review. */
  envelope: PlanEnvelope | null;
  /** The plan as it arrived, for the `Edited` computation. */
  original: PlanEnvelope | null;
  /** The history listing, newest first. Refreshed on demand, never watched. */
  history: PlanSummary[];
  /** The history row holding the plan under review, or `null` if it was never persisted. */
  recordId: string | null;

  /** Begin reviewing a plan. Deep-copies so the caller's object is not shared. */
  load: (envelope: PlanEnvelope) => void;
  /** Replace the plan under review with an edited copy (no undo step, no commit). */
  edit: (envelope: PlanEnvelope) => void;
  /** Discard edits, returning to the plan as it arrived. */
  reset: () => void;
  /** End the review. The plan leaves memory; its history row is kept until applied. */
  close: () => void;

  /** Write the plan under review to the history. Returns its record id, or `null`. */
  persist: () => Promise<string | null>;
  /** Re-read the history listing. */
  refreshHistory: () => Promise<void>;
  /** Reopen a proposal from the history as an unedited review. */
  openHistory: (id: string) => Promise<boolean>;
  /** Drop a proposal from the history. Used when it is applied, and on demand. */
  forgetHistory: (id: string) => Promise<void>;
}

export const usePlan = create<PlanReviewState>()((set, get) => ({
  envelope: null,
  original: null,
  history: [],
  recordId: null,

  // A plan is JSON data (D7), so a structured clone is a total, lossless copy — the editor
  // and the original cannot alias the same nested object.
  load: (envelope) =>
    set({
      envelope: structuredClone(envelope),
      original: structuredClone(envelope),
      recordId: null,
    }),
  edit: (envelope) => set({ envelope }),
  reset: () => set((state) => ({ envelope: state.original ? structuredClone(state.original) : null })),
  close: () => set({ envelope: null, original: null, recordId: null }),

  persist: async () => {
    const { envelope } = get();
    if (envelope === null) return null;
    const record = toPlanRecord(envelope);
    try {
      await repository.save(record);
    } catch {
      // A history that cannot be written is not a reason to refuse the review (§9.5).
      return null;
    }
    set({ recordId: record.id });
    return record.id;
  },

  refreshHistory: async () => {
    try {
      set({ history: await repository.list() });
    } catch {
      set({ history: [] });
    }
  },

  openHistory: async (id) => {
    let record: PlanRecord | null = null;
    try {
      record = await repository.load(id);
    } catch {
      return false;
    }
    if (record === null) return false;
    // Reopened as *unedited*: the proposal is being looked at again, not yet changed again.
    set({
      envelope: structuredClone(record.envelope),
      original: structuredClone(record.envelope),
      recordId: record.id,
    });
    return true;
  },

  forgetHistory: async (id) => {
    try {
      await repository.remove(id);
    } catch {
      // Nothing else to do: the row is stale, and the review itself is unaffected.
    }
    set((state) => ({ history: state.history.filter((entry) => entry.id !== id) }));
  },
}));
