/**
 * Series/Project asset resolution.
 *
 * This is the one place in the engine that knows both scopes exist, and it is pure. Every
 * other module — the renderer, the sampler, the audio planner — takes the value this
 * returns and cannot tell a series asset from a project override. That is deliberate: it is
 * what makes the Series change a *scope* change rather than a behaviour change, and what
 * lets a second show render without a line of engine change (ARCHITECTURE_SPEC.md §29.4).
 *
 * The merged library is **computed, never persisted**. Writing it back into
 * `Project.assets` would recreate the exact conflation Phase 14 exists to remove, and would
 * make the series a decoration rather than the owner (§4.3.4).
 */

import type { AssetLibrary, Project, SceneContext, SeriesDef } from '../types';

/**
 * Merge a project's overrides over its series' library.
 *
 * Project wins on an id collision, per §4.3.2. The reasoning is that a project's override
 * exists *because* it differs, so the narrower scope is the more specific statement about
 * what should be drawn. Series-wins would make an override silently unreachable, which is
 * the mirror image of the same bug: an author who changed an asset and saw no change.
 *
 * Collections are merged per collection, not as a whole. A series that overrides nothing in
 * `poses` still contributes every pose; a project that overrides one pose keeps the series'
 * other four. Merging by collection is what makes "the narrowest scope that can express the
 * variation" true per-asset rather than per-document.
 *
 * `series` may be `null` — a free project, or a document being validated before its owner
 * has been loaded. The result is then just the project's own assets, which is the honest
 * answer rather than an empty library: for a series-less project those assets *are* the
 * library.
 *
 * Note this does not check that `project.seriesId === series.id`. That check belongs where
 * a whole workspace is visible (see `validateProject` against the merged library, and the
 * store's open path), because this function's job is to answer "what should be drawn", and
 * answering that never requires knowing which show asked.
 */
export function resolveAssets(project: Project, series: SeriesDef | null): SceneContext {
  const overrides = project.assets;
  if (series === null) {
    return { assets: overrides, settings: project.settings };
  }
  const library = series.assets;
  return {
    assets: {
      characters: mergeById(library.characters, overrides.characters),
      environments: mergeById(library.environments, overrides.environments),
      poses: mergeById(library.poses, overrides.poses),
      expressions: mergeById(library.expressions, overrides.expressions),
      props: mergeById(library.props, overrides.props),
      audio: mergeById(library.audio, overrides.audio),
    },
    settings: project.settings,
  };
}

/**
 * Series entries, with project entries replacing the ones they share an id with.
 *
 * Series order is preserved and an override takes the position of the entry it replaces,
 * rather than being appended. Order is data here — `validateProject` resolves a scene's
 * first match and the renderer's part ordering depends on collection order — so an override
 * must not silently move an asset to the end of its collection.
 *
 * An override whose id matches nothing in the series is appended. That is the one case
 * where a project introduces an id the series has never seen, and dropping it would make
 * the override invisible to validation, which is worse than an extra entry.
 */
function mergeById<T extends { id: string }>(library: T[], overrides: T[]): T[] {
  if (overrides.length === 0) return [...library];
  const overridesById = new Map(overrides.map((entry) => [entry.id, entry]));
  const merged: T[] = [];
  const claimed = new Set<string>();
  for (const entry of library) {
    const override = overridesById.get(entry.id);
    if (override !== undefined) {
      merged.push(override);
      claimed.add(entry.id);
    } else {
      merged.push(entry);
    }
  }
  for (const override of overrides) {
    if (!claimed.has(override.id)) merged.push(override);
  }
  return merged;
}

/** Whether two libraries resolve to the same assets, for assertions and change detection. */
export function assetsEqual(a: AssetLibrary, b: AssetLibrary): boolean {
  return (
    sameById(a.characters, b.characters) &&
    sameById(a.environments, b.environments) &&
    sameById(a.poses, b.poses) &&
    sameById(a.expressions, b.expressions) &&
    sameById(a.props, b.props) &&
    sameById(a.audio, b.audio)
  );
}

function sameById<T extends { id: string }>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((entry) => [entry.id, entry]));
  return b.every((entry) => JSON.stringify(byId.get(entry.id)) === JSON.stringify(entry));
}
