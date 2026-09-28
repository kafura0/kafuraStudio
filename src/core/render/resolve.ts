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
  scale: number;
  flipX: boolean;
  rotation: number;
  alpha: number;
  /** An extra transform on the resolved mouth part, used for the talk pulse. */
  mouthScale?: number;
  pose?: PoseDef | null;
  expression?: ExpressionDef | null;
}

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

  ordered.forEach((part, index) => {
    const poseOverride = options.pose?.slots[part.slot];
    const expressionOverride = options.expression?.slots[part.slot];

    // Composition: rest, then pose, then expression wins on a shared slot.
    let local = applyOverride(part.rest, poseOverride);
    if (expressionOverride) local = applyOverride(local, expressionOverride);

    const visible = part.visible && (expressionOverride?.visible ?? poseOverride?.visible ?? true);
    if (!visible) return;

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

    const shape = expressionOverride?.shape ?? poseOverride?.shape ?? part.shape;
    const colorKey = expressionOverride?.colorKey ?? poseOverride?.colorKey ?? part.colorKey;
    stack[index] = world;

    // The talk pulse widens the mouth on the Y axis only, so it reads as an open
    // jaw rather than a shrunken head.
    const mouthBoost = part.slot === 'mouth' ? (options.mouthScale ?? 1) : 1;
    const uniformScale = options.scale * world.scaleX;

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
      scaleX: (options.flipX ? -1 : 1) * uniformScale,
      scaleY: options.scale * world.scaleY * mouthBoost,
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
