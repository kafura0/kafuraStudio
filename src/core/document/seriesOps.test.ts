/**
 * Series-scope document operations.
 *
 * A series is the reusable show library; the operations in `seriesOps.ts` edit it, and the
 * one that is genuinely new is the cross-project reference check. A project-level override
 * can always be deleted — falling back to the series asset is safe — but a series asset is
 * referenced by every project of the show, so removing one is a decision about all of them
 * and has to refuse when any of them still names it.
 */

import { describe, expect, it } from 'vitest';
import { createSeries } from './factories';
import { SEED_PROJECT } from '../../data/seed';
import {
  seriesAssetReferenceCount,
  removeSeriesAsset,
  addSeriesAsset,
  updateSeriesAsset,
  renameSeries,
} from './seriesOps';
import type { Project, Scene } from '../types';

/** A minimal character on the series. */
const character = (id: string): never =>
  ({ id, name: id, description: '', parts: [], defaultPoseId: null }) as never;

/** A project that casts `characterId` in exactly one scene, exactly once. */
const projectCasting = (id: string, characterId: string): Project => {
  const base = SEED_PROJECT.scenes[0];
  if (!base) throw new Error('seed project has no scene');
  const actor = base.actors[0];
  if (!actor) throw new Error('seed scene has no actor');
  const scene: Scene = { ...base, id: `sc-${id}`, name: 'Cast test', actors: [{ ...actor, characterId }] };
  return { ...SEED_PROJECT, id, name: 'Cast test', scenes: [scene], episodes: [] };
};

describe('seriesAssetReferenceCount', () => {
  it('counts across every project given it, per project', () => {
    const counts = seriesAssetReferenceCount(
      [projectCasting('p1', 'char-a'), projectCasting('p2', 'char-a')],
      'characters',
      'char-a',
    );
    expect(counts.get('p1')).toBe(1);
    expect(counts.get('p2')).toBe(1);
  });

  it('returns an empty map when nothing references the asset', () => {
    const counts = seriesAssetReferenceCount(
      [projectCasting('p1', 'char-a')],
      'characters',
      'char-absent',
    );
    expect(counts.size).toBe(0);
  });

  it('counts the seed project scene-by-scene', () => {
    const used = SEED_PROJECT.scenes[0]!.actors[0]!.characterId;
    const counts = seriesAssetReferenceCount([SEED_PROJECT], 'characters', used);
    expect(counts.get(SEED_PROJECT.id)).toBeGreaterThanOrEqual(1);
  });
});

describe('removeSeriesAsset', () => {
  it('refuses while a project references the asset, naming the project', () => {
    const series = addSeriesAsset(createSeries('Show'), 'characters', character('char-a'));
    const projects = [projectCasting('p1', 'char-a')];
    expect(() => removeSeriesAsset(series, 'characters', 'char-a', projects)).toThrowError(
      /still used by 1 project.*"Cast test"/,
    );
  });

  it('removes the asset when nothing references it', () => {
    const series = addSeriesAsset(createSeries('Show'), 'characters', character('char-a'));
    const next = removeSeriesAsset(series, 'characters', 'char-a', []);
    expect(next.assets.characters.map((c) => c.id)).not.toContain('char-a');
  });
});

describe('addSeriesAsset / updateSeriesAsset / renameSeries', () => {
  it('adds an asset', () => {
    const series = createSeries('Show');
    const next = addSeriesAsset(series, 'characters', character('char-a'));
    expect(next.assets.characters.map((c) => c.id)).toContain('char-a');
  });

  it('refuses a duplicate id', () => {
    const series = addSeriesAsset(createSeries('Show'), 'characters', character('char-a'));
    expect(() => addSeriesAsset(series, 'characters', character('char-a'))).toThrowError(
      /already has a characters asset/,
    );
  });

  it('patches an existing asset without touching the others', () => {
    const series = addSeriesAsset(
      addSeriesAsset(createSeries('Show'), 'characters', character('char-a')),
      'characters',
      character('char-b'),
    );
    const next = updateSeriesAsset(series, 'characters', 'char-a', { name: 'Renamed A' });
    expect(next.assets.characters.find((c) => c.id === 'char-a')?.name).toBe('Renamed A');
    expect(next.assets.characters.find((c) => c.id === 'char-b')?.id).toBe('char-b');
  });

  it('renames without touching assets', () => {
    const series = addSeriesAsset(createSeries('Old Show'), 'characters', character('char-a'));
    const next = renameSeries(series, 'New Show');
    expect(next.name).toBe('New Show');
    expect(next.assets.characters).toHaveLength(1);
  });

  it('treats a blank rename as a no-op', () => {
    const series = createSeries('Show');
    expect(renameSeries(series, '   ')).toBe(series);
  });

  it('leaves an id absent from the series alone', () => {
    const series = createSeries('Show');
    const next = updateSeriesAsset(series, 'characters', 'char-absent', { name: 'X' });
    expect(next).toBe(series);
  });
});