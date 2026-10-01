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

import { parseProject, serializeProject } from '../serialize';
import type { Project } from '../types';
import {
  DEFAULT_DB_NAME,
  isIndexedDbAvailable,
  openDatabase,
  promisify,
  STORE_META,
  STORE_PROJECTS,
  STORE_QUARANTINE,
  transactionDone,
} from './db.browser';
import type { ProjectRepository, ProjectSummary } from './repository';

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
    };
    const tx = db.transaction([STORE_PROJECTS, STORE_META], 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(record);
    tx.objectStore(STORE_META).put({ key: 'lastOpenedProjectId', value: project.id });
    await transactionDone(tx);
  }

  /**
   * Read a project, quarantining the record if it will not parse.
   *
   * The re-validation on read is the point: a record written by a newer or corrupted
   * build must never reach the editor. The throw is deliberate — the caller needs to
   * know the project it asked for is not the one it got — but by the time it throws, the
   * record has already been moved somewhere a later save cannot overwrite, so the
   * operator's bytes still exist even if the app does not reopen.
   */
  async load(id: string): Promise<Project | null> {
    const db = await this.db();
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const record = await promisify<ProjectRecord | undefined>(
      tx.objectStore(STORE_PROJECTS).get(id) as IDBRequest<ProjectRecord | undefined>,
    );
    if (!record) return null;

    try {
      return parseProject(record.document);
    } catch (error) {
      await this.quarantine(record, error);
      throw error;
    }
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

  async list(): Promise<ProjectSummary[]> {
    const db = await this.db();
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const records = await promisify<ProjectRecord[]>(
      tx.objectStore(STORE_PROJECTS).getAll() as IDBRequest<ProjectRecord[]>,
    );
    return records
      .map((r) => ({
        id: r.id,
        name: r.name,
        updatedAt: r.updatedAt,
        sceneCount: r.sceneCount,
        episodeCount: r.episodeCount,
        // Absent on records written before archiving existed; `?? null` rather than a
        // truthiness test, so a record with the field missing is treated as live.
        archivedAt: r.archivedAt ?? null,
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
