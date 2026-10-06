/**
 * IndexedDB persistence: schema, quarantine, and the v1 -> v2 upgrade.
 *
 * Scoped `fake-indexeddb` import rather than the global setup file, so only the tests
 * that actually need a database pay for one.
 *
 * The quarantine cases are the important ones. They test a fix for real data loss: the
 * editor used to fall back to the seed project when a record would not parse, and the
 * next autosave then wrote the seed over the operator's bytes. "The corrupt record is
 * still there afterwards, byte for byte" is the assertion that would have caught it.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_VERSION,
  openDatabase,
  STORE_MEDIA,
  STORE_PROJECTS,
  STORE_QUARANTINE,
  STORE_SERIES,
  transactionDone,
} from './db.browser';
import {
  IndexedDbProjectRepository,
  isIndexedDbAvailable,
  type QuarantinedRecord,
} from './indexedDb.browser';
import { IndexedDbMediaStore } from './media.browser';
import { serializeProject } from '../serialize';
import { SEED_PROJECT } from '../../data/seed';

let counter = 0;
/** A fresh database name per test, so nothing leaks between cases. */
const dbName = (): string => `zanza-test-${(counter += 1)}`;

const repository = (name: string): IndexedDbProjectRepository =>
  new IndexedDbProjectRepository({ dbName: name });

function bytes(text: string): ArrayBuffer {
  const buffer = new TextEncoder().encode(text);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

beforeEach(() => {
  expect(isIndexedDbAvailable()).toBe(true);
});

/** Write a raw record straight into the store, bypassing the repository's validation. */
async function writeRawRecord(name: string, id: string, document: string): Promise<void> {
  const db = await openDatabase(name);
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  tx.objectStore(STORE_PROJECTS).put({
    id,
    name: `Project ${id}`,
    updatedAt: '2026-02-02T00:00:00.000Z',
    document,
    sceneCount: 5,
    episodeCount: 1,
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('tx failed'));
  });
  db.close();
}

describe('project records', () => {
  it('saves and reloads a project unchanged', async () => {
    const name = dbName();
    const repo = repository(name);
    await repo.save(SEED_PROJECT);
    const loaded = await repo.load(SEED_PROJECT.id);
    expect(loaded).toEqual(SEED_PROJECT);
  });

  it('stores the document compactly and the summary fields alongside it', async () => {
    const name = dbName();
    await repository(name).save(SEED_PROJECT);
    const db = await openDatabase(name);
    const record = await new Promise<{ document: string; sceneCount: number; episodeCount: number }>(
      (resolve, reject) => {
        const request = db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS).get(SEED_PROJECT.id);
        request.onsuccess = () => resolve(request.result as never);
        request.onerror = () => reject(request.error);
      },
    );
    expect(record.sceneCount).toBe(SEED_PROJECT.scenes.length);
    expect(record.episodeCount).toBe(SEED_PROJECT.episodes.length);
    // The listing path must never have to parse a document to show a name and a count.
    expect(record.document).not.toContain('\n');
    db.close();
  });

  it('lists newest first and counts scenes and episodes', async () => {
    const name = dbName();
    const repo = repository(name);
    await repo.save({ ...SEED_PROJECT, id: 'proj_a', updatedAt: '2026-01-01T00:00:00.000Z' });
    await repo.save({ ...SEED_PROJECT, id: 'proj_b', updatedAt: '2026-05-01T00:00:00.000Z' });
    const summaries = await repo.list();
    expect(summaries.map((s) => s.id)).toEqual(['proj_b', 'proj_a']);
    expect(summaries[0]?.sceneCount).toBe(SEED_PROJECT.scenes.length);
  });

  it('reopens the project that was open last, and tracks it as projects are saved', async () => {
    const name = dbName();
    const repo = repository(name);
    await repo.save({ ...SEED_PROJECT, id: 'proj_a' });
    expect((await repo.loadMostRecent())?.id).toBe('proj_a');
    await repo.save({ ...SEED_PROJECT, id: 'proj_b' });
    expect((await repo.loadMostRecent())?.id).toBe('proj_b');
  });

  it('falls back to the newest project when nothing records what was open', async () => {
    const name = dbName();
    const repo = repository(name);
    await repo.save({ ...SEED_PROJECT, id: 'proj_a', updatedAt: '2026-01-01T00:00:00.000Z' });
    await repo.save({ ...SEED_PROJECT, id: 'proj_b', updatedAt: '2026-05-01T00:00:00.000Z' });
    const db = await openDatabase(name);
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete('lastOpenedProjectId');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
    expect((await repo.loadMostRecent())?.id).toBe('proj_b');
  });

  it('removes a project, and forgets that it was the one to reopen', async () => {
    const name = dbName();
    const repo = repository(name);
    await repo.save({ ...SEED_PROJECT, id: 'proj_a' });
    await repo.remove('proj_a');
    expect(await repo.load('proj_a')).toBeNull();
    expect(await repo.list()).toEqual([]);
    expect(await repo.loadMostRecent()).toBeNull();
  });

  it('does not reopen a project the operator archived', async () => {
    // Archiving is a write, and every write records the pointer, so the newest record on
    // disk is the archived one. Honouring it would reopen a project that is hidden from
    // the browser — silently undoing the archive on the next launch.
    const name = dbName();
    const repo = repository(name);
    await repo.save({ ...SEED_PROJECT, id: 'proj_live' });
    await repo.save({
      ...SEED_PROJECT,
      id: 'proj_archived',
      metadata: { archived: '2026-03-01T00:00:00.000Z', duplicatedFrom: null, snapshotOf: null },
    });

    // The archived record is still the one the pointer names.
    expect(await repo.load('proj_archived')).not.toBeNull();
    // But it is not what the workspace opens.
    expect((await repo.loadMostRecent())?.id).toBe('proj_live');
  });

  it('opens the browser rather than an archived project when it is the only one', async () => {
    const name = dbName();
    const repo = repository(name);
    await repo.save({
      ...SEED_PROJECT,
      id: 'proj_archived',
      metadata: { archived: '2026-03-01T00:00:00.000Z', duplicatedFrom: null, snapshotOf: null },
    });

    // Nothing to open is a real answer, not a failure: the operator archived their last
    // project on purpose, and reopening it would defeat that.
    expect(await repo.loadMostRecent()).toBeNull();
  });

  it('keeps three projects side by side without touching each other', async () => {
    // The acceptance criterion the whole phase exists for.
    const name = dbName();
    const repo = repository(name);
    const ids = ['proj_one', 'proj_two', 'proj_three'];
    for (const id of ids) {
      await repo.save({ ...SEED_PROJECT, id, name: `Project ${id}` });
    }
    expect((await repo.list()).map((s) => s.name).sort()).toEqual([
      'Project proj_one',
      'Project proj_three',
      'Project proj_two',
    ]);
    for (const id of ids) {
      expect((await repo.load(id))?.id).toBe(id);
    }
  });
});

describe('quarantine', () => {
  /** A document that is valid JSON but not a valid project. */
  const corrupt = (): string =>
    JSON.stringify({ formatVersion: 2, project: { id: 'proj_bad', name: 'Bad', scenes: 'not an array' } });

  it('preserves the unparseable bytes instead of discarding them', async () => {
    const name = dbName();
    const repo = repository(name);
    const document = corrupt();
    await writeRawRecord(name, 'proj_bad', document);

    await expect(repo.load('proj_bad')).rejects.toThrow();

    const quarantined = await repo.listQuarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.document).toBe(document);
    expect(quarantined[0]?.id).toBe('proj_bad');
  });

  it('takes the record out of the projects list so it cannot be opened again', async () => {
    const name = dbName();
    const repo = repository(name);
    await writeRawRecord(name, 'proj_bad', corrupt());
    await expect(repo.load('proj_bad')).rejects.toThrow();
    expect((await repo.list()).map((s) => s.id)).not.toContain('proj_bad');
  });

  it('is not overwritten by the next save under the same id', async () => {
    // The actual data-loss bug. The editor fell back to the seed project and autosaved
    // it under the same id, replacing the operator's bytes with the seed.
    const name = dbName();
    const repo = repository(name);
    const document = corrupt();
    await writeRawRecord(name, SEED_PROJECT.id, document);
    await expect(repo.load(SEED_PROJECT.id)).rejects.toThrow();

    // Whatever the editor does next - seed, blank, anything - the bad bytes survive.
    await repo.save(SEED_PROJECT);
    const quarantined = await repo.listQuarantined();
    expect(quarantined[0]?.document).toBe(document);
    expect((await repo.load(SEED_PROJECT.id))?.id).toBe(SEED_PROJECT.id);
  });

  it('stops pointing at the unreadable project as the one to reopen', async () => {
    const name = dbName();
    const repo = repository(name);
    await repo.save(SEED_PROJECT);
    await writeRawRecord(name, 'proj_bad', corrupt());
    const db = await openDatabase(name);
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key: 'lastOpenedProjectId', value: 'proj_bad' });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();

    await expect(repo.loadMostRecent()).rejects.toThrow();
    // The unreadable id is no longer recorded, so the next launch does not try it again.
    // It falls through to the newest project that does open, rather than giving up.
    const reopened = await repo.loadMostRecent();
    expect(reopened?.id).toBe(SEED_PROJECT.id);
  });

  it('records why it was quarantined, in words', async () => {
    const name = dbName();
    const repo = repository(name);
    await writeRawRecord(name, 'proj_bad', corrupt());
    await expect(repo.load('proj_bad')).rejects.toThrow();
    const [entry] = await repo.listQuarantined();
    // Specific enough to act on: which field, and what was wrong with it.
    expect(entry?.reason).toMatch(/project\.scenes/);
    expect(entry?.reason.length ?? 0).toBeGreaterThan(0);
  });

  it('restores a record so a fixed build can try it again', async () => {
    const name = dbName();
    const repo = repository(name);
    const document = corrupt();
    await writeRawRecord(name, 'proj_bad', document);
    await expect(repo.load('proj_bad')).rejects.toThrow();

    expect(await repo.restoreQuarantined('proj_bad')).toBe(true);
    expect(await repo.listQuarantined()).toEqual([]);
    expect((await repo.list()).map((s) => s.id)).toContain('proj_bad');
    // It is still unparseable - restoring is not repairing - but the bytes are back.
    await expect(repo.load('proj_bad')).rejects.toThrow();
  });

  it('reports false when asked to restore something that is not there', async () => {
    expect(await repository(dbName()).restoreQuarantined('nope')).toBe(false);
  });

  it('discards a record for good when the operator asks', async () => {
    const name = dbName();
    const repo = repository(name);
    await writeRawRecord(name, 'proj_bad', corrupt());
    await expect(repo.load('proj_bad')).rejects.toThrow();
    await repo.discardQuarantined('proj_bad');
    expect(await repo.listQuarantined()).toEqual([]);
  });

  it('lists the newest quarantine first', async () => {
    const name = dbName();
    const repo = repository(name);
    await writeRawRecord(name, 'proj_first', corrupt());
    await expect(repo.load('proj_first')).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeRawRecord(name, 'proj_second', corrupt());
    await expect(repo.load('proj_second')).rejects.toThrow();
    expect((await repo.listQuarantined()).map((e) => e.id)).toEqual(['proj_second', 'proj_first']);
  });

  it('quarantines a record that is not even JSON', async () => {
    const name = dbName();
    const repo = repository(name);
    await writeRawRecord(name, 'proj_bad', 'this is not json');
    await expect(repo.load('proj_bad')).rejects.toThrow();
    const quarantined: QuarantinedRecord[] = await repo.listQuarantined();
    expect(quarantined[0]?.document).toBe('this is not json');
    expect(quarantined[0]?.name).toBe('Project proj_bad');
  });
});

describe('schema version 2', () => {
  it('adds the media and quarantine stores to a version 1 database without touching its data', async () => {
    // A v1 database created by a previous build: two stores, and a real project in it.
    const name = dbName();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const projects = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(STORE_PROJECTS, 'readwrite');
        tx.objectStore(STORE_PROJECTS).put({
          id: SEED_PROJECT.id,
          name: SEED_PROJECT.name,
          updatedAt: SEED_PROJECT.updatedAt,
          document: serializeProject(SEED_PROJECT, false),
          sceneCount: SEED_PROJECT.scenes.length,
          episodeCount: SEED_PROJECT.episodes.length,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    // Opening with the current version runs the upgrade.
    const db = await openDatabase(name);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(
      [STORE_MEDIA, 'meta', STORE_PROJECTS, STORE_SERIES, STORE_QUARANTINE].sort(),
    );
    db.close();

    // The v1 project is still there and still opens - the upgrade adds, it does not reset.
    // It reopens *and* migrates: the row is a v2 document, so the repository derives its
    // series on read rather than refusing a workspace it wrote itself.
    const repo = repository(name);
    expect(await repo.load(SEED_PROJECT.id)).toEqual(SEED_PROJECT);
  });

  it('is a no-op when the database is already current', async () => {
    const name = dbName();
    const first = await openDatabase(name);
    expect(first.version).toBe(DB_VERSION);
    first.close();
    const second = await openDatabase(name);
    expect(second.version).toBe(DB_VERSION);
    expect([...second.objectStoreNames]).toContain(STORE_MEDIA);
    second.close();
  });
});

describe('media records', () => {
  // `size` is metadata the store sums and displays; `data` is an arbitrary payload. They
  // are independent on purpose, so a test can assert totals without crafting big buffers.
  const record = (id: string, size: number, data = 'wave') => ({
    id,
    name: `${id}.wav`,
    type: 'audio/wav',
    size,
    createdAt: '2026-04-01T00:00:00.000Z',
    duration: 2,
    data: bytes(data),
  });

  it('round trips bytes through IndexedDB', async () => {
    const name = dbName();
    const media = new IndexedDbMediaStore({ dbName: name });
    await media.put(record('media_1', 4));
    const found = await media.get('media_1');
    expect(new Uint8Array(found!.data)).toEqual(new Uint8Array(bytes('wave')));
    expect(found!.name).toBe('media_1.wav');
  });

  it('shares the database with the project repository', async () => {
    // Two classes opening the same name must see one database. A media store pointed at
    // a different name would write bytes no project could ever reach.
    const name = dbName();
    const repo = repository(name);
    const media = new IndexedDbMediaStore({ dbName: name });
    await repo.save(SEED_PROJECT);
    await media.put(record('media_1', 4));
    expect(await repo.load(SEED_PROJECT.id)).toEqual(SEED_PROJECT);
    expect(await media.has('media_1')).toBe(true);
  });

  it('lists metadata without the bytes, newest first, and totals the size', async () => {
    const name = dbName();
    const media = new IndexedDbMediaStore({ dbName: name });
    await media.put({ ...record('media_old', 4), createdAt: '2026-01-01T00:00:00.000Z' });
    await media.put({ ...record('media_new', 8), createdAt: '2026-07-01T00:00:00.000Z' });
    const listed = await media.list();
    expect(listed.map((m) => m.id)).toEqual(['media_new', 'media_old']);
    expect('data' in (listed[0] as object)).toBe(false);
    expect(await media.totalBytes()).toBe(12);
  });

  it('removes media independently of projects', async () => {
    const name = dbName();
    const media = new IndexedDbMediaStore({ dbName: name });
    await media.put(record('media_1', 4));
    await media.remove('media_1');
    expect(await media.get('media_1')).toBeNull();
  });

  it('overwrites by id', async () => {
    const name = dbName();
    const media = new IndexedDbMediaStore({ dbName: name });
    await media.put(record('media_1', 4));
    await media.put({ ...record('media_1', 8), data: bytes('newbytes') });
    const found = await media.get('media_1');
    expect(new Uint8Array(found!.data)).toEqual(new Uint8Array(bytes('newbytes')));
    expect((await media.list()).length).toBe(1);
  });

  // A record adopted from a database written by an earlier build can predate a field. The
  // real browser run that found this wrote a media record with no `duration` at all, and
  // structured clone handed it back as `undefined`: `duration === null` was false, so the
  // panel called `toFixed` on `undefined` and React unmounted the whole editor. The read
  // boundary is where a missing key becomes the `null` this type documents, because that
  // is the only place that knows the bytes were written by something else.
  it('reads a record missing fields as unknown rather than undefined', async () => {
    const name = dbName();
    const media = new IndexedDbMediaStore({ dbName: name });

    const db = await openDatabase(name);
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    tx.objectStore(STORE_MEDIA).put({
      id: 'media_legacy',
      name: 'old.wav',
      size: 4,
      createdAt: '2026-04-01T00:00:00.000Z',
      data: bytes('wave'),
    });
    await transactionDone(tx);

    const found = await media.get('media_legacy');
    expect(found).not.toBeNull();
    expect(found!.duration).toBeNull();
    expect(found!.type).toBe('');
    // The bytes are the one field that must survive untouched, and they do.
    expect(new Uint8Array(found!.data)).toEqual(new Uint8Array(bytes('wave')));
  });

  it('keeps a decoded duration when the record has one', async () => {
    const name = dbName();
    const media = new IndexedDbMediaStore({ dbName: name });
    await media.put({ ...record('media_1', 4), duration: 1.5 });
    expect((await media.get('media_1'))!.duration).toBe(1.5);
    // `null` is the documented "not decoded yet", and it must survive the round trip too.
    await media.put({ ...record('media_2', 4), duration: null });
    expect((await media.get('media_2'))!.duration).toBeNull();
  });

  it('lists a legacy record without throwing on its missing fields', async () => {
    const name = dbName();
    const media = new IndexedDbMediaStore({ dbName: name });

    const db = await openDatabase(name);
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    tx.objectStore(STORE_MEDIA).put({ id: 'media_legacy', data: bytes('wave') });
    await transactionDone(tx);

    // `list` sorts on `createdAt`, so an absent one used to throw before it could render.
    const listed = await media.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.duration).toBeNull();
    expect(listed[0]!.size).toBe(0);
    expect('data' in (listed[0] as object)).toBe(false);
  });
});
