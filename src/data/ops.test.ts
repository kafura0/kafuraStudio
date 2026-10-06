/**
 * Document operation regressions.
 *
 * Each of these pins a bug that TypeScript could not catch: a blind spread that
 * smuggled unrelated keys into a typed object, and a `find` that cleaned one of many
 * matching tracks. Both produced documents that failed their own invariants.
 */

import { describe, expect, it } from 'vitest';
import { placeCharacter } from '../core/document/sceneOps';
import { addDialogueLineWithCue, removeDialogueLine } from '../core/document/dialogueOps';
import { createSceneInProject } from '../core/document/projectOps';
import { validateProject } from '../core/document/invariants';
import { NIA } from './characters';
import { SEED_PROJECT, SEED_SERIES } from './seed';

describe('placeCharacter', () => {
  it('does not leak poseId or expressionId into the transform', () => {
    const created = createSceneInProject(SEED_PROJECT, SEED_SERIES.assets, {
      name: 'Leak check',
      environmentId: SEED_PROJECT.assets.environments[0]?.id ?? '',
    });
    const placed = placeCharacter(created.project, created.sceneId, NIA, {
      x: 500,
      y: 900,
      poseId: 'pose.sitting',
      expressionId: 'expr.angry',
    });

    const actor = placed.project.scenes
      .find((s) => s.id === created.sceneId)
      ?.actors.find((a) => a.id === placed.actorId);
    expect(actor).toBeDefined();
    if (!actor) return;

    expect(actor.poseId).toBe('pose.sitting');
    expect(actor.expressionId).toBe('expr.angry');
    // The transform must be exactly a Transform2D. A spread of the whole placement
    // object put `poseId` here at runtime, where the type said it could not be.
    expect(Object.keys(actor.transform).sort()).toEqual([
      'alpha',
      'rotation',
      'scaleX',
      'scaleY',
      'x',
      'y',
    ]);
  });

  it('still places the actor where asked', () => {
    const created = createSceneInProject(SEED_PROJECT, SEED_SERIES.assets, {
      name: 'Placement check',
      environmentId: SEED_PROJECT.assets.environments[0]?.id ?? '',
    });
    const placed = placeCharacter(created.project, created.sceneId, NIA, { x: 500, y: 900 });
    const actor = placed.project.scenes
      .find((s) => s.id === created.sceneId)
      ?.actors.find((a) => a.id === placed.actorId);
    expect(actor?.transform.x).toBe(500);
    expect(actor?.transform.y).toBe(900);
    expect(actor?.transform.scaleX).toBe(1);
  });
});

describe('removeDialogueLine', () => {
  function sceneWithThreeLines() {
    const created = createSceneInProject(SEED_PROJECT, SEED_SERIES.assets, {
      name: 'Dialogue removal',
      environmentId: SEED_PROJECT.assets.environments[0]?.id ?? '',
    });
    let project = created.project;
    for (const [index, speaker] of ['Nia', 'Kito', 'Nia'].entries()) {
      const added = addDialogueLineWithCue(project, created.sceneId, {
        speaker,
        text: `line ${index}`,
        start: index * 2,
        duration: 1.5,
      });
      project = added.project;
    }
    return { project, sceneId: created.sceneId };
  }

  it('removes the line, its clip, and the track that held it', () => {
    const { project, sceneId } = sceneWithThreeLines();
    const scene = project.scenes.find((s) => s.id === sceneId);
    const victim = scene?.dialogue[1];
    expect(victim).toBeDefined();
    if (!victim) return;

    expect(scene?.tracks.filter((t) => t.kind === 'dialogue')).toHaveLength(3);
    // One cue per track, not every cue on every track.
    for (const track of scene?.tracks.filter((t) => t.kind === 'dialogue') ?? []) {
      expect(track.clips).toHaveLength(1);
    }

    const next = removeDialogueLine(project, sceneId, victim.id);
    const after = next.scenes.find((s) => s.id === sceneId);

    expect(after?.dialogue.map((l) => l.id)).not.toContain(victim.id);
    expect(after?.tracks.flatMap((t) => t.clips).map((c) => c.dialogueLineId)).not.toContain(victim.id);
    // One dialogue track per line, so two lines means two tracks remain.
    expect(after?.tracks.filter((t) => t.kind === 'dialogue')).toHaveLength(2);
  });

  it('leaves a document that still validates', () => {
    const { project, sceneId } = sceneWithThreeLines();
    const scene = project.scenes.find((s) => s.id === sceneId);
    const victim = scene?.dialogue[1];
    if (!victim) throw new Error('no line');

    const next = removeDialogueLine(project, sceneId, victim.id);
    // An orphaned clip is exactly what the old `find`-one-track version produced, and
    // validateProject is what noticed.
    expect(validateProject(next).filter((i) => i.message.includes('clip'))).toEqual([]);
  });

  it('is a no-op for a line that is not in the scene', () => {
    const { project, sceneId } = sceneWithThreeLines();
    const next = removeDialogueLine(project, sceneId, 'line.does_not_exist');
    const after = next.scenes.find((s) => s.id === sceneId);
    expect(after?.dialogue).toHaveLength(3);
    expect(after?.tracks.filter((t) => t.kind === 'dialogue')).toHaveLength(3);
  });
});
