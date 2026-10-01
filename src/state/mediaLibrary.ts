/**
 * The workspace's one media store.
 *
 * The project repository and this are constructed at module scope for the same reason: a
 * second `IndexedDbMediaStore` over the same database is not a second store, it is a second
 * connection to the first, and the only difference is which one holds the open handle.
 * There is one local workspace, so there is one media store.
 *
 * Neither this nor the repository names the database. Both take the core default, so they
 * cannot drift apart: a document could otherwise reference media bytes that live in a
 * database nothing reads, and the symptom would be a slot that silently stops having a
 * file. The original name is not used for new work -- `adoptLegacyWorkspace` copies the
 * old database forward once, on the first launch after the rename.
 *
 * This is a state-layer module, not core: it is the seam where "a media id" becomes actual
 * bytes for the audio engine, and `core` must not know that a store exists at all.
 */
import { MemoryMediaStore, type MediaStore } from '../core/media/mediaStore';
import { IndexedDbMediaStore } from '../core/persistence/media.browser';
import { isIndexedDbAvailable } from '../core/persistence/indexedDb.browser';

let store: MediaStore | null = null;

/**
 * The media store, opened lazily.
 *
 * Falls back to memory when IndexedDB is missing so a browser with storage disabled still
 * runs — the session is simply lost on reload, which is the same guarantee the project
 * repository makes in that situation and is stated in the browser UI.
 */
export function mediaStore(): MediaStore {
  store ??= isIndexedDbAvailable() ? new IndexedDbMediaStore() : new MemoryMediaStore();
  return store;
}

/** Test seam: drop the shared instance so a suite can start from a clean store. */
export function resetMediaStore(): void {
  store = null;
}
