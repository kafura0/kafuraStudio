/**
 * The reusable EXPRESSION library.
 *
 * An expression is structurally identical to a pose — a partial map of rig slot to
 * override — and is applied after the pose, so a slot touched by both resolves to
 * the expression. That single mechanism is why `smug` is three lines of data rather
 * than a separate drawing system.
 *
 * The face slots an expression can drive:
 *   browL / browR   rotation (tilt) and y (height)
 *   eyeL / eyeR     scaleY (blink, widen) and scaleX
 *   mouth           shape swap
 */

import { ellipse, polyline, roundRect } from '../core/render/shapes';
import type { ExpressionDef, ShapeDef, SlotOverride } from '../core/types';

/**
 * Mouth shapes, sized relative to a head radius of 1 so they scale with any
 * character's head.
 */
export const MOUTH_SHAPES: Record<string, ShapeDef> = {
  closed: roundRect(0.34, 0.05, 0.02),
  flat: roundRect(0.3, 0.045, 0.02),
  small: ellipse(0.075, 0.055),
  open: ellipse(0.1, 0.13),
  wide: ellipse(0.16, 0.1),
  grin: roundRect(0.38, 0.13, 0.055),
  o: ellipse(0.085, 0.115),
  frown: polyline([
    { x: -0.16, y: 0.05 },
    { x: 0, y: -0.02 },
    { x: 0.16, y: 0.05 },
  ], false),
  smirk: polyline([
    { x: -0.15, y: 0.03 },
    { x: 0.02, y: -0.04 },
    { x: 0.18, y: 0.01 },
  ], false),
  wavy: polyline([
    { x: -0.17, y: 0.02 },
    { x: -0.06, y: 0.06 },
    { x: 0.06, y: -0.01 },
    { x: 0.17, y: 0.04 },
  ], false),
};

/** Convenience: a mouth shape by name, for use in expression data. */
function mouth(name: keyof typeof MOUTH_SHAPES): SlotOverride {
  const shape = MOUTH_SHAPES[name];
  return { shape: shape ?? MOUTH_SHAPES.closed ?? ellipse(0.3, 0.05) };
}

const HALF_BLINK: SlotOverride = { scaleY: 0.72 };
const CLOSED_EYES: SlotOverride = { scaleY: 0.12 };
const WIDE_EYES: SlotOverride = { scaleY: 1.35, scaleX: 1.1 };

export const EXPRESSIONS: ExpressionDef[] = [
  {
    id: 'expr.neutral',
    name: 'Neutral',
    description: 'The rest face. The default for a character with nothing to say.',
    tags: ['neutral', 'default'],
    slots: {},
  },
  {
    id: 'expr.happy',
    name: 'Happy',
    description: 'Warm, easy smile.',
    tags: ['positive'],
    slots: {
      mouth: mouth('grin'),
      eyeL: HALF_BLINK,
      eyeR: HALF_BLINK,
      browL: { y: -0.02 },
      browR: { y: -0.02 },
    },
  },
  {
    id: 'expr.angry',
    name: 'Angry',
    description: 'Brows down and in, hard frown.',
    tags: ['negative', 'conflict'],
    slots: {
      mouth: mouth('frown'),
      browL: { rotation: 0.3, y: 0.035 },
      browR: { rotation: -0.3, y: 0.035 },
      eyeL: { scaleY: 0.82 },
      eyeR: { scaleY: 0.82 },
    },
  },
  {
    id: 'expr.annoyed',
    name: 'Annoyed',
    description: 'One brow down, flat mouth. The default Nia-versus-landlord read.',
    tags: ['negative'],
    slots: {
      mouth: mouth('flat'),
      browL: { rotation: 0.2, y: 0.03 },
      eyeL: { scaleY: 0.68 },
      eyeR: { scaleY: 0.86 },
      head: { rotation: 0.03 },
    },
  },
  {
    id: 'expr.confused',
    name: 'Confused',
    description: 'Brows at different heights, small open mouth.',
    tags: ['negative', 'question'],
    slots: {
      mouth: mouth('small'),
      browL: { rotation: -0.22, y: -0.05 },
      browR: { rotation: 0.16, y: 0.02 },
      head: { rotation: 0.07 },
    },
  },
  {
    id: 'expr.shocked',
    name: 'Shocked',
    description: 'Brows up, eyes wide, mouth open.',
    tags: ['reaction', 'surprise'],
    slots: {
      mouth: mouth('o'),
      eyeL: WIDE_EYES,
      eyeR: WIDE_EYES,
      browL: { y: -0.09 },
      browR: { y: -0.09 },
    },
  },
  {
    id: 'expr.embarrassed',
    name: 'Embarrassed',
    description: 'Brows up and in, averted eyes, wavy mouth.',
    tags: ['negative', 'vulnerability'],
    slots: {
      mouth: mouth('wavy'),
      eyeL: { scaleY: 0.55, y: 0.015 },
      eyeR: { scaleY: 0.55, y: 0.015 },
      browL: { rotation: -0.26, y: -0.04 },
      browR: { rotation: 0.26, y: -0.04 },
      head: { y: 0.02, rotation: 0.05 },
    },
  },
  {
    id: 'expr.sad',
    name: 'Sad',
    description: 'Brows up and in, deep frown.',
    tags: ['negative'],
    slots: {
      mouth: mouth('frown'),
      browL: { rotation: -0.24, y: -0.03 },
      browR: { rotation: 0.24, y: -0.03 },
      eyeL: { scaleY: 0.8 },
      eyeR: { scaleY: 0.8 },
      head: { y: 0.03, rotation: 0.04 },
    },
  },
  {
    id: 'expr.smug',
    name: 'Smug',
    description: 'Half-lidded, one brow up, asymmetric smirk. Kito, mid-pitch.',
    tags: ['positive', 'attitude'],
    slots: {
      mouth: mouth('smirk'),
      eyeL: { scaleY: 0.55 },
      eyeR: { scaleY: 0.8 },
      browL: { rotation: -0.2, y: -0.05 },
      browR: { rotation: 0.1, y: 0.01 },
      head: { rotation: 0.05 },
    },
  },
  {
    id: 'expr.worried',
    name: 'Worried',
    description: 'Brows pinched up, wavy mouth.',
    tags: ['negative'],
    slots: {
      mouth: mouth('wavy'),
      browL: { rotation: -0.3, y: -0.05 },
      browR: { rotation: 0.3, y: -0.05 },
      eyeL: { scaleY: 0.92 },
      eyeR: { scaleY: 0.92 },
    },
  },
  {
    id: 'expr.laughing',
    name: 'Laughing',
    description: 'Eyes squeezed shut, mouth wide.',
    tags: ['positive', 'reaction'],
    slots: {
      mouth: mouth('wide'),
      eyeL: CLOSED_EYES,
      eyeR: CLOSED_EYES,
      browL: { y: -0.05 },
      browR: { y: -0.05 },
      head: { rotation: -0.08 },
    },
  },
  {
    id: 'expr.deadpan',
    name: 'Deadpan',
    description: 'Flat, unimpressed, waiting. The strongest comedy beat in the toolkit.',
    tags: ['neutral', 'comedy'],
    slots: {
      mouth: mouth('flat'),
      eyeL: { scaleY: 0.7 },
      eyeR: { scaleY: 0.7 },
      browL: { rotation: 0.04, y: 0.01 },
      browR: { rotation: -0.04, y: 0.01 },
    },
  },
];
