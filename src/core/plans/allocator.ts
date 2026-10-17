/**
 * Plan fold determinism helpers (ARCHITECTURE_SPEC.md §8.3, §11.5 — Phase 17).
 *
 * A plan preview and a plan apply must produce byte-identical documents. That holds
 * only if every fresh id and every timestamp in the fold comes from an injected source
 * — never from `crypto` or `Date` (§8.3). These are the test-side sources: a counting
 * allocator that reads like the real ids (`scene_0001`) and a clock that does not tick.
 */
import type { Id } from '../types';

/**
 * An allocator that hands out `prefix_0001`, `prefix_0002`, ... in call order.
 *
 * Deterministic by construction, so `preview === applied` is an exact comparison and
 * not a "same shape" claim. The zero-padding keeps ids sortable and readable in a diff.
 */
export function makeCountingAllocator(seed = 1): (prefix: string) => Id {
  let next = seed;
  return (prefix: string): Id => {
    const id = `${prefix}_${String(next).padStart(4, '0')}`;
    next += 1;
    return id;
  };
}

/** A clock that always returns `iso`. */
export function fixedClock(iso: string): () => string {
  return () => iso;
}
