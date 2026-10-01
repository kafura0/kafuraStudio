/**
 * THE STARTER LIBRARY.
 *
 * A project created in the browser has to be usable, and "valid" is not the same as
 * "usable". The project invariant requires a character and an environment the moment a
 * project holds a scene, and there is no asset-authoring UI in this phase, so a strictly
 * empty project is a document the user can open, name, and stare at with no way forward.
 *
 * So a new project starts with the smallest set that renders: one neutral environment, one
 * neutral character, the one pose and one expression it needs to be stageable, and one
 * declared audio slot. That is five entries, all of them deliberately anonymous.
 *
 * This is a technical scaffold, not ZANZA canon (RULE 13). Nothing here is a character, a
 * location, or a story beat: the names are "Environment 1" and "Character 1", the palette
 * is flat greys, and the environment is a wall and a floor. It exists so that "New
 * project" is a button that leads somewhere. Replacing it with real art is the user's job,
 * through the ordinary asset path.
 *
 * The rig is the same shared human template the cast uses, so the pose and expression
 * libraries work on the starter character exactly as they do on Nia. A bespoke
 * one-part rig here would have made the starter the one character in the product that no
 * shared pose could animate.
 */

import { rect } from '../core/render/shapes';
import { transform } from '../core/types';
import type {
  AssetLibrary,
  AudioDef,
  CharacterDef,
  EnvironmentDef,
  ExpressionDef,
  PoseDef,
} from '../core/types';
import { buildHumanRig, proportions } from './rig';

const STARTER_WIDTH = 1920;
const STARTER_HEIGHT = 1080;
const FLOOR_Y = 820;

const STARTER_PALETTE = {
  skin: '#9a9aa2',
  skinShade: '#86868e',
  hair: '#4a4a52',
  brow: '#3c3c44',
  eye: '#2a2a30',
  mouth: '#7a5a5a',
  top: '#6b7280',
  bottom: '#4b5563',
  shoe: '#374151',
  accent: '#9ca3af',
} as const;

/**
 * A wall, a floor, and a stand anchor.
 *
 * The anchor is the part that matters: it is what makes the character placeable, and a
 * scene with no anchor cannot be staged by anything that looks for one.
 */
export const STARTER_ENVIRONMENT: EnvironmentDef = {
  id: 'env.starter',
  name: 'Environment 1',
  description: 'An empty room. Replace it, or duplicate it and start building from here.',
  tags: ['starter'],
  width: STARTER_WIDTH,
  height: STARTER_HEIGHT,
  lighting: { ambient: '#ffffff', overlayColor: null, vignette: 0 },
  layers: [
    {
      id: 'env.starter.back',
      name: 'Back',
      z: 0,
      parallax: 1,
      parts: [
        { shape: rect(STARTER_WIDTH, STARTER_HEIGHT), colorKey: '#2a2a31', pivot: { x: 0, y: 0 }, transform: transform({ x: STARTER_WIDTH / 2, y: STARTER_HEIGHT / 2 }) },
        { shape: rect(STARTER_WIDTH, 260), colorKey: '#22222a', pivot: { x: 0, y: 0 }, transform: transform({ x: STARTER_WIDTH / 2, y: FLOOR_Y + 130 }) },
      ],
    },
  ],
  anchors: [
    {
      id: 'env.starter.anchor.centre',
      name: 'Centre',
      x: STARTER_WIDTH / 2,
      y: FLOOR_Y,
      scale: 1,
      rotation: 0,
      flipX: false,
      facing: 'right',
      kind: 'stand',
      tags: ['starter'],
    },
  ],
};

/** The starter pose: the rig's own rest values, which is what `slots: {}` means. */
export const STARTER_POSE: PoseDef = {
  id: 'pose.starter',
  name: 'Standing',
  description: 'Neutral rest stance. The rig default, authored as a pose so it can be replaced.',
  tags: ['neutral', 'starter'],
  slots: {},
};

/** The starter expression, for the same reason. */
export const STARTER_EXPRESSION: ExpressionDef = {
  id: 'expr.starter',
  name: 'Neutral',
  description: 'The resting face. The rig default, authored as an expression so it can be replaced.',
  tags: ['neutral', 'starter'],
  slots: {},
};

export const STARTER_CHARACTER: CharacterDef = {
  id: 'char.starter',
  name: 'Character 1',
  description: 'A placeholder on the shared human rig. Give it a palette and a name.',
  tags: ['starter'],
  height: 640,
  palette: { ...STARTER_PALETTE },
  rig: buildHumanRig(proportions(640, 'average'), { hairStyle: 'bald' }),
  defaultPoseId: STARTER_POSE.id,
  defaultExpressionId: STARTER_EXPRESSION.id,
};

/**
 * The starter audio slot.
 *
 * Declared, and empty on purpose: `src: null` is the honest state of a slot that has no
 * file yet, and the panel reports it as "no recording" rather than pretending a voice
 * exists (RULE 9). It is here so the attach workflow has something to attach *to* in a
 * brand new project — a slot you must author before you can record it is a dead end in a
 * project with no asset editor.
 *
 * The duration is 0 for the same reason `src` is null: a slot that claims a length it
 * cannot back would be cut silent by `audioPlan` and then read as a broken file. The real
 * length arrives with the file, from the decode probe.
 */
export const STARTER_AUDIO: AudioDef = {
  id: 'audio.starter',
  name: 'Audio 1',
  kind: 'ambience',
  src: null,
  srcKind: null,
  duration: 0,
  tags: ['starter'],
};

/**
 * A fresh, empty library holding the starter set.
 *
 * Built on `emptyAssetLibrary` rather than on the seed so a new project cannot inherit a
 * single piece of ZANZA canon by accident, and so "New project" is reproducible.
 */
export function starterAssetLibrary(): AssetLibrary {
  return {
    characters: [STARTER_CHARACTER],
    environments: [STARTER_ENVIRONMENT],
    poses: [STARTER_POSE],
    expressions: [STARTER_EXPRESSION],
    props: [],
    audio: [STARTER_AUDIO],
  };
}
