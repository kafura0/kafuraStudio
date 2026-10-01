/**
 * One-time copy-forward from the original workspace database to the renamed one.
 *
 * The active workspace database is `kafura-studio` (`DEFAULT_DB_NAME`). The database this
 * app originally wrote is `zanza-studio`, and every project, media byte and quarantined
 * record anyone saved lives there. Renaming the on-disk store without moving that data
 * would present an empty project list and orphan every saved document, so the records are
 * copied forward on the first launch that finds the new name empty.
 *
 * Properties this is built to have, in the order they mattered:
 *
 * - **Non-destructive.** The legacy database is opened read-only for the copy and is never
 *   written, cleared or deleted afterwards. It stays exactly as it was, so the original
 *   records remain readable from it as well as from the active store. Nothing is ever at
 *   risk because of this step.
 * - **Never clobbers.** If the active database already holds a project, this does nothing.
 *   The check is what makes calling it on every `hydrate` safe.
 * - **Idempotent.** Running it twice adopts nothing the second time, by the same check.
 * - **Render-neutral.** Records are copied verbatim, key for key. No document is
 *   transformed, re-serialized or re-versioned here, so the rendered result of an adopted
 *   project is identical to the same project read from the legacy store. This is a
 *   *database-name* migration and is deliberately separate from the document
 *   `formatVersion` migration in `serialize.ts`, which owns document content and is keyed
 *   to its own version. `DB_VERSION` is untouched: the schema is identical in both names.
 *
 * If the legacy database does not exist -- a workspace that only ever ran this build --
 * nothing is created for it and this is a no-op.
 *
 * Neither name is a default here except the active one, and the legacy name is *required*
 * rather than hardcoded. The original database was named after this one show, and a show
 * name in `core` is exactly what the content-blindness guard exists to keep out: the
 * engine should not know which workspace it is migrating, only how to move one. The
 * caller, which is allowed to know the product, passes the name.
 */

import {
  DEFAULT_DB_NAME,
  isIndexedDbAvailable,
  openDatabase,
  promisify,
  STORE_MEDIA,
  STORE_META,
  STORE_PROJECTS,
  STORE_QUARANTINE,
  transactionDone,
} from './db.browser';

/** Every store that belongs to the workspace, in the order it is copied. */
const WORKSPACE_STORES = [STORE_PROJECTS, STORE_META, STORE_MEDIA, STORE_QUARANTINE] as const;

export interface LegacyAdoption {
  /** True when records were actually copied. */
  adopted: boolean;
  projects: number;
  media: number;
  quarantined: number;
}

const NOTHING: LegacyAdoption = { adopted: false, projects: 0, media: 0, quarantined: 0 };

/**
 * Whether a database of this name exists, without creating one.
 *
 * `openDatabase` runs the schema upgrade, so calling it for a name that does not exist
 * would *create* an empty legacy database on every launch. Asking first keeps the no-op
 * case free of side effects. `databases()` is recent, so its absence falls back to trying:
 * worst case an empty legacy database exists and copies nothing.
 */
async function databaseExists(name: string): Promise<boolean> {
  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<{ name?: string | undefined }[]>;
  };
  if (typeof factory.databases !== 'function') return true;
  try {
    const infos = await factory.databases();
    return infos.some((info) => info.name === name);
  } catch {
    return true;
  }
}

export async function adoptLegacyWorkspace(
  legacyName: string,
  activeName: string = DEFAULT_DB_NAME,
): Promise<LegacyAdoption> {
  if (!isIndexedDbAvailable() || activeName === legacyName) return NOTHING;
  if (!(await databaseExists(legacyName))) return NOTHING;

  const legacy = await openDatabase(legacyName);
  const active = await openDatabase(activeName);

  // An active workspace is a real workspace. This is both the "never clobber" rule and the
  // "run once" rule: the second call finds projects and returns.
  const existing = await promisify<number>(
    active.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS).count(),
  );
  if (existing > 0) return NOTHING;

  const adopted: LegacyAdoption = { adopted: false, projects: 0, media: 0, quarantined: 0 };

  for (const store of WORKSPACE_STORES) {
    const records = await promisify<unknown[]>(
      legacy.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<unknown[]>,
    );
    if (records.length === 0) continue;

    // `put` by the record's own key, so ids, `updatedAt` and the last-opened pointer all
    // survive. Copying the same records again would be a no-op, which is what makes the
    // whole step safe to attempt on every launch.
    const tx = active.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    for (const record of records) objectStore.put(record);
    await transactionDone(tx);

    if (store === STORE_PROJECTS) adopted.projects = records.length;
    if (store === STORE_MEDIA) adopted.media = records.length;
    if (store === STORE_QUARANTINE) adopted.quarantined = records.length;
  }

  adopted.adopted = adopted.projects > 0;
  return adopted;
}
