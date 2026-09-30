/**
 * Episode timing.
 *
 * These are the arithmetic that decides which scene is on screen at any moment of an
 * episode, so they are tested as arithmetic: every case here is invisible without a
 * screenshot, and a boundary that is off by one frame is a scene that stutters.
 *
 * The layout under test throughout is the one from the module's header — A=10s, B=8s,
 * C=12s, total 30 — because it makes every expected number checkable by hand:
 *
 *     0  .. 10      A
 *     10 .. 18      B
 *     18 .. 30      C
 */

import { describe, expect, it } from 'vitest';
import {
  buildEpisodeTimeline,
  episodeDuration,
  episodeList,
  safeEpisodeTime,
  sceneAtTime,
  timeOfScene,
} from './episode';
import { createEpisode, createProject, createScene } from '../document/factories';
import type { Id, Project, Scene } from '../types';

/** A 10 / 8 / 12 cut, so offsets are 0, 10, 18 and the total is 30. */
function threeSceneEpisode(): { project: Project; ids: [Id, Id, Id] } {
  const project = createProject('Timing');
  const a = createScene('A', 'env', { duration: 10 });
  const b = createScene('B', 'env', { duration: 8 });
  const c = createScene('C', 'env', { duration: 12 });
  const withScenes: Project = {
    ...project,
    scenes: [a, b, c],
  };
  const episode = createEpisode('EP');
  const withEpisode: Project = {
    ...withScenes,
    episodes: [{ ...episode, sceneIds: [a.id, b.id, c.id] }],
  };
  return { project: withEpisode, ids: [a.id, b.id, c.id] };
}

function episodeIdOf(project: Project): Id {
  const id = project.episodes[0]?.id;
  if (!id) throw new Error('fixture has no episode');
  return id;
}

const timelineOf = (project: Project) => {
  const timeline = buildEpisodeTimeline(project, episodeIdOf(project));
  if (!timeline) throw new Error('fixture episode did not resolve');
  return timeline;
};

describe('buildEpisodeTimeline', () => {
  it('lays the cut out in order with running offsets', () => {
    const { project, ids } = threeSceneEpisode();
    const timeline = timelineOf(project);

    expect(timeline.segments.map((s) => s.scene.id)).toEqual(ids);
    expect(timeline.segments.map((s) => s.offset)).toEqual([0, 10, 18]);
    // `end` is exclusive, so it is the next segment's offset, and the last one is the
    // total.
    expect(timeline.segments.map((s) => s.end)).toEqual([10, 18, 30]);
    expect(timeline.segments.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('sums the scene durations into the episode duration', () => {
    const { project } = threeSceneEpisode();
    expect(episodeDuration(timelineOf(project))).toBe(30);
  });

  it('returns null for an episode the project does not contain', () => {
    const { project } = threeSceneEpisode();
    expect(buildEpisodeTimeline(project, 'no-such-episode')).toBeNull();
    expect(episodeDuration(null)).toBe(0);
  });

  it('reports an empty cut as zero rather than failing', () => {
    const project = createProject('Empty');
    const withEpisode: Project = {
      ...project,
      episodes: [createEpisode('EP')],
    };
    const timeline = timelineOf(withEpisode);
    expect(timeline.segments).toEqual([]);
    expect(timeline.duration).toBe(0);
  });

  it('skips a scene the project does not contain, and keeps the rest contiguous', () => {
    // A cut that names a missing scene must not leave a hole in the timeline: the
    // scenes after it shift down, so no time is silently unplayable.
    const { project, ids } = threeSceneEpisode();
    const [, b, c] = ids;
    const broken: Project = {
      ...project,
      episodes: [
        { ...project.episodes[0]!, sceneIds: [ids[0], 'missing', b, c] },
      ],
    };
    const timeline = timelineOf(broken);
    expect(timeline.segments.map((s) => s.scene.id)).toEqual([ids[0], b, c]);
    expect(timeline.segments.map((s) => s.offset)).toEqual([0, 10, 18]);
    expect(timeline.duration).toBe(30);
  });

  it('skips a zero-length scene rather than creating two boundaries at one instant', () => {
    // Two zero-length segments in a row would make "which scene is at 3s" ambiguous,
    // and a resolver that scans forward could not decide.
    const { project, ids } = threeSceneEpisode();
    const zero = { ...createScene('Zero', 'env', { duration: 1 }), duration: 0 } as Scene;
    const withZero: Project = {
      ...project,
      scenes: [...project.scenes, zero],
      episodes: [
        { ...project.episodes[0]!, sceneIds: [zero.id, ids[0], ids[1], ids[2]] },
      ],
    };
    const timeline = timelineOf(withZero);
    expect(timeline.segments.map((s) => s.scene.id)).not.toContain(zero.id);
    expect(timeline.duration).toBe(30);
  });

  it('ignores a non-finite duration rather than propagating NaN', () => {
    const { project, ids } = threeSceneEpisode();
    const broken = { ...createScene('Broken', 'env', { duration: 5 }), duration: Number.NaN } as Scene;
    const withBroken: Project = {
      ...project,
      scenes: [...project.scenes, broken],
      episodes: [{ ...project.episodes[0]!, sceneIds: [ids[0], broken.id, ids[1], ids[2]] }],
    };
    const timeline = timelineOf(withBroken);
    expect(timeline.duration).toBe(30);
    expect(timeline.segments.every((s) => Number.isFinite(s.offset))).toBe(true);
  });

  it('does not mutate the project', () => {
    const { project } = threeSceneEpisode();
    const before = JSON.stringify(project);
    timelineOf(project);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('lists the episodes in document order', () => {
    const { project } = threeSceneEpisode();
    expect(episodeList(project).map((e) => e.title)).toEqual(['EP']);
  });
});

describe('sceneAtTime — first scene', () => {
  it('resolves t=0 to the first scene at local 0', () => {
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 0);
    expect(at.sceneId).toBe(ids[0]);
    expect(at.sceneTime).toBe(0);
    expect(at.offset).toBe(0);
    expect(at.ended).toBe(false);
  });

  it('resolves a small positive time to the same scene', () => {
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 0.001);
    expect(at.sceneId).toBe(ids[0]);
    expect(at.sceneTime).toBeCloseTo(0.001, 12);
  });

  it('resolves one frame before the end to the first scene, not the second', () => {
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 10 - 1e-6);
    expect(at.sceneId).toBe(ids[0]);
    expect(at.sceneTime).toBeCloseTo(10, 5);
    expect(at.ended).toBe(false);
  });
});

describe('sceneAtTime — boundaries', () => {
  it('treats an exact boundary as the start of the next scene', () => {
    // Half-open intervals: the instant a scene ends is already the next scene's first
    // frame. See the module header for why the alternative was rejected.
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 10);
    expect(at.sceneId).toBe(ids[1]);
    expect(at.sceneTime).toBe(0);
    expect(at.offset).toBe(10);
    expect(at.ended).toBe(false);
  });

  it('resolves the second boundary the same way', () => {
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 18);
    expect(at.sceneId).toBe(ids[2]);
    expect(at.sceneTime).toBe(0);
  });

  it('keeps a time a hair inside the boundary in the earlier scene', () => {
    // The other side of the same coin: resolution must not round, or scrubbing to a
    // boundary would flicker between the two scenes.
    const { project, ids } = threeSceneEpisode();
    expect(sceneAtTime(timelineOf(project), 18 - 1e-9).sceneId).toBe(ids[1]);
    expect(sceneAtTime(timelineOf(project), 10 - 1e-9).sceneId).toBe(ids[0]);
  });
});

describe('sceneAtTime — middle and final scenes', () => {
  it('resolves a time inside a middle scene to that scene and its local time', () => {
    // The example from the phase brief: t=14 is 4s into an 8s scene at offset 10.
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 14);
    expect(at.sceneId).toBe(ids[1]);
    expect(at.sceneTime).toBe(4);
    expect(at.index).toBe(1);
    expect(at.ended).toBe(false);
  });

  it('resolves a time inside the final scene', () => {
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 21);
    expect(at.sceneId).toBe(ids[2]);
    expect(at.sceneTime).toBe(3);
    expect(at.ended).toBe(false);
  });

  it('resolves the last frame inside the final scene', () => {
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 30 - 1e-6);
    expect(at.sceneId).toBe(ids[2]);
    expect(at.sceneTime).toBeCloseTo(12, 5);
  });
});

describe('sceneAtTime — end of the cut', () => {
  it('resolves the exact end to the last frame of the last scene, flagged ended', () => {
    // Half-open means t=30 is past the end, but handing the renderer nothing would blank
    // the stage on the final frame, so it resolves to the last frame and says `ended`.
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 30);
    expect(at.sceneId).toBe(ids[2]);
    expect(at.sceneTime).toBe(12);
    expect(at.ended).toBe(true);
  });

  it('clamps a time past the end to the same last frame', () => {
    const { project } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), 9999);
    expect(at.sceneTime).toBe(12);
    expect(at.ended).toBe(true);
    expect(at.duration).toBe(30);
  });

  it('clamps a negative time to the first frame', () => {
    const { project, ids } = threeSceneEpisode();
    const at = sceneAtTime(timelineOf(project), -5);
    expect(at.sceneId).toBe(ids[0]);
    expect(at.sceneTime).toBe(0);
    expect(at.ended).toBe(false);
  });

  it('resolves a non-finite time to the first frame rather than the end', () => {
    // NaN fails every comparison, so an unguarded scan would fall out of the loop as if
    // the episode had finished — a silent wrong answer instead of a loud one.
    const { project, ids } = threeSceneEpisode();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const at = sceneAtTime(timelineOf(project), bad);
      expect(at.sceneId).toBe(ids[0]);
      expect(at.sceneTime).toBe(0);
      expect(at.ended).toBe(false);
    }
  });
});

describe('sceneAtTime — degenerate cuts', () => {
  it('resolves an empty cut to a safe, deterministic position', () => {
    const project = createProject('Empty');
    const withEpisode: Project = { ...project, episodes: [createEpisode('EP')] };
    const timeline = timelineOf(withEpisode);

    for (const t of [0, 1, -1, Number.NaN]) {
      const at = sceneAtTime(timeline, t);
      expect(at.scene).toBeNull();
      expect(at.sceneId).toBe('');
      expect(at.sceneTime).toBe(0);
      expect(at.ended).toBe(true);
      expect(at.duration).toBe(0);
    }
  });

  it('resolves a null timeline the same way', () => {
    const at = sceneAtTime(null, 5);
    expect(at.scene).toBeNull();
    expect(at.ended).toBe(true);
    expect(at.duration).toBe(0);
  });

  it('resolves a cut of only zero-length scenes as empty, not as unresolvable', () => {
    const zero = { ...createScene('Zero', 'env', { duration: 1 }), duration: 0 } as Scene;
    const project = createProject('Zeros');
    const withEpisode: Project = {
      ...project,
      scenes: [zero],
      episodes: [{ ...createEpisode('EP'), sceneIds: [zero.id] }],
    };
    const at = sceneAtTime(timelineOf(withEpisode), 0);
    expect(at.scene).toBeNull();
    expect(at.duration).toBe(0);
  });

  it('terminates on a pathological cut', () => {
    // Many degenerate scenes must not turn resolution into an unbounded walk. A build
    // that takes microseconds here is a build whose per-frame cost is bounded.
    const scenes: Scene[] = Array.from({ length: 500 }, (_, i) => ({
      ...createScene(`S${i}`, 'env', { duration: 1 }),
      duration: 0,
    }));
    const project = createProject('Pathological');
    const withEpisode: Project = {
      ...project,
      scenes,
      episodes: [
        { ...createEpisode('EP'), sceneIds: scenes.map((s) => s.id) },
      ],
    };
    expect(sceneAtTime(timelineOf(withEpisode), 0).scene).toBeNull();
  });
});

describe('determinism', () => {
  it('resolves the same episode time identically every time', () => {
    const { project } = threeSceneEpisode();
    const first = timelineOf(project);
    for (let i = 0; i < 10; i += 1) {
      const at = sceneAtTime(first, 14.5);
      expect(sceneAtTime(timelineOf(project), 14.5)).toEqual(at);
    }
  });

  it('agrees with itself at every boundary it can reach', () => {
    // The inverse property, checked densely rather than at chosen points: walking the
    // whole cut and verifying episodeTime == offset + sceneTime catches an offset
    // table that is internally consistent but wrong at one scene.
    const { project } = threeSceneEpisode();
    const timeline = timelineOf(project);
    for (let t = 0; t <= 30; t += 0.05) {
      const at = sceneAtTime(timeline, t);
      expect(at.offset + at.sceneTime).toBeCloseTo(t, 8);
      expect(at.sceneTime).toBeGreaterThanOrEqual(0);
      expect(at.sceneTime).toBeLessThanOrEqual((at.scene?.duration ?? 0) + 1e-9);
    }
  });

  it('never returns a local time outside the scene it resolved', () => {
    const { project } = threeSceneEpisode();
    const timeline = timelineOf(project);
    for (let t = 0; t <= 31; t += 1 / 60) {
      const at = sceneAtTime(timeline, t);
      if (!at.scene) continue;
      expect(at.sceneTime).toBeLessThanOrEqual(at.scene.duration + 1e-9);
    }
  });
});

describe('timeOfScene', () => {
  it('reports where each scene starts', () => {
    const { project, ids } = threeSceneEpisode();
    const timeline = timelineOf(project);
    expect(timeOfScene(timeline, ids[0])).toBe(0);
    expect(timeOfScene(timeline, ids[1])).toBe(10);
    expect(timeOfScene(timeline, ids[2])).toBe(18);
  });

  it('reports 0 for a scene that is not in the cut', () => {
    const { project } = threeSceneEpisode();
    expect(timeOfScene(timelineOf(project), 'nope')).toBe(0);
    expect(timeOfScene(null, 'nope')).toBe(0);
  });
});

describe('safeEpisodeTime', () => {
  it('passes a time inside the episode through unchanged', () => {
    expect(safeEpisodeTime(14, 30)).toBe(14);
  });

  it('clamps below zero and above the duration', () => {
    expect(safeEpisodeTime(-1, 30)).toBe(0);
    expect(safeEpisodeTime(45, 30)).toBe(30);
  });

  it('replaces a non-finite time with the first frame', () => {
    // All three non-finite values get the same answer, and it matches what
    // `sceneAtTime` does with them. Two functions disagreeing about what a broken
    // clock means is how a playhead ends up at the end of the episode with the
    // transport reading "Play".
    expect(safeEpisodeTime(Number.NaN, 30)).toBe(0);
    expect(safeEpisodeTime(Number.POSITIVE_INFINITY, 30)).toBe(0);
    expect(safeEpisodeTime(Number.NEGATIVE_INFINITY, 30)).toBe(0);
  });

  it('never returns a negative time for a negative duration', () => {
    // A zero-duration episode must not produce a negative clamp bound.
    expect(safeEpisodeTime(5, 0)).toBe(0);
    expect(safeEpisodeTime(5, -3)).toBe(0);
  });
});
