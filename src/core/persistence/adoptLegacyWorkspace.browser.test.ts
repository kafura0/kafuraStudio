/**
 * The database-name migration: copying the original workspace forward.
 *
 * The regression this protects is a workspace that looks empty after a rename, which reads
 * to an operator exactly like data loss. The records are not lost -- they are in the
 * original database -- so the only thing that has to be true is that they are found.
 *
 * Scoped `fake-indexeddb` import rather than the global setup file, so only the tests that
 * need a real database pay for it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { adoptLegacyWorkspace } from './adoptLegacyWorkspace.browser';
import { DEFAULT_DB_NAME, openDatabase, STORE_MEDIA, STORE_PROJECTS } from './db.browser';

/** The pre-rename workspace name. A fixture here, not a constant in core. */
const LEGACY = 'zanza-studio';

/** A fresh in-memory factory per test, so databases cannot leak between them. */
function freshFactory(): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: new IDBFactory(),
    configurable: true,
    writable: true,
  });
}

async function seed(name: string, store: string, records: unknown[]): Promise<void> {
  const db = await openDatabase(name);
  const tx = db.transaction(store, 'readwrite');
  for (const record of records) tx.objectStore(store).put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function readAll(name: string, store: string): Promise<unknown[]> {
  const db = await openDatabase(name);
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const project = (id: string) => ({ id, name: `Project ${id}`, document: `{"formatVersion":2,"project":{"id":"${id}"}}` });

describe('adoptLegacyWorkspace', () => {
  afterEach(() => {
    freshFactory();
  });

  it('copies projects from the original database into the active one', async () => {
    freshFactory();
    await seed(LEGACY, STORE_PROJECTS, [project('a'), project('b')]);

    const result = await adoptLegacyWorkspace(LEGACY);

    expect(result).toEqual({ adopted: true, projects: 2, media: 0, quarantined: 0 });
    const adopted = (await readAll(DEFAULT_DB_NAME, STORE_PROJECTS)) as { id: string }[];
    expect(adopted.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('copies media bytes too, so an adopted document can still resolve its audio', async () => {
    freshFactory();
    await seed(LEGACY, STORE_PROJECTS, [project('a')]);
    await seed(LEGACY, STORE_MEDIA, [{ id: 'media_1', name: 'tone.wav', size: 4, data: new ArrayBuffer(4) }]);

    const result = await adoptLegacyWorkspace(LEGACY);

    expect(result.media).toBe(1);
    const media = (await readAll(DEFAULT_DB_NAME, STORE_MEDIA)) as { id: string }[];
    expect(media.map((m) => m.id)).toEqual(['media_1']);
  });

  it('is idempotent: a second run adopts nothing and does not duplicate', async () => {
    freshFactory();
    await seed(LEGACY, STORE_PROJECTS, [project('a')]);

    const first = await adoptLegacyWorkspace(LEGACY);
    const second = await adoptLegacyWorkspace(LEGACY);

    expect(first.adopted).toBe(true);
    expect(second.adopted).toBe(false);
    const adopted = (await readAll(DEFAULT_DB_NAME, STORE_PROJECTS)) as { id: string }[];
    expect(adopted).toHaveLength(1);
  });

  it('never clobbers an active workspace that already has projects', async () => {
    freshFactory();
    await seed(LEGACY, STORE_PROJECTS, [project('legacy')]);
    await seed(DEFAULT_DB_NAME, STORE_PROJECTS, [project('current')]);

    const result = await adoptLegacyWorkspace(LEGACY);

    expect(result.adopted).toBe(false);
    const adopted = (await readAll(DEFAULT_DB_NAME, STORE_PROJECTS)) as { id: string }[];
    expect(adopted.map((r) => r.id)).toEqual(['current']);
  });

  it('leaves the original database intact, so its records stay readable there', async () => {
    freshFactory();
    await seed(LEGACY, STORE_PROJECTS, [project('a')]);

    await adoptLegacyWorkspace(LEGACY);

    const legacy = (await readAll(LEGACY, STORE_PROJECTS)) as { id: string }[];
    expect(legacy.map((r) => r.id)).toEqual(['a']);
  });

  it('does nothing, and creates nothing, when the original database does not exist', async () => {
    freshFactory();

    const result = await adoptLegacyWorkspace(LEGACY);

    expect(result.adopted).toBe(false);
    const infos = await indexedDB.databases();
    expect(infos.map((i) => i.name)).not.toContain(LEGACY);
  });

  it('copies records verbatim, so an adopted project renders identically', async () => {
    freshFactory();
    const document = '{"formatVersion":1,"project":{"id":"a","scenes":[{"id":"s1"}]}}';
    await seed(LEGACY, STORE_PROJECTS, [{ id: 'a', name: 'A', document }]);

    await adoptLegacyWorkspace(LEGACY);

    const adopted = (await readAll(DEFAULT_DB_NAME, STORE_PROJECTS)) as { document: string }[];
    // Render neutrality: not re-serialized, not re-versioned, the same bytes.
    expect(adopted[0]?.document).toBe(document);
  });
});
