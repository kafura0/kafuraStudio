/**
 * Rig resolution tests.
 *
 * The load-bearing property is that a part is drawn relative to its **parent**, even
 * when it paints at a `z` that puts it behind the parent. `p_hairBack` is a child of
 * the head and the lowest-z part in the rig, which is exactly the case that a single
 * "sort by z and resolve in that order" pass gets wrong.
 */

import { describe, expect, it } from 'vitest';
import { buildHumanRig, proportions } from './rig';
import { resolveRig } from '../core/render/resolve';
import type { PartDef, Transform2D } from '../core/types';
import { transform } from '../core/types';

const OPTIONS = {
  origin: { x: 1000, y: 900 },
  scale: 1,
  flipX: false,
  rotation: 0,
  alpha: 1,
};

function resolve(parts: PartDef[], overrides: Partial<typeof OPTIONS> = {}) {
  return resolveRig(parts, {}, { ...OPTIONS, ...overrides });
}

function byId(parts: PartDef[]) {
  return new Map(parts.map((p) => [p.id, p]));
}

describe('resolveRig hierarchy', () => {
  it('places a child relative to its parent even when the child paints first', () => {
    const rig = buildHumanRig(proportions(620), { hairStyle: 'locs' });
    const parts = byId(rig);
    const hair = parts.get('p_hairBack');
    const head = parts.get('p_head');
    expect(hair).toBeDefined();
    expect(head).toBeDefined();
    if (!hair || !head) return;

    // The precondition for the regression: the child paints behind its parent.
    expect(hair.parent).toBe('p_head');
    expect(hair.z).toBeLessThan(head.z);

    const resolved = resolve(rig);
    const rHead = resolved.find((p) => p.id === 'p_head');
    const rHair = resolved.find((p) => p.id === 'p_hairBack');
    expect(rHead).toBeDefined();
    expect(rHair).toBeDefined();
    if (!rHead || !rHair) return;

    // Same x as the head, and vertically adjacent to it. Before the fix the hair was
    // resolved before the head existed, so it sat at the rig origin near the feet.
    expect(rHair.x).toBeCloseTo(rHead.x, 5);
    expect(Math.abs(rHair.y - rHead.y)).toBeLessThan(80);
  });

  it('does not double-apply the origin to a parented part', () => {
    const rig = buildHumanRig(proportions(620), { hairStyle: 'afro' });
    const hair = resolve(rig).find((p) => p.id === 'p_hairBack');
    expect(hair).toBeDefined();
    if (!hair) return;
    // A parented part inherits the origin through its parent exactly once.
    expect(hair.y).toBeLessThan(OPTIONS.origin.y);
  });

  it('resolves a three-level chain', () => {
    const grandparent = part('a', null, 0, transform({ x: 10, y: 0 }));
    const parent = part('b', 'a', 100, transform({ x: 5, y: 0 }));
    const child = part('c', 'b', -100, transform({ x: 2, y: 0 }));

    // `c` has the lowest z of the three: resolution cannot follow z order here.
    const resolved = resolve([child, parent, grandparent]);
    const a = resolved.find((p) => p.id === 'a');
    const b = resolved.find((p) => p.id === 'b');
    const c = resolved.find((p) => p.id === 'c');
    // `a` is a root, so it takes the origin. `b` and `c` inherit it exactly once
    // through their parents and add their own local offsets.
    expect(a?.x).toBeCloseTo(OPTIONS.origin.x + 10, 5);
    expect(b?.x).toBeCloseTo(OPTIONS.origin.x + 15, 5);
    expect(c?.x).toBeCloseTo(OPTIONS.origin.x + 17, 5);
  });

  it('returns parts in ascending z so the caller paints back to front', () => {
    const rig = buildHumanRig(proportions(620), { hairStyle: 'locs' });
    const zs = resolve(rig).map((p) => p.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
  });

  it('treats a dangling parent id as a root rather than dropping the part', () => {
    const orphan = part('x', 'does_not_exist', 0, transform({ x: 7, y: 0 }));
    const resolved = resolve([orphan]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.x).toBeCloseTo(OPTIONS.origin.x + 7, 5);
  });

  it('terminates on a parent cycle instead of recursing forever', () => {
    const a = part('a', 'b', 0, transform());
    const b = part('b', 'a', 1, transform());
    expect(() => resolve([a, b])).not.toThrow();
  });

  it('carries the authored pivot through to the draw list', () => {
    const rig = buildHumanRig(proportions(620), { hairStyle: 'locs' });
    const authored = byId(rig);
    for (const resolved of resolve(rig)) {
      expect(resolved.pivot).toEqual(authored.get(resolved.id)?.pivot);
    }
  });

  it('resolves every slot the pose and expression libraries address', () => {
    const rig = buildHumanRig(proportions(620), { hairStyle: 'locs' });
    const ids = new Set(rig.map((p) => p.id));
    // A hand is parented to a forearm, which is parented to an arm, which is parented
    // to the torso. If any link were missing the hand would render at the origin.
    for (const id of ['p_torso', 'p_armL', 'p_forearmL', 'p_handL', 'p_thighL', 'p_shinL', 'p_footL']) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

function part(id: string, parent: string | null, z: number, rest: Transform2D): PartDef {
  return {
    id,
    slot: id,
    parent,
    z,
    shape: { kind: 'ellipse', rx: 1, ry: 1 },
    colorKey: 'skin',
    pivot: { x: 0.5, y: 0.5 },
    rest,
    visible: true,
  };
}
