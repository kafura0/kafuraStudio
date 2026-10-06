/**
 * RENDERER.
 *
 * `renderScene` is a pure function, so these tests assert on recorded draw calls
 * rather than pixels. That is deliberate: a pixel test would be slow, flaky, and
 * would not tell us *why* a frame changed.
 */

import { describe, expect, it } from 'vitest';
import { renderScene } from '../core/render/render';
import { sampleSceneTarget, sceneDuration } from '../core/animation/sample';
import { activeClips, findScene } from '../core/document/lookups';
import { SEED_PROJECT, seedContext } from './seed';
import { RecordingContext, renderToRecording } from '../test/recordingContext';

const scene1 = SEED_PROJECT.scenes[0]!;

function renderAt(time: number): RecordingContext {
  return renderToRecording(seedContext(), scene1, time);
}

describe('renderScene', () => {
  it('paints a frame and leaves the canvas state balanced', () => {
    const ctx = renderAt(0);

    expect(ctx.calls.length).toBeGreaterThan(50);
    // Every save must be matched by a restore, or state leaks between scenes.
    expect(ctx.isBalanced()).toBe(true);
    expect(ctx.countOf('fill')).toBeGreaterThan(0);
  });

  it('is deterministic: identical input produces an identical call log', () => {
    const a = renderAt(2.5).calls;
    const b = renderAt(2.5).calls;
    expect(a).toEqual(b);
  });

  it('produces different frames at different times when the scene animates', () => {
    const first = renderAt(0.2).calls;
    const later = renderAt(3.0).calls;
    expect(first).not.toEqual(later);
  });

  it('draws both characters in the acceptance scene', () => {
    const ctx = renderAt(3);
    // Rig resolution colours every part; both characters contribute fills.
    const fills = ctx.countOf('fill');
    expect(fills).toBeGreaterThan(20);
  });

  it('shows the subtitle for the line that is speaking at that time', () => {
    const speakingAt3 = renderAt(3.0).textDrawn();
    expect(speakingAt3.join(' | ')).toContain('Building my empire.');

    // Between lines nothing should be subtitled.
    const quiet = renderAt(8.5).textDrawn().join(' | ');
    expect(quiet).not.toContain('Building my empire.');
  });

  it('never renders outside a balanced context stack, even with no environment', () => {
    const ctx = new RecordingContext();
    const bare = { ...scene1, environmentId: 'env.missing' };
    renderScene(ctx, SEED_PROJECT, bare, 1);
    expect(ctx.isBalanced()).toBe(true);
  });

  it('renders every scene in the seed without throwing', () => {
    for (const scene of SEED_PROJECT.scenes) {
      const ctx = new RecordingContext();
      renderScene(ctx, SEED_PROJECT, scene, sceneDuration(scene) / 2);
      expect(ctx.calls.length).toBeGreaterThan(0);
      expect(ctx.isBalanced()).toBe(true);
    }
  });
});

describe('timeline sampling', () => {
  it('reports the scene length', () => {
    expect(sceneDuration(scene1)).toBe(10);
  });

  it('finds the dialogue clip that is live at a given time', () => {
    const at0 = activeClips(scene1, 0.5, 'dialogue');
    const at8 = activeClips(scene1, 8, 'dialogue');
    expect(at0).toHaveLength(1);
    expect(at8).toHaveLength(0);
  });

  it('samples Kito off-stage before he walks in, and on stage after', () => {
    const kito = scene1.actors.find((a) => a.characterId === 'char.kito');
    expect(kito).toBeDefined();
    if (!kito) return;

    const start = sampleSceneTarget(scene1, 'actor', kito.id, 0);
    const mid = sampleSceneTarget(scene1, 'actor', kito.id, 1.6);

    expect(start.alpha).toBe(0);
    expect(start.x).toBe(1330);
    expect(mid.alpha).toBe(1);
    expect(mid.x).toBe(1120);
    expect(mid.poseId).toBe('pose.standing');
  });

  it('steps expression changes instead of tweening them', () => {
    const nia = scene1.actors.find((a) => a.characterId === 'char.nia');
    expect(nia).toBeDefined();
    if (!nia) return;

    // Just before the beat the expression is still the previous one.
    const before = sampleSceneTarget(scene1, 'actor', nia.id, 3.85);
    const at = sampleSceneTarget(scene1, 'actor', nia.id, 3.9);
    expect(before.expressionId).toBe('expr.neutral');
    expect(at.expressionId).toBe('expr.angry');
  });

  it('keeps Nia staged on her anchor while her expressions change', () => {
    const nia = scene1.actors.find((a) => a.characterId === 'char.nia');
    expect(nia).toBeDefined();
    if (!nia) return;

    // An expression-only keyframe track must not overwrite the placement.
    for (const time of [0, 2.2, 3.9, 5.5]) {
      expect(sampleSceneTarget(scene1, 'actor', nia.id, time).x).toBeUndefined();
    }
  });

  it('pushes the camera in over the scene', () => {
    const clips = activeClips(scene1, 5, 'camera');
    expect(clips).toHaveLength(1);

    // Clips are half-open [start, start+duration), so the last sampleable instant
    // is just before the end. Sampling at exactly `duration` returns nothing, and
    // that is intentional: it keeps adjacent clips from double-covering a frame.
    const atStart = sampleSceneTarget(scene1, 'camera', 'camera', 0);
    const atEnd = sampleSceneTarget(scene1, 'camera', 'camera', 9.999);
    expect(atStart.scaleX).toBe(1);
    expect(atEnd.scaleX).toBeCloseTo(1.18, 3);

    // One frame past the end there is no camera clip active at all.
    expect(sampleSceneTarget(scene1, 'camera', 'camera', 10)).toEqual({});
  });
});

describe('lookups used by the renderer', () => {
  it('finds the acceptance scene by id', () => {
    expect(findScene(SEED_PROJECT, scene1.id)).toBeDefined();
  });
});
