import { describe, expect, it } from 'vitest';
import { blocksApply, previewSceneId, reviewPlan } from './review';
import { makeCountingAllocator, fixedClock } from './allocator';
import {
  MISSING_CHARACTER_PLAN,
  WORKED_EXAMPLE_PLAN,
  seedPlanContext,
} from '../../data/plans';
import { SEED_PROJECT } from '../../data/seed';
import type { PlanEnvelope } from './types';

const AT = '2026-10-17T00:00:00.000Z';

function options() {
  return { allocate: makeCountingAllocator(), now: fixedClock(AT) };
}

/** A camera zoom beyond the tested range: a *warning*, not an error (§10.2). */
function warningPlan(): PlanEnvelope {
  const sceneId = SEED_PROJECT.scenes[0]!.id;
  return {
    planVersion: 1,
    kind: 'scene',
    title: 'Zoom warning',
    createdAt: AT,
    body: { sceneId, camera: { keyframes: [{ at: 0, zoom: 12 }, { at: 5, zoom: 1 }] } },
  };
}

describe('reviewPlan', () => {
  it('previews a valid plan without touching the current document', () => {
    const ctx = seedPlanContext();
    const before = ctx.project;
    const review = reviewPlan(ctx, WORKED_EXAMPLE_PLAN, options());

    expect(review.ok).toBe(true);
    if (!review.ok) return;
    // The preview is a different document, and the source is untouched (the fold is pure).
    expect(review.preview).not.toBe(before);
    expect(ctx.project).toBe(before);
    expect(review.preview.scenes.length).toBe(before.scenes.length + 1);
    expect(review.diff.scenes).toHaveLength(1);
    expect(review.diff.scenes[0]!.kind).toBe('added');
    expect(review.commands.length).toBeGreaterThan(0);
    expect(blocksApply(review)).toBe(false);
  });

  it('blocks apply on an error and reports it, committing nothing', () => {
    const review = reviewPlan(seedPlanContext(), MISSING_CHARACTER_PLAN, options());
    expect(review.ok).toBe(false);
    expect(blocksApply(review)).toBe(true);
    expect(review.validation.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('does not block apply on a warning alone', () => {
    const review = reviewPlan(seedPlanContext(), warningPlan(), options());
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.validation.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
    expect(blocksApply(review)).toBe(false);
  });

  it('names the created scene for a creating plan and the target scene for a modifying one', () => {
    const create = reviewPlan(seedPlanContext(), WORKED_EXAMPLE_PLAN, options());
    const created = create.ok ? previewSceneId(create) : null;
    // The created scene is in the preview but not in the current project.
    expect(created).not.toBeNull();
    expect(SEED_PROJECT.scenes.some((s) => s.id === created)).toBe(false);

    const modify = reviewPlan(seedPlanContext(), warningPlan(), options());
    expect(previewSceneId(modify)).toBe(SEED_PROJECT.scenes[0]!.id);
  });
});
