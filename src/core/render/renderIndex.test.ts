/**
 * The render index (ARCHITECTURE_SPEC.md §18.2 R4, §18.3 R10).
 *
 * The draw-log parity for this refactor is the golden fixtures: they were committed from
 * the pre-index renderer and must not have moved a single op. What this file pins down is
 * the index itself — that the memo rebuilds on identity change, that the maps answer the
 * way the `.find()` scans they replaced answered, that muted tracks and dangling
 * references are excluded exactly as the per-frame walk excluded them, and that the
 * document is never mutated to get there.
 */

import { describe, expect, it } from 'vitest';
import { dialogueAt, renderIndexFor, resolveRenderIndex, speakingAt } from './renderIndex';
import { SEED_PROJECT, seedContext } from '../../data/seed';
import type { Scene, SceneContext } from '../types';

const scene1 = SEED_PROJECT.scenes[0]!;

/** `scene1` with a track predicate applied, as an edited document would be: a new object. */
function sceneWith(scene: Scene, edit: (track: Scene['tracks'][number]) => Scene['tracks'][number]): Scene {
  return { ...scene, tracks: scene.tracks.map(edit) };
}

describe('renderIndexFor', () => {
  it('reuses the index while (context, scene) identity holds', () => {
    const context = seedContext();
    const first = renderIndexFor(context, scene1);
    expect(renderIndexFor(context, scene1)).toBe(first);
  });

  it('rebuilds for a new scene object — identity is revision', () => {
    const context = seedContext();
    const first = renderIndexFor(context, scene1);
    expect(renderIndexFor(context, { ...scene1 })).not.toBe(first);
    expect(renderIndexFor(seedContext(), scene1)).not.toBe(first);
  });
});

describe('resolveRenderIndex', () => {
  it('answers every asset id the way the array .find() scans did', () => {
    const context = seedContext();
    const index = resolveRenderIndex(context, scene1);

    expect(index.characters.size).toBe(context.assets.characters.length);
    expect(index.poses.size).toBe(context.assets.poses.length);
    expect(index.expressions.size).toBe(context.assets.expressions.length);
    expect(index.props.size).toBe(context.assets.props.length);
    expect(index.environment?.id).toBe(scene1.environmentId);
    expect(index.clipsByKind.get('camera')?.length).toBeGreaterThan(0);
  });

  it('sorts environment layers into a copy, leaving the document in authored order', () => {
    const context = seedContext();
    const reversed: SceneContext = {
      ...context,
      assets: {
        ...context.assets,
        environments: context.assets.environments.map((env) =>
          env.id === scene1.environmentId ? { ...env, layers: [...env.layers].reverse() } : env,
        ),
      },
    };

    const index = resolveRenderIndex(reversed, scene1);
    const zs = index.layers.map((l) => l.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));

    // The source array is still reversed: the sort happened on the index's own copy.
    const env = reversed.assets.environments.find((e) => e.id === scene1.environmentId);
    expect(env).toBeDefined();
    if (!env || env.layers.length < 2) return;
    expect(env.layers[0]!.z).toBeGreaterThan(env.layers[env.layers.length - 1]!.z);
  });

  it('resolves a dangling environment to null rather than throwing', () => {
    const index = resolveRenderIndex(seedContext(), { ...scene1, environmentId: 'env.none' });
    expect(index.environment).toBeNull();
    expect(index.layers).toEqual([]);
  });

  it('excludes a muted track from every clip bucket', () => {
    const muted = resolveRenderIndex(
      seedContext(),
      sceneWith(scene1, (track) => (track.kind === 'camera' ? { ...track, muted: true } : track)),
    );
    expect(muted.clipsByKind.get('camera')).toBeUndefined();
    expect(muted.tracksByKindTarget.get('camera')).toBeUndefined();
    // Unmuted tracks of other kinds are untouched by a muted camera.
    expect(muted.dialogue.length).toBeGreaterThan(0);
  });

  it('skips dialogue clips whose line id does not resolve', () => {
    const dangling = resolveRenderIndex(
      seedContext(),
      sceneWith(scene1, (track) =>
        track.kind === 'dialogue'
          ? { ...track, clips: track.clips.map((clip) => ({ ...clip, dialogueLineId: 'line.none' })) }
          : track,
      ),
    );
    expect(dangling.dialogue).toHaveLength(0);
  });
});

describe('dialogueAt / speakingAt', () => {
  const index = resolveRenderIndex(seedContext(), scene1);

  it('returns the live line with its half-open window, first match in track order', () => {
    const entry = dialogueAt(index, 3);
    expect(entry).not.toBeNull();
    if (!entry) return;
    expect(entry.line.text).toBe('Building my empire.');
    expect(entry.line.id).toBe(entry.clip.dialogueLineId);
    expect(entry.start).toBe(entry.clip.start);
    expect(entry.end).toBe(entry.clip.start + entry.clip.duration);
    expect(dialogueAt(index, 1e6)).toBeNull();
  });

  it('reports the speaking actor once per frame, and nobody when the scene is over', () => {
    const kito = scene1.actors.find((a) => a.characterId === 'char.kito');
    expect(kito).toBeDefined();
    if (!kito) return;

    expect(speakingAt(index, 3).has(kito.id)).toBe(true);
    expect(speakingAt(index, 1e6).size).toBe(0);
  });

  it('treats a muted dialogue track as silent', () => {
    const muted = resolveRenderIndex(
      seedContext(),
      sceneWith(scene1, (track) => (track.kind === 'dialogue' ? { ...track, muted: true } : track)),
    );
    expect(dialogueAt(muted, 3)).toBeNull();
    expect(speakingAt(muted, 3).size).toBe(0);
  });
});
