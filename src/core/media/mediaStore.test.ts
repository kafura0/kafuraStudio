/**
 * Media storage.
 *
 * The property under test throughout is the one that keeps the app honest: a slot may
 * only claim a recording the editor can actually load. Every "no file" path here is a
 * case where the document says something the store cannot back up, and the correct answer
 * is always to report no file rather than to guess.
 */

import { describe, expect, it } from 'vitest';
import {
  findOrphanedMedia,
  hasMediaSource,
  mediaIdFor,
  MemoryMediaStore,
  missingMediaReferences,
  referencedMediaIds,
  sweepOrphanedMedia,
  type MediaMeta,
  type MediaRecord,
} from './mediaStore';
import { emptyAssetLibrary } from '../document/factories';
import { resolveAssets } from '../document/scopes';
import { serializeProject } from '../serialize';
import { CURRENT_FORMAT_VERSION } from '../constants';
import type { AssetLibrary, AudioDef, Project, SeriesDef } from '../types';
import { SEED_PROJECT, SEED_SERIES, seedContext } from '../../data/seed';

function audio(overrides: Partial<AudioDef> & { id: string }): AudioDef {
  return {
    name: overrides.id,
    kind: 'dialogue',
    src: null,
    srcKind: null,
    duration: 1,
    tags: [],
    ...overrides,
  };
}

function bytes(text: string): ArrayBuffer {
  const buffer = new TextEncoder().encode(text);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function record(id: string, overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id,
    name: `${id}.wav`,
    type: 'audio/wav',
    size: 4,
    createdAt: '2026-03-01T00:00:00.000Z',
    duration: 1.5,
    data: bytes('wave'),
    ...overrides,
  };
}

function withAudio(audioDefs: AudioDef[]): Project {
  return { ...SEED_PROJECT, assets: { ...emptyAssetLibrary(), ...SEED_PROJECT.assets, audio: audioDefs } };
}

/**
 * The resolved library for a project built by `withAudio`.
 *
 * The media helpers take a library, not a project, and a test that passed `project.assets`
 * would keep passing against a channel that ignored series assets entirely — which is the
 * exact bug the split introduced. Going through `resolveAssets` here means these tests
 * exercise the same merge the running app does.
 */
function libraryOf(audioDefs: AudioDef[]): AssetLibrary {
  return resolveAssets(withAudio(audioDefs), null).assets;
}

describe('MediaStore round trip', () => {
  it('stores and returns the exact bytes, not a lossy re-encode', () => {
    const store = new MemoryMediaStore();
    const original = record('media_1');
    return store
      .put(original)
      .then(() => store.get('media_1'))
      .then((found) => {
        expect(found).not.toBeNull();
        expect(new Uint8Array(found!.data)).toEqual(new Uint8Array(original.data));
        expect(found!.size).toBe(original.size);
        expect(found!.type).toBe('audio/wav');
        expect(found!.duration).toBe(1.5);
      });
  });

  it('copies on write and on read, so a caller cannot mutate what is stored', () => {
    // Without this, a decode buffer handed back by `get` could write over the stored
    // bytes and the file would be corrupted with no save in between.
    const store = new MemoryMediaStore();
    const view = new Uint8Array(new TextEncoder().encode('wave'));
    return store
      .put(record('media_1', { data: view.buffer }))
      .then(() => {
        view.fill(255);
        return store.get('media_1');
      })
      .then(async (found) => {
        expect(new Uint8Array(found!.data)).toEqual(new Uint8Array([119, 97, 118, 101]));
        const again = (await store.get('media_1'))!;
        new Uint8Array(again.data).fill(0);
        const stillThere = await store.get('media_1');
        expect(new Uint8Array(stillThere!.data)).toEqual(new Uint8Array([119, 97, 118, 101]));
      });
  });

  it('overwrites by id rather than accumulating versions', async () => {
    const store = new MemoryMediaStore();
    await store.put(record('media_1', { data: bytes('one') }));
    await store.put(record('media_1', { data: bytes('two'), createdAt: '2026-03-02T00:00:00.000Z' }));
    expect(await store.list()).toHaveLength(1);
    expect(await store.totalBytes()).toBe(4);
  });

  it('lists newest first and totals the bytes', async () => {
    const store = new MemoryMediaStore();
    await store.put(record('media_old', { size: 10, createdAt: '2026-01-01T00:00:00.000Z' }));
    await store.put(record('media_new', { size: 20, createdAt: '2026-06-01T00:00:00.000Z' }));
    expect((await store.list()).map((m) => m.id)).toEqual(['media_new', 'media_old']);
    expect(await store.totalBytes()).toBe(30);
  });

  it('does not hand the bytes back from a list view', async () => {
    const store = new MemoryMediaStore();
    await store.put(record('media_1'));
    const [listed] = await store.list();
    expect(listed && 'data' in listed).toBe(false);
  });

  it('reports absence rather than throwing', async () => {
    const store = new MemoryMediaStore();
    expect(await store.get('nope')).toBeNull();
    expect(await store.has('nope')).toBe(false);
    await expect(store.remove('nope')).resolves.toBeUndefined();
  });

  it('forgets a removed file', async () => {
    const store = new MemoryMediaStore();
    await store.put(record('media_1'));
    await store.remove('media_1');
    expect(await store.has('media_1')).toBe(false);
  });
});

describe('mediaIdFor', () => {
  it('resolves a local slot to its media id', () => {
    expect(mediaIdFor(audio({ id: 'a', src: 'media_1', srcKind: 'local' }))).toBe('media_1');
  });

  it('is null for a declared slot with no file, which is how the library ships', () => {
    expect(mediaIdFor(audio({ id: 'a' }))).toBeNull();
  });

  it('is null when srcKind is unknown, even if src looks like a media id', () => {
    // A v1 document that has not been migrated, or a hand-edited file. The id cannot be
    // trusted, so the slot reports no file.
    expect(mediaIdFor(audio({ id: 'a', src: 'media_1' }))).toBeNull();
  });

  it('is null for an external path, which the editor never reads', () => {
    expect(mediaIdFor(audio({ id: 'a', src: '/tmp/theme.wav', srcKind: 'external' }))).toBeNull();
  });

  it('is null for a local slot with no src, which is self-contradictory', () => {
    expect(mediaIdFor(audio({ id: 'a', src: null, srcKind: 'local' }))).toBeNull();
  });

  it('agrees with hasMediaSource', () => {
    expect(hasMediaSource(audio({ id: 'a', src: 'media_1', srcKind: 'local' }))).toBe(true);
    expect(hasMediaSource(audio({ id: 'a' }))).toBe(false);
  });
});

describe('referencedMediaIds', () => {
  it('collects only the ids the library actually claims to hold', () => {
    const library = libraryOf([
      audio({ id: 'a', src: 'media_1', srcKind: 'local' }),
      audio({ id: 'b' }),
      audio({ id: 'c', src: '/tmp/x.wav', srcKind: 'external' }),
      audio({ id: 'd', src: 'media_2', srcKind: 'local' }),
    ]);
    expect([...referencedMediaIds(library)].sort()).toEqual(['media_1', 'media_2']);
  });

  it('counts a shared id once', () => {
    const library = libraryOf([
      audio({ id: 'a', src: 'media_1', srcKind: 'local' }),
      audio({ id: 'b', src: 'media_1', srcKind: 'local' }),
    ]);
    expect(referencedMediaIds(library).size).toBe(1);
  });

  it('finds nothing in the shipped seed, which declares slots and no files', () => {
    expect(referencedMediaIds(seedContext().assets).size).toBe(0);
  });

  it('counts a slot that lives on the series, not only on the project', () => {
    // The regression this signature exists for. Once a voice moved onto its series, the
    // project's own library holds no audio at all, so counting `project.assets` reported
    // zero references and a sweep would have deleted the show's recordings.
    const series: SeriesDef = {
      ...SEED_SERIES,
      assets: {
        ...SEED_SERIES.assets,
        audio: [audio({ id: 'vo_shared', src: 'media_shared', srcKind: 'local' })],
      },
    };
    const project: Project = { ...SEED_PROJECT, assets: emptyAssetLibrary() };
    const resolved = resolveAssets(project, series).assets;
    expect([...referencedMediaIds(resolved)]).toEqual(['media_shared']);
  });
});

describe('missingMediaReferences', () => {
  it('names the slots that claim a file the store cannot produce', () => {
    const library = libraryOf([
      audio({ id: 'a', src: 'media_gone', srcKind: 'local' }),
      audio({ id: 'b', src: 'media_here', srcKind: 'local' }),
    ]);
    const missing = missingMediaReferences(library, new Set(['media_here']));
    expect(missing.map((m) => m.id)).toEqual(['media_gone']);
  });

  it('is empty for the shipped seed', () => {
    expect(missingMediaReferences(seedContext().assets, new Set())).toEqual([]);
  });
});

describe('orphaned media', () => {
  it('is nothing when every file is referenced', async () => {
    const store = new MemoryMediaStore();
    await store.put(record('media_1'));
    const library = libraryOf([audio({ id: 'a', src: 'media_1', srcKind: 'local' })]);
    expect(await findOrphanedMedia([library], store)).toEqual([]);
  });

  it('finds a file no library points at', async () => {
    const store = new MemoryMediaStore();
    await store.put(record('media_1'));
    const library = libraryOf([audio({ id: 'a' })]);
    expect((await findOrphanedMedia([library], store)).map((m) => m.id)).toEqual(['media_1']);
  });

  it('treats a file shared by two projects as still referenced', async () => {
    // The reason the sweep is explicit rather than automatic: a duplicated project
    // shares its media with the original, and deleting the original must not take the
    // bytes out from under the copy.
    const store = new MemoryMediaStore();
    await store.put(record('media_1'));
    const usesIt = libraryOf([audio({ id: 'a', src: 'media_1', srcKind: 'local' })]);
    // A different slot id and a different document: two projects, one recording.
    const copyOfIt = libraryOf([audio({ id: 'b', src: 'media_1', srcKind: 'local' })]);
    const doesNot = libraryOf([audio({ id: 'a' })]);
    expect(await findOrphanedMedia([doesNot, usesIt, copyOfIt], store)).toEqual([]);
  });

  it('sweeps only after being asked, and reports what it removed', async () => {
    const store = new MemoryMediaStore();
    await store.put(record('media_kept'));
    await store.put(record('media_orphan'));
    const library = libraryOf([audio({ id: 'a', src: 'media_kept', srcKind: 'local' })]);
    const removed: MediaMeta[] = await sweepOrphanedMedia([library], store);
    expect(removed.map((m) => m.id)).toEqual(['media_orphan']);
    expect(await store.has('media_kept')).toBe(true);
    expect(await store.has('media_orphan')).toBe(false);
  });

  it('keeps everything when every project is gone, because there is nothing to judge against', async () => {
    // An empty list means "no information", not "everything is garbage". Sweeping on it
    // would delete every recording in the workspace the first time a project is closed.
    const store = new MemoryMediaStore();
    await store.put(record('media_1'));
    expect(await findOrphanedMedia([], store)).toHaveLength(1);
  });
});

describe('a project with attached media still round trips', () => {
  it('survives serialize -> parse with the src and srcKind intact', () => {
    const project = withAudio([audio({ id: 'vo_1', src: 'media_1', srcKind: 'local' })]);
    const text = serializeProject(project);
    const parsed = JSON.parse(text) as { project: Project };
    const def = parsed.project.assets.audio[0];
    expect(def?.src).toBe('media_1');
    expect(def?.srcKind).toBe('local');
    // Current format version, whatever that is today. This assertion is about the *field*
    // surviving the round trip; pinning the number would make it fail the next time a
    // migration is added, saying nothing about src or srcKind.
    expect(project.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });
});
