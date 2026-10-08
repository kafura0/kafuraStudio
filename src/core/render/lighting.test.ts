/**
 * Lighting strengths as data (ARCHITECTURE_SPEC.md §18.3 R9).
 *
 * The renderer once hardcoded 0.28 / 0.18 / 0.85 / 0.75. They are now fields on
 * `Lighting`, optional, defaulting to exactly those numbers — so every environment
 * authored before the fields existed draws byte-identically, and the draw-log
 * equality in the last test is what stops the defaults from drifting.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHTING, vignetteStops } from './render';
import type { Lighting, SceneContext } from '../types';
import { SEED_PROJECT, seedContext } from '../../data/seed';
import { renderToRecording, type RecordingContext } from '../../test/recordingContext';

const scene1 = SEED_PROJECT.scenes[0]!;
const ENV_MAX = 1920; // max(ENV_WIDTH, ENV_HEIGHT) of every seed environment.

/** The seed context with `partial` merged into scene 1's environment lighting. */
function contextWithLighting(partial: Partial<Lighting>): SceneContext {
  const base = seedContext();
  return {
    ...base,
    assets: {
      ...base.assets,
      environments: base.assets.environments.map((env) =>
        env.id === scene1.environmentId ? { ...env, lighting: { ...env.lighting, ...partial } } : env,
      ),
    },
  };
}

/**
 * The alpha the wash painted in `mode` composite, read from between the composite
 * switch and the next alpha set — other passes (actors, the subtitle box) also touch
 * `globalAlpha`, so a bare `toContain(0.28)` could pass on their leftovers.
 */
function washAlpha(ctx: RecordingContext, mode: 'multiply' | 'overlay'): number | undefined {
  const at = ctx.calls.findIndex(
    (c) => c.op === 'set:globalCompositeOperation' && c.args[0] === mode,
  );
  if (at < 0) return undefined;
  const alpha = ctx.calls.slice(at).find((c) => c.op === 'set:globalAlpha');
  return alpha ? Number(alpha.args[0]) : undefined;
}

describe('lighting defaults', () => {
  it('reproduces the hardcoded strengths when the environment declares nothing', () => {
    const ctx = renderToRecording(seedContext(), scene1, 3);
    expect(washAlpha(ctx, 'multiply')).toBe(DEFAULT_LIGHTING.ambientOpacity);
    expect(washAlpha(ctx, 'overlay')).toBe(DEFAULT_LIGHTING.overlayOpacity);
    const radius = ctx.opsFor('createRadialGradient')[0]?.args[5];
    expect(radius).toBe(ENV_MAX * DEFAULT_LIGHTING.vignetteRadius);
  });

  it('draws byte-identically whether the defaults are declared or absent', () => {
    const absent = renderToRecording(seedContext(), scene1, 3);
    const declared = renderToRecording(
      contextWithLighting({
        ambientOpacity: DEFAULT_LIGHTING.ambientOpacity,
        overlayOpacity: DEFAULT_LIGHTING.overlayOpacity,
        vignetteOpacity: DEFAULT_LIGHTING.vignetteOpacity,
        vignetteRadius: DEFAULT_LIGHTING.vignetteRadius,
      }),
      scene1,
      3,
    );
    expect(declared.calls).toEqual(absent.calls);
  });

  it('honours declared strengths and leaves the undeclared ones at their defaults', () => {
    const ctx = renderToRecording(
      contextWithLighting({ ambientOpacity: 0.5, vignetteRadius: 0.9 }),
      scene1,
      3,
    );
    expect(washAlpha(ctx, 'multiply')).toBe(0.5);
    expect(washAlpha(ctx, 'overlay')).toBe(DEFAULT_LIGHTING.overlayOpacity);
    expect(ctx.opsFor('createRadialGradient')[0]?.args[5]).toBe(ENV_MAX * 0.9);
  });
});

describe('vignetteStops', () => {
  it('renders the environment strength to three decimal places', () => {
    const [inner, outer] = vignetteStops(0.34, DEFAULT_LIGHTING.vignetteOpacity);
    expect(inner).toBe('rgba(0,0,0,0)');
    expect(outer).toBe('rgba(0,0,0,0.340)');
  });

  it('caps a strength that would otherwise paint over the scene', () => {
    const [, outer] = vignetteStops(0.99, DEFAULT_LIGHTING.vignetteOpacity);
    expect(outer).toBe('rgba(0,0,0,0.850)');
  });

  it('lets a lowered cap darken less than the environment asks for', () => {
    const [, outer] = vignetteStops(0.5, 0.25);
    expect(outer).toBe('rgba(0,0,0,0.250)');
  });
});
