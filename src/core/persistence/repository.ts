/**
 * Project persistence interface.
 *
 * The editor only ever talks to this interface, so swapping local IndexedDB for a
 * cloud backend later touches nothing outside this file (AGENTS.md RULE 10). This
 * module is deliberately free of browser APIs; the IndexedDB implementation lives
 * in `indexedDb.browser.ts`.
 *
 * `SeriesRepository` sits alongside it rather than inside it because the two have genuinely
 * different lifetimes: a series outlives every project that references it, so it cannot be a
 * field on one. Splitting the interface also keeps the "no backend" rule honest — a cloud
 * backend would store a show and an episode in the same table as an index, not as a nested
 * object.
 */

import type { Project, SeriesDef } from '../types';

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
  /**
   * The owning series, or `null` for a free project.
   *
   * On the summary because the browser groups by it before opening anything, and a
   * free project has to be listed as its own case rather than silently filed under the
   * first show that happens to be there.
   */
  seriesId: string | null;
}

export interface ProjectRepository {
  /** Create or overwrite a project. */
  save(project: Project): Promise<void>;
  load(id: string): Promise<Project | null>;
  /**
   * The workspace listing, newest first.
   *
   * `seriesId` scopes it to one show. It is optional rather than required because "every
   * project in the workspace" is a real question — the browser asks it when there is no
   * series chosen yet — and requiring the argument would have meant passing a sentinel to
   * mean "no filter", which is worse than an omitted optional.
   */
  list(seriesId?: string | null): Promise<ProjectSummary[]>;
  remove(id: string): Promise<void>;
  /** The most recently updated project, if any. */
  loadMostRecent(): Promise<Project | null>;
}

export interface SeriesSummary {
  id: string;
  name: string;
  updatedAt: string;
  /**
   * How many projects reference this series, or `null` when this store cannot tell.
   *
   * Shown so a delete can say what it affects, which is why `null` has to be expressible
   * rather than standing in as zero: "no projects use this" and "this store cannot count"
   * lead to opposite decisions, and only one of them may delete.
   */
  projectCount: number | null;
}

/**
 * Reusable libraries.
 *
 * There is no `archive` here, and that is a decision rather than an omission. `ProjectMetadata`
 * has an archive date because an episode is work in progress that someone may want to hide
 * for a while and get back to; a series is the show itself, and "hiding the show" is better
 * served by not opening it than by a second row state that every query would then have to
 * filter. Adding it later is additive.
 */
export interface SeriesRepository {
  save(series: SeriesDef): Promise<void>;
  load(id: string): Promise<SeriesDef | null>;
  list(): Promise<SeriesSummary[]>;
  remove(id: string): Promise<void>;
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

  async list(seriesId?: string | null): Promise<ProjectSummary[]> {
    return [...this.store.values()]
      .filter((p) => seriesId === undefined || p.seriesId === seriesId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        sceneCount: p.scenes.length,
        episodeCount: p.episodes.length,
        archivedAt: p.metadata.archived,
        seriesId: p.seriesId,
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

/**
 * In-memory series storage, for tests and for the seed workspace.
 *
 * `SeriesRepository` cannot count projects itself — that is a question about the *project*
 * store — so the count arrives as a constructor parameter and is `null` when the caller has
 * no project store to ask. A default of zero would be the convenient answer and the wrong
 * one: a test that builds one series and two projects and then reads the series as empty
 * would be testing the double rather than the code, and the seed workspace would tell an
 * operator that a series with fifty projects has none.
 */
export class MemorySeriesRepository implements SeriesRepository {
  private readonly store = new Map<string, SeriesDef>();

  private readonly countProjects: (seriesId: string) => number | null;

  constructor(
    seed: SeriesDef[] = [],
    countProjects: (seriesId: string) => number | null = () => null,
  ) {
    for (const series of seed) this.store.set(series.id, structuredClone(series));
    this.countProjects = countProjects;
  }

  async save(series: SeriesDef): Promise<void> {
    this.store.set(series.id, structuredClone(series));
  }

  async load(id: string): Promise<SeriesDef | null> {
    const found = this.store.get(id);
    return found ? structuredClone(found) : null;
  }

  async list(): Promise<SeriesSummary[]> {
    return [...this.store.values()]
      .map((s) => ({
        id: s.id,
        name: s.name,
        updatedAt: s.updatedAt,
        projectCount: this.countProjects(s.id),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }
}
