/**
 * THE ZANZA CAST.
 *
 * Four recurring characters, each a data structure built from the shared rig
 * template. No character's name appears anywhere in `src/core/` or `src/ui/` —
 * the renderer and the editor only ever see ids (AGENTS.md RULE 3).
 *
 * Proportions carry most of the character: Nia is slight, Kito is tall and
 * long-limbed and slightly awkward, Mama Nia is shorter and broader, and the
 * Landlord is heavy and unimpressed. Palettes do the rest.
 */

import type { CharacterDef } from '../core/types';
import { buildHumanRig, proportions } from './rig';

export const NIA: CharacterDef = {
  id: 'char.nia',
  name: 'Nia',
  description:
    '23. Aspiring musician and creator in Kilimani 2.0. Witty, ambitious, impulsive, and privately terrified of failing at the thing she says she has handled.',
  tags: ['protagonist', 'musician', 'creator', 'young-adult'],
  height: 640,
  palette: {
    skin: '#8d5524',
    skinShade: '#7a4720',
    hair: '#241a16',
    brow: '#2b1d18',
    eye: '#1a1210',
    mouth: '#5c2a24',
    top: '#e8574a',
    bottom: '#2f3a4d',
    shoe: '#1b1f27',
    accent: '#f2b33d',
  },
  rig: buildHumanRig(proportions(640, 'slim'), { hairStyle: 'locs' }),
  defaultPoseId: 'pose.standing',
  mouthSlot: 'mouth',
  defaultExpressionId: 'expr.neutral',
};

export const KITO: CharacterDef = {
  id: 'char.kito',
  name: 'Kito',
  description:
    "Nia's closest friend. An ambitious hustler with relentless, doomed business ideas, who is most confident exactly when he is most wrong. \"I have a plan.\"",
  tags: ['friend', 'hustler', 'comedy-engine', 'young-adult'],
  height: 680,
  palette: {
    skin: '#6b4423',
    skinShade: '#59371c',
    hair: '#15100e',
    brow: '#1a1310',
    eye: '#140f0d',
    mouth: '#4a221d',
    top: '#3f9d6d',
    bottom: '#243447',
    shoe: '#15181d',
    accent: '#6fd3ff',
  },
  rig: buildHumanRig(proportions(680, 'average', { armLength: 680 * 0.4 }), { hairStyle: 'short' }),
  defaultPoseId: 'pose.standing',
  mouthSlot: 'mouth',
  defaultExpressionId: 'expr.neutral',
};

export const MAMA_NIA: CharacterDef = {
  id: 'char.mama_nia',
  name: 'Mama Nia',
  description:
    "Nia's mother. Loves her completely and does not fully trust her unconventional career. Generational expectation, played with warmth rather than as a caricature.",
  tags: ['family', 'parent', 'warm'],
  height: 580,
  palette: {
    skin: '#7d4a24',
    skinShade: '#6a3d1d',
    hair: '#1d1512',
    brow: '#241a16',
    eye: '#171010',
    mouth: '#542823',
    top: '#b8623c',
    bottom: '#3b3550',
    shoe: '#1b1a20',
    accent: '#e8c26a',
  },
  rig: buildHumanRig(proportions(580, 'broad', { headRadius: 580 * 0.096 }), { hairStyle: 'bun' }),
  defaultPoseId: 'pose.standing',
  mouthSlot: 'mouth',
  defaultExpressionId: 'expr.neutral',
};

export const THE_LANDLORD: CharacterDef = {
  id: 'char.landlord',
  name: 'The Landlord',
  description:
    'Obsessed with rent, rules, and extracting money from tenants. Operates in a futuristic city with the exact methods of a traditional landlord — that contrast is the joke, and the character.',
  tags: ['authority', 'comedy-engine', 'landlord'],
  height: 600,
  palette: {
    skin: '#5e3a1f',
    skinShade: '#4d2f19',
    hair: '#2b2622',
    brow: '#2b2622',
    eye: '#141210',
    mouth: '#46201c',
    top: '#4a4f6b',
    bottom: '#22242e',
    shoe: '#101216',
    accent: '#c9a227',
  },
  rig: buildHumanRig(proportions(600, 'broad', { headRadius: 600 * 0.09, limbThickness: 600 * 0.05 }), {
    hairStyle: 'bald',
  }),
  defaultPoseId: 'pose.standing',
  mouthSlot: 'mouth',
  defaultExpressionId: 'expr.deadpan',
};

export const CHARACTERS: CharacterDef[] = [NIA, KITO, MAMA_NIA, THE_LANDLORD];
