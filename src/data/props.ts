/**
 * THE ZANZA PROP LIBRARY.
 *
 * Props use the same `PartDef` rig structure as characters, so the renderer draws a
 * character and a mug through the same code path — one `drawRig`, no special cases.
 * Each prop is defined once here and referenced by id from every scene that uses it.
 */

import { circle, ellipse, polyline, rect, roundRect } from '../core/render/shapes';
import { transform } from '../core/types';
import type { PartDef, PropDef, ShapeDef, Vec2 } from '../core/types';

const CENTRE: Vec2 = { x: 0.5, y: 0.5 };
const BOTTOM: Vec2 = { x: 0.5, y: 1 };

function part(
  id: string,
  slot: string,
  z: number,
  shape: ShapeDef,
  colorKey: string,
  rest: Partial<PartDef['rest']> = {},
  pivot: Vec2 = CENTRE,
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

export const PHONE: PropDef = {
  id: 'prop.phone',
  name: 'Phone',
  description: 'A slab handset. Screen glows when a scene needs it to.',
  tags: ['device', 'hand', 'small'],
  pivot: CENTRE,
  defaultScale: 1,
  parts: [
    part('pr_phone_body', 'body', 0, roundRect(44, 84, 9), '#1c1f27'),
    part('pr_phone_screen', 'screen', 1, roundRect(36, 70, 6), '#4a9fd8', { y: -3 }),
    part('pr_phone_glow', 'glow', 2, roundRect(30, 60, 4), '#8fd6ff', { y: -3 }),
  ],
};

export const MUG: PropDef = {
  id: 'prop.mug',
  name: 'Mug',
  description: 'Instant-noodle era kitchenware. The Rent Is Due stress object.',
  tags: ['kitchen', 'small', 'held'],
  pivot: BOTTOM,
  defaultScale: 1,
  parts: [
    part('pr_mug_body', 'body', 0, roundRect(52, 56, 8), '#e8e2d6', { y: -28 }),
    part('pr_mug_handle', 'handle', 1, circle(15), '#e8e2d6', { x: 32, y: -28 }),
    part('pr_mug_liquid', 'liquid', 2, ellipse(20, 7), '#5c3a1e', { y: -52 }),
  ],
};

export const LAPTOP: PropDef = {
  id: 'prop.laptop',
  name: 'Laptop',
  description: 'Work machine. Where the empire gets planned.',
  tags: ['device', 'desk', 'medium'],
  pivot: BOTTOM,
  defaultScale: 1,
  parts: [
    part('pr_laptop_base', 'base', 0, roundRect(240, 14, 4), '#3a3d47', { y: -7 }),
    part('pr_laptop_lid', 'lid', 1, roundRect(240, 156, 8), '#2a2c34', { y: -90, rotation: -0.12 }),
    part('pr_laptop_screen', 'screen', 2, roundRect(214, 128, 4), '#5fa8ff', { y: -92, rotation: -0.12 }),
  ],
};

export const TABLET: PropDef = {
  id: 'prop.tablet',
  name: 'Tablet',
  description: 'Futuristic slab. Holographic interface surface.',
  tags: ['device', 'hand', 'medium'],
  pivot: CENTRE,
  defaultScale: 1,
  parts: [
    part('pr_tablet_body', 'body', 0, roundRect(180, 240, 12), '#22252e'),
    part('pr_tablet_screen', 'screen', 1, roundRect(162, 220, 8), '#1d2c52'),
    part('pr_tablet_ui', 'ui', 2, roundRect(120, 12, 6), '#6fd3ff', { y: 60 }),
    part('pr_tablet_ui2', 'ui', 3, roundRect(90, 12, 6), '#f2b33d', { y: 34 }),
    part('pr_tablet_ui3', 'ui', 4, roundRect(104, 12, 6), '#f2577f', { y: 8 }),
  ],
};

export const MICROPHONE: PropDef = {
  id: 'prop.microphone',
  name: 'Microphone',
  description: 'The object the whole show is about, eventually.',
  tags: ['music', 'held', 'hero'],
  pivot: BOTTOM,
  defaultScale: 1,
  parts: [
    part('pr_mic_body', 'body', 0, roundRect(26, 150, 10), '#2a2c34', { y: -75 }),
    part('pr_mic_grille', 'grille', 1, circle(34), '#4a4d57', { y: -160 }),
    part('pr_mic_mesh', 'grille', 2, circle(22), '#6b6f7a', { y: -160 }),
    part('pr_mic_band', 'body', 3, rect(28, 6), '#f2b33d', { y: -132 }),
  ],
};

export const HEADPHONES: PropDef = {
  id: 'prop.headphones',
  name: 'Headphones',
  description: 'Over-ear cans. Beat-matched to whatever is playing.',
  tags: ['music', 'worn', 'small'],
  pivot: CENTRE,
  defaultScale: 1,
  parts: [
    part('pr_hp_band', 'band', 0, polyline(
      [
        { x: -46, y: 6 },
        { x: -40, y: -26 },
        { x: 0, y: -38 },
        { x: 40, y: -26 },
        { x: 46, y: 6 },
      ],
      false,
    ), '#2a2c34'),
    part('pr_hp_cup_l', 'cup', 1, roundRect(22, 34, 9), '#3a3d47', { x: -48, y: 12 }),
    part('pr_hp_cup_r', 'cup', 1, roundRect(22, 34, 9), '#3a3d47', { x: 48, y: 12 }),
  ],
};

export const CUSHION: PropDef = {
  id: 'prop.cushion',
  name: 'Cushion',
  description: 'A cushion that has been sat on. Staging dressing.',
  tags: ['furniture', 'soft'],
  pivot: CENTRE,
  defaultScale: 1,
  parts: [
    part('pr_cushion', 'body', 0, roundRect(120, 44, 20), '#c94f3d', { rotation: -0.06 }),
  ],
};

export const FOOD_BOWL: PropDef = {
  id: 'prop.food_bowl',
  name: 'Food bowl',
  description: 'Late-night leftovers. Zanza City eats late.',
  tags: ['kitchen', 'food', 'small'],
  pivot: BOTTOM,
  defaultScale: 1,
  parts: [
    part('pr_bowl', 'body', 0, polyline(
      [
        { x: -46, y: 0 },
        { x: 46, y: 0 },
        { x: 30, y: 34 },
        { x: -30, y: 34 },
      ],
      true,
    ), '#d8d2c4', { y: -34 }),
    part('pr_bowl_food', 'food', 1, ellipse(38, 11), '#c96a2a', { y: -36 }),
  ],
};

export const PROPS: PropDef[] = [
  PHONE,
  MUG,
  LAPTOP,
  TABLET,
  MICROPHONE,
  HEADPHONES,
  CUSHION,
  FOOD_BOWL,
];
