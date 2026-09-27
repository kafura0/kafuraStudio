/**
 * Rig resolution: turn a character definition plus a pose, an expression and a
 * keyframe sample into a flat, sorted draw list.
 *
 * The three override layers compose as `rest <- pose <- expression <- keyframe`.
 * Poses change the body, expressions change the face, and because a pose and an
 * expression are the same mechanism (`Record<slot, SlotOverride>`) they are applied
 * in one pass and a slot touched by both resolves to the expression's value.
 */
import type { CharacterDef, ExpressionDef, PartDef, PoseDef, PropDef, Vec2 } from '../types';
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
}
/** Resolve a colour key against a palette, treating it as a literal if unknown. */
export declare function resolveColor(colorKey: string, palette: Record<string, string>): string;
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
export declare function resolveRig(parts: PartDef[], palette: Record<string, string>, options: ResolveRigOptions): ResolvedPart[];
export declare function resolveCharacter(character: CharacterDef, options: ResolveRigOptions): ResolvedPart[];
export declare function resolveProp(prop: PropDef, options: ResolveRigOptions): ResolvedPart[];
