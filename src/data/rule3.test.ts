/**
 * RULE 3 — NIA IS NOT SPECIAL.
 *
 * The load-bearing test of the whole architecture. If adding a character requires
 * any change to `core/`, the design has failed.
 *
 * This test defines a brand-new character inline, drops it into the real EP001
 * production project, animates it and renders it. If it ever needs a code change
 * to pass, the generic system has started special-casing content.
 */

import { describe, expect, it } from 'vitest';
import { addSceneToEpisode, createSceneInProject } from '../core/document/projectOps';
import { placeCharacter, setActorExpression, setActorPose } from '../core/document/sceneOps';
import { addKeyframe, addSimpleClip } from '../core/document/trackOps';
import { sampleSceneTarget } from '../core/animation/sample';
import { buildHumanRig, proportions } from './rig';
import type { CharacterDef, Project, Scene } from '../core/types';
import { RecordingContext } from '../test/recordingContext';
import { renderScene } from '../core/render/render';
import { validateProject } from '../core/document/invariants';
import { resolveAssets } from '../core/document/scopes';
import { SEED_PROJECT, SEED_SERIES } from './seed';

const SYNTHETIC_SKIN = '#c98a5b';

/** A character that appears nowhere in src/data. */
function makeSyntheticCharacter(): CharacterDef {
  return {
    id: 'char.synthetic_tester',
    name: 'Synthetic Tester',
    description: 'A throwaway character used only by this test.',
    tags: ['test'],
    height: 620,
    palette: {
      skin: SYNTHETIC_SKIN,
      skinShade: '#a9703f',
      hair: '#2b2118',
      brow: '#1a1210',
      eye: '#15100e',
      mouth: '#4a201c',
      top: '#2f6f4f',
      bottom: '#26303f',
      shoe: '#15181d',
      accent: '#f2b33d',
    },
    rig: buildHumanRig(proportions(620, 'broad'), { hairStyle: 'bun' }),
    defaultPoseId: 'pose.standing',
    mouthSlot: 'mouth',
    defaultExpressionId: 'expr.neutral',
  };
}

const CHARACTER = makeSyntheticCharacter();
const ENVIRONMENT_ID = SEED_PROJECT.assets.environments[0]?.id ?? '';

/**
 * The seed project with one unknown character added, standing in a fresh scene and
 * animating. Only `add*` document operations are used — exactly what a user or a
 * future import path would do.
 */
function stageSynthetic(): {
  project: Project;
  scene: Scene;
  actorId: string;
  trackId: string;
  clipId: string;
} {
  const withCharacter: Project = {
    ...SEED_PROJECT,
    assets: { ...SEED_PROJECT.assets, characters: [...SEED_PROJECT.assets.characters, CHARACTER] },
  };

  // Resolved rather than read off the project, because this character is an *override* on
  // top of a series library rather than the whole library: the scene needs both this
  // character and the environment the series already owns.
  const created = createSceneInProject(withCharacter, resolveAssets(withCharacter, SEED_SERIES).assets, {
    name: 'Synthetic scene',
    environmentId: ENVIRONMENT_ID,
    duration: 4,
  });
  let project = created.project;
  const { sceneId } = created;

  const placed = placeCharacter(project, sceneId, CHARACTER, { x: 400, y: 900, scaleX: 1, scaleY: 1 });
  project = placed.project;
  project = setActorPose(project, sceneId, placed.actorId, 'pose.standing');
  project = setActorExpression(project, sceneId, placed.actorId, 'expr.happy');

  const clip = addSimpleClip(project, sceneId, 'actor', placed.actorId, CHARACTER.name, 0, 4);
  project = addKeyframe(clip.project, sceneId, clip.trackId, clip.clipId, 0, {
    x: 400,
    alpha: 0,
    rotation: 0,
  });
  project = addKeyframe(project, sceneId, clip.trackId, clip.clipId, 2, {
    x: 1200,
    alpha: 1,
    rotation: 0.4,
  });

  project = addSceneToEpisode(project, project.episodes[0]?.id ?? '', sceneId);

  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('scene was not created');
  return { project, scene, actorId: placed.actorId, trackId: clip.trackId, clipId: clip.clipId };
}

describe('RULE 3 — a new character needs no core changes', () => {
  it('keeps the whole project valid', () => {
    const { project } = stageSynthetic();
    expect(validateProject(project)).toEqual([]);
  });

  it('reuses the shared pose and expression libraries by id', () => {
    const { scene, actorId } = stageSynthetic();
    const actor = scene.actors.find((a) => a.id === actorId);
    expect(actor?.poseId).toBe('pose.standing');
    expect(actor?.expressionId).toBe('expr.happy');
    // The scene must reference the library, never embed a copy of the rig.
    expect(JSON.stringify(actor)).not.toContain('p_head');
  });

  it('renders the new character without any special-casing', () => {
    const { project, scene } = stageSynthetic();
    const ctx = new RecordingContext();
    renderScene(ctx, project, scene, 2);
    expect(ctx.isBalanced()).toBe(true);
    expect(ctx.countOf('fill')).toBeGreaterThan(10);
  });

  it('resolves the new character palette into the frame', () => {
    const { project, scene } = stageSynthetic();
    const ctx = new RecordingContext();
    renderScene(ctx, project, scene, 2);

    // Rig parts carry semantic color keys, so the fills must be this character's
    // own palette rather than the seed cast's.
    const fills = ctx.opsFor('set:fillStyle').map((op) => op.args[0]);
    expect(fills).toContain(SYNTHETIC_SKIN);
  });

  it('animates the new character through the ordinary sampler', () => {
    const { scene, actorId } = stageSynthetic();
    const track = scene.tracks.find((t) => t.kind === 'actor' && t.targetId === actorId);
    expect(track).toBeDefined();

    const start = sampleSceneTarget(scene, 'actor', actorId, 0);
    const end = sampleSceneTarget(scene, 'actor', actorId, 2);
    expect(start.x).toBe(400);
    expect(start.alpha).toBe(0);
    expect(end.x).toBe(1200);
    expect(end.alpha).toBe(1);
    expect(end.rotation).toBeCloseTo(0.4, 5);
  });

  it('changes pose mid-shot through a keyframe, and it reaches the pixels', () => {
    const staged = stageSynthetic();
    const withPose = addKeyframe(staged.project, staged.scene.id, staged.trackId, staged.clipId, 3, {
      poseId: 'pose.pointing',
    });
    const scene = withPose.scenes.find((s) => s.id === staged.scene.id);
    if (!scene) throw new Error('scene missing');

    // poseId is a keyframed channel: absent until it is first keyed, after which it
    // holds. The renderer falls back to the actor's static pose in the meantime.
    expect(sampleSceneTarget(scene, 'actor', staged.actorId, 3).poseId).toBe('pose.pointing');
    expect(sampleSceneTarget(scene, 'actor', staged.actorId, 1).poseId).toBeUndefined();

    const before = new RecordingContext();
    const after = new RecordingContext();
    renderScene(before, withPose, scene, 1);
    renderScene(after, withPose, scene, 3);
    expect(after.calls).not.toEqual(before.calls);
  });
});
