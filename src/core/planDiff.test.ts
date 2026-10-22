import { describe, expect, it } from 'vitest';
import { planDiff, isEmptyDiff } from './planDiff';
import { applyPlan } from './plans/apply';
import { makeCountingAllocator, fixedClock } from './plans/allocator';
import { WORKED_EXAMPLE_PLAN, seedPlanContext } from '../data/plans';
import { SEED_PROJECT, SEED_SERIES } from '../data/seed';
import type { Project } from './types';

const AT = '2026-10-17T00:00:00.000Z';

function appliedProject(): Project {
  const ctx = seedPlanContext();
  const result = applyPlan(ctx, WORKED_EXAMPLE_PLAN, {
    allocate: makeCountingAllocator(),
    now: fixedClock(AT),
  });
  if (!result.ok) throw new Error('fixture plan must apply');
  return result.project;
}

/** A deep clone of the seed project, via its own JSON round-trip (a plan is JSON, D7). */
function cloneSeed(): Project {
  return JSON.parse(JSON.stringify(SEED_PROJECT)) as Project;
}

describe('planDiff', () => {
  it('reports a scene a plan creates, with its cast and its lines', () => {
    const before = seedPlanContext().project;
    const after = appliedProject();
    const diff = planDiff(before, after, SEED_SERIES);

    expect(diff.scenes).toEqual([
      { kind: 'added', id: expect.any(String), label: 'Overheard' },
    ]);
    expect(diff.actors).toHaveLength(2);
    expect(diff.actors.every((row) => row.kind === 'added')).toBe(true);
    expect(diff.actors.map((row) => row.label).sort()).toEqual(['Kito', 'Nia']);
    expect(diff.lines).toHaveLength(2);
    expect(diff.lines.every((row) => row.kind === 'added')).toBe(true);
    // The fixture adds no project-scope asset overrides.
    expect(diff.assets).toEqual([]);
    expect(diff.issues).toEqual([]);
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it('shows a scene the next document deletes, so a removal is never silent', () => {
    const before = cloneSeed();
    const removed = before.scenes[0];
    expect(removed).toBeDefined();
    const after: Project = { ...before, scenes: before.scenes.slice(1) };

    const diff = planDiff(before, after, SEED_SERIES);
    expect(diff.scenes).toContainEqual({ kind: 'removed', id: removed!.id, label: removed!.name });
  });

  it('reports a scene whose own fields changed as changed, not added or removed', () => {
    const before = cloneSeed();
    const target = before.scenes[0]!;
    const after: Project = {
      ...before,
      scenes: before.scenes.map((scene) =>
        scene.id === target.id ? { ...scene, name: `${scene.name} (revised)`, duration: scene.duration + 2 } : scene,
      ),
    };

    const diff = planDiff(before, after, SEED_SERIES);
    expect(diff.scenes).toEqual([
      { kind: 'changed', id: target.id, label: `${target.name} (revised)` },
    ]);
  });

  it('keeps an actor change on the actor row, not on the scene row', () => {
    const before = cloneSeed();
    const scene = before.scenes.find((s) => s.actors.length > 0)!;
    const actor = scene.actors[0]!;
    const after: Project = {
      ...before,
      scenes: before.scenes.map((s) =>
        s.id === scene.id
          ? { ...s, actors: s.actors.map((a) => (a.id === actor.id ? { ...a, z: a.z + 5 } : a)) }
          : s,
      ),
    };

    const diff = planDiff(before, after, SEED_SERIES);
    expect(diff.scenes).toEqual([]);
    expect(diff.actors).toEqual([
      { kind: 'changed', id: actor.id, label: actor.displayName, sceneId: scene.id },
    ]);
  });

  it('reports an asset override the next document gains', () => {
    const before = cloneSeed();
    const override = { ...SEED_SERIES.assets.characters[0]!, id: 'char.project_override' };
    const after: Project = {
      ...before,
      assets: { ...before.assets, characters: [...before.assets.characters, override] },
    };

    const diff = planDiff(before, after, SEED_SERIES);
    expect(diff.assets).toEqual([
      { kind: 'added', id: override.id, label: `character: ${override.name}` },
    ]);
  });

  it('lists only the issues the next document introduces — what it breaks', () => {
    const before = cloneSeed();
    const target = before.scenes[0]!;
    const after: Project = {
      ...before,
      scenes: before.scenes.map((scene) =>
        scene.id === target.id ? { ...scene, environmentId: 'env.does_not_exist' } : scene,
      ),
    };

    const diff = planDiff(before, after, SEED_SERIES);
    expect(diff.issues.some((issue) => issue.message.includes('env.does_not_exist'))).toBe(true);
  });

  it('is empty when the two documents are the same fact', () => {
    const project = cloneSeed();
    expect(isEmptyDiff(planDiff(project, cloneSeed(), SEED_SERIES))).toBe(true);
  });

  it('does not depend on object key order', () => {
    const before = cloneSeed();
    // Rebuild every scene with its keys in a different order. The document is the same
    // fact; a diff that called this "changed" would be comparing construction, not data.
    const reorder = <T extends Record<string, unknown>>(obj: T): T => {
      const entries = Object.entries(obj).reverse();
      return Object.fromEntries(entries) as T;
    };
    const after: Project = {
      ...before,
      scenes: before.scenes.map((scene) => reorder({ ...scene })),
    };
    expect(isEmptyDiff(planDiff(before, after, SEED_SERIES))).toBe(true);
  });
});
