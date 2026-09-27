/**
 * Human rig builder — the authoring tool for ZANZA characters.
 *
 * Every character is built from this one template, differing only by proportions
 * and palette. That is deliberate: it is what makes a single set of poses and
 * expressions reusable across the entire cast. A character-specific rig would
 * mean re-authoring every pose.
 *
 * Rig layout (feet at y = 0, growing upward as y decreases):
 *
 *   z=0   hairBack
 *   z=4   thighR/L  -> shinR/L -> footR/L
 *   z=8   armR -> forearmR -> handR          (far arm, behind the torso)
 *   z=12  torso
 *   z=14  armL -> forearmL -> handL          (near arm, in front of the torso)
 *   z=18  neck
 *   z=20  head
 *   z=22  earR / earL
 *   z=26  browR / browL
 *   z=27  eyeR / eyeL
 *   z=28  nose
 *   z=29  mouth
 *   z=30  hairFront (fringe)
 */

import { circle, ellipse, limb, polyline, rect, roundRect } from '../core/render/shapes';
import { transform } from '../core/types';
import type { PartDef, ShapeDef, Vec2 } from '../core/types';

export interface Proportions {
  /** Total height in px at scale 1. */
  height: number;
  /** Head half-width. */
  headRadius: number;
  shoulderWidth: number;
  hipWidth: number;
  torsoLength: number;
  legLength: number;
  armLength: number;
  limbThickness: number;
  /** Multiplies the neck and face feature sizes. */
  faceDetail: number;
}

export type Build = 'slim' | 'average' | 'broad';

/** Proportion presets. Height is the primary axis; the rest derive from it. */
export function proportions(
  height: number,
  build: Build = 'average',
  overrides: Partial<Proportions> = {},
): Proportions {
  const buildScale: Record<Build, { shoulder: number; limb: number; hip: number }> = {
    slim: { shoulder: 0.86, limb: 0.82, hip: 0.92 },
    average: { shoulder: 1, limb: 1, hip: 1 },
    broad: { shoulder: 1.18, limb: 1.24, hip: 1.05 },
  };
  const b = buildScale[build];

  const legLength = height * 0.46;
  const torsoLength = height * 0.3;

  return {
    height,
    legLength,
    torsoLength,
    headRadius: height * 0.093,
    shoulderWidth: height * 0.2 * b.shoulder,
    hipWidth: height * 0.13 * b.hip,
    armLength: height * 0.37,
    limbThickness: height * 0.042 * b.limb,
    faceDetail: 1,
    ...overrides,
  };
}

const MID: Vec2 = { x: 0.5, y: 0 };
const BOTTOM: Vec2 = { x: 0.5, y: 1 };
const CENTRE: Vec2 = { x: 0.5, y: 0.5 };

function part(
  id: string,
  slot: string,
  z: number,
  shape: ShapeDef,
  colorKey: string,
  pivot: Vec2,
  rest: Partial<PartDef['rest']>,
  parent: string | null = null,
): PartDef {
  return {
    id,
    slot,
    z,
    shape,
    colorKey,
    pivot,
    rest: transform(rest),
    visible: true,
    parent,
  };
}

export interface RigOptions {
  /** Slot name for the hair silhouette, so poses can ruffle it. */
  hairStyle?: 'afro' | 'locs' | 'long' | 'short' | 'bald' | 'bun';
}

/**
 * Build the full rig for a humanoid character.
 *
 * The returned slots are the contract with the pose and expression libraries:
 * `head`, `torso`, `thighL/R`, `shinL/R`, `armL/R`, `forearmL/R`, `browL/R`,
 * `eyeL/R`, `mouth`, and so on.
 */
export function buildHumanRig(p: Proportions, options: RigOptions = {}): PartDef[] {
  const { headRadius: hr, shoulderWidth: sw, hipWidth: hw, torsoLength: tl, legLength: ll, armLength: al, limbThickness: lt, faceDetail: fd } = p;

  const hipY = -ll;
  const shoulderY = hipY - tl;
  const thighLength = ll * 0.52;
  const shinLength = ll * 0.48;
  const upperArm = al * 0.5;
  const foreArm = al * 0.5;

  const parts: PartDef[] = [];

  /* --- hair silhouette (behind everything) -------------------------- */
  const hair = buildHairBack(options.hairStyle ?? 'short', hr);
  if (hair) parts.push(part('p_hairBack', 'hairBack', 0, hair.shape, hair.colorKey, hair.pivot, hair.rest, 'p_head'));

  /* --- legs ---------------------------------------------------------- */
  for (const side of ['R', 'L'] as const) {
    const sign = side === 'L' ? -1 : 1;
    const thighId = `p_thigh${side}`;
    const shinId = `p_shin${side}`;
    const footId = `p_foot${side}`;

    parts.push(
      part(
        thighId,
        `thigh${side}`,
        4,
        limb(lt * 1.25, lt, thighLength),
        'bottom',
        MID,
        { x: (sign * hw) / 2, y: hipY },
      ),
    );
    parts.push(
      part(shinId, `shin${side}`, 5, limb(lt, lt * 0.78, shinLength), 'bottom', MID, { y: thighLength }, thighId),
    );
    parts.push(
      part(
        footId,
        `foot${side}`,
        6,
        roundRect(lt * 1.7, lt * 0.9, lt * 0.35),
        'shoe',
        { x: 0.25, y: 0.5 },
        { x: lt * 0.25, y: shinLength },
        shinId,
      ),
    );
  }

  /* --- far arm (behind the torso) ------------------------------------ */
  parts.push(...buildArm('R', sw * 0.44, shoulderY, upperArm, foreArm, lt, 8, 'p_torso'));

  /* --- torso ---------------------------------------------------------- */
  parts.push(part('p_torso', 'torso', 12, roundRect(sw, tl, tl * 0.22), 'top', BOTTOM, { y: hipY }));

  /* --- near arm (in front of the torso) ------------------------------ */
  parts.push(...buildArm('L', -sw * 0.44, shoulderY, upperArm, foreArm, lt, 14, 'p_torso'));

  /* --- neck + head ---------------------------------------------------- */
  parts.push(
    part('p_neck', 'neck', 18, rect(hr * 0.5, hr * 0.4), 'skin', CENTRE, { y: shoulderY - hr * 0.1 }, 'p_torso'),
  );
  parts.push(
    part('p_head', 'head', 20, ellipse(hr, hr * 1.12), 'skin', { x: 0.5, y: 0.88 }, { y: shoulderY - hr * 0.42 }, 'p_torso'),
  );

  parts.push(...buildEars(hr, fd));
  parts.push(...buildFace(hr, fd));

  /* --- fringe (in front of the face) ---------------------------------- */
  const front = buildHairFront(options.hairStyle ?? 'short', hr, fd);
  if (front) parts.push(part('p_hairFront', 'hairFront', 30, front.shape, front.colorKey, front.pivot, front.rest, 'p_head'));

  return parts;
}

/* ------------------------------------------------------------------ */
/* Arm assembly                                                        */
/* ------------------------------------------------------------------ */

function buildArm(
  side: 'L' | 'R',
  shoulderX: number,
  shoulderY: number,
  upperArm: number,
  foreArm: number,
  lt: number,
  z: number,
  parent: string,
): PartDef[] {
  const armId = `p_arm${side}`;
  const foreId = `p_forearm${side}`;
  const handId = `p_hand${side}`;

  return [
    part(armId, `arm${side}`, z, limb(lt, lt * 0.86, upperArm), 'skin', MID, { x: shoulderX, y: shoulderY }, parent),
    part(foreId, `forearm${side}`, z + 1, limb(lt * 0.86, lt * 0.72, foreArm), 'skin', MID, { y: upperArm }, armId),
    part(handId, `hand${side}`, z + 2, circle(lt * 0.62), 'skin', MID, { y: foreArm }, foreId),
  ];
}

/* ------------------------------------------------------------------ */
/* Face                                                                */
/* ------------------------------------------------------------------ */

function buildEars(hr: number, fd: number): PartDef[] {
  const r = hr * 0.2 * fd;
  return [
    part('p_earR', 'earR', 22, ellipse(r, r * 1.25), 'skin', CENTRE, { x: hr * 0.94, y: -hr * 0.05 }, 'p_head'),
    part('p_earL', 'earL', 22, ellipse(r, r * 1.25), 'skin', CENTRE, { x: -hr * 0.94, y: -hr * 0.05 }, 'p_head'),
  ];
}

/**
 * The face. Every part here is a slot an expression can override, which is how a
 * smirk becomes `browL: rotate(-6°) + mouth: <narrow shape>` with no bespoke art.
 */
function buildFace(hr: number, fd: number): PartDef[] {
  const eyeR = hr * 0.17 * fd;
  const browW = hr * 0.34 * fd;
  const browH = hr * 0.075 * fd;
  const eyeY = -hr * 0.1;
  const eyeX = hr * 0.38;
  const browY = -hr * 0.36;
  const mouthY = hr * 0.46;

  return [
    part('p_browR', 'browR', 26, roundRect(browW, browH, browH / 2), 'brow', { x: 0, y: 0.5 }, { x: eyeX, y: browY }, 'p_head'),
    part('p_browL', 'browL', 26, roundRect(browW, browH, browH / 2), 'brow', { x: 0, y: 0.5 }, { x: -eyeX, y: browY }, 'p_head'),
    part('p_eyeR', 'eyeR', 27, ellipse(eyeR, eyeR * 1.1), 'eye', CENTRE, { x: eyeX, y: eyeY }, 'p_head'),
    part('p_eyeL', 'eyeL', 27, ellipse(eyeR, eyeR * 1.1), 'eye', CENTRE, { x: -eyeX, y: eyeY }, 'p_head'),
    part(
      'p_nose',
      'nose',
      28,
      polyline([
        { x: 0, y: -hr * 0.02 },
        { x: hr * 0.09, y: hr * 0.2 },
        { x: -hr * 0.02, y: hr * 0.24 },
      ], false),
      'skinShade',
      CENTRE,
      {},
      'p_head',
    ),
    // The mouth is a plain slot: expressions swap its shape to change the read.
    part(
      'p_mouth',
      'mouth',
      29,
      roundRect(hr * 0.34, hr * 0.05, hr * 0.02),
      'mouth',
      CENTRE,
      { y: mouthY },
      'p_head',
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* Hair                                                                */
/* ------------------------------------------------------------------ */

function buildHairBack(
  style: NonNullable<RigOptions['hairStyle']>,
  hr: number,
): { shape: ShapeDef; colorKey: string; pivot: Vec2; rest: PartDef['rest'] } | null {
  switch (style) {
    case 'afro':
      return { shape: circle(hr * 1.42), colorKey: 'hair', pivot: CENTRE, rest: transform({ y: -hr * 0.16 }) };
    case 'locs':
      return {
        shape: roundRect(hr * 2.1, hr * 2.5, hr * 0.5),
        colorKey: 'hair',
        pivot: { x: 0.5, y: 0.16 },
        rest: transform({ y: -hr * 0.2 }),
      };
    case 'long':
      return {
        shape: roundRect(hr * 2.15, hr * 3.0, hr * 0.85),
        colorKey: 'hair',
        pivot: { x: 0.5, y: 0.14 },
        rest: transform({ y: -hr * 0.22 }),
      };
    case 'bun':
      return {
        shape: roundRect(hr * 2.0, hr * 1.9, hr * 0.8),
        colorKey: 'hair',
        pivot: CENTRE,
        rest: transform({ y: -hr * 0.18 }),
      };
    case 'bald':
      return null;
    case 'short':
    default:
      return {
        shape: roundRect(hr * 2.02, hr * 1.72, hr * 0.7),
        colorKey: 'hair',
        pivot: { x: 0.5, y: 0.18 },
        rest: transform({ y: -hr * 0.2 }),
      };
  }
}

function buildHairFront(
  style: NonNullable<RigOptions['hairStyle']>,
  hr: number,
  fd: number,
): { shape: ShapeDef; colorKey: string; pivot: Vec2; rest: PartDef['rest'] } | null {
  // A high face-detail build gets a thinner, more articulated fringe.
  const drop = fd * 0.06;
  switch (style) {
    case 'bald':
      return null;
    case 'locs':
    case 'afro':
      // Full silhouettes already cover the crown; the fringe would double it up.
      return {
        shape: roundRect(hr * 1.98, hr * 0.6, hr * 0.28),
        colorKey: 'hair',
        pivot: { x: 0.5, y: 0.2 },
        rest: transform({ y: -hr * 0.72 }),
      };
    case 'bun':
    case 'long':
    case 'short':
    default:
      return {
        shape: polyline(
          [
            { x: -hr * 1.0, y: -hr * 0.62 },
            { x: -hr * 0.55, y: -hr * 1.02 },
            { x: hr * 0.35, y: -hr * 0.95 },
            { x: hr * 1.0, y: -hr * 0.5 },
            { x: hr * 0.86, y: -hr * 0.42 },
            { x: hr * 0.2, y: -hr * 0.6 },
            { x: -hr * 0.7, y: -hr * 0.4 },
          ],
          true,
        ),
        colorKey: 'hair',
        pivot: CENTRE,
        rest: transform({ y: -hr * 0.72 - drop * hr }),
      };
  }
}
