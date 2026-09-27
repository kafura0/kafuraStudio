/**
 * THE ZANZA LOCATIONS.
 *
 * Each environment is a layered vector set plus the staging anchors that make
 * composition repeatable. An anchor is a named place a character can be put: bind
 * an actor to `nia.couch` and moving the anchor re-stages every scene bound to it.
 *
 * Zanza City is fictional. The architecture is an original Afrofuturist take —
 * dense mid-rise, satellite dishes, holo-billboards, evolved matatu transit — with
 * no reference to any real city, building, brand or business.
 */

import { circle, ellipse, polyline, rect, roundRect } from '../core/render/shapes';
import { transform } from '../core/types';
import type { AnchoredEnvPart, EnvLayer, EnvironmentDef, StagingAnchor } from '../core/types';
import { BOTTOM_PIVOT, CENTRE_PIVOT } from './envHelpers';

export const ENV_WIDTH = 1920;
export const ENV_HEIGHT = 1080;

function anchor(
  name: string,
  x: number,
  y: number,
  options: Partial<StagingAnchor> = {},
): StagingAnchor {
  return {
    id: `anchor.${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    name,
    x,
    y,
    scale: options.scale ?? 1,
    rotation: options.rotation ?? 0,
    flipX: options.flipX ?? false,
    facing: options.facing ?? 'right',
    kind: options.kind ?? 'stand',
    tags: options.tags ?? [],
  };
}

/* ================================================================== */
/* NIA'S APARTMENT — the primary set                                 */
/* ================================================================== */

const APARTMENT_FLOOR_Y = 760;

const apartmentBackLayer: EnvLayer = {
  id: 'env.apartment.back',
  name: 'Back wall, windows, screens',
  z: 0,
  parallax: 0.94,
  parts: [
    // Wall
    { shape: rect(ENV_WIDTH, 900), colorKey: '#2b2a3d', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 400 }) },
    // Wainscot
    { shape: rect(ENV_WIDTH, 90), colorKey: '#232234', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 720 }) },
    // Window: night sky of Zanza City
    { shape: roundRect(560, 400, 14), colorKey: '#0e1430', pivot: CENTRE_PIVOT, transform: transform({ x: 520, y: 330 }) },
    { shape: rect(16, 400), colorKey: '#3a3852', pivot: CENTRE_PIVOT, transform: transform({ x: 520, y: 330 }) },
    { shape: rect(560, 14), colorKey: '#3a3852', pivot: CENTRE_PIVOT, transform: transform({ x: 520, y: 330 }) },
    // Skyline behind the glass: distant towers with lit windows
    { shape: rect(80, 190), colorKey: '#1b2450', pivot: BOTTOM_PIVOT, transform: transform({ x: 300, y: 470 }) },
    { shape: rect(56, 260), colorKey: '#212c60', pivot: BOTTOM_PIVOT, transform: transform({ x: 400, y: 470 }) },
    { shape: rect(104, 150), colorKey: '#1b2450', pivot: BOTTOM_PIVOT, transform: transform({ x: 490, y: 470 }) },
    { shape: rect(46, 300), colorKey: '#253172', pivot: BOTTOM_PIVOT, transform: transform({ x: 580, y: 470 }) },
    { shape: rect(70, 210), colorKey: '#1b2450', pivot: BOTTOM_PIVOT, transform: transform({ x: 660, y: 470 }) },
    // Lit windows
    { shape: rect(7, 9), colorKey: '#f2c14e', pivot: BOTTOM_PIVOT, transform: transform({ x: 288, y: 430 }) },
    { shape: rect(7, 9), colorKey: '#f2c14e', pivot: BOTTOM_PIVOT, transform: transform({ x: 310, y: 400 }) },
    { shape: rect(7, 9), colorKey: '#8fd6ff', pivot: BOTTOM_PIVOT, transform: transform({ x: 392, y: 420 }) },
    { shape: rect(7, 9), colorKey: '#f2c14e', pivot: BOTTOM_PIVOT, transform: transform({ x: 574, y: 250 }) },
    { shape: rect(7, 9), colorKey: '#8fd6ff', pivot: BOTTOM_PIVOT, transform: transform({ x: 574, y: 300 }) },
    { shape: rect(7, 9), colorKey: '#f2c14e', pivot: BOTTOM_PIVOT, transform: transform({ x: 650, y: 380 }) },
    // A flying matatu crossing the skyline
    { shape: roundRect(70, 22, 10), colorKey: '#6fd3ff', pivot: CENTRE_PIVOT, transform: transform({ x: 470, y: 214 }) },
    { shape: polyline([{ x: -22, y: 0 }, { x: -6, y: -7 }], false), colorKey: '#6fd3ff', pivot: CENTRE_PIVOT, transform: transform({ x: 434, y: 214 }) },
    { shape: polyline([{ x: 22, y: 0 }, { x: 6, y: -7 }], false), colorKey: '#6fd3ff', pivot: CENTRE_PIVOT, transform: transform({ x: 506, y: 214 }) },
    // Wall screen: the show-within-the-show
    { shape: roundRect(300, 190, 8), colorKey: '#12131f', pivot: CENTRE_PIVOT, transform: transform({ x: 1180, y: 300 }) },
    { shape: roundRect(276, 166, 4), colorKey: '#1d2c52', pivot: CENTRE_PIVOT, transform: transform({ x: 1180, y: 300 }) },
    { shape: roundRect(180, 10, 5), colorKey: '#5fa8ff', pivot: CENTRE_PIVOT, transform: transform({ x: 1120, y: 260 }) },
    { shape: roundRect(120, 10, 5), colorKey: '#5fa8ff', pivot: CENTRE_PIVOT, transform: transform({ x: 1090, y: 282 }) },
    { shape: circle(20), colorKey: '#f2c14e', pivot: CENTRE_PIVOT, transform: transform({ x: 1250, y: 340 }) },
    // Framed art
    { shape: roundRect(110, 140, 6), colorKey: '#3a3852', pivot: CENTRE_PIVOT, transform: transform({ x: 1620, y: 330 }) },
    { shape: roundRect(92, 122, 4), colorKey: '#4d6a8a', pivot: CENTRE_PIVOT, transform: transform({ x: 1620, y: 330 }) },
    // Ceiling light strip
    { shape: rect(900, 12), colorKey: '#f2e8c9', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 46 }) },
  ],
};

const apartmentMidLayer: EnvLayer = {
  id: 'env.apartment.mid',
  name: 'Couch, table, kitchen',
  z: 10,
  parallax: 1,
  parts: [
    // Floor
    { shape: rect(ENV_WIDTH, 340), colorKey: '#1b1a28', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 860 }) },
    // Kitchen run, stage right
    { shape: rect(560, 250), colorKey: '#343249', pivot: CENTRE_PIVOT, transform: transform({ x: 1650, y: 660 }) },
    { shape: rect(560, 20), colorKey: '#43405a', pivot: CENTRE_PIVOT, transform: transform({ x: 1650, y: 540 }) },
    { shape: rect(150, 150), colorKey: '#3c3a52', pivot: CENTRE_PIVOT, transform: transform({ x: 1720, y: 300 }) },
    { shape: roundRect(132, 132, 6), colorKey: '#20283f', pivot: CENTRE_PIVOT, transform: transform({ x: 1720, y: 300 }) },
    // Couch, stage left. Seat height is what the `couch` anchors are built around.
    { shape: roundRect(700, 190, 34), colorKey: '#3d5a80', pivot: CENTRE_PIVOT, transform: transform({ x: 640, y: 700 }) },
    { shape: roundRect(700, 120, 30), colorKey: '#456a94', pivot: CENTRE_PIVOT, transform: transform({ x: 640, y: 592 }) },
    { shape: roundRect(150, 260, 30), colorKey: '#456a94', pivot: CENTRE_PIVOT, transform: transform({ x: 310, y: 660 }) },
    { shape: roundRect(150, 260, 30), colorKey: '#456a94', pivot: CENTRE_PIVOT, transform: transform({ x: 970, y: 660 }) },
    { shape: roundRect(700, 26, 12), colorKey: '#5a86b5', pivot: CENTRE_PIVOT, transform: transform({ x: 640, y: 600 }) },
    // Coffee table
    { shape: roundRect(320, 22, 8), colorKey: '#6b4a34', pivot: CENTRE_PIVOT, transform: transform({ x: 640, y: 830 }) },
    { shape: rect(18, 90), colorKey: '#4a3223', pivot: CENTRE_PIVOT, transform: transform({ x: 500, y: 874 }) },
    { shape: rect(18, 90), colorKey: '#4a3223', pivot: CENTRE_PIVOT, transform: transform({ x: 780, y: 874 }) },
    // Door, stage right, where Kito comes in
    { shape: roundRect(180, 330, 8), colorKey: '#4a3f33', pivot: CENTRE_PIVOT, transform: transform({ x: 1330, y: 600 }) },
    { shape: circle(9), colorKey: '#f2c14e', pivot: CENTRE_PIVOT, transform: transform({ x: 1250, y: 600 }) },
    // Mat by the door
    { shape: ellipse(90, 26), colorKey: '#2f5a4a', pivot: CENTRE_PIVOT, transform: transform({ x: 1330, y: 782 }) },
  ],
};

const apartmentFrontLayer: EnvLayer = {
  id: 'env.apartment.front',
  name: 'Plant, foreground clutter',
  z: 20,
  parallax: 1.08,
  parts: [
    { shape: roundRect(80, 90, 8), colorKey: '#7a4a30', pivot: CENTRE_PIVOT, transform: transform({ x: 1860, y: 930 }) },
    { shape: ellipse(60, 90), colorKey: '#2f6b3f', pivot: CENTRE_PIVOT, transform: transform({ x: 1860, y: 830 }) },
    { shape: ellipse(44, 70), colorKey: '#3a7d4c', pivot: CENTRE_PIVOT, transform: transform({ x: 1820, y: 860 }) },
    { shape: ellipse(40, 66), colorKey: '#356f47', pivot: CENTRE_PIVOT, transform: transform({ x: 1900, y: 856 }) },
  ],
};

export const NIA_APARTMENT: EnvironmentDef = {
  id: 'env.nia_apartment',
  name: "Nia's Apartment",
  description:
    'A Kilimani 2.0 smart apartment. Couch, coffee table, kitchen run, a wall screen, and a window onto the Zanza City skyline. The show\'s primary set.',
  tags: ['interior', 'primary', 'apartment'],
  width: ENV_WIDTH,
  height: ENV_HEIGHT,
  layers: [apartmentBackLayer, apartmentMidLayer, apartmentFrontLayer],
  anchors: [
    anchor('Nia_Couch', 560, 800, { kind: 'sit', facing: 'right', tags: ['seat', 'couch'] }),
    anchor('Nia_Couch_Right', 800, 800, { kind: 'sit', facing: 'right', tags: ['seat', 'couch'] }),
    anchor('Nia_Table', 700, 980, { kind: 'stand', facing: 'left', tags: ['table'] }),
    anchor('Nia_Kitchen', 1560, 880, { kind: 'stand', facing: 'right', tags: ['kitchen'] }),
    anchor('Kito_Door', 1330, 800, { kind: 'door', facing: 'left', tags: ['door', 'entrance'] }),
    anchor('Nia_Floor', 1080, 960, { kind: 'floor', facing: 'left', tags: ['floor'] }),
  ],
  lighting: {
    ambient: '#8f9ad6',
    overlayColor: '#f2b33d',
    vignette: 0.34,
  },
};

/* ================================================================== */
/* ZANZA STREET — the external city                                  */
/* ================================================================== */

const streetBackLayer: EnvLayer = {
  id: 'env.street.back',
  name: 'Night sky and towers',
  z: 0,
  parallax: 0.88,
  parts: [
    { shape: rect(ENV_WIDTH, 1080), colorKey: '#0b1026', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 540 }) },
    { shape: circle(46), colorKey: '#e8ecff', pivot: CENTRE_PIVOT, transform: transform({ x: 1560, y: 150 }) },
    { shape: circle(120), colorKey: 'rgba(232,236,255,0.10)', pivot: CENTRE_PIVOT, transform: transform({ x: 1560, y: 150 }) },
    // Far towers
    { shape: rect(200, 460), colorKey: '#141a3d', pivot: BOTTOM_PIVOT, transform: transform({ x: 180, y: 660 }) },
    { shape: rect(150, 560), colorKey: '#1a2249', pivot: BOTTOM_PIVOT, transform: transform({ x: 380, y: 660 }) },
    { shape: rect(240, 400), colorKey: '#141a3d', pivot: BOTTOM_PIVOT, transform: transform({ x: 620, y: 660 }) },
    { shape: rect(170, 600), colorKey: '#1d2652', pivot: BOTTOM_PIVOT, transform: transform({ x: 860, y: 660 }) },
    { shape: rect(220, 430), colorKey: '#141a3d', pivot: BOTTOM_PIVOT, transform: transform({ x: 1120, y: 660 }) },
    { shape: rect(160, 540), colorKey: '#1a2249', pivot: BOTTOM_PIVOT, transform: transform({ x: 1330, y: 660 }) },
    { shape: rect(260, 380), colorKey: '#141a3d', pivot: BOTTOM_PIVOT, transform: transform({ x: 1620, y: 660 }) },
    { shape: rect(190, 470), colorKey: '#1d2652', pivot: BOTTOM_PIVOT, transform: transform({ x: 1830, y: 660 }) },
    // Lit window grids
    ...litWindows(180, 660, 200, 460),
    ...litWindows(1330, 660, 160, 540),
    ...litWindows(380, 660, 150, 560),
    // Holo-billboard
    { shape: roundRect(280, 170, 12), colorKey: '#101733', pivot: CENTRE_PIVOT, transform: transform({ x: 640, y: 260 }) },
    { shape: roundRect(258, 148, 8), colorKey: '#2a1f5c', pivot: CENTRE_PIVOT, transform: transform({ x: 640, y: 260 }) },
    { shape: roundRect(160, 16, 8), colorKey: '#f2577f', pivot: CENTRE_PIVOT, transform: transform({ x: 596, y: 224 }) },
    { shape: roundRect(110, 16, 8), colorKey: '#6fd3ff', pivot: CENTRE_PIVOT, transform: transform({ x: 580, y: 256 }) },
  ],
};

const streetMidLayer: EnvLayer = {
  id: 'env.street.mid',
  name: 'Shops, matatu, signage',
  z: 10,
  parallax: 1,
  parts: [
    // Pavement
    { shape: rect(ENV_WIDTH, 420), colorKey: '#20202c', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 870 }) },
    { shape: rect(ENV_WIDTH, 16), colorKey: '#33333f', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 668 }) },
    // Shopfronts
    { shape: roundRect(300, 240, 10), colorKey: '#2a2438', pivot: CENTRE_PIVOT, transform: transform({ x: 260, y: 550 }) },
    { shape: roundRect(260, 200, 8), colorKey: '#3a2f4e', pivot: CENTRE_PIVOT, transform: transform({ x: 260, y: 550 }) },
    { shape: roundRect(200, 46, 10), colorKey: '#f2b33d', pivot: CENTRE_PIVOT, transform: transform({ x: 260, y: 418 }) },
    { shape: roundRect(300, 240, 10), colorKey: '#242b38', pivot: CENTRE_PIVOT, transform: transform({ x: 1780, y: 550 }) },
    { shape: roundRect(260, 200, 8), colorKey: '#2f3a4d', pivot: CENTRE_PIVOT, transform: transform({ x: 1780, y: 550 }) },
    { shape: roundRect(180, 46, 10), colorKey: '#3f9d6d', pivot: CENTRE_PIVOT, transform: transform({ x: 1780, y: 418 }) },
    // A matatu: the evolved transit staple, parked at the kerb
    { shape: roundRect(560, 250, 34), colorKey: '#c94f3d', pivot: CENTRE_PIVOT, transform: transform({ x: 1000, y: 560 }) },
    { shape: roundRect(200, 110, 14), colorKey: '#2c3a4f', pivot: CENTRE_PIVOT, transform: transform({ x: 880, y: 500 }) },
    { shape: roundRect(200, 110, 14), colorKey: '#2c3a4f', pivot: CENTRE_PIVOT, transform: transform({ x: 1100, y: 500 }) },
    { shape: roundRect(240, 54, 12), colorKey: '#f2e8c9', pivot: CENTRE_PIVOT, transform: transform({ x: 1000, y: 640 }) },
    { shape: circle(46), colorKey: '#15171d', pivot: CENTRE_PIVOT, transform: transform({ x: 810, y: 660 }) },
    { shape: circle(46), colorKey: '#15171d', pivot: CENTRE_PIVOT, transform: transform({ x: 1190, y: 660 }) },
    { shape: circle(18), colorKey: '#5a5f70', pivot: CENTRE_PIVOT, transform: transform({ x: 810, y: 660 }) },
    { shape: circle(18), colorKey: '#5a5f70', pivot: CENTRE_PIVOT, transform: transform({ x: 1190, y: 660 }) },
    // Road
    { shape: rect(ENV_WIDTH, 190), colorKey: '#15161f', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 1000 }) },
    { shape: rect(120, 12), colorKey: '#d8d2b8', pivot: CENTRE_PIVOT, transform: transform({ x: 300, y: 1000 }) },
    { shape: rect(120, 12), colorKey: '#d8d2b8', pivot: CENTRE_PIVOT, transform: transform({ x: 700, y: 1000 }) },
    { shape: rect(120, 12), colorKey: '#d8d2b8', pivot: CENTRE_PIVOT, transform: transform({ x: 1300, y: 1000 }) },
    { shape: rect(120, 12), colorKey: '#d8d2b8', pivot: CENTRE_PIVOT, transform: transform({ x: 1700, y: 1000 }) },
  ],
};

const streetFrontLayer: EnvLayer = {
  id: 'env.street.front',
  name: 'Kerb clutter',
  z: 20,
  parallax: 1.12,
  parts: [
    { shape: rect(90, 150), colorKey: '#2b2b36', pivot: BOTTOM_PIVOT, transform: transform({ x: 70, y: 1020 }) },
    { shape: circle(20), colorKey: '#3f3f4d', pivot: CENTRE_PIVOT, transform: transform({ x: 70, y: 872 }) },
    { shape: roundRect(70, 60, 8), colorKey: '#3a3a46', pivot: BOTTOM_PIVOT, transform: transform({ x: 1870, y: 1030 }) },
  ],
};

export const ZANZA_STREET: EnvironmentDef = {
  id: 'env.zanza_street',
  name: 'Zanza Street',
  description:
    'A Kilimani main road after dark. Mid-rise towers, holo-billboards, a matatu at the kerb, and the evolved transit that never stops.',
  tags: ['exterior', 'city', 'street', 'night'],
  width: ENV_WIDTH,
  height: ENV_HEIGHT,
  layers: [streetBackLayer, streetMidLayer, streetFrontLayer],
  anchors: [
    anchor('Nia_Street', 420, 900, { kind: 'stand', facing: 'right', tags: ['street'] }),
    anchor('Kito_Street', 700, 900, { kind: 'stand', facing: 'left', tags: ['street'] }),
    anchor('Street_Kerb', 1300, 900, { kind: 'stand', facing: 'left', tags: ['street'] }),
    anchor('Street_Door', 260, 880, { kind: 'door', facing: 'right', tags: ['door'] }),
  ],
  lighting: {
    ambient: '#7f8ad0',
    overlayColor: '#f2577f',
    vignette: 0.42,
  },
};

/* ================================================================== */
/* ZANZA LOUNGE — the recurring social location                       */
/* ================================================================== */

const loungeBackLayer: EnvLayer = {
  id: 'env.lounge.back',
  name: 'Back wall, bottle shelf',
  z: 0,
  parallax: 0.92,
  parts: [
    { shape: rect(ENV_WIDTH, 900), colorKey: '#1c1526', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 400 }) },
    { shape: roundRect(900, 240, 16), colorKey: '#2a1f38', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 320 }) },
    { shape: rect(860, 12), colorKey: '#6b4a86', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 420 }) },
    { shape: rect(860, 12), colorKey: '#6b4a86', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 250 }) },
    // Bottles
    { shape: rect(18, 54), colorKey: '#3f9d6d', pivot: BOTTOM_PIVOT, transform: transform({ x: 600, y: 414 }) },
    { shape: rect(18, 54), colorKey: '#c94f3d', pivot: BOTTOM_PIVOT, transform: transform({ x: 640, y: 414 }) },
    { shape: rect(18, 54), colorKey: '#f2b33d', pivot: BOTTOM_PIVOT, transform: transform({ x: 680, y: 414 }) },
    { shape: rect(18, 54), colorKey: '#6fd3ff', pivot: BOTTOM_PIVOT, transform: transform({ x: 720, y: 414 }) },
    { shape: rect(18, 54), colorKey: '#3f9d6d', pivot: BOTTOM_PIVOT, transform: transform({ x: 1160, y: 414 }) },
    { shape: rect(18, 54), colorKey: '#c94f3d', pivot: BOTTOM_PIVOT, transform: transform({ x: 1200, y: 414 }) },
    { shape: rect(18, 54), colorKey: '#f2b33d', pivot: BOTTOM_PIVOT, transform: transform({ x: 1240, y: 414 }) },
    { shape: rect(18, 54), colorKey: '#6fd3ff', pivot: BOTTOM_PIVOT, transform: transform({ x: 1280, y: 414 }) },
    // Neon sign
    { shape: roundRect(320, 100, 20), colorKey: '#2a1f38', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 620 }) },
    { shape: roundRect(280, 24, 12), colorKey: '#f2577f', pivot: CENTRE_PIVOT, transform: transform({ x: 900, y: 600 }) },
    { shape: roundRect(190, 24, 12), colorKey: '#6fd3ff', pivot: CENTRE_PIVOT, transform: transform({ x: 1030, y: 640 }) },
    { shape: rect(ENV_WIDTH, 200), colorKey: '#141020', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 900 }) },
  ],
};

const loungeMidLayer: EnvLayer = {
  id: 'env.lounge.mid',
  name: 'Bar, stools, tables',
  z: 10,
  parallax: 1,
  parts: [
    { shape: rect(ENV_WIDTH, 130), colorKey: '#2f2440', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 735 }) },
    { shape: rect(ENV_WIDTH, 26), colorKey: '#6b4a86', pivot: CENTRE_PIVOT, transform: transform({ x: 960, y: 676 }) },
    // Stools
    { shape: roundRect(90, 22, 8), colorKey: '#8a5a3a', pivot: CENTRE_PIVOT, transform: transform({ x: 700, y: 800 }) },
    { shape: rect(16, 70), colorKey: '#5a3a24', pivot: CENTRE_PIVOT, transform: transform({ x: 700, y: 846 }) },
    { shape: roundRect(90, 22, 8), colorKey: '#8a5a3a', pivot: CENTRE_PIVOT, transform: transform({ x: 880, y: 800 }) },
    { shape: rect(16, 70), colorKey: '#5a3a24', pivot: CENTRE_PIVOT, transform: transform({ x: 880, y: 846 }) },
    { shape: roundRect(90, 22, 8), colorKey: '#8a5a3a', pivot: CENTRE_PIVOT, transform: transform({ x: 1060, y: 800 }) },
    { shape: rect(16, 70), colorKey: '#5a3a24', pivot: CENTRE_PIVOT, transform: transform({ x: 1060, y: 846 }) },
    // Lounge tables
    { shape: ellipse(110, 30), colorKey: '#3f9d6d', pivot: CENTRE_PIVOT, transform: transform({ x: 330, y: 880 }) },
    { shape: rect(18, 90), colorKey: '#2a5a44', pivot: CENTRE_PIVOT, transform: transform({ x: 330, y: 936 }) },
    { shape: ellipse(110, 30), colorKey: '#c94f3d', pivot: CENTRE_PIVOT, transform: transform({ x: 1620, y: 880 }) },
    { shape: rect(18, 90), colorKey: '#7d2f24', pivot: CENTRE_PIVOT, transform: transform({ x: 1620, y: 936 }) },
  ],
};

const loungeFrontLayer: EnvLayer = {
  id: 'env.lounge.front',
  name: 'Foreground booth',
  z: 20,
  parallax: 1.1,
  parts: [
    { shape: roundRect(700, 300, 30), colorKey: '#241a30', pivot: CENTRE_PIVOT, transform: transform({ x: 400, y: 960 }) },
    { shape: roundRect(700, 90, 26), colorKey: '#2e2140', pivot: CENTRE_PIVOT, transform: transform({ x: 400, y: 810 }) },
  ],
};

export const ZANZA_LOUNGE: EnvironmentDef = {
  id: 'env.zanza_lounge',
  name: 'Zanza Lounge',
  description:
    'The recurring social set. A bottle-lined bar, stools, small tables, and a booth in the foreground. Where deals get made and friendships get tested.',
  tags: ['interior', 'social', 'nightlife', 'recurring'],
  width: ENV_WIDTH,
  height: ENV_HEIGHT,
  layers: [loungeBackLayer, loungeMidLayer, loungeFrontLayer],
  anchors: [
    anchor('Nia_Bar', 700, 860, { kind: 'sit', facing: 'right', tags: ['bar', 'seat'] }),
    anchor('Kito_Bar', 880, 860, { kind: 'sit', facing: 'right', tags: ['bar', 'seat'] }),
    anchor('Lounge_Table', 330, 950, { kind: 'stand', facing: 'right', tags: ['table'] }),
    anchor('Lounge_Floor', 1400, 960, { kind: 'floor', facing: 'left', tags: ['floor'] }),
  ],
  lighting: {
    ambient: '#a678d8',
    overlayColor: '#f2577f',
    vignette: 0.5,
  },
};

export const ENVIRONMENTS: EnvironmentDef[] = [NIA_APARTMENT, ZANZA_STREET, ZANZA_LOUNGE];

/** A grid of lit windows on a tower face. Deterministic, so the set is stable. */
function litWindows(x: number, baseY: number, w: number, h: number): AnchoredEnvPart[] {
  const parts: AnchoredEnvPart[] = [];
  const cols = Math.max(2, Math.floor(w / 34));
  const rows = Math.max(3, Math.floor(h / 46));
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      // A cheap deterministic hash keeps the grid irregular without randomness, so
      // the set looks the same on every load.
      const hash = (c * 31 + r * 17 + Math.round(x)) % 7;
      if (hash > 3) continue;
      const colour = hash === 0 ? '#8fd6ff' : hash === 1 ? '#f2c14e' : '#ffe9a8';
      parts.push({
        shape: rect(12, 16),
        colorKey: colour,
        pivot: CENTRE_PIVOT,
        transform: {
          x: x - w / 2 + 24 + c * 34,
          y: baseY - 30 - r * 46,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          alpha: 1,
        },
      });
    }
  }
  return parts;
}

export { APARTMENT_FLOOR_Y };
