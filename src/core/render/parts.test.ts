/**
 * Draw-list unit tests.
 *
 * These pin the exact geometry contract of `drawParts`: the pivot point the author
 * nominated inside the shape lands on the part's transform origin, so a rotated part
 * turns about its own joint. Getting this wrong is invisible in a screenshot review
 * and obvious on screen — a limb rotates about its middle instead of its joint, or
 * every shape floats half its own size up and to the left of where it was placed.
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

/** One recorded argument, defaulting to zero so a missing op cannot go undefined. */
function at(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

/** One recorded shape op's arguments, as numbers. */
function shapeArgs(ctx: RecordingContext, op: string): number[] {
  return (ctx.opsFor(op)[0]?.args ?? []).map((a) => Number(a));
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The box a part actually covers on screen.
 *
 * The pivot offset and the shape's own geometry are separate draw ops, so the box
 * only exists once they are combined — which is exactly where this contract lives.
 */
function drawnBox(ctx: RecordingContext): Box {
  const offset = translate(ctx, 1);
  const shape = shapeArgs(ctx, 'rect');
  const tx = at(offset, 0);
  const ty = at(offset, 1);
  const x0 = tx + at(shape, 0);
  const y0 = ty + at(shape, 1);
  return { x0, y0, x1: x0 + at(shape, 2), y1: y0 + at(shape, 3) };
}

/** The box an ellipse covers, in the same way. */
function drawnEllipseBox(ctx: RecordingContext): Box {
  const offset = translate(ctx, 1);
  const shape = shapeArgs(ctx, 'ellipse');
  const tx = at(offset, 0);
  const ty = at(offset, 1);
  const x0 = tx + at(shape, 0) - at(shape, 2);
  const y0 = ty + at(shape, 1) - at(shape, 3);
  return { x0, y0, x1: x0 + 2 * at(shape, 2), y1: y0 + 2 * at(shape, 3) };
}

describe('drawParts', () => {
  it('lands the pivot point on the transform origin', () => {
    const ctx = new RecordingContext();
    // A 40x120 arm pivoting at its top edge, i.e. the shoulder. The arm hangs below
    // the origin and stays centred on it: the top edge's midpoint IS the origin.
    drawParts(ctx, [part({ pivot: { x: 0.5, y: 0 } })]);

    expect(drawnBox(ctx)).toEqual({ x0: -20, y0: 0, x1: 20, y1: 120 });
  });

  it('offsets by the authored pivot, not the centre', () => {
    const ctx = new RecordingContext();
    drawParts(ctx, [part({ pivot: { x: 0.5, y: 0 } })]);

    // The pivot offset, not the shape's own geometry: the shape is rasterised
    // centred, so this is the distance from that centre to the nominated point.
    // A centre pivot would have produced [0, 0] and detached the arm from the
    // shoulder by half its length.
    expect(translate(ctx, 1)).toEqual([0, 60]);
  });

  it('centres the shape when the pivot is the middle', () => {
    const ctx = new RecordingContext();
    drawParts(ctx, [part({ pivot: { x: 0.5, y: 0.5 } })]);

    expect(translate(ctx, 1)).toEqual([0, 0]);
    expect(drawnBox(ctx)).toEqual({ x0: -20, y0: -60, x1: 20, y1: 60 });
  });

  it('puts the bottom edge on the origin for a bottom pivot', () => {
    const ctx = new RecordingContext();
    drawParts(ctx, [part({ pivot: { x: 0.5, y: 1 } })]);

    // A tower standing on the ground line: its base is on the origin.
    expect(drawnBox(ctx)).toEqual({ x0: -20, y0: -120, x1: 20, y1: 0 });
  });

  it('applies the part transform before the pivot offset', () => {
    const ctx = new RecordingContext();
    drawParts(ctx, [part({ x: 300, y: 200, rotation: 0.5 })]);

    const ops = ctx.calls.map((c) => c.op);
    expect(ops.indexOf('translate')).toBeLessThan(ops.indexOf('rotate'));
    expect(ops.indexOf('rotate')).toBeLessThan(ops.indexOf('scale'));
    // The part's own placement, then the local pivot offset.
    expect(translate(ctx, 0)).toEqual([300, 200]);
    expect(translate(ctx, 1)).toEqual([0, 60]);
  });

  it('lands the pivot on the origin for every shape kind', () => {
    const rectCtx = new RecordingContext();
    drawParts(rectCtx, [part({ pivot: { x: 0.5, y: 0.5 } })]);
    const ellipseCtx = new RecordingContext();
    drawParts(ellipseCtx, [
      part({ pivot: { x: 0.5, y: 0.5 }, shape: { kind: 'ellipse', rx: 20, ry: 60 } }),
    ]);

    // Same pivot, same size, same place: the geometry is identical whatever the
    // shape is rasterised from.
    expect(drawnEllipseBox(ellipseCtx)).toEqual(drawnBox(rectCtx));
    expect(drawnEllipseBox(ellipseCtx)).toEqual({ x0: -20, y0: -60, x1: 20, y1: 60 });
  });

  it('skips fully transparent parts but draws a visible sliver', () => {
    const hidden = new RecordingContext();
    drawParts(hidden, [part({ alpha: 0 })]);
    expect(hidden.countOf('fill')).toBe(0);

    const sliver = new RecordingContext();
    drawParts(sliver, [part({ alpha: 0.002 })]);
    expect(sliver.countOf('fill')).toBe(1);
  });

  it('leaves the context balanced', () => {
    const ctx = new RecordingContext();
    drawParts(ctx, [part(), part({ id: 'p_armR' })]);
    expect(ctx.isBalanced()).toBe(true);
  });
});
