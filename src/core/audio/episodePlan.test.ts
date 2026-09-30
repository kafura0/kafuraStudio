/**
 * Episode audio timing.
 *
 * `audioPlan` answers "what is audible in this scene". This answers "what is audible in
 * this episode", and the only difference is the offset (§19.5). That makes the
 * interesting cases about *where a segment lands*, not about audio: a segment in the
 * second scene must not be scheduled at the same instant as one in the first, and that
 * is exactly the bug a mixdown would produce if it kept its own running total instead
 * of using the episode timeline.
 */

import { describe, expect, it } from 'vitest';
import { episodeAudioPlan, episodePositionAt } from './episodePlan';
import { createEpisode, createProject, createScene, createTrack } from '../document/factories';
import type { AudioDef, Id, Project, Scene } from '../types';

function asset(id: string, kind: AudioDef['kind'], duration: number): AudioDef {
  return { id, name: id, kind, src: null, duration, tags: [] };
}

/**
 * A three-scene cut (10s / 8s / 12s, total 30) where each scene carries one ambience
 * clip starting at local 2s. So the expected episode starts are 2, 12 and 20 — the
 * numbers that prove the offsets are real.
 */
function episodeWithAudio(): { project: Project; episodeId: Id } {
  const project = createProject('Episode audio');
  const durations = [10, 8, 12];
  const names = ['A', 'B', 'C'];

  const scenes: Scene[] = durations.map((duration, i) => {
    const scene = createScene(names[i] ?? 'S', 'env', { duration });
    const track = createTrack('audio', `amb-${i}`, `Ambience ${i}`, '#0f0');
    return {
      ...scene,
      tracks: [
        {
          ...track,
          clips: [
            {
              id: `clip-${i}`,
              start: 2,
              duration: duration - 2,
              keyframes: [],
              audioId: `amb-${i}`,
              dialogueLineId: null,
              gain: 0.5 + i * 0.1,
            },
          ],
        },
      ],
    };
  });

  const assets = durations.map((_, i) => asset(`amb-${i}`, 'ambience', 60));
  const episode = createEpisode('EP');

  return {
    project: {
      ...project,
      assets: { ...project.assets, audio: assets },
      scenes,
      episodes: [{ ...episode, sceneIds: scenes.map((s) => s.id) }],
    },
    episodeId: episode.id,
  };
}

describe('episodeAudioPlan', () => {
  it('offsets every scene by where that scene starts in the cut', () => {
    const { project, episodeId } = episodeWithAudio();
    const plan = episodeAudioPlan(project, episodeId);

    // Offsets 0, 10, 18 plus a local start of 2 in each scene.
    expect(plan.map((s) => s.episodeStart)).toEqual([2, 12, 20]);
  });

  it('keeps the scene-local start untouched alongside the episode start', () => {
    const { project, episodeId } = episodeWithAudio();
    const plan = episodeAudioPlan(project, episodeId);
    // The same window is reported twice, in two clocks. A consumer that mixes them up
    // is the bug this module exists to prevent.
    expect(plan.map((s) => s.start)).toEqual([2, 2, 2]);
  });

  it('names the scene each segment belongs to', () => {
    const { project, episodeId } = episodeWithAudio();
    const plan = episodeAudioPlan(project, episodeId);
    const sceneIds = project.episodes[0]?.sceneIds ?? [];
    expect(plan.map((s) => s.sceneId)).toEqual(sceneIds);
  });

  it('carries gain and loop through the offset unchanged', () => {
    const { project, episodeId } = episodeWithAudio();
    const plan = episodeAudioPlan(project, episodeId);
    // An offset changes when a sound is heard, never how loud it is.
    expect(plan.map((s) => s.gain)).toEqual([0.5, 0.6, 0.7]);
    expect(plan.every((s) => s.loop)).toBe(true);
  });

  it('returns segments in episode order', () => {
    const { project, episodeId } = episodeWithAudio();
    const plan = episodeAudioPlan(project, episodeId);
    const starts = plan.map((s) => s.episodeStart);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('never places a segment past the end of the episode', () => {
    const { project, episodeId } = episodeWithAudio();
    const plan = episodeAudioPlan(project, episodeId);
    // Total is 30s. A segment running past it would be scheduled into nothing.
    expect(Math.max(...plan.map((s) => s.episodeStart + s.duration))).toBeLessThanOrEqual(30);
  });

  it('returns nothing for an episode the project does not contain', () => {
    const { project } = episodeWithAudio();
    expect(episodeAudioPlan(project, 'no-such-episode')).toEqual([]);
  });

  it('returns nothing for a cut of silent scenes', () => {
    // The seed project is exactly this case: every slot is `src: null`. Silence is the
    // honest result, not a failure.
    const project = createProject('Silent');
    const scene = createScene('S', 'env', { duration: 5 });
    const episode = createEpisode('EP');
    const withEpisode: Project = {
      ...project,
      scenes: [scene],
      episodes: [{ ...episode, sceneIds: [scene.id] }],
    };
    expect(episodeAudioPlan(withEpisode, episode.id)).toEqual([]);
  });

  it('returns nothing for an empty cut', () => {
    const project = createProject('Empty');
    const episode = createEpisode('EP');
    expect(episodeAudioPlan({ ...project, episodes: [episode] }, episode.id)).toEqual([]);
  });

  it('skips a missing scene and offsets the rest by their real positions', () => {
    // The remaining scenes must not shift up to fill the gap: episode time is
    // determined by the scenes that exist, and a cut naming a missing scene is already
    // a validation issue rather than a timeline to compensate for.
    const { project, episodeId } = episodeWithAudio();
    const [a, b, c] = project.episodes[0]?.sceneIds ?? [];
    if (!a || !b || !c) throw new Error('fixture needs three scenes');

    const broken: Project = {
      ...project,
      episodes: [{ ...project.episodes[0]!, sceneIds: [a, 'missing', b, c] }],
    };
    const plan = episodeAudioPlan(broken, episodeId);
    // A at 0, B at 10 (A was 10s), C at 18.
    expect(plan.map((s) => s.episodeStart)).toEqual([2, 12, 20]);
  });

  it('does not mutate the project', () => {
    const { project, episodeId } = episodeWithAudio();
    const before = JSON.stringify(project);
    episodeAudioPlan(project, episodeId);
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe('episodePositionAt', () => {
  it('resolves an episode time to the scene and its local time', () => {
    const { project, episodeId } = episodeWithAudio();
    const at = episodePositionAt(project, episodeId, 14);
    expect(at.sceneTime).toBe(4);
    expect(at.offset).toBe(10);
    expect(at.ended).toBe(false);
  });

  it('reports the episode duration alongside the position', () => {
    const { project, episodeId } = episodeWithAudio();
    expect(episodePositionAt(project, episodeId, 0).duration).toBe(30);
  });

  it('flags the end of the cut', () => {
    const { project, episodeId } = episodeWithAudio();
    expect(episodePositionAt(project, episodeId, 30).ended).toBe(true);
  });

  it('resolves an unknown episode to a safe empty position', () => {
    const { project } = episodeWithAudio();
    const at = episodePositionAt(project, 'nope', 5);
    expect(at.scene).toBeNull();
    expect(at.duration).toBe(0);
  });
});
