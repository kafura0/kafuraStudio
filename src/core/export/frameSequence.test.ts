import { describe, expect, it } from 'vitest';
import { frameSequence } from './frameSequence';
import { episodeDuration, flattenCut } from '../timeline/episode';
import { SEED_PROJECT } from '../../data/seed';
import type { Episode, Project } from '../types';

function firstEpisode(project: Project): Episode {
  const episode = project.episodes[0];
  if (!episode) throw new Error('seed has no episode');
  return episode;
}

function seedDuration(project: Project): number {
  const episode = firstEpisode(project);
  return episodeDuration(flattenCut(project, episode));
}

describe('frameSequence', () => {
  it('reads the episode it is handed, not the project copy', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    const empty: Episode = { ...episode, sceneIds: [] };

    expect(frameSequence(undefined, empty, project)).toEqual([]);
    expect(frameSequence(undefined, episode, project).length).toBeGreaterThan(0);
  });

  it('returns an empty sequence for a non-positive fps instead of looping forever', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    expect(frameSequence({ fps: 0 }, episode, project)).toEqual([]);
    expect(frameSequence({ fps: -30 }, episode, project)).toEqual([]);
  });

  it('returns an empty sequence for a cut with no playable scenes', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    const missing: Episode = {
      ...episode,
      sceneIds: ['scene.does-not-exist'],
    };
    expect(frameSequence(undefined, missing, project)).toEqual([]);
  });

  it('starts at zero and keeps every frame strictly inside the cut', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    const duration = seedDuration(project);
    const frames = frameSequence(undefined, episode, project);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]?.index).toBe(0);
    expect(frames[0]?.time).toBe(0);

    // Half-open: the end instant belongs to whatever comes next, so no exported frame
    // may sit on it. A frame at `duration` would render the next scene or nothing.
    for (const frame of frames) {
      expect(frame.time).toBeLessThan(duration);
    }
  });

  it('lets the last frame cover the end rather than landing on it', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    const duration = seedDuration(project);

    for (const fps of [8, 12, 24, 30]) {
      const frames = frameSequence({ fps }, episode, project);
      const last = frames[frames.length - 1];
      if (!last) throw new Error('no frames');

      // The last frame plus its own hold must reach the end, and the gap left to close
      // is at most one frame interval.
      expect(last.time + 1 / fps).toBeGreaterThanOrEqual(duration - 1e-9);
      expect(duration - last.time).toBeLessThanOrEqual(1 / fps + 1e-9);
    }
  });

  it('spaces frames evenly at exactly 1/fps', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    const fps = 12;
    const frames = frameSequence({ fps }, episode, project);

    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1];
      const curr = frames[i];
      if (!prev || !curr) throw new Error('frame missing');
      expect(curr.time - prev.time).toBeCloseTo(1 / fps, 10);
    }
  });

  it('covers a duration that is an exact multiple of the frame interval', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    // 38s at 12fps is exactly 456 frames, so the last frame is 37.9167s and the
    // boundary case is exercised without float slop deciding the count.
    const duration = seedDuration(project);
    const fps = 12;
    const frames = frameSequence({ fps }, episode, project);
    expect(frames.length).toBe(Math.ceil(duration * fps));
    expect(frames[frames.length - 1]?.time).toBeCloseTo(
      (frames.length - 1) / fps,
      10,
    );
  });

  it('rejects a non-finite fps rather than producing NaN times', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    expect(frameSequence({ fps: Number.NaN }, episode, project)).toEqual([]);
    expect(frameSequence({ fps: Number.POSITIVE_INFINITY }, episode, project)).toEqual([]);
  });

  it('produces exactly ceil(duration * fps) frames and never overshoots', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    const duration = seedDuration(project);

    for (const fps of [1, 8, 12, 24, 30, 60]) {
      const frames = frameSequence({ fps }, episode, project);
      expect(frames.length).toBe(Math.ceil(duration * fps));
      for (const frame of frames) {
        expect(frame.time).toBeGreaterThanOrEqual(0);
        expect(frame.time).toBeLessThanOrEqual(duration + 1e-9);
      }
    }
  });

  it('places every frame on the fps boundary and indexes from zero', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    const duration = seedDuration(project);
    const fps = 12;
    const frames = frameSequence({ fps }, episode, project);

    frames.forEach((frame, i) => {
      expect(frame.index).toBe(i);
      expect(frame.time).toBeCloseTo(Math.min(i / fps, duration), 10);
    });
  });

  it('falls back to the episode render settings when no fps is given', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    const fps = episode.renderSettings.fps;
    const frames = frameSequence(undefined, episode, project);
    expect(frames.length).toBe(Math.ceil(seedDuration(project) * fps));
  });

  it('increases time strictly monotonically', () => {
    const project = SEED_PROJECT;
    const episode = firstEpisode(project);
    const frames = frameSequence({ fps: 24 }, episode, project);
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1];
      const curr = frames[i];
      if (!prev || !curr) throw new Error('frame missing');
      expect(curr.time).toBeGreaterThan(prev.time);
    }
  });
});
