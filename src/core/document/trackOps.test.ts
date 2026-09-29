/**
 * Track and clip operation semantics.
 *
 * These pin the clip-model contract the timeline editor builds on. Two of them are
 * the visual kind of bug that never trips a typecheck:
 *
 *   - A moved or start-trimmed clip shifts its keyframes so the animation travels
 *     with the clip. Watching a clip glide while its actor stays frozen, because the
 *     keyframes were left pinned at the old absolute times, is wrong in exactly the
 *     way the eye catches first and the model cannot see.
 *   - An end trim cuts the clip's content, so keyframes beyond the cut go with it.
 *     Leaving them would let a trimmed-away pose come back the moment the clip is
 *     stretched again.
 *
 * The "4 issues" fixtures below are synthetic and have no matching assets, so they
 * validate with a small baseline issue list; the assertions pin that the ops never
 * make validation *worse*.
 */

import { describe, expect, it } from 'vitest';
import { createProject, createScene } from './factories';
import {
  addKeyframe,
  addSimpleClip,
  addTrack,
  moveClip,
  moveKeyframe,
  moveTrack,
  relocateClip,
  removeClip,
  removeKeyframe,
  trimClip,
} from './trackOps';
import { validateProject } from './invariants';
import type { Project, Track } from '../types';

function projectWith(): { project: Project; sceneId: string; trackId: string; clipId: string } {
  const seed = createProject('K');
  const scene = createScene('Scene A', 'env', { duration: 10 });
  const withScene = { ...seed, scenes: [scene] };
  const clip = addSimpleClip(withScene, scene.id, 'dialogue', 'nia', 'Nia says', 2, 1);
  return {
    project: clip.project,
    sceneId: scene.id,
    trackId: clip.trackId,
    clipId: clip.clipId,
  };
}

/** Validation must never get worse as a result of an op. Synthetic fixtures start at 4. */
function expectNotWorse(before: Project, after: Project): void {
  expect(validateProject(after).length).toBeLessThanOrEqual(validateProject(before).length);
}

function clipOf(project: Project, trackId: string, clipId: string) {
  return project.scenes[0]?.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
}

function keyed(project: Project, sceneId: string, trackId: string, clipId: string): Project {
  return addKeyframe(project, sceneId, trackId, clipId, 2.5, { x: 10 });
}

describe('addKeyframe', () => {
  it('adds a keyframe', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const next = keyed(project, sceneId, trackId, clipId);
    expect(clipOf(next, trackId, clipId)?.keyframes).toHaveLength(1);
  });

  it('does not make validation worse', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    expectNotWorse(project, keyed(project, sceneId, trackId, clipId));
  });

  it('replaces the keyframe already sitting on that exact time instead of stacking', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const first = keyed(project, sceneId, trackId, clipId);
    const second = addKeyframe(first, sceneId, trackId, clipId, 2.5, { y: 5, x: 1 });
    const clip = clipOf(second, trackId, clipId);
    expect(clip?.keyframes).toHaveLength(1);
    expect(clip?.keyframes[0]?.props).toEqual({ y: 5, x: 1 });
  });

  it('keeps a keyframe off the existing one when the time differs', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const second = addKeyframe(keyed(project, sceneId, trackId, clipId), sceneId, trackId, clipId, 2.5001, { y: 1 });
    expect(clipOf(second, trackId, clipId)?.keyframes).toHaveLength(2);
  });
});

describe('moveClip and keyframes', () => {
  it('shifts the clip and its keyframes together', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const next = moveClip(keyed(project, sceneId, trackId, clipId), sceneId, trackId, clipId, 5, { snap: false });
    const clip = clipOf(next, trackId, clipId);
    expect(clip?.start).toBe(5);
    expect(clip?.keyframes[0]?.time).toBeCloseTo(5.5, 5);
  });

  it('leaves keyframes alone when snapping pulls a move back to the original edge', () => {
    // A neighbour ends at exactly 2, so the 2.01 move snaps back to 2 — a no-op
    // move. The keyframe must not move either.
    const { project, sceneId, trackId, clipId } = projectWith();
    const withNeighbour = addSimpleClip(project, sceneId, 'dialogue', 'nia', 'Nia says', 1, 1).project;
    const keyedUp = keyed(withNeighbour, sceneId, trackId, clipId);
    // findOrCreateTrack reused the existing dialogue track, so the id is stable.
    const next = moveClip(keyedUp, sceneId, trackId, clipId, 2.01);
    const clip = clipOf(next, trackId, clipId);
    expect(clip?.start).toBe(2);
    expect(clip?.keyframes[0]?.time).toBeCloseTo(2.5, 5);
  });

  it('does not make validation worse', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const withKeys = keyed(project, sceneId, trackId, clipId);
    expectNotWorse(withKeys, moveClip(withKeys, sceneId, trackId, clipId, 5, { snap: false }));
  });
});

describe('trimClip and keyframes', () => {
  it('slides keyframes so their offset inside the clip is preserved on a start trim', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const next = trimClip(keyed(project, sceneId, trackId, clipId), sceneId, trackId, clipId, 'start', 2.5);
    const clip = clipOf(next, trackId, clipId);
    expect(clip?.start).toBe(2.5);
    expect(clip?.keyframes[0]?.time).toBeCloseTo(3, 5);
  });

  it('drops keyframes an end trim cuts away', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const withKeys = addKeyframe(keyed(project, sceneId, trackId, clipId), sceneId, trackId, clipId, 2.9, { x: 9 });
    const next = trimClip(withKeys, sceneId, trackId, clipId, 'end', 2.75);
    expect(clipOf(next, trackId, clipId)?.keyframes.map((k) => k.time)).toEqual([2.5]);
  });

  it('keeps keyframes when the trim does not move the edge it guards', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const next = trimClip(keyed(project, sceneId, trackId, clipId), sceneId, trackId, clipId, 'start', 2);
    expect(clipOf(next, trackId, clipId)?.keyframes[0]?.time).toBeCloseTo(2.5, 5);
  });
});

describe('moveKeyframe', () => {
  it('moves a keyframe within its clip', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const withKeys = keyed(project, sceneId, trackId, clipId);
    const kfId = clipOf(withKeys, trackId, clipId)?.keyframes[0]?.id;
    if (!kfId) throw new Error('expected a keyframe');
    const next = moveKeyframe(withKeys, sceneId, trackId, clipId, kfId, 2.75);
    expect(clipOf(next, trackId, clipId)?.keyframes[0]?.time).toBeCloseTo(2.75, 5);
  });

  it('clamps a keyframe dropped outside the clip back inside it', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const withKeys = keyed(project, sceneId, trackId, clipId);
    const kfId = clipOf(withKeys, trackId, clipId)?.keyframes[0]?.id;
    if (!kfId) throw new Error('expected a keyframe');
    for (const tooFar of [99, -4, 0.1]) {
      const next = moveKeyframe(withKeys, sceneId, trackId, clipId, kfId, tooFar);
      const time = clipOf(next, trackId, clipId)?.keyframes[0]?.time ?? -1;
      expect(time).toBeGreaterThanOrEqual(2);
      expect(time).toBeLessThanOrEqual(3);
    }
  });

  it('sorts keyframes after a move that would reorder them', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    let p = keyed(project, sceneId, trackId, clipId);
    p = addKeyframe(p, sceneId, trackId, clipId, 2.8, { x: 1 });
    const moved = clipOf(p, trackId, clipId)?.keyframes[0]?.id;
    if (!moved) throw new Error('expected a keyframe');
    // 2.9 is not on the 24fps grid; 70/24 is. The moved keyframe lands on it.
    const next = moveKeyframe(p, sceneId, trackId, clipId, moved, 2.9);
    const times = clipOf(next, trackId, clipId)?.keyframes.map((k) => k.time) ?? [];
    expect(times[0]).toBe(2.8);
    expect(times[1]).toBeCloseTo(70 / 24, 5);
  });
});

describe('moveTrack', () => {
  it('moves a track to an earlier index', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    let p = addTrack(project, sceneId, 'audio', 'amb_1', 'Ambience A');
    p = addTrack(p, sceneId, 'camera', 'camera', 'Camera');
    const ids = (p.scenes[0]?.tracks ?? []).map((t) => t.id);
    const next = moveTrack(p, sceneId, ids[1] ?? '', 0);
    const order = (next.scenes[0]?.tracks ?? []).map((t) => t.id);
    expect(order).toEqual([ids[1], ids[0], ids[2]]);
    expect(clipOf(next, trackId, clipId)).toBeDefined();
  });

  it('clamps an out-of-range index to the end and is a no-op for an unknown track', () => {
    const { project, sceneId } = projectWith();
    const withA = addTrack(project, sceneId, 'audio', 'amb_1', 'Ambience A');
    const ids = (withA.scenes[0]?.tracks ?? []).map((t) => t.id);
    const afterClamp = moveTrack(withA, sceneId, ids[0] ?? '', 99);
    const order = (afterClamp.scenes[0]?.tracks ?? []).map((t) => t.id);
    expect(order[order.length - 1]).toBe(ids[0]);
    // An unknown track must leave the document untouched, object identity and all —
    // the UI depends on that to skip a no-op undo step.
    expect(moveTrack(withA, sceneId, 'track_missing', 0)).toBe(withA);
  });
});

describe('relocateClip', () => {
  it('moves a clip onto another same-kind track and strips an emptied source', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    // A second dialogue line owns its own track (dialogue tracks are keyed by line
    // id), so this one is a genuinely different track of the same kind.
    const withOther = addSimpleClip(project, sceneId, 'dialogue', 'line_two', 'Other line', 5, 1);
    expect(withOther.trackId).not.toBe(trackId);
    const next = relocateClip(withOther.project, sceneId, trackId, withOther.trackId, clipId);
    const target = next.scenes[0]?.tracks.find((t) => t.id === withOther.trackId);
    // sortClips orders by start time, so the relocated 2s clip leads the 5s one.
    expect(target?.clips.map((c) => c.id)).toEqual([clipId, withOther.clipId]);
    expect(next.scenes[0]?.tracks.find((t) => t.id === trackId)).toBeUndefined();
  });

  it('refuses a cross-kind move', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const withAudio = addTrack(project, sceneId, 'audio', 'sound', 'Ambience');
    const audioTrack = withAudio.scenes[0]?.tracks.find((t) => t.kind === 'audio');
    if (!audioTrack) throw new Error('no audio track');
    const next = relocateClip(withAudio, sceneId, trackId, audioTrack.id, clipId);
    expect(next).toBe(withAudio);
  });

  it('is a no-op when the tracks match', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    expect(relocateClip(project, sceneId, trackId, trackId, clipId)).toBe(project);
  });
});

describe('removeKeyframe and removeClip', () => {
  it('removes exactly the keyframe asked for', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const withKeys = keyed(project, sceneId, trackId, clipId);
    const kfId = clipOf(withKeys, trackId, clipId)?.keyframes[0]?.id;
    if (!kfId) throw new Error('expected a keyframe');
    const next = removeKeyframe(withKeys, sceneId, trackId, clipId, kfId);
    expect(clipOf(next, trackId, clipId)?.keyframes).toHaveLength(0);
  });

  it('removing a clip removes whatever the clip carried', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const next = removeClip(keyed(project, sceneId, trackId, clipId), sceneId, trackId, clipId);
    expect(clipOf(next, trackId, clipId)).toBeUndefined();
  });

  it('strips an orphaned empty track after the last clip is removed', () => {
    const { project, sceneId, trackId, clipId } = projectWith();
    const next = removeClip(project, sceneId, trackId, clipId);
    const tracks = next.scenes[0]?.tracks;
    expect(tracks?.find((t: Track) => t.id === trackId)).toBeUndefined();
  });
});