/**
 * Nia's rig tests.
 *
 * Nia has her own rig rather than the shared humanoid template, so these pin the
 * properties the template gives the rest of the cast for free and she has to earn:
 *
 *   - every colour in her rig resolves against her own palette (a dangling key
 *     paints the wrong colour, silently);
 *   - she answers to every slot the shared pose and expression libraries address,
 *     which is what makes `pose.sittingSofa` and `expr.annoyed` work on her;
 *   - she is as tall as her own metadata claims, feet on the ground and crown at
 *     the top of the declared height;
 *   - her face features are inside her head, and her mouth is mouth-sized when the
 *     shared mouth library swaps its shape in.
 */

import { describe, expect, it } from 'vitest';
import { NIA } from './characters';
import { EXPRESSIONS } from './expressions';
import { POSES } from './poses';
import { resolveCharacter } from '../core/render/resolve';
import { shapeBounds } from '../core/render/shapes';
import type { ExpressionDef, PoseDef } from '../core/types';

const OPTIONS = {
  origin: { x: 0, y: 0 },
  scaleX: 1,
  scaleY: 1,
  flipX: false,
  rotation: 0,
  alpha: 1,
};

function resolve(pose?: PoseDef, expression?: ExpressionDef) {
  return resolveCharacter(NIA, { ...OPTIONS, pose: pose ?? null, expression: expression ?? null });
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The box a resolved part covers, with the pivot contract applied.
 *
 * A shape is rasterised centred on its bounding box and then offset so the
 * nominated pivot lands on the part's origin, so the box follows from the shape's
 * own size and the pivot — which is the same arithmetic the renderer performs.
 */
function drawnBox(part: ReturnType<typeof resolve>[number]): Box {
  const bounds = shapeBounds(part.shape);
  const cx = part.x + part.scaleX * bounds.width * (0.5 - part.pivot.x);
  const cy = part.y + part.scaleY * bounds.height * (0.5 - part.pivot.y);
  const halfW = (bounds.width * Math.abs(part.scaleX)) / 2;
  const halfH = (bounds.height * Math.abs(part.scaleY)) / 2;
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH };
}

function boxOf(parts: ReturnType<typeof resolve>, slot: string): Box {
  const part = parts.find((p) => p.slot === slot);
  if (!part) throw new Error(`No part on slot '${slot}'`);
  return drawnBox(part);
}

function unionBox(parts: ReturnType<typeof resolve>, slots: readonly string[]): Box {
  const boxes = parts.filter((p) => slots.includes(p.slot)).map(drawnBox);
  if (boxes.length === 0) throw new Error(`No parts on slots '${slots.join(', ')}'`);
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

describe("Nia's rig", () => {
  it('resolves every colour against her own palette', () => {
    for (const part of NIA.rig) {
      expect(
        Object.hasOwn(NIA.palette, part.colorKey),
        `part '${part.id}' uses colour key '${part.colorKey}', which her palette does not define`,
      ).toBe(true);
    }
  });

  it('has unique part ids and no dangling parents', () => {
    const ids = new Set(NIA.rig.map((p) => p.id));
    expect(ids.size).toBe(NIA.rig.length);

    for (const part of NIA.rig) {
      if (part.parent === null) continue;
      expect(ids.has(part.parent), `part '${part.id}' names a missing parent '${part.parent}'`).toBe(true);
    }
  });

  it('answers to every slot the shared pose library addresses', () => {
    const slots = new Set(NIA.rig.map((p) => p.slot));
    for (const pose of POSES) {
      for (const slot of Object.keys(pose.slots)) {
        expect(slots.has(slot), `pose '${pose.id}' drives slot '${slot}', which Nia does not have`).toBe(
          true,
        );
      }
    }
  });

  it('answers to every slot the shared expression library addresses', () => {
    const slots = new Set(NIA.rig.map((p) => p.slot));
    for (const expression of EXPRESSIONS) {
      for (const slot of Object.keys(expression.slots)) {
        expect(
          slots.has(slot),
          `expression '${expression.id}' drives slot '${slot}', which Nia does not have`,
        ).toBe(true);
      }
    }
  });

  it('stands on the ground and is as tall as her metadata claims', () => {
    const parts = resolve();

    // The soles of her shoes are on y = 0.
    const footR = boxOf(parts, 'footR');
    const footL = boxOf(parts, 'footL');
    expect(footR.y1).toBeCloseTo(0, 5);
    expect(footL.y1).toBeCloseTo(0, 5);

    // And the crown of her head is at the top of the declared height.
    const head = boxOf(parts, 'head');
    expect(head.y0).toBeCloseTo(-NIA.height, 5);
  });

  it('keeps her face inside her head', () => {
    const parts = resolve();
    const head = boxOf(parts, 'head');

    for (const slot of ['eyeR', 'eyeL', 'browR', 'browL', 'nose', 'mouth']) {
      const box = boxOf(parts, slot);
      expect(box.x0, `${slot} is outside the head on the left`).toBeGreaterThanOrEqual(head.x0);
      expect(box.x1, `${slot} is outside the head on the right`).toBeLessThanOrEqual(head.x1);
      expect(box.y0, `${slot} is above the head`).toBeGreaterThanOrEqual(head.y0);
      expect(box.y1, `${slot} is below the head`).toBeLessThanOrEqual(head.y1);
    }
  });

  it('defaults to a broad smile that stays inside her face', () => {
    const parts = resolve();
    const head = boxOf(parts, 'head');
    const mouth = boxOf(parts, 'mouth');

    // A narrow mouth reads as a line at 640px. The default smile is the one
    // feature that has to survive being seen small.
    expect(mouth.x1 - mouth.x0).toBeGreaterThan(23);
    expect(mouth.x0).toBeGreaterThan(head.x0);
    expect(mouth.x1).toBeLessThan(head.x1);
  });

  it('gives the locs a silhouette wider than the head', () => {
    const parts = resolve();
    const head = boxOf(parts, 'head');
    const hair = unionBox(parts, ['hairBack', 'hairFront']);

    // The head outline is 96 wide. Hair that never leaves it is a cap, not locs.
    expect(hair.x0).toBeLessThan(head.x0);
    expect(hair.x1).toBeGreaterThan(head.x1);
  });

  it('stands both sneaker soles on the ground', () => {
    const parts = resolve();
    for (const id of ['p_soleR', 'p_soleL']) {
      const part = parts.find((p) => p.id === id);
      expect(part, `missing part '${id}'`).toBeDefined();
      if (!part) continue;
      expect(drawnBox(part).y1).toBeCloseTo(0, 5);
    }
  });

  it('draws a mouth-sized mouth when the shared mouth library swaps its shape in', () => {
    // The shared mouth shapes are authored for a head radius of one, so a rig that
    // does not carry the head radius as its mouth scale draws them at a fraction of
    // a pixel wide and the character talks with a closed mouth.
    const happy = EXPRESSIONS.find((e) => e.id === 'expr.happy');
    expect(happy).toBeDefined();
    if (!happy) return;

    const mouth = boxOf(resolve(undefined, happy), 'mouth');
    expect(mouth.x1 - mouth.x0).toBeGreaterThan(8);
    expect(mouth.x1 - mouth.x0).toBeLessThan(40);
  });

  it('has a toothy smile aligned with the mouth', () => {
    const parts = resolve();
    const mouth = boxOf(parts, 'mouth');
    const teeth = parts.find((p) => p.slot === 'teeth');
    expect(teeth).toBeDefined();
    if (!teeth) return;
    expect(teeth.color).toBe(NIA.palette.eyeWhite);

    const teethBox = drawnBox(teeth);
    // Teeth sit above the lower lip and span most of the mouth width.
    expect(teethBox.x0).toBeGreaterThan(mouth.x0);
    expect(teethBox.x1).toBeLessThan(mouth.x1);
    expect(teethBox.y1).toBeLessThan(mouth.y1);
    expect(teethBox.y0).toBeGreaterThan(mouth.y0);
  });

  it('keeps teeth visible when the shared mouth library swaps shapes', () => {
    const happy = EXPRESSIONS.find((e) => e.id === 'expr.happy');
    expect(happy).toBeDefined();
    if (!happy) return;

    const parts = resolve(undefined, happy);
    const teeth = parts.find((p) => p.slot === 'teeth');
    expect(teeth).toBeDefined();
    if (!teeth) return;
    // Teeth remain on their own slot and are not replaced by mouth shape swaps.
    expect(teeth.shape.kind).toBe('roundRect');
  });

  it('blinks every layer of an eye together', () => {
    // The white, iris, pupil and catchlight share a slot; an expression that
    // scales the slot must move all four, or the iris stays open over a closed lid.
    const laughing = EXPRESSIONS.find((e) => e.id === 'expr.laughing');
    expect(laughing).toBeDefined();
    if (!laughing) return;

    const parts = resolve(undefined, laughing);
    const eyes = parts.filter((p) => p.slot === 'eyeL');
    expect(eyes.length).toBe(4);
    for (const eye of eyes) {
      expect(eye.scaleY).toBeLessThan(0.2);
    }
  });
});
