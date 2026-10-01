/**
 * The one place that knows the shape of the local database.
 *
 * Both the project repository and the media store live in the same IndexedDB database,
 * which means one version number and one upgrade transaction. Splitting that across two
 * modules is how a database ends up at version 2 with a `media` store that only exists
 * if some other module happened to open it first.
 *
 * Browser globals are confined to the `*.browser.ts` suffix (AGENTS.md RULE 5).
 */

/** Schema version. Bump only alongside a step in the ladder below. */
export const DB_VERSION = 2;

export const STORE_PROJECTS = 'projects';
export const STORE_META = 'meta';
/** Audio/video bytes, keyed by the media id an `AudioDef.src` points at. */
export const STORE_MEDIA = 'media';
/** Records that failed to parse, kept verbatim so a bad write is never overwritten. */
export const STORE_QUARANTINE = 'quarantine';

/**
 * Storage defaults.
 *
 * The database is named after the *product*, never after a show, so a second series
 * lands in the same local workspace instead of needing an engine change. Callers may
 * override the name; the value below is only a default, not a decision core makes
 * about content.
 */
export const DEFAULT_DB_NAME = 'kafura-studio';

export function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);

    /**
     * One upgrade, run exactly once per existing database.
     *
     * Every step is guarded by a `contains` check, so opening an already-current
     * database is a no-op and the ladder can be re-read from the top as it grows. A new
     * step is appended, never inserted, because a user on version 1 runs the whole
     * ladder on their next open and an edited step would rewrite history.
     */
    request.onupgradeneeded = () => {
      const db = request.result;

      // v1: projects + meta.
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }

      // v2: media bytes, and a place to put a record that will not parse.
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_QUARANTINE)) {
        db.createObjectStore(STORE_QUARANTINE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
}

/** True when IndexedDB is usable in this environment. */
export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}
