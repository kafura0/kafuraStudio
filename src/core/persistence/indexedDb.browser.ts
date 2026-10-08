/**
 * IndexedDB-backed project persistence.
 *
 * Records are stored under the serialized `ProjectFile` shape, so a corrupt or invalid
 * record is rejected on read with the same validation the JSON importer uses — a bad
 * record can never enter the editor.
 *
 * A record that fails to read is *quarantined*, not repaired and not deleted. It is moved
 * verbatim into its own store and the reason is kept alongside it. This is the fix for a
 * real data-loss path: the editor used to fall back to the seed project and then autosave
 * the seed over the corrupt record, destroying whatever was there while the operator saw
 * a working project with no warning. The bytes now live somewhere a save cannot reach.
 */

import { migrateProjectFile, parseSeries, serializeProject, serializeSeries } from '../serialize';
import { validateSeries } from '../document/invariants';
import type { Project, SeriesDef } from '../types';
import {
  DEFAULT_DB_NAME,
  isIndexedDbAvailable,
  openDatabase,
  promisify,
  STORE_META,
  STORE_PROJECTS,
  STORE_QUARANTINE,
  STORE_SERIES,
  transactionDone,
} from './db.browser';
import type { ProjectRepository, ProjectSummary, SeriesRepository, SeriesSummary } from './repository';

export { DEFAULT_DB_NAME, isIndexedDbAvailable };

export interface IndexedDbOptions {
  /** Database name. Defaults to {@link DEFAULT_DB_NAME}. */
  dbName?: string | undefined;
}

interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  /** The serialized `{ formatVersion, project }` document. */
  document: string;
  sceneCount: number;
  episodeCount: number;
  /**
   * When the project was archived, or `null`.
   *
   * Denormalized like the counts, for the same reason: the project browser has to decide
   * what to show without parsing every document in the database, and archive means
   * "hidden from the default list", so the list needs the answer to be a field. A record
   * written before this field existed reads back `undefined`, which is treated as not
   * archived — the safe direction, since showing a project beats hiding one silently.
   */
  archivedAt?: string | null;
  /**
   * The owning series, or `null` for a free project. Absent on pre-Phase-14 records.
   *
   * Denormalized for the same reason as `archivedAt`, and with the same backward-compatible
   * reading: `undefined` means "written before series existed", and the honest answer to
   * "which series does this belong to" for such a record is "unknown until it is opened" —
   * which is precisely when the lazy migration works it out. It is *not* coerced to `null`,
   * because that would claim the record is a free project when it is really a migrated one
   * with its art still inline.
   */
  seriesId?: string | null;
}

interface SeriesRecord {
  id: string;
  name: string;
  updatedAt: string;
  /** The serialized `{ formatVersion, series }` document. */
  document: string;
}

/** A record that would not parse, kept exactly as it was found. */
export interface QuarantinedRecord {
  id: string;
  name: string;
  /** The unparseable serialized document, byte for byte. */
  document: string;
  /** Why it was quarantined, in words a person can act on. */
  reason: string;
  /** ISO 8601. */
  quarantinedAt: string;
}

export class IndexedDbProjectRepository implements ProjectRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private readonly dbName: string;

  constructor(options: IndexedDbOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDatabase(this.dbName);
    return this.dbPromise;
  }

  async save(project: Project): Promise<void> {
    const db = await this.db();
    const record: ProjectRecord = {
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      document: serializeProject(project, false),
      sceneCount: project.scenes.length,
      episodeCount: project.episodes.length,
      archivedAt: project.metadata.archived,
      seriesId: project.seriesId,
    };
    const tx = db.transaction([STORE_PROJECTS, STORE_META], 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(record);
    tx.objectStore(STORE_META).put({ key: 'lastOpenedProjectId', value: project.id });
    await transactionDone(tx);
  }

  /**
   * Read a project, migrating the record in place if it predates Series, and quarantining
   * it if it will not parse.
   *
   * The re-validation on read is the point: a record written by a newer or corrupted
   * build must never reach the editor. The throw is deliberate — the caller needs to
   * know the project it asked for is not the one it got — but by the time it throws, the
   * record has already been moved somewhere a later save cannot overwrite, so the
   * operator's bytes still exist even if the app does not reopen.
   *
   * This is also where the lazy v2->v3 migration is *applied to storage* (§6.6). Reading a
   * pre-series record yields both halves: a project whose library has moved out, and the
   * series that library became. The series is written first, then the project record is
   * rewritten at the current version. Both go in one transaction, so a crash between them is
   * impossible and the next open simply repeats the work.
   *
   * A series row that *already exists* is never overwritten. The id the migration derives is
   * deterministic, so the second open of a migrated record would otherwise re-derive a
   * series and clobber every edit made to the show since — the exact data loss that
   * deterministic ids are supposed to make impossible.
   */
  async load(id: string): Promise<Project | null> {
    const db = await this.db();
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const record = await promisify<ProjectRecord | undefined>(
      tx.objectStore(STORE_PROJECTS).get(id) as IDBRequest<ProjectRecord | undefined>,
    );
    if (!record) return null;

    let project: Project;
    let implied: SeriesDef | null;
    try {
      // Authoring mode on purpose: this row was written by us, so a colour-key warning in
      // it means work in progress, not a hostile file — and refusing it would quarantine a
      // document the editor itself produced (its own "missing series" lockout §18.2 R3).
      // The warning is surfaced by IssuePanel once the project is open.
      ({ project, series: implied } = migrateProjectFile(record.document, { mode: 'authoring' }));
    } catch (error) {
      await this.quarantine(record, error);
      throw error;
    }

    if (implied !== null) {
      await this.adoptImpliedSeries(record, project, implied);
    }
    return project;
  }

  /**
   * Write the series a pre-series record implies, and re-save the project against it.
   *
   * `project` is the already-migrated document, so the project record is replaced rather
   * than left to be re-migrated on every subsequent read. Leaving it would mean paying for
   * the migration forever and, worse, would leave the stored document disagreeing with what
   * the editor is holding in memory.
   */
  private async adoptImpliedSeries(
    record: ProjectRecord,
    project: Project,
    implied: SeriesDef,
  ): Promise<void> {
    const db = await this.db();
    const write = db.transaction([STORE_PROJECTS, STORE_SERIES], 'readwrite');
    const seriesStore = write.objectStore(STORE_SERIES);
    const existing = await promisify<SeriesRecord | undefined>(
      seriesStore.get(implied.id) as IDBRequest<SeriesRecord | undefined>,
    );
    if (existing === undefined) {
      seriesStore.put({
        id: implied.id,
        name: implied.name,
        updatedAt: implied.updatedAt,
        document: serializeSeries(implied, false),
      });
    }
    write.objectStore(STORE_PROJECTS).put({
      ...record,
      document: serializeProject(project, false),
      seriesId: project.seriesId,
      archivedAt: project.metadata.archived,
    });
    await transactionDone(write);
  }

  /**
   * Move a bad record aside, preserving it byte for byte.
   *
   * Both writes happen in one transaction: either the record is safely out of the
   * projects store or nothing changed. A crash between the two would leave it readable
   * again, which is fine; leaving it *gone* without a copy would not be.
   */
  private async quarantine(record: ProjectRecord, error: unknown): Promise<void> {
    const db = await this.db();
    const entry: QuarantinedRecord = {
      id: record.id,
      name: record.name,
      document: record.document,
      reason: error instanceof Error ? error.message : String(error),
      quarantinedAt: new Date().toISOString(),
    };
    const tx = db.transaction([STORE_PROJECTS, STORE_QUARANTINE, STORE_META], 'readwrite');
    tx.objectStore(STORE_QUARANTINE).put(entry);
    tx.objectStore(STORE_PROJECTS).delete(record.id);
    // The project that pointed at this record is no longer the newest thing in the
    // workspace, so stop claiming it as the one to reopen.
    tx.objectStore(STORE_META).delete('lastOpenedProjectId');
    await transactionDone(tx);
  }

  async list(seriesId?: string | null): Promise<ProjectSummary[]> {
    const db = await this.db();
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const records = await promisify<ProjectRecord[]>(
      tx.objectStore(STORE_PROJECTS).getAll() as IDBRequest<ProjectRecord[]>,
    );
    return records
      // `undefined` means the argument was omitted, i.e. "every project in the workspace".
      // Filtering on identity rather than truthiness is what keeps a record written before
      // series existed visible in the unfiltered listing instead of vanishing from it.
      //
      // A record whose `seriesId` column is *absent* is unknown, not free. `(r.seriesId ??
      // null) === seriesId` would collapse the two and file every pre-series project under
      // "No series" — asserting an answer the record does not contain. Reading it requires
      // opening it, and opening it migrates it.
      .filter((r) => seriesId === undefined || (r.seriesId === undefined ? false : r.seriesId === seriesId))
      .map((r) => ({
        id: r.id,
        name: r.name,
        updatedAt: r.updatedAt,
        sceneCount: r.sceneCount,
        episodeCount: r.episodeCount,
        // Absent on records written before archiving existed; `?? null` rather than a
        // truthiness test, so a record with the field missing is treated as live.
        archivedAt: r.archivedAt ?? null,
        seriesId: r.seriesId ?? null,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([STORE_PROJECTS, STORE_META], 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(id);
    // A deleted project must not be the one the next launch reopens.
    tx.objectStore(STORE_META).delete('lastOpenedProjectId');
    await transactionDone(tx);
  }

  async loadMostRecent(): Promise<Project | null> {
    const db = await this.db();
    const tx = db.transaction(STORE_META, 'readonly');
    const meta = await promisify<{ key: string; value: string } | undefined>(
      tx.objectStore(STORE_META).get('lastOpenedProjectId') as IDBRequest<
        { key: string; value: string } | undefined
      >,
    );
    if (meta?.value) {
      // A quarantined record throws. That is reported, not swallowed: the caller shows
      // the operator that something was recovered and what happened to it.
      const project = await this.load(meta.value);
      // Never hand back something the operator archived. `save` records the pointer for
      // every write, and archiving is a write, so a project that was just hidden can still
      // be the newest thing on disk — reopening it would undo the archive silently, on the
      // next launch, with no action from the user.
      if (project && project.metadata.archived === null) return project;
    }
    // The same rule for the fallback: an archived project is not a candidate for being
    // opened for the operator.
    const summaries = (await this.list()).filter((s) => s.archivedAt === null);
    const newest = summaries[0];
    return newest ? this.load(newest.id) : null;
  }

  /** Records that failed to parse, newest first. */
  async listQuarantined(): Promise<QuarantinedRecord[]> {
    const db = await this.db();
    const tx = db.transaction(STORE_QUARANTINE, 'readonly');
    const entries = await promisify<QuarantinedRecord[]>(
      tx.objectStore(STORE_QUARANTINE).getAll() as IDBRequest<QuarantinedRecord[]>,
    );
    return entries.sort((a, b) => b.quarantinedAt.localeCompare(a.quarantinedAt));
  }

  /**
   * Put a quarantined record back where the editor can try it again.
   *
   * For the case where the cause was a build bug rather than a bad file: the operator
   * restores it and the next open migrates it properly. The project fields are unknown,
   * so they are read back out of the document and fall back to placeholders.
   */
  async restoreQuarantined(id: string): Promise<boolean> {
    const db = await this.db();
    const read = await promisify<QuarantinedRecord | undefined>(
      db.transaction(STORE_QUARANTINE, 'readonly').objectStore(STORE_QUARANTINE).get(id) as IDBRequest<
        QuarantinedRecord | undefined
      >,
    );
    if (!read) return false;

    const fields = describeUnparseable(read.document);
    const record: ProjectRecord = {
      id: read.id,
      name: fields.name,
      updatedAt: fields.updatedAt,
      document: read.document,
      sceneCount: fields.sceneCount,
      episodeCount: fields.episodeCount,
    };
    const tx = db.transaction([STORE_PROJECTS, STORE_QUARANTINE], 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(record);
    tx.objectStore(STORE_QUARANTINE).delete(id);
    await transactionDone(tx);
    return true;
  }

  /** Delete a quarantined record for good. The operator asked for this explicitly. */
  async discardQuarantined(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE_QUARANTINE, 'readwrite');
    tx.objectStore(STORE_QUARANTINE).delete(id);
    await transactionDone(tx);
  }
}

/**
 * IndexedDB-backed series persistence.
 *
 * The same database and the same rules as the project repository, for one reason worth
 * stating: a series and its projects are one workspace, and two databases would make "which
 * workspace is this document in" a question with two valid answers.
 *
 * Series records are stored as serialized documents rather than as plain objects, even though
 * a `SeriesDef` needs no migration of its own to date. The reason is forward-looking rather
 * than present-tense: a document has a `formatVersion` and therefore somewhere to put the
 * next field, whereas a bare object has no version to migrate from and would need its records
 * rewritten by hand. Storage that cannot change shape is a constraint that gets paid for
 * exactly once, on the day it is needed.
 *
 * A series record that fails validation is **not** quarantined the way a project record is.
 * The difference is that a broken series is not a data-loss event: the projects referencing
 * it are still perfectly readable documents, and refusing them would turn one bad row into an
 * unreachable workspace. Instead `load` returns `null` and the caller reports a dangling
 * reference — which is the honest description and leaves the operator able to act.
 */
export class IndexedDbSeriesRepository implements SeriesRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private readonly dbName: string;

  constructor(options: IndexedDbOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDatabase(this.dbName);
    return this.dbPromise;
  }

  async save(series: SeriesDef): Promise<void> {
    const issues = validateSeries(series);
    if (issues.length > 0) {
      // Refused here rather than repaired here. `SeriesDef` is built by code in this
      // repository, so an invalid one is a bug; writing it would turn a bug that a test
      // catches into a row that quietly breaks every project of the show.
      throw new Error(
        `Refusing to save an invalid series "${series.id}": ` +
          issues.map((i) => `${i.path}: ${i.message}`).join('; '),
      );
    }
    const db = await this.db();
    const record: SeriesRecord = {
      id: series.id,
      name: series.name,
      updatedAt: series.updatedAt,
      document: serializeSeries(series, false),
    };
    const tx = db.transaction([STORE_SERIES, STORE_META], 'readwrite');
    tx.objectStore(STORE_SERIES).put(record);
    // Recorded alongside the project pointer, so "which show was this workspace on" has the
    // same answer after a reload as it did before.
    tx.objectStore(STORE_META).put({ key: 'lastOpenedSeriesId', value: series.id });
    await transactionDone(tx);
  }

  /** The stored series, or `null` if there is no readable one at this id. */
  async load(id: string): Promise<SeriesDef | null> {
    const db = await this.db();
    const record = await promisify<SeriesRecord | undefined>(
      db.transaction(STORE_SERIES, 'readonly').objectStore(STORE_SERIES).get(id) as IDBRequest<
        SeriesRecord | undefined
      >,
    );
    if (!record) return null;
    try {
      // Through `parseSeries`, so the envelope is unwrapped in the one module that knows
      // about it. `normaliseSeries` on the whole document would not throw — it would hand
      // back a default series with an empty library, and the workspace would look like it
      // had quietly lost the show.
      return parseSeries(record.document);
    } catch {
      return null;
    }
  }

  /**
   * Series summaries with a real project count.
   *
   * The count comes from the `seriesId` column on the project records rather than from
   * parsing every project document, for the same reason the project list denormalizes its
   * counts: a series browser asks "how much is in here?" before it opens anything, and
   * parsing the whole workspace to answer that would make opening the browser O(workspace).
   *
   * Counts are built by tallying records into a map rather than filtering the full list once
   * per series. Both are one pass over the same array, but the per-series version scans it
   * `n` times, and the number of series is the thing this method cannot bound in advance.
   *
   * A pre-Phase-14 project record has no `seriesId` and therefore belongs to no series, so it
   * contributes to no count. It is not counted as free: it is unknown until opened, and a
   * missing column must not be read as an answer.
   */
  async list(): Promise<SeriesSummary[]> {
    const db = await this.db();
    const tx = db.transaction([STORE_SERIES, STORE_PROJECTS], 'readonly');
    const [records, projects] = await Promise.all([
      promisify<SeriesRecord[]>(tx.objectStore(STORE_SERIES).getAll() as IDBRequest<SeriesRecord[]>),
      promisify<ProjectRecord[]>(
        tx.objectStore(STORE_PROJECTS).getAll() as IDBRequest<ProjectRecord[]>,
      ),
    ]);
    const counts = new Map<string, number>();
    for (const p of projects) {
      if (p.seriesId === undefined || p.seriesId === null) continue;
      counts.set(p.seriesId, (counts.get(p.seriesId) ?? 0) + 1);
    }
    return records
      .map((r) => ({
        id: r.id,
        name: r.name,
        updatedAt: r.updatedAt,
        projectCount: counts.get(r.id) ?? 0,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Delete a series row.
   *
   * Refuses while any project names it. A deletion that ignored references would leave every
   * project of the show pointing at a row that no longer exists, and each of them would then
   * refuse to open — one decision in the series browser turning a working show into a set of
   * files that cannot be read. The check reads the `seriesId` column rather than parsing
   * documents, so it costs one store scan.
   *
   * `lastOpenedSeriesId` is cleared only when it names *this* series. Clearing it
   * unconditionally would un-open whichever show the operator was actually working in just
   * because they deleted a different one.
   */
  async remove(id: string): Promise<void> {
    const db = await this.db();
    const readTx = db.transaction([STORE_PROJECTS, STORE_META], 'readonly');
    const [projects, pointer] = await Promise.all([
      promisify<ProjectRecord[]>(
        readTx.objectStore(STORE_PROJECTS).getAll() as IDBRequest<ProjectRecord[]>,
      ),
      promisify<{ key: string; value: string } | undefined>(
        readTx.objectStore(STORE_META).get('lastOpenedSeriesId') as IDBRequest<
          { key: string; value: string } | undefined
        >,
      ),
    ]);
    const dependents = projects.filter((p) => p.seriesId === id);
    if (dependents.length > 0) {
      throw new Error(
        `Refusing to delete series "${id}": ${dependents.length} project` +
          `${dependents.length === 1 ? '' : 's'} still reference it. Reassign or delete ` +
          `${dependents.length === 1 ? 'that project' : 'those projects'} first.`,
      );
    }
    // Both writes in one transaction, scheduled synchronously. Issuing the second request
    // from inside an awaited continuation of the first would rely on the transaction still
    // being alive, which is true in Chrome and not guaranteed everywhere.
    const tx = db.transaction([STORE_SERIES, STORE_META], 'readwrite');
    tx.objectStore(STORE_SERIES).delete(id);
    if (pointer?.value === id) tx.objectStore(STORE_META).delete('lastOpenedSeriesId');
    await transactionDone(tx);
  }
}

/**
 * The few fields the project list needs, read without trusting the document.
 *
 * A quarantined record does not parse, so nothing inside it can be trusted to be the
 * right type. These are best-effort so the browser can list the record and let the
 * operator decide, not so it can be opened.
 */
function describeUnparseable(document: string): {
  name: string;
  updatedAt: string;
  sceneCount: number;
  episodeCount: number;
} {
  const fallback = { name: 'Unreadable project', updatedAt: new Date(0).toISOString(), sceneCount: 0, episodeCount: 0 };
  try {
    const file: unknown = JSON.parse(document);
    if (typeof file !== 'object' || file === null) return fallback;
    const project = (file as Record<string, unknown>).project;
    if (typeof project !== 'object' || project === null) return fallback;
    const record = project as Record<string, unknown>;
    return {
      name: typeof record.name === 'string' ? record.name : fallback.name,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : fallback.updatedAt,
      sceneCount: Array.isArray(record.scenes) ? record.scenes.length : 0,
      episodeCount: Array.isArray(record.episodes) ? record.episodes.length : 0,
    };
  } catch {
    return fallback;
  }
}
