/**
 * Small authoring helpers for environment content.
 *
 * Kept in `data/` rather than `core/` because they exist to make the seed sets
 * readable, not because the domain needs them.
 */

import { transform } from '../core/types';
import type {
  AnchoredEnvPart,
  EnvLayer,
  EnvironmentDef,
  StagingAnchor,
} from '../core/types';

export const CENTRE_PIVOT = { x: 0.5, y: 0.5 } as const;
export const BOTTOM_PIVOT = { x: 0.5, y: 1 } as const;
export const TOP_PIVOT = { x: 0.5, y: 0 } as const;

/** A centred environment part, positioned by its centre. */
export function part(
  shape: AnchoredEnvPart['shape'],
  colorKey: string,
  x: number,
  y: number,
  options: { rotation?: number; scaleX?: number; scaleY?: number; alpha?: number; pivot?: { x: number; y: number } } = {},
): AnchoredEnvPart {
  return {
    shape,
    colorKey,
    pivot: options.pivot ?? CENTRE_PIVOT,
    transform: transform({
      x,
      y,
      rotation: options.rotation ?? 0,
      scaleX: options.scaleX ?? 1,
      scaleY: options.scaleY ?? 1,
      alpha: options.alpha ?? 1,
    }),
  };
}

/** An environment part pinned by its bottom edge — the natural choice for towers. */
export function standingPart(
  shape: AnchoredEnvPart['shape'],
  colorKey: string,
  x: number,
  baseY: number,
): AnchoredEnvPart {
  return part(shape, colorKey, x, baseY, { pivot: BOTTOM_PIVOT });
}

export function layer(id: string, name: string, z: number, parallax: number, parts: AnchoredEnvPart[]): EnvLayer {
  return { id, name, z, parallax, parts };
}

export type { AnchoredEnvPart, EnvLayer, EnvironmentDef, StagingAnchor };
