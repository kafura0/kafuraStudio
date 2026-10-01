/**
 * Project persistence interface.
 *
 * The editor only ever talks to this interface, so swapping local IndexedDB for a
 * cloud backend later touches nothing outside this file (AGENTS.md RULE 10). This
 * module is deliberately free of browser APIs; the IndexedDB implementation lives
 * in `indexedDb.browser.ts`.
 */

import type { Project } from '../types';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  sceneCount: number;
  episodeCount: number;
  /**
   * When the project was archived, or `null` if it is live.
   *
   * Carried on the summary rather than read back per row because the browser has to
   * decide what to show before it opens anything. Archive is "hidden from the default
   * list, not deleted" — so the list needs to know, and a summary that could not say was
   * a browser that either showed archived projects forever or hid them with no way back.
   */
  archivedAt: string | null;
}

export interface ProjectRepository {
  /** Create or overwrite a project. */
  save(project: Project): Promise<void>;
  load(id: string): Promise<Project | null>;
  list(): Promise<ProjectSummary[]>;
  remove(id: string): Promise<void>;
  /** The most recently updated project, if any. */
  loadMostRecent(): Promise<Project | null>;
}

/** In-memory implementation. Used by tests, and as a fallback if IndexedDB is blocked. */
export class MemoryProjectRepository implements ProjectRepository {
  private readonly store = new Map<string, Project>();

  async save(project: Project): Promise<void> {
    this.store.set(project.id, structuredClone(project));
  }

  async load(id: string): Promise<Project | null> {
    const found = this.store.get(id);
    return found ? structuredClone(found) : null;
  }

  async list(): Promise<ProjectSummary[]> {
    return [...this.store.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        sceneCount: p.scenes.length,
        episodeCount: p.episodes.length,
        archivedAt: p.metadata.archived,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }

  async loadMostRecent(): Promise<Project | null> {
    const all = await this.list();
    const newest = all[0];
    return newest ? this.load(newest.id) : null;
  }
}
