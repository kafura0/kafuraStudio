/**
 * Dialogue document operations.
 *
 * Timing lives on the clip, not on the line, so every op here has to find the cue that
 * carries a line before it can move anything. That resolution is the easy thing to get
 * subtly wrong — the wrong clip, or no clip at all — and a mistake shows up as a
 * subtitle in the wrong place rather than as an exception, so it is pinned here.
 */

import { describe, expect, it } from 'vitest';
import { createSceneInProject } from './projectOps';
import { addDialogueLineWithCue, setDialogueCue } from './dialogueOps';
import { MIN_CLIP_DURATION } from './trackOps';
import { validateProject } from './invariants';
import { SEED_PROJECT } from '../../data/seed';
import type { Clip, Project, Scene } from '../types';

/** A scene with two cued lines, the second starting exactly where the first ends. */
function sceneWithTwoCues(): { project: Project; sceneId: string; first: string; second: string } {
  const created = createSceneInProject(SEED_PROJECT, {
    name: 'Cue timing',
    environmentId: SEED_PROJECT.assets.environments[0]?.id ?? '',
  });
  const one = addDialogueLineWithCue(created.project, created.sceneId, {
    speaker: 'Nia',
    text: 'first',
    start: 1,
    duration: 2,
  });
  const two = addDialogueLineWithCue(one.project, created.sceneId, {
    speaker: 'Kito',
    text: 'second',
    start: 3,
    duration: 2,
  });
  return { project: two.project, sceneId: created.sceneId, first: one.lineId, second: two.lineId };
}

/** Every cue clip on a scene, in timeline order, for asserting on windows. */
function cues(scene: Scene): Clip[] {
  return scene.tracks
    .filter((t) => t.kind === 'dialogue')
    .flatMap((t) => t.clips)
    .sort((a, b) => a.start - b.start);
}

function cueFor(scene: Scene, lineId: string): Clip | undefined {
  return scene.tracks.flatMap((t) => t.clips).find((c) => c.dialogueLineId === lineId);
}

describe('setDialogueCue', () => {
  it('moves the cue and leaves the line content alone', () => {
    const { project, sceneId, first } = sceneWithTwoCues();
    const next = setDialogueCue(project, sceneId, first, { start: 6 });
    const after = next.scenes.find((s) => s.id === sceneId);

    expect(cueFor(after!, first)?.start).toBe(6);
    // A shift, like a drag: the length travels with the window.
    expect(cueFor(after!, first)?.duration).toBe(2);
    expect(after?.dialogue.find((l) => l.id === first)?.text).toBe('first');
  });

  it('changes the duration from the end, keeping the start where it is', () => {
    const { project, sceneId, first } = sceneWithTwoCues();
    const next = setDialogueCue(project, sceneId, first, { duration: 4.5 });
    const after = next.scenes.find((s) => s.id === sceneId);
    const cue = cueFor(after!, first);

    expect(cue?.start).toBe(1);
    expect(cue?.duration).toBe(4.5);
  });

  it('sets both in one mutation', () => {
    const { project, sceneId, second } = sceneWithTwoCues();
    const next = setDialogueCue(project, sceneId, second, { start: 8, duration: 1.25 });
    const after = next.scenes.find((s) => s.id === sceneId);
    const cue = cueFor(after!, second);

    expect(cue?.start).toBe(8);
    expect(cue?.duration).toBe(1.25);
  });

  it('does not snap: a typed start beside a neighbouring edge is taken exactly', () => {
    const { project, sceneId, first } = sceneWithTwoCues();
    // 3.02 is 2cm from the second cue's start edge at 3. The pointer drag would snap
    // to it; a typed number must not be moved out from under the user.
    const next = setDialogueCue(project, sceneId, first, { start: 3.02 });
    const after = next.scenes.find((s) => s.id === sceneId);

    expect(cueFor(after!, first)?.start).toBe(3.02);
  });

  it('returns the same project when the cue already sits there, so no undo step is spent', () => {
    const { project, sceneId, first } = sceneWithTwoCues();
    expect(setDialogueCue(project, sceneId, first, { start: 1, duration: 2 })).toBe(project);
    expect(setDialogueCue(project, sceneId, first, {})).toBe(project);
  });

  it('is a no-op for a line that is not in the scene', () => {
    const { project, sceneId } = sceneWithTwoCues();
    expect(setDialogueCue(project, sceneId, 'line.nope', { start: 5 })).toBe(project);
  });

  it('clamps a negative start to zero and a vanishing duration to the minimum', () => {
    const { project, sceneId, first } = sceneWithTwoCues();
    const next = setDialogueCue(project, sceneId, first, { start: -4, duration: 0 });
    const cue = cueFor(next.scenes.find((s) => s.id === sceneId)!, first);

    expect(cue?.start).toBe(0);
    expect(cue?.duration).toBe(MIN_CLIP_DURATION);
  });

  it('leaves a document that still validates', () => {
    const { project, sceneId, first } = sceneWithTwoCues();
    const next = setDialogueCue(project, sceneId, first, { start: 7.5, duration: 0.5 });
    expect(validateProject(next)).toEqual([]);
  });

  it('carries the line with it: the subtitle moves to the new window', () => {
    const { project, sceneId, second } = sceneWithTwoCues();
    const next = setDialogueCue(project, sceneId, second, { start: 9, duration: 1 });
    const after = next.scenes.find((s) => s.id === sceneId);
    const windows = cues(after!).map((c) => [c.start, c.duration]);

    expect(windows).toEqual([
      [1, 2],
      [9, 1],
    ]);
  });
});
