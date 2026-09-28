/**
 * The transform `renderScene` establishes on entry.
 *
 * This is a small thing with an expensive failure mode. `renderScene` deliberately
 * overrides the caller's transform rather than inheriting it, which is what makes it
 * deterministic. The Stage separately sized the canvas backing store by the device
 * pixel ratio, which is what makes it crisp. When those two met, the identity
 * transform won: on a 2x display the scene drew at half scale into the top-left
 * quarter of the surface, and nothing threw.
 *
 * So the pixel ratio is an explicit parameter, and these tests pin that it reaches
 * the transform.
 */

import { describe, expect, it } from 'vitest';
import { renderScene } from './render';
import { RecordingContext } from '../../test/recordingContext';
import { SEED_PROJECT } from '../../data/seed';

function firstScene() {
  const scene = SEED_PROJECT.scenes[0];
  if (!scene) throw new Error('Seed project has no scenes');
  return scene;
}

function transformArgs(ctx: RecordingContext): number[] {
  const calls = ctx.opsFor('setTransform');
  expect(calls.length).toBeGreaterThan(0);
  return calls[0]?.args as number[];
}

describe('renderScene transform', () => {
  it('scales by the supplied pixel ratio instead of resetting to identity', () => {
    const ctx = new RecordingContext();
    renderScene(ctx, SEED_PROJECT, firstScene(), 0, { pixelRatio: 2 });

    expect(transformArgs(ctx)).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('defaults to a 1:1 transform when no ratio is supplied', () => {
    const ctx = new RecordingContext();
    renderScene(ctx, SEED_PROJECT, firstScene(), 0);

    expect(transformArgs(ctx)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('ignores a transform the caller left behind', () => {
    // A caller mid-some-other-transform, as a partially drawn frame would be.
    const ctx = new RecordingContext();
    ctx.setTransform(3, 0, 0, 3, 40, 90);

    renderScene(ctx, SEED_PROJECT, firstScene(), 0, { pixelRatio: 1 });

    // The second recorded setTransform is renderScene's own, not the caller's.
    const calls = ctx.opsFor('setTransform');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('fills the whole stage rect, so a scaled transform still covers the surface', () => {
    const scene = firstScene();
    const ctx = new RecordingContext();
    renderScene(ctx, SEED_PROJECT, scene, 0, {
      width: 960,
      height: 540,
      pixelRatio: 2,
    });

    // The background fill is expressed in stage coordinates and must span the full
    // stage rect, not the backing store. If it did, the 2x surface would show a
    // quarter-filled image again.
    const fill = ctx.opsFor('fillRect')[0];
    expect(fill?.args).toEqual([0, 0, 960, 540]);
  });
});
