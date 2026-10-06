/**
 * Media storage: the bytes behind an `AudioDef.src`.
 *
 * A media store is deliberately *not* part of the project document. Audio files are
 * large, they are shared between projects, and a project is a JSON document that must
 * stay readable and diffable. So the document says "this slot uses media id `media_x`"
 * and the bytes live here, addressed by that id.
 *
 * This module is an interface and pure helpers only. The IndexedDB implementation lives
 * in `persistence/media.browser.ts`, which is what lets the store and its tests run
 * against an in-memory implementation (AGENTS.md RULE 5, RULE 10).
 */

import type { AssetLibrary, AudioDef, Id } from '../types';

/** Everything about a media file except the bytes. Cheap to list, safe to render. */
export interface MediaMeta {
  id: string;
  /** Original filename, shown to the operator. Never used as a path. */
  name: string;
  /** MIME type as reported by the browser, e.g. `audio/wav`. */
  type: string;
  /** Byte length. */
  size: number;
  /** ISO 8601. */
  createdAt: string;
  /** Seconds. `null` until something has actually decoded the file. */
  duration: number | null;
}

export interface MediaRecord extends MediaMeta {
  data: ArrayBuffer;
}

export interface MediaStore {
  put(record: MediaRecord): Promise<void>;
  get(id: string): Promise<MediaRecord | null>;
  has(id: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  list(): Promise<MediaMeta[]>;
  /** Total bytes held, for the storage line in the browser. */
  totalBytes(): Promise<number>;
}

/** In-memory implementation. Used by tests, and when IndexedDB is unavailable. */
export class MemoryMediaStore implements MediaStore {
  private readonly store = new Map<string, MediaRecord>();

  async put(record: MediaRecord): Promise<void> {
    this.store.set(record.id, {
      ...record,
      data: record.data.slice(0),
    });
  }

  async get(id: string): Promise<MediaRecord | null> {
    const found = this.store.get(id);
    return found ? { ...found, data: found.data.slice(0) } : null;
  }

  async has(id: string): Promise<boolean> {
    return this.store.has(id);
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }

  async list(): Promise<MediaMeta[]> {
    return [...this.store.values()]
      .map(toMeta)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async totalBytes(): Promise<number> {
    return [...this.store.values()].reduce((total, record) => total + record.size, 0);
  }
}

function toMeta(record: MediaRecord): MediaMeta {
  const { data: _data, ...meta } = record;
  return meta;
}

/**
 * The media id a slot points at, or `null` if it does not point at one.
 *
 * Three fields have to agree before a slot counts as having a file: `src` present,
 * `srcKind: 'local'`, and something in the store under that id. Any one of them missing
 * means "no file", because a slot that *claims* a recording the editor cannot load is
 * the one failure mode that makes the whole app lie to the user.
 */
export function mediaIdFor(def: AudioDef): string | null {
  return def.src !== null && def.srcKind === 'local' ? def.src : null;
}

/** True when the slot points at local media. Says nothing about whether the bytes exist. */
export function hasMediaSource(def: AudioDef): boolean {
  return mediaIdFor(def) !== null;
}

/**
 * Every media id a library references, across every audio slot in it.
 *
 * Takes the *resolved* library rather than a project, and that is a correctness requirement
 * rather than tidiness. A slot moved onto its series is not in `project.assets`, so a sweep
 * that counted project-local slots would call every shared recording garbage and delete a
 * show's voice files because of where the asset was declared. Callers resolve with
 * `resolveAssets(project, series)` first.
 */
export function referencedMediaIds(library: AssetLibrary): Set<string> {
  const ids = new Set<string>();
  for (const def of library.audio) {
    const id = mediaIdFor(def);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/**
 * Which stored media no project points at any more.
 *
 * Reachable but unreferenced is not garbage: a project can be temporarily closed, and a
 * duplicated project shares its media with the original. This returns the candidates and
 * leaves the decision to the caller, so nothing is destroyed implicitly.
 *
 * `libraries` are resolved libraries, one per open or stored project *and* one per series,
 * because a series slot's recording is as reachable as a project's own.
 */
export async function findOrphanedMedia(
  libraries: AssetLibrary[],
  media: MediaStore,
): Promise<MediaMeta[]> {
  const referenced = new Set<string>();
  for (const library of libraries) {
    for (const id of referencedMediaIds(library)) referenced.add(id);
  }
  const all = await media.list();
  return all.filter((record) => !referenced.has(record.id));
}

/**
 * Delete media that no project references.
 *
 * Called after a project is deleted, never as part of a delete. `removed` is returned so
 * the UI can say what it did instead of silently reclaiming megabytes.
 */
export async function sweepOrphanedMedia(
  libraries: AssetLibrary[],
  media: MediaStore,
): Promise<MediaMeta[]> {
  const orphans = await findOrphanedMedia(libraries, media);
  for (const orphan of orphans) {
    await media.remove(orphan.id);
  }
  return orphans;
}

/**
 * A slot that claims local media the store does not have.
 *
 * Takes the resolved library for the same reason as `referencedMediaIds`: a series-owned
 * slot with a dead file path must be reported missing, and a project-local list would
 * report it as absent rather than broken.
 */
export function missingMediaReferences(
  library: AssetLibrary,
  available: ReadonlySet<string>,
): { def: AudioDef; id: Id }[] {
  return library.audio
    .filter((def) => {
      const id = mediaIdFor(def);
      return id !== null && !available.has(id);
    })
    .map((def) => ({ def, id: mediaIdFor(def) as string }));
}
