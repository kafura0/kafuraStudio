/**
 * Draw-list unit tests.
 *
 * These pin the exact geometry contract of `drawParts`: a shape is offset by
 * `-pivot * size` so a rotated part turns about its own pivot. Getting this wrong is
 * invisible in a screenshot review and obvious on screen — a limb rotates about its
 * middle instead of its joint.
 */

import { describe, expect, it } from 'vitest';
import { drawParts } from './render';
import type { ResolvedPart } from './resolve';
import { RecordingContext } from '../../test/recordingContext';

function part(overrides: Partial<ResolvedPart> = {}): ResolvedPart {
  return {
    id: 'p_armL',
    slot: 'armL',
    z: 1,
    shape: { kind: 'rect', w: 40, h: 120 },
    color: '#ff0000',
    alpha: 1,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    pivot: { x: 0.5, y: 0 },
    ...overrides,
  };
}

/** The nth recorded translate, as plain numbers (`-0` and `0` compare equal). */
function translate(ctx: RecordingContext, index: number): number[] {
  const args = ctx.opsFor('translate')[index]?.args ?? [];
  return args.map((a) => Number(a) + 0);
}

describe('drawParts', () => {
  it('offsets by the authored pivot, not the centre', () => {
    const ctx = new RecordingContext();
    // A 40x120 arm pivoting at its top edge, i.e. the shoulder.
    drawParts(ctx, [part({ pivot: { x: 0.5, y: 0 } })], {});

    // -pivot * size. A centre pivot would have produced [-20, -60] and detached the
    // arm from the shoulder by half its length.
    expect(translate(ctx, 1)).toEqual([-20, 0]);
  });

  it('centres the shape when the pivot is the middle', () => {
    const ctx = new RecordingContext();
    drawParts(ctx, [part({ pivot: { x: 0.5, y: 0.5 } })], {});
    expect(translate(ctx, 1)).toEqual([-20, -60]);
  });

  it('applies the part transform before the pivot offset', () => {
    const ctx = new RecordingContext();
    drawParts(ctx, [part({ x: 300, y: 200, rotation: 0.5 })], {});

    const ops = ctx.calls.map((c) => c.op);
    expect(ops.indexOf('translate')).toBeLessThan(ops.indexOf('rotate'));
    expect(ops.indexOf('rotate')).toBeLessThan(ops.indexOf('scale'));
    // The part's own placement, then the local pivot offset.
    expect(translate(ctx, 0)).toEqual([300, 200]);
    expect(translate(ctx, 1)).toEqual([-20, 0]);
  });

  it('skips fully transparent parts but draws a visible sliver', () => {
    const hidden = new RecordingContext();
    drawParts(hidden, [part({ alpha: 0 })], {});
    expect(hidden.countOf('fill')).toBe(0);

    const sliver = new RecordingContext();
    drawParts(sliver, [part({ alpha: 0.002 })], {});
    expect(sliver.countOf('fill')).toBe(1);
  });

  it('leaves the context balanced', () => {
    const ctx = new RecordingContext();
    drawParts(ctx, [part(), part({ id: 'p_armR' })], {});
    expect(ctx.isBalanced()).toBe(true);
  });
});
