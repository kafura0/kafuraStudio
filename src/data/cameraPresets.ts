/**
 * ZANZA's shot vocabulary.
 *
 * Generic production framings, not show canon. A preset here is a starting point the
 * user overrides by dragging the numbers, which is why the set is small and the names
 * are the vocabulary a storyboard artist would already use. Nothing in `src/core`
 * refers to any of this.
 *
 * All of these are composed for the 1920x1080 stage the project ships at, so `x` and
 * `y` are that frame's centre line and `zoom` is relative to it. A zoom below 1 shows
 * more than the authored frame, which the renderer letterboxes: only "Wide two-shot"
 * goes under, and only to give two performers air around them. Everything else sits at
 * or above 1 so a preset does not reveal area an artist did not draw.
 */

import { createCameraPreset } from '../core/document/factories';
import { ENV_HEIGHT, ENV_WIDTH } from './environments';
import type { CameraPreset } from '../core/types';

const CENTRE_X = ENV_WIDTH / 2;
const CENTRE_Y = ENV_HEIGHT / 2;
const STAGE = { width: ENV_WIDTH, height: ENV_HEIGHT };

export const CAMERA_PRESETS: CameraPreset[] = [
  createCameraPreset(
    'Establishing',
    { x: CENTRE_X, y: CENTRE_Y, zoom: 1, rotation: 0 },
    {
      id: 'camp.establishing',
      description: 'The whole set, unzoomed. Where are we?',
      tags: ['wide', 'establishing'],
      authoredFor: STAGE,
    },
  ),
  createCameraPreset(
    'Wide two-shot',
    { x: CENTRE_X, y: CENTRE_Y, zoom: 0.92, rotation: 0 },
    {
      id: 'camp.wide_two_shot',
      description: 'Both performers, a little air around them.',
      tags: ['wide', 'two-shot'],
      authoredFor: STAGE,
    },
  ),
  createCameraPreset(
    'Medium',
    { x: CENTRE_X, y: CENTRE_Y, zoom: 1.5, rotation: 0 },
    {
      id: 'camp.medium',
      description: 'Waist up. The workhorse framing for dialogue.',
      tags: ['medium', 'dialogue'],
      authoredFor: STAGE,
    },
  ),
  createCameraPreset(
    'Close-up',
    { x: CENTRE_X, y: 520, zoom: 2.6, rotation: 0 },
    {
      id: 'camp.close_up',
      description: 'Head and shoulders. A reaction, a beat, a reveal.',
      tags: ['close-up', 'reaction'],
      authoredFor: STAGE,
    },
  ),
  createCameraPreset(
    'Insert',
    { x: CENTRE_X, y: 700, zoom: 3.2, rotation: 0 },
    {
      id: 'camp.insert',
      description: 'Low and tight on a prop — a mug, a phone, a hand.',
      tags: ['insert', 'prop'],
      authoredFor: STAGE,
    },
  ),
  createCameraPreset(
    'High angle',
    { x: CENTRE_X, y: 420, zoom: 1.6, rotation: 0 },
    {
      id: 'camp.high_angle',
      description: 'Looking down. Someone is smaller than they want to be.',
      tags: ['high', 'angle'],
      authoredFor: STAGE,
    },
  ),
  createCameraPreset(
    'Low angle',
    { x: CENTRE_X, y: 660, zoom: 1.6, rotation: 0 },
    {
      id: 'camp.low_angle',
      description: 'Looking up. Someone is about to be a problem.',
      tags: ['low', 'angle'],
      authoredFor: STAGE,
    },
  ),
  createCameraPreset(
    'Dutch tilt',
    { x: CENTRE_X, y: CENTRE_Y, zoom: 1.4, rotation: 0.14 },
    {
      id: 'camp.dutch_tilt',
      description: 'Eight degrees off level. Something is already wrong.',
      tags: ['tilt', 'unsettled'],
      authoredFor: STAGE,
    },
  ),
];
