/**
 * Rig resolution: turn a character definition plus a pose, an expression and a
 * keyframe sample into a flat, sorted draw list.
 *
 * The three override layers compose as `rest <- pose <- expression <- keyframe`.
 * Poses change the body, expressions change the face, and because a pose and an
 * expression are the same mechanism (`Record<slot, SlotOverride>`) they are applied
 * in one pass and a slot touched by both resolves to the expression's value.
 */

import { composeTransform } from '../geometry';
import type {
  CharacterDef,
  ExpressionDef,
  PartDef,
  PoseDef,
  PropDef,
  SlotOverride,
  Transform2D,
  Vec2,
} from '../types';
import { IDENTITY_TRANSFORM } from '../types';
import type { ShapeDef } from '../types';

export interface ResolvedPart {
  id: string;
  slot: string;
  z: number;
  shape: ShapeDef;
  color: string;
  alpha: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  /**
   * Normalised 0..1 pivot within the shape, copied from the `PartDef`.
   *
   * The renderer must translate by `-pivot * size` or a limb rotates about its
   * middle instead of its joint, so this cannot be defaulted at draw time.
   */
  pivot: Vec2;
}

/** Resolve a colour key against a palette, treating it as a literal if unknown. */
export function resolveColor(colorKey: string, palette: Record<string, string>): string {
  return palette[colorKey] ?? colorKey;
}

/**
 * The CSS named colours.
 *
 * A `colorKey` may legitimately be a plain word, so `red` must not be mistaken for a
 * dangling palette key. Only the names the Canvas actually accepts belong here — a
 * set of every colour word would let a typo like `skinn` through.
 */
const NAMED_COLORS: ReadonlySet<string> = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue',
  'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
  'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick',
  'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod',
  'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred', 'indigo',
  'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue',
  'lightcoral', 'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey',
  'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray',
  'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen',
  'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
  'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
  'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite',
  'navy', 'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod',
  'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink',
  'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue',
  'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver',
  'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue',
  'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white', 'whitesmoke',
  'yellow', 'yellowgreen',
]);

/**
 * Is this `colorKey` a colour the Canvas will paint when handed the string as-is?
 *
 * `resolveColor` treats an unknown key as a literal, which is exactly how a typo'd
 * palette key becomes a part that paints wrong and nobody is told: the fallback is
 * silent, and assigning an invalid `fillStyle` is ignored, so the part draws with
 * whatever fill was last set. This is the question `validateProject` asks before
 * accepting that fallback — a literal is a legitimate authoring choice (every prop
 * part is one), a word that is neither a palette key nor a colour is a mistake
 * (ARCHITECTURE_SPEC.md §18.2 R3).
 */
export function isColorLiteral(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'currentcolor') return true;
  if (NAMED_COLORS.has(v)) return true;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return true;
  return /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/.test(v);
}

/**
 * Fold one slot override into a transform.
 *
 * Translation and rotation offsets are additive; scale and alpha are multiplicative.
 * Additive rotation is what makes a pose's `armL: 0.4` mean "raise the arm 0.4 rad
 * from rest" rather than "pin the arm at 0.4 rad", which is how a rig stays
 * readable as more poses are authored.
 */
function applyOverride(base: Transform2D, override: SlotOverride | undefined): Transform2D {
  if (!override) return base;
  return {
    x: base.x + (override.x ?? 0),
    y: base.y + (override.y ?? 0),
    rotation: base.rotation + (override.rotation ?? 0),
    scaleX: base.scaleX * (override.scaleX ?? 1),
    scaleY: base.scaleY * (override.scaleY ?? 1),
    alpha: base.alpha * (override.alpha ?? 1),
  };
}

export interface ResolveRigOptions {
  /** Placed on the origin of the rig. Usually the actor's feet. */
  origin: Vec2;
  /**
   * Instance scale on the X axis, composed against the rest and pose scale.
   *
   * X and Y are distinct on purpose: the transform model allows an author (or a
   * keyframe) to squash an instance with `scaleY: 0.5`, and a single `scale` field
   * silently discarded the Y half of that (ARCHITECTURE_SPEC.md §18.2 R1).
   */
  scaleX: number;
  /** Instance scale on the Y axis. Composed independently of `scaleX`. */
  scaleY: number;
  flipX: boolean;
  rotation: number;
  alpha: number;
  /** An extra transform on the resolved mouth part, used for the talk pulse. */
  mouthScale?: number;
  /**
   * Which slot `mouthScale` applies to, from `CharacterDef.mouthSlot`.
   *
   * Absent for props (they never pulse) and for callers that want the house
   * convention; `resolveRig` falls back to `DEFAULT_MOUTH_SLOT`.
   */
  mouthSlot?: string;
  pose?: PoseDef | null;
  expression?: ExpressionDef | null;
}

/**
 * The one documented rig-slot literal in the engine: the talk pulse's slot name for
 * a character that has not said otherwise.
 *
 * It lives here — and the normaliser imports it rather than repeating the string —
 * so `'mouth'` appears in exactly one core file. The G2 content-blindness gate
 * allows it at this home and nowhere else (`src/arch/contentBlindness.test.ts`).
 */
export const DEFAULT_MOUTH_SLOT = 'mouth';

/**
 * Order the parts so every parent is resolved before any of its children.
 *
 * This is deliberately *not* the draw order. A part's `z` says where it paints, and
 * nothing about where it sits in the hierarchy: back hair is a child of the head but
 * paints behind the whole body. Resolving in z order therefore read the head's world
 * transform before the head had been resolved, and drew the hair at the rig origin
 * instead of on the head.
 *
 * Depth-first by hierarchy, tie-broken by `z` so the result is stable.
 */
function resolutionOrder(parts: PartDef[]): PartDef[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const depthOfPart = new Map<string, number>();
  const inProgress = new Set<string>();

  const depthOf = (part: PartDef): number => {
    const cached = depthOfPart.get(part.id);
    if (cached !== undefined) return cached;
    // A cycle is a data error, not something to hang on. Treat the offender as a
    // root so resolution still terminates and the validator can report it.
    if (inProgress.has(part.id)) return 0;
    const parent = part.parent === null ? undefined : byId.get(part.parent);
    if (!parent) {
      depthOfPart.set(part.id, 0);
      return 0;
    }
    inProgress.add(part.id);
    const depth = depthOf(parent) + 1;
    inProgress.delete(part.id);
    depthOfPart.set(part.id, depth);
    return depth;
  };

  return [...parts]
    .map((part) => ({ part, depth: depthOf(part) }))
    .sort((a, b) => a.depth - b.depth || a.part.z - b.part.z)
    .map((entry) => entry.part);
}

export function resolveRig(
  parts: PartDef[],
  palette: Record<string, string>,
  options: ResolveRigOptions,
): ResolvedPart[] {
  const ordered = resolutionOrder(parts);
  const indexById = new Map<string, number>();
  ordered.forEach((part, index) => indexById.set(part.id, index));

  const out: ResolvedPart[] = [];
  // World transform per part, indexed by its position in `ordered`.
  const stack: Transform2D[] = new Array<Transform2D>(ordered.length);
  const mouthSlot = options.mouthSlot ?? DEFAULT_MOUTH_SLOT;

  ordered.forEach((part, index) => {
    const poseOverride = options.pose?.slots[part.slot];
    const expressionOverride = options.expression?.slots[part.slot];

    // Composition: rest, then pose, then expression wins on a shared slot.
    let local = applyOverride(part.rest, poseOverride);
    if (expressionOverride) local = applyOverride(local, expressionOverride);

    // A slot the expression hides is hidden even if the pose showed it, and the
    // reverse: an explicit `visible: true` from either layer wins over a rest `false`.
    const visible =
      part.visible && (expressionOverride?.visible ?? poseOverride?.visible ?? true);

    const parentIndex = part.parent === null ? -1 : (indexById.get(part.parent) ?? -1);
    const parent = parentIndex >= 0 ? stack[parentIndex] : undefined;

    const world = composeTransform(
      parent ?? IDENTITY_TRANSFORM,
      local,
      // A fresh object per part: the stack must retain each part's world transform,
      // so these cannot share the scratch instance.
      { ...IDENTITY_TRANSFORM },
    );

    // A root part has no parent, so place it into the world here.
    if (parentIndex < 0) {
      world.x += options.origin.x;
      world.y += options.origin.y;
    }

    // The stack is written even for a part that is not drawn. A hidden part still has
    // a world transform, and its children compose against it — skipping the write
    // would leave the slot undefined and drop the whole subtree to the frame origin.
    stack[index] = world;

    if (!visible) return;

    const shape = expressionOverride?.shape ?? poseOverride?.shape ?? part.shape;
    const colorKey = expressionOverride?.colorKey ?? poseOverride?.colorKey ?? part.colorKey;

    // The talk pulse widens the mouth on the Y axis only, so it reads as an open
    // jaw rather than a shrunken head. The slot is data (`CharacterDef.mouthSlot`),
    // not a literal: a rig may call its mouth anything it likes, and a rig with no
    // matching slot has no part to pulse and is therefore silent rather than wrong.
    const mouthBoost = part.slot === mouthSlot ? (options.mouthScale ?? 1) : 1;

    out.push({
      id: part.id,
      slot: part.slot,
      z: part.z,
      shape,
      color: resolveColor(colorKey, palette),
      alpha: clamp01(world.alpha * options.alpha),
      x: world.x,
      y: world.y,
      rotation: world.rotation + options.rotation,
      scaleX: (options.flipX ? -1 : 1) * options.scaleX * world.scaleX,
      scaleY: options.scaleY * world.scaleY * mouthBoost,
      pivot: part.pivot,
    });
  });

  // Paint in the authored `z` order, which is unrelated to the order above.
  out.sort((a, b) => a.z - b.z);
  return out;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function resolveCharacter(
  character: CharacterDef,
  options: ResolveRigOptions,
): ResolvedPart[] {
  return resolveRig(character.rig, character.palette, options);
}

export function resolveProp(prop: PropDef, options: ResolveRigOptions): ResolvedPart[] {
  return resolveRig(prop.parts, {}, options);
}
