/**
 * Operations on a `SeriesDef`.
 *
 * The project overrides an asset by writing its own copy and letting `resolveAssets` merge
 * it over the series' version. So editing the *show itself* is a series operation, and the
 * narrowest-scope rule that makes the split work has a consequence here: a series asset is
 * readable from every project of the show, so changing or deleting one is a decision about
 * all of them.
 *
 * Every function in this module is pure — it takes a series (and, where the safety of an
 * action depends on it, the projects that share it) and returns a new series. Nothing here
 * talks to a repository; the store decides when and where to persist the result.
 */

import type { AssetLibrary, AudioDef, Id, Project, SeriesDef } from '../types';

/** The asset collections, shared with the project-level operations. */
export type SeriesAssetCollection =
  | 'characters'
  | 'environments'
  | 'poses'
  | 'expressions'
  | 'props'
  | 'audio';

/** Bump the modification stamp. Series have no history to enter, but repos sort by it. */
export function touchSeries(series: SeriesDef): SeriesDef {
  return { ...series, updatedAt: new Date().toISOString() };
}

export function renameSeries(series: SeriesDef, name: string): SeriesDef {
  const trimmed = name.trim() === '' ? series.name : name.trim();
  return trimmed === series.name ? series : touchSeries({ ...series, name: trimmed });
}

function seriesLibrary(series: SeriesDef): AssetLibrary {
  return series.assets;
}

/**
 * How many places in these projects refer to an asset id.
 *
 * Counts across every project of a show, because a series asset belongs to all of them: a
 * character used once in each of six episodes is six references, and the message that blocks
 * its removal ought to say so. The per-project split is returned as well, so a refusal can
 * name the projects that would break rather than just a number.
 */
export function seriesAssetReferenceCount(
  projects: Project[],
  collection: SeriesAssetCollection,
  id: Id,
): Map<string, number> {
  const perProject = new Map<string, number>();
  for (const project of projects) {
    for (const scene of project.scenes) {
      let count = 0;
      if (collection === 'environments' && scene.environmentId === id) count += 1;
      if (collection === 'characters') {
        count += scene.actors.filter((actor) => actor.characterId === id).length;
      }
      if (collection === 'poses') {
        count += scene.actors.filter((actor) => actor.poseId === id).length;
      }
      if (collection === 'expressions') {
        count += scene.actors.filter((actor) => actor.expressionId === id).length;
      }
      if (collection === 'props') {
        count += scene.props.filter((prop) => prop.propId === id).length;
      }
      if (collection === 'audio') {
        count += scene.dialogue.filter((line) => line.voiceAudioId === id).length;
        count += scene.tracks
          .flatMap((track) => track.clips)
          .filter((clip) => clip.audioId === id).length;
      }
      if (count > 0) perProject.set(project.id, (perProject.get(project.id) ?? 0) + count);
    }
  }
  return perProject;
}

/**
 * Remove a series asset, refusing while any project of the show still references it.
 *
 * This is the cross-project version of the project-level `removeAsset` guard, and it is the
 * case the reference check exists for. A project override can fall back to the series asset,
 * so removing an override is always safe; removing the series asset itself is destructive by
 * definition, because every reference to it resolves to nothing afterwards. The refusal names
 * the projects that reference it — a number alone would send the operator hunting through the
 * browser for which episodes use it.
 *
 * `projects` must be every project of the series. The caller (the store) has the repository
 * to answer that; this function only sums the references it is given.
 */
export function removeSeriesAsset(
  series: SeriesDef,
  collection: SeriesAssetCollection,
  id: Id,
  projects: Project[],
): SeriesDef {
  const references = seriesAssetReferenceCount(projects, collection, id);
  if (references.size > 0) {
    const names = projects
      .filter((p) => references.has(p.id))
      .map((p) => `"${p.name}" (${references.get(p.id)})`);
    throw new Error(
      `Cannot remove ${collection} asset "${id}": it is still used by ${references.size} project${
        references.size === 1 ? '' : 's'
      } — ${names.join(', ')}.`,
    );
  }
  return touchSeries({
    ...series,
    assets: {
      ...series.assets,
      [collection]: series.assets[collection].filter(
        (item) => (item as { id: Id }).id !== id,
      ),
    },
  });
}

/**
 * Add an asset to the series.
 *
 * The item is stored as-is and resolved into every project of the show (unless a project
 * already overrides the id). The caller is responsible for a fresh id — the same allocation
 * rule the project-level `addAsset` uses.
 */
export function addSeriesAsset<K extends SeriesAssetCollection>(
  series: SeriesDef,
  collection: K,
  item: AssetLibrary[K][number],
): SeriesDef {
  const existing = series.assets[collection];
  if (existing.some((current) => (current as { id: Id }).id === item.id)) {
    // An id is a key, and a duplicate key is a bug the operator did not ask us to fix.
    throw new Error(
      `Series "${series.id}" already has a ${collection} asset with id "${item.id}".`,
    );
  }
  return touchSeries({
    ...series,
    assets: {
      ...series.assets,
      [collection]: [...existing, item],
    },
  });
}

/**
 * Patch one series asset in place.
 *
 * Applies to the show itself, so every project that does not override the id sees the change
 * on its next resolve. An id that is not on the series is left alone without error: patching
 * a project override here would be the caller guessing the wrong scope, and this module does
 * not guess.
 */
export function updateSeriesAsset<K extends SeriesAssetCollection>(
  series: SeriesDef,
  collection: K,
  id: Id,
  patch: Partial<AssetLibrary[K][number]>,
): SeriesDef {
  const list = series.assets[collection];
  let matched = false;
  const next = list.map((item) => {
    if ((item as { id: Id }).id !== id) return item;
    matched = true;
    return { ...(item as object), ...patch };
  });
  return matched ? touchSeries({ ...series, assets: { ...series.assets, [collection]: next } }) : series;
}

/** The audio slots of a series, for the media store's reference accounting. */
export function seriesAudio(series: SeriesDef): AudioDef[] {
  return seriesLibrary(series).audio;
}