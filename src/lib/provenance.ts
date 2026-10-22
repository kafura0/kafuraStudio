/**
 * Provenance helpers (ARCHITECTURE_SPEC.md §9.4, Phase 19 step 6).
 *
 * Framework-agnostic predicates over `Provenance`, kept out of the badge component so the
 * component module exports only components (React fast refresh) and core-adjacent callers
 * can ask "was this AI-authored" without pulling in React.
 */
import type { Provenance } from '../core/types';

/** True when a record was authored by a model rather than a person. */
export function isAIProvenance(provenance?: Provenance): boolean {
  return provenance?.actor === 'ai';
}

/** The first AI provenance among a set of records, or `undefined` when none was. */
export function anyAIProvenance(records: readonly { provenance?: Provenance }[]): Provenance | undefined {
  return records.find((record) => isAIProvenance(record.provenance))?.provenance;
}
