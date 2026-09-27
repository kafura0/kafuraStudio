/**
 * IndexedDB-backed project persistence.
 *
 * The only module in the codebase that touches IndexedDB (AGENTS.md RULE 5 allows
 * browser globals in `*.browser.ts` files).
 *
 * Records are stored under the serialized `ProjectFile` shape, so a corrupt or
 * invalid record is rejected on read with the same validation the JSON importer
 * uses — a bad record can never enter the editor.
 */

import { parseProject, serializeProject } from '../serialize';
import type { Project } from '../types';
import type { ProjectRepository, ProjectSummary } from './repository';

const DB_NAME = 'zanza-studio';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_META = 'meta';

interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  /** The serialized `{ formatVersion, project }` document. */
  document: string;
  sceneCount: number;
  episodeCount: number;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
}

export class IndexedDbProjectRepository implements ProjectRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDatabase();
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
    };
    const tx = db.transaction([STORE_PROJECTS, STORE_META], 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(record);
    tx.objectStore(STORE_META).put({ key: 'lastOpenedProjectId', value: project.id });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  async load(id: string): Promise<Project | null> {
    const db = await this.db();
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const record = await promisify<ProjectRecord | undefined>(
      tx.objectStore(STORE_PROJECTS).get(id) as IDBRequest<ProjectRecord | undefined>,
    );
    if (!record) return null;
    // Re-validate on read: a record written by a newer or corrupted build must not
    // reach the editor.
    return parseProject(record.document);
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
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
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
      const project = await this.load(meta.value);
      if (project) return project;
    }
    const summaries = await this.list();
    const newest = summaries[0];
    return newest ? this.load(newest.id) : null;
  }
}

/** True when IndexedDB is usable in this environment. */
export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}
