/**
 * IndexedDB-backed media storage.
 *
 * Stores whole records in one object store rather than a key and a value store, so a
 * list view can read every filename without fetching every byte. Reading a record pulls
 * the bytes too, which is the trade this shape makes: metadata is cheap and frequent,
 * bytes are read only when a clip is about to play.
 */

import { DEFAULT_DB_NAME, openDatabase, promisify, STORE_MEDIA, transactionDone } from './db.browser';
import type { MediaMeta, MediaRecord, MediaStore } from '../media/mediaStore';

export interface IndexedDbMediaOptions {
  /** Database name. Must match the project repository's, or the bytes are unreachable. */
  dbName?: string | undefined;
}

/**
 * What actually comes back out of the object store.
 *
 * Deliberately not `MediaRecord`. This store is the one boundary in the app holding bytes
 * written by a *different build* - a workspace adopted from the pre-rename database carries
 * whatever that build's record looked like - and structured clone represents an absent key
 * as `undefined`, not as the `null` this app uses for "not known yet". Typing the read as
 * `MediaRecord` would make that a lie the compiler cannot catch, and the first component
 * that trusted `duration` would call `toFixed` on `undefined` and take the editor down
 * with no error boundary in the tree.
 */
type RawMediaRecord = Partial<MediaRecord> & { data?: ArrayBuffer };

function normalizeMeta(raw: RawMediaRecord): MediaMeta {
  return {
    id: raw.id ?? '',
    name: raw.name ?? '',
    type: raw.type ?? '',
    size: typeof raw.size === 'number' && Number.isFinite(raw.size) ? raw.size : 0,
    createdAt: raw.createdAt ?? '',
    duration:
      typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? raw.duration : null,
  };
}

function normalizeRecord(raw: RawMediaRecord): MediaRecord {
  return { ...normalizeMeta(raw), data: raw.data ?? new ArrayBuffer(0) };
}

export class IndexedDbMediaStore implements MediaStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private readonly dbName: string;

  constructor(options: IndexedDbMediaOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDatabase(this.dbName);
    return this.dbPromise;
  }

  async put(record: MediaRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    tx.objectStore(STORE_MEDIA).put(record);
    await transactionDone(tx);
  }

  async get(id: string): Promise<MediaRecord | null> {
    const db = await this.db();
    const tx = db.transaction(STORE_MEDIA, 'readonly');
    const record = await promisify<RawMediaRecord | undefined>(
      tx.objectStore(STORE_MEDIA).get(id) as IDBRequest<RawMediaRecord | undefined>,
    );
    return record === undefined ? null : normalizeRecord(record);
  }

  async has(id: string): Promise<boolean> {
    const db = await this.db();
    const tx = db.transaction(STORE_MEDIA, 'readonly');
    const key = await promisify(tx.objectStore(STORE_MEDIA).getKey(id));
    return key !== undefined;
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    tx.objectStore(STORE_MEDIA).delete(id);
    await transactionDone(tx);
  }

  async list(): Promise<MediaMeta[]> {
    const db = await this.db();
    const tx = db.transaction(STORE_MEDIA, 'readonly');
    const records = await promisify<RawMediaRecord[]>(
      tx.objectStore(STORE_MEDIA).getAll() as IDBRequest<RawMediaRecord[]>,
    );
    return records
      .map(normalizeMeta)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async totalBytes(): Promise<number> {
    const all = await this.list();
    return all.reduce((total, record) => total + record.size, 0);
  }
}
