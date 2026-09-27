/**
 * Shape rasterisation.
 *
 * Every drawable in ZANZA is a `ShapeDef`. A shape is always drawn in a local space
 * where its bounding box is centred on the origin, then offset by `-pivot` so the
 * declared pivot lands on the transform origin. That single rule is what lets a rig
 * rotate a forearm around its elbow without any per-shape special cases.
 */
import type { Canvas2DLike } from './canvas';
import type { ShapeDef, Vec2 } from '../types';
export interface ShapeBounds {
    width: number;
    height: number;
    /** Centre of the shape inside its own local space, before centring. */
    cx: number;
    cy: number;
}
export declare function shapeBounds(shape: ShapeDef): ShapeBounds;
/** Build the path for a shape, centred on the origin. Does not fill or stroke. */
export declare function buildShapePath(ctx: Canvas2DLike, shape: ShapeDef): void;
export declare function ellipse(rx: number, ry: number): ShapeDef;
export declare function rect(w: number, h: number): ShapeDef;
export declare function roundRect(w: number, h: number, radius: number): ShapeDef;
export declare function polyline(points: Vec2[], closed?: boolean): ShapeDef;
/** A tapered limb: a quad from a wide root to a narrow tip. */
export declare function limb(rootWidth: number, tipWidth: number, length: number, options?: {
    bend?: number;
}): ShapeDef;
/** A circle, the most common shape in the rig library. */
export declare function circle(radius: number): ShapeDef;
