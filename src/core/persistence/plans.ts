/**
 * Plan persistence (ARCHITECTURE_SPEC.md §9.5, §12, §24.9 Phase 18 step 7).
 *
 * A plan is an *instruction*, not a fact: the document records what is true after the plan
 * ran, never what was asked for (§9.5). So plans are not stored with projects. They live in
 * the transient review store, and *optionally* in this repository, which exists for one
 * purpose — a **review history**: the proposals this workspace has seen, so a proposal that
 * was closed without applying can be reopened and finished later rather than retyped.
 *
 * A record is discarded once applied. What survives an apply is not the plan but its
 * `Provenance`, stamped onto the history entry the apply produced.
 *
 * The interface is deliberately free of browser APIs, like `repository.ts`: swapping the
 * in-memory implementation for IndexedDB — or later, a cloud — touches nothing outside the
 * repository module.
 */

import type { Provenance } from '../types';
import type { PlanEnvelope } from '../plans/types';

/** The stored form of a plan under review: the envelope plus its stable key. */
export interface PlanRecord {
  id: string;
  planVersion: number;
  envelope: PlanEnvelope;
}

/**
 * The history listing, without the envelopes.
 *
 * Listed the same way projects are (`ProjectSummary`): the panel has to say "which proposals
 * are here?" before it parses anything, and parsing every proposal to render a list of titles
 * would make opening the history cost the whole history.
 */
export interface PlanSummary {
  id: string;
  title: string;
  /** ISO 8601. The plan's own `createdAt`, not the time it was written here. */
  createdAt: string;
  /** Who or what proposed it. `human` when the plan carries no provenance. */
  actor: Provenance['actor'];
}

export interface PlanRepository {
  /** Create or overwrite a record. Re-saving an unchanged plan is a no-op by id. */
  save(record: PlanRecord): Promise<void>;
  load(id: string): Promise<PlanRecord | null>;
  /** Newest first. */
  list(): Promise<PlanSummary[]>;
  remove(id: string): Promise<void>;
}

/**
 * A stable id derived from the plan's contents.
 *
 * Plans have no id of their own (§9.4), so the key is a hash of the envelope. Content-derived
 * rather than random on purpose: proposing the same plan twice writes one history row instead
 * of accumulating identical entries, and reopening a plan from history and saving it unchanged
 * overwrites the row it came from rather than forking it.
 *
 * FNV-1a — a hash, not a security primitive. Nothing here is authenticated; the only property
 * required is that two different envelopes practically never collide into one row.
 */
export function planRecordId(envelope: PlanEnvelope): string {
  const input = JSON.stringify(envelope);
  let hash = 0x811c9dc5;
  for (let at = 0; at < input.length; at += 1) {
    hash ^= input.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `plan_${hash.toString(16).padStart(8, '0')}`;
}

/** Wrap an envelope for storage. Pure: the envelope is stored as-is, never normalised. */
export function toPlanRecord(envelope: PlanEnvelope): PlanRecord {
  return {
    id: planRecordId(envelope),
    planVersion: envelope.planVersion,
    envelope: structuredClone(envelope),
  };
}

/** Who proposed it. A plan with no provenance was authored by a person. */
export function planActor(envelope: PlanEnvelope): Provenance['actor'] {
  return envelope.provenance?.actor ?? 'human';
}

/**
 * In-memory plan storage.
 *
 * Used by tests, and as the fallback wherever IndexedDB is unavailable or blocked — a review
 * history that could not be written must never stop a review from happening.
 */
export class MemoryPlanRepository implements PlanRepository {
  private readonly store = new Map<string, PlanRecord>();

  async save(record: PlanRecord): Promise<void> {
    this.store.set(record.id, {
      id: record.id,
      planVersion: record.planVersion,
      envelope: structuredClone(record.envelope),
    });
  }

  async load(id: string): Promise<PlanRecord | null> {
    const found = this.store.get(id);
    return found ? structuredClone(found) : null;
  }

  async list(): Promise<PlanSummary[]> {
    return [...this.store.values()]
      .map((record) => ({
        id: record.id,
        title: record.envelope.title,
        createdAt: record.envelope.createdAt,
        actor: planActor(record.envelope),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }
}
