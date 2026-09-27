/**
 * The reusable POSE library.
 *
 * A pose is a partial map of rig slot -> override. Because the slots are free-form
 * strings produced by the rig builder, every pose here works on every humanoid
 * character in the cast. That reuse is the production advantage: write `sitting`
 * once, stage any character on any couch.
 *
 * Rotation is in radians and ADDITIVE to the rig's rest rotation. In the rig's local
 * space a limb pointing straight down is rotation 0, so a positive rotation swings it
 * forward (+x) for a character facing right.
 */

import type { PoseDef } from '../core/types';

const PI = Math.PI;

export const POSES: PoseDef[] = [
  {
    id: 'pose.standing',
    name: 'Standing',
    description: 'Neutral rest stance, weight even. The base for most dialogue.',
    tags: ['neutral', 'default'],
    slots: {},
  },
  {
    id: 'pose.standingIdle',
    name: 'Standing (idle)',
    description: 'A slight contrapposto so a still character is not a statue.',
    tags: ['idle', 'standing'],
    slots: {
      thighL: { rotation: 0.04 },
      thighR: { rotation: -0.03 },
      armL: { rotation: 0.1 },
      armR: { rotation: 0.06 },
      head: { rotation: -0.02 },
    },
  },
  {
    id: 'pose.sitting',
    name: 'Sitting',
    description: 'Thighs forward, shins down. Requires a seat-height staging anchor.',
    tags: ['sit', 'seated', 'default'],
    slots: {
      thighL: { rotation: PI / 2 },
      thighR: { rotation: PI / 2 - 0.04 },
      shinL: { rotation: -PI / 2 + 0.05 },
      shinR: { rotation: -PI / 2 },
      footL: { rotation: -0.25 },
      footR: { rotation: -0.25 },
      armL: { rotation: 0.55 },
      armR: { rotation: 0.5 },
      torso: { rotation: -0.03 },
    },
  },
  {
    id: 'pose.sittingSofa',
    name: 'Sitting (sofa)',
    description: 'Sitting, slouched back into the couch. The Rent Is Due Nia.',
    tags: ['sit', 'seated', 'sofa'],
    slots: {
      thighL: { rotation: PI / 2 - 0.12 },
      thighR: { rotation: PI / 2 - 0.16 },
      shinL: { rotation: -PI / 2 + 0.28 },
      shinR: { rotation: -PI / 2 + 0.22 },
      footL: { rotation: -0.3 },
      footR: { rotation: -0.3 },
      armL: { rotation: 0.85 },
      forearmL: { rotation: -1.25 },
      armR: { rotation: 0.7 },
      forearmR: { rotation: -1.05 },
      torso: { rotation: -0.07, y: 14 },
      head: { rotation: 0.04 },
    },
  },
  {
    id: 'pose.walking',
    name: 'Walking',
    description: 'Mid-stride, opposed limbs. Pair with a position keyframe track to travel.',
    tags: ['locomotion', 'moving'],
    slots: {
      thighL: { rotation: 0.42 },
      shinL: { rotation: -0.28 },
      thighR: { rotation: -0.38 },
      shinR: { rotation: 0.36 },
      armL: { rotation: -0.34 },
      forearmL: { rotation: -0.2 },
      armR: { rotation: 0.3 },
      forearmR: { rotation: -0.28 },
      torso: { rotation: 0.03 },
    },
  },
  {
    id: 'pose.pointing',
    name: 'Pointing',
    description: 'Near arm extended forward. The accusation pose.',
    tags: ['gesture', 'accuse'],
    slots: {
      armL: { rotation: -1.42 },
      forearmL: { rotation: 0.16 },
      armR: { rotation: 0.2 },
      torso: { rotation: 0.05 },
      head: { rotation: 0.04 },
    },
  },
  {
    id: 'pose.armsCrossed',
    name: 'Arms crossed',
    description: 'Closed, unimpressed, waiting for you to explain yourself.',
    tags: ['stance', 'closed'],
    slots: {
      armL: { rotation: 1.15 },
      forearmL: { rotation: -2.0 },
      armR: { rotation: 0.95 },
      forearmR: { rotation: -2.25 },
      torso: { rotation: 0.02 },
    },
  },
  {
    id: 'pose.handsOnHips',
    name: 'Hands on hips',
    description: 'Expectant, impatient, or about to deliver bad news.',
    tags: ['stance', 'open'],
    slots: {
      armL: { rotation: 0.62 },
      forearmL: { rotation: -1.72 },
      armR: { rotation: 2.5 },
      forearmR: { rotation: -1.72 },
      torso: { rotation: 0 },
    },
  },
  {
    id: 'pose.holdingPhone',
    name: 'Holding phone',
    description: 'Both hands forward around a device, head tipped down at the screen.',
    tags: ['prop', 'device'],
    slots: {
      armL: { rotation: 0.78 },
      forearmL: { rotation: -1.62 },
      armR: { rotation: 0.72 },
      forearmR: { rotation: -1.7 },
      head: { rotation: 0.2 },
      torso: { rotation: 0.05 },
    },
  },
  {
    id: 'pose.talking',
    name: 'Talking',
    description: 'One hand out, mid-gesture. The default delivery pose for a line.',
    tags: ['dialogue', 'default', 'gesture'],
    slots: {
      armR: { rotation: 0.52 },
      forearmR: { rotation: -0.95 },
      armL: { rotation: 0.18 },
      torso: { rotation: 0.02 },
    },
  },
  {
    id: 'pose.laughing',
    name: 'Laughing',
    description: 'Leaned back, near arm up.',
    tags: ['reaction', 'positive'],
    slots: {
      torso: { rotation: -0.1 },
      head: { rotation: -0.18 },
      armL: { rotation: 0.95 },
      forearmL: { rotation: -1.5 },
      armR: { rotation: 0.2 },
      thighL: { rotation: 0.06 },
      thighR: { rotation: -0.05 },
    },
  },
  {
    id: 'pose.arguing',
    name: 'Arguing',
    description: 'Both hands up, leaning in. Volume with posture.',
    tags: ['reaction', 'conflict'],
    slots: {
      armL: { rotation: -1.05 },
      forearmL: { rotation: -0.35 },
      armR: { rotation: -0.85 },
      forearmR: { rotation: -0.45 },
      torso: { rotation: -0.05 },
      head: { rotation: 0.08 },
    },
  },
  {
    id: 'pose.shocked',
    name: 'Shocked',
    description: 'Thrown back, arms away from the body.',
    tags: ['reaction', 'surprise'],
    slots: {
      torso: { rotation: -0.12 },
      head: { rotation: -0.06 },
      armL: { rotation: -0.75 },
      forearmL: { rotation: -0.5 },
      armR: { rotation: -0.62 },
      forearmR: { rotation: -0.55 },
      thighL: { rotation: -0.12 },
      thighR: { rotation: 0.14 },
    },
  },
  {
    id: 'pose.thinking',
    name: 'Thinking',
    description: 'Near hand up to the chin, looking away.',
    tags: ['stance', 'contemplative'],
    slots: {
      armL: { rotation: 0.95 },
      forearmL: { rotation: -2.5 },
      handL: { rotation: 0.2 },
      head: { rotation: 0.16 },
      torso: { rotation: 0.04 },
    },
  },
  {
    id: 'pose.walkingIn',
    name: 'Walking in',
    description: 'Striding forward with intent. For a character entering on a door anchor.',
    tags: ['locomotion', 'entrance'],
    slots: {
      thighL: { rotation: 0.55 },
      shinL: { rotation: -0.42 },
      thighR: { rotation: -0.5 },
      shinR: { rotation: 0.5 },
      armL: { rotation: -0.42 },
      forearmL: { rotation: -0.24 },
      armR: { rotation: 0.38 },
      forearmR: { rotation: -0.34 },
      torso: { rotation: 0.05 },
    },
  },
];
