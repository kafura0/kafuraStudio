/**
 * NIA'S OWN RIG.
 *
 * The cast shares one humanoid template so a pose written for Kito also plays on
 * Mama Nia. Nia is the exception, and deliberately so: she is the protagonist, she
 * has a silhouette the template cannot express (locs, a cropped top, cargo
 * trousers), and a face the template does not attempt to be expressive with.
 *
 * Everything here is still the shared contract - `PartDef` in, `PartDef` out, the
 * same slot names the pose and expression libraries address, the same renderer -
 * so `pose.sittingSofa` and `expr.annoyed` work on her unchanged. What changes is
 * the art, and the proportions.
 *
 * HER SPACE: the feet on `y = 0`, the crown of her head on `y = -640`, and the
 * camera-facing side is `+x`. A character is 640 tall here, which is what
 * `CharacterDef.height` claims; the shared template draws its characters
 * considerably taller than their declared height, and a protagonist whose
 * proportions do not match her own metadata is a protagonist nobody can scale.
 *
 * TWO RULES THE NUMBERS BELOW OBEY, because both cost a whole rebuild to learn:
 *
 *   1. A child's rest offset is measured from its PARENT'S ORIGIN - the point the
 *      parent's pivot nominates - not from the parent's centre or its edge. The
 *      torso's origin is its waist (it pivots on its bottom edge), so "the
 *      shoulder is 100 above the waist" is a rest offset of `y: -100`.
 *   2. `y` grows DOWNWARD. A segment that hangs from a joint is `joint - tip`,
 *      not `tip - joint`: the thigh is `KNEE_Y - HIP_Y`, which is positive.
 */

import { circle, ellipse, limb, polyline, roundRect } from '../core/render/shapes';
import { transform } from '../core/types';
import type { PartDef, ShapeDef, Vec2 } from '../core/types';

/* ------------------------------------------------------------------ */
/* Landmarks                                                           */
/* ------------------------------------------------------------------ */

const CROWN_Y = -640;
const CHIN_Y = -528;
const SHOULDER_Y = -468;
const WAIST_Y = -368;
const HIP_Y = -326;
const KNEE_Y = -176;
const ANKLE_Y = -26;

/** The head's centre, and the half-width the face scales from. */
const HEAD_CY = (CROWN_Y + CHIN_Y) / 2;
const HEAD_RX = 48;

/** The mouth library sizes its shapes for a head radius of one, so the mouth part
 *  carries the head radius as its scale and every mouth shape lands at her size. */
const HEAD_SCALE = HEAD_RX;

/** Segment lengths. `y` grows downward, so a hanging segment is `joint - tip`. */
const THIGH_LEN = KNEE_Y - HIP_Y;
const SHIN_LEN = ANKLE_Y - KNEE_Y;
const UPPER_ARM_LEN = 118;
const FOREARM_LEN = 108;

/** The joint a limb hangs from: the shape's top edge sits on the origin. */
const HINGE: Vec2 = { x: 0.5, y: 0 };
const CENTRE: Vec2 = { x: 0.5, y: 0.5 };
/** The bottom edge sits on the origin: a body that grows upward from its origin. */
const BOTTOM: Vec2 = { x: 0.5, y: 1 };

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/**
 * The head: an egg with a jaw, not an ellipse.
 *
 * A circle reads as a ball. The narrowing towards the chin is the whole difference
 * between a face and a dot, and it costs sixteen points.
 *
 * The points are measured from the head's centre, and the outline is symmetric
 * about it, so the shape's bounding box is centred on the origin too - which is
 * what lets the head be pivoted in its centre.
 */
const HEAD_OUTLINE: Vec2[] = [
  { x: 0, y: -56 },
  { x: 25, y: -52 },
  { x: 41, y: -39 },
  { x: 48, y: -17 },
  { x: 47, y: 5 },
  { x: 40, y: 25 },
  { x: 27, y: 40 },
  { x: 11, y: 50 },
  { x: 0, y: 56 },
  { x: -11, y: 50 },
  { x: -27, y: 40 },
  { x: -40, y: 25 },
  { x: -47, y: 5 },
  { x: -48, y: -17 },
  { x: -41, y: -39 },
  { x: -25, y: -52 },
];

/**
 * The fringe: locs swept off the face, parted slightly off centre.
 *
 * The parting is what keeps it from being a helmet. The lower edge stops at the
 * brows so the face still reads, and the shape is a crescent - an outer edge over
 * the crown and an inner edge back along the hairline.
 *
 * The points are measured from the FRINGE'S OWN centre, not the head's: a path
 * shape is drawn centred on its own bounding box, so a path authored in head
 * coordinates ends up wherever its own bounding box happens to be.
 */
const FRINGE: Vec2[] = [
  { x: -47, y: 8 },
  { x: -44, y: -4 },
  { x: -22, y: -13 },
  { x: 4, y: -11 },
  { x: 28, y: -13 },
  { x: 44, y: -4 },
  { x: 47, y: 8 },
  { x: 30, y: 5 },
  { x: 6, y: 0 },
  { x: -18, y: 6 },
  { x: -36, y: 12 },
];

/**
 * A smile, in head-radius units so it matches the mouth library's scale.
 *
 * `y` grows downward, so the middle of a smile is the LARGEST y: the line dips
 * at the centre and the corners turn up. The expression library's `frown` is the
 * same curve the other way round.
 */
const SMILE: Vec2[] = [
  { x: -0.19, y: 0.02 },
  { x: -0.1, y: 0.062 },
  { x: 0, y: 0.078 },
  { x: 0.1, y: 0.062 },
  { x: 0.19, y: 0.02 },
];

const NOSE: Vec2[] = [
  { x: 0, y: -2 },
  { x: 5, y: 8 },
  { x: -1, y: 11 },
];

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

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

/**
 * Build Nia's rig.
 *
 * The z order is the reading order of the drawing: hair behind, legs, the far arm,
 * the body, the near arm, and the face on top.
 */
export function buildNiaRig(): PartDef[] {
  const parts: PartDef[] = [];

  /* --- locs, behind everything ---------------------------------------- */
  // The mass is big enough to cover the crown: hair that starts below the crown
  // leaves her looking shaved from the top.
  parts.push(
    part('p_locsMass', 'hairBack', 0, ellipse(58, 72), 'hair', CENTRE, { x: 0, y: -2 }, 'p_head'),
    part('p_locsFall', 'hairBack', 1, roundRect(34, 76, 16), 'hair', CENTRE, { x: -4, y: 54 }, 'p_head'),
    part('p_locsStrandL', 'hairBack', 2, roundRect(13, 92, 6), 'hair', CENTRE, { x: -40, y: 40 }, 'p_head'),
    part('p_locsStrandR', 'hairBack', 2, roundRect(13, 92, 6), 'hair', CENTRE, { x: 40, y: 40 }, 'p_head'),
  );

  /* --- legs ------------------------------------------------------------ */
  for (const side of ['R', 'L'] as const) {
    const sign = side === 'L' ? -1 : 1;
    parts.push(
      part(
        `p_thigh${side}`,
        `thigh${side}`,
        4,
        limb(40, 33, THIGH_LEN),
        'bottom',
        HINGE,
        { x: sign * 26, y: HIP_Y },
      ),
    );
    // The cargo pocket: the detail that says "cargo trousers" rather than "trousers".
    parts.push(
      part(
        `p_pocket${side}`,
        `pocket${side}`,
        5,
        roundRect(26, 22, 4),
        'bottomShade',
        CENTRE,
        { x: 0, y: 96 },
        `p_thigh${side}`,
      ),
    );
    parts.push(
      part(
        `p_shin${side}`,
        `shin${side}`,
        6,
        limb(31, 24, SHIN_LEN),
        'bottom',
        HINGE,
        { y: THIGH_LEN },
        `p_thigh${side}`,
      ),
    );
    parts.push(
      part(
        `p_foot${side}`,
        `foot${side}`,
        7,
        roundRect(54, 26, 8),
        'shoe',
        HINGE,
        { x: sign * 5, y: SHIN_LEN },
        `p_shin${side}`,
      ),
    );
  }

  /* --- far arm (behind the torso) -------------------------------------- */
  parts.push(...buildArm('R', 1));

  /* --- the body -------------------------------------------------------- */
  // The pelvis is a root of its own: the hips belong to the legs, not to the
  // chest, so a torso rotation does not drag them with it.
  parts.push(
    part('p_pelvis', 'pelvis', 9, roundRect(92, 46, 16), 'bottom', CENTRE, { x: 0, y: -347 }, null),
  );

  // The torso's origin is its waist: the chest turns at the waist, and the head
  // and arms hang off it. Its bottom edge is on that origin, so the body grows
  // upward from the waist to the shoulders.
  parts.push(
    part('p_torso', 'torso', 10, roundRect(96, 100, 18), 'bottom', BOTTOM, { x: 0, y: WAIST_Y }, null),
  );
  // Every offset below is measured from the waist, which is the torso's origin.
  parts.push(
    part('p_midriff', 'midriff', 14, roundRect(74, 44, 10), 'skin', CENTRE, { x: 0, y: -30 }, 'p_torso'),
    part('p_top', 'top', 15, roundRect(116, 52, 22), 'top', CENTRE, { x: 0, y: -76 }, 'p_torso'),
    // The hem band is the one piece of magenta on her: restrained means one band.
    part('p_topBand', 'topBand', 16, roundRect(100, 12, 5), 'accentPink', CENTRE, { x: 0, y: -48 }, 'p_torso'),
    part('p_waistband', 'waistband', 17, roundRect(86, 26, 6), 'bottomShade', CENTRE, { x: 0, y: 2 }, 'p_torso'),
    part('p_buckle', 'buckle', 18, roundRect(15, 11, 3), 'accentPink', CENTRE, { x: 0, y: 2 }, 'p_torso'),
  );

  /* --- near arm (in front of the torso) -------------------------------- */
  parts.push(...buildArm('L', 19));

  /* --- neck, head, face ------------------------------------------------ */
  parts.push(
    part('p_neck', 'neck', 20, roundRect(26, 64, 10), 'skin', CENTRE, { x: 0, y: -130 }, 'p_torso'),
    part(
      'p_head',
      'head',
      21,
      { kind: 'path', points: HEAD_OUTLINE, closed: true },
      'skin',
      CENTRE,
      { x: 0, y: HEAD_CY - WAIST_Y },
      'p_torso',
    ),
  );
  parts.push(
    part('p_earR', 'earR', 22, ellipse(8, 11), 'skin', CENTRE, { x: 45, y: 4 }, 'p_head'),
    part('p_earL', 'earL', 22, ellipse(8, 11), 'skin', CENTRE, { x: -45, y: 4 }, 'p_head'),
    part('p_earringR', 'earringR', 23, circle(4), 'accent', CENTRE, { x: 47, y: 13 }, 'p_head'),
    part(
      'p_fringe',
      'hairFront',
      24,
      { kind: 'path', points: FRINGE, closed: true },
      'hair',
      CENTRE,
      // The fringe's own peak is 13 above its origin, so an origin 43 below the
      // head's centre puts the peak exactly on the crown and the hairline on the
      // brows.
      { x: 0, y: -43 },
      'p_head',
    ),
    part('p_browR', 'browR', 26, roundRect(26, 5, 2.5), 'brow', CENTRE, { x: 18, y: -28 }, 'p_head'),
    part('p_browL', 'browL', 26, roundRect(26, 5, 2.5), 'brow', CENTRE, { x: -18, y: -28 }, 'p_head'),
  );

  // The eye is two parts on one slot: the white and the iris share a slot, so a
  // blink or a widening from an expression moves both together.
  for (const side of ['R', 'L'] as const) {
    const sign = side === 'L' ? -1 : 1;
    parts.push(
      part(`p_eye${side}`, `eye${side}`, 27, ellipse(12, 8.5), 'eyeWhite', CENTRE, { x: sign * 18, y: -6 }, 'p_head'),
      part(`p_iris${side}`, `eye${side}`, 27, ellipse(7.5, 7), 'eye', CENTRE, { x: sign * 18, y: -6 }, 'p_head'),
    );
  }

  parts.push(
    part('p_nose', 'nose', 28, polyline(NOSE, false), 'skinShade', CENTRE, { x: 0, y: 4 }, 'p_head'),
    // The mouth carries the head radius as its scale, because the shared mouth
    // library is authored for a head radius of one.
    part(
      'p_mouth',
      'mouth',
      29,
      polyline(SMILE, false),
      'mouth',
      CENTRE,
      { x: 0, y: 26, scaleX: HEAD_SCALE, scaleY: HEAD_SCALE },
      'p_head',
    ),
  );

  return parts;
}

/**
 * One arm: upper arm, forearm, hand.
 *
 * Each segment hangs from its joint, so a pose that rotates `armL` swings the
 * whole arm from the shoulder and one that rotates `forearmL` bends it at the
 * elbow.
 */
function buildArm(side: 'L' | 'R', z: number): PartDef[] {
  const sign = side === 'L' ? -1 : 1;
  return [
    part(`p_arm${side}`, `arm${side}`, z, limb(26, 22, UPPER_ARM_LEN), 'skin', HINGE, { x: sign * 56, y: SHOULDER_Y - WAIST_Y }, 'p_torso'),
    part(`p_forearm${side}`, `forearm${side}`, z + 1, limb(22, 17, FOREARM_LEN), 'skin', HINGE, { y: UPPER_ARM_LEN }, `p_arm${side}`),
    part(`p_hand${side}`, `hand${side}`, z + 2, circle(11), 'skin', CENTRE, { y: FOREARM_LEN }, `p_forearm${side}`),
  ];
}
