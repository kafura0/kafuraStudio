/**
 * The audio channel at a scene boundary.
 *
 * The channel is thin, and the only thing Phase 10 asks of it is that crossing from one
 * scene to the next is a hard cut: whatever the previous scene was sounding has to stop,
 * or an ambience bed runs on across a location change. That is easy to get wrong
 * because nothing crashes when it is wrong — the audio is simply the wrong scene's.
 *
 * The engine is faked rather than the Web Audio API, so the assertions are about *calls*
 * ("stop was called, then schedule was called with the new scene") rather than about
 * samples, which is the only thing this layer decides.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createEpisode, createProject, createScene, createTrack } from '../core/document/factories';
import type { AudioEngine } from '../core/audio/audioEngine.browser';
import type { Id, Project } from '../core/types';
import type * as AudioChannel from './audioChannel';

const engine = vi.hoisted(() => ({
  schedule: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('../core/audio/audioEngine.browser', () => ({
  createBrowserAudioEngine: (): AudioEngine => engine as unknown as AudioEngine,
}));

/**
 * The channel remembers which scene it last scheduled for, so each test gets a fresh
 * module. Sharing one instance lets the previous test's scene leak in and the first
 * frame of the next test looks like a boundary crossing that never happened.
 */
type Channel = typeof AudioChannel;
let channel: Channel;

beforeEach(async () => {
  vi.resetModules();
  channel = await import('./audioChannel');
  // `mockClear` leaves `invocationCallOrder` populated, so the ordering assertion below
  // would compare against calls from an earlier test. Only `mockReset` clears it.
  engine.schedule.mockReset();
  engine.stop.mockReset();
});

/** A two-scene cut, each with one ambience track, so the channel has something to cut. */
function twoScenes(): Project {
  const project = createProject('Boundary');
  const sceneA = createScene('A', 'env', { duration: 4 });
  const sceneB = createScene('B', 'env', { duration: 4 });
  const withTracks: Project = {
    ...project,
    scenes: [sceneA, sceneB].map((scene) => ({
      ...scene,
      tracks: [createTrack('audio', 'amb', 'Ambience', '#0f0')],
    })),
    episodes: [
      { ...createEpisode('EP'), sceneIds: [sceneA.id, sceneB.id] },
    ],
  };
  return withTracks;
}

const idsOf = (project: Project): [Id, Id] => {
  const ids = project.episodes[0]?.sceneIds ?? [];
  const a = ids[0];
  const b = ids[1];
  if (!a || !b) throw new Error('fixture needs two scenes');
  return [a, b];
};

describe('audioChannel at a scene boundary', () => {
  let project: Project;
  let a: Id;
  let b: Id;

  beforeEach(() => {
    project = twoScenes();
    [a, b] = idsOf(project);
  });

  it('schedules the scene it is handed', () => {
    channel.syncPlaybackAudio(project, a, 1, true);
    expect(engine.schedule).toHaveBeenCalledWith(project, expect.anything(), 1);
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('stops the old scene before scheduling the new one at a boundary', () => {
    channel.syncPlaybackAudio(project, a, 3, true);
    engine.stop.mockReset();

    // The first frame of the next scene: episode time 4, scene-local time 0.
    channel.syncPlaybackAudio(project, b, 0, true);

    expect(engine.stop).toHaveBeenCalledTimes(1);
    // Order matters: stopping after scheduling would cut the new scene's first segment.
    expect(engine.stop.mock.invocationCallOrder[0]).toBeLessThan(
      engine.schedule.mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(engine.schedule).toHaveBeenLastCalledWith(project, expect.anything(), 0);
  });

  it('does not stop on every frame of the same scene', () => {
    // Stopping per frame would make each frame of ambience restart, which is an audible
    // stutter even though the calls look unremarkable in a log.
    channel.syncPlaybackAudio(project, a, 0, true);
    channel.syncPlaybackAudio(project, a, 1, true);
    channel.syncPlaybackAudio(project, a, 2, true);
    expect(engine.schedule).toHaveBeenCalledTimes(3);
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('stops everything when playback is turned off', () => {
    channel.syncPlaybackAudio(project, a, 1, true);
    engine.stop.mockReset();
    engine.schedule.mockReset();
    channel.syncPlaybackAudio(project, a, 1, false);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    // A paused frame schedules nothing, so nothing is left half-played.
    expect(engine.schedule).not.toHaveBeenCalled();
  });

  it('treats the next scene as a cut even after a stop', () => {
    // Pause, then resume into a different scene. The channel forgot which scene it was
    // on, so it must not treat the first frame of the new scene as a continuation.
    channel.syncPlaybackAudio(project, a, 1, true);
    channel.syncPlaybackAudio(project, a, 1, false);
    engine.stop.mockReset();

    channel.syncPlaybackAudio(project, b, 0, true);
    expect(engine.stop).not.toHaveBeenCalled();
    expect(engine.schedule).toHaveBeenLastCalledWith(project, expect.anything(), 0);
  });

  it('forgets the scene when playback is torn down by the store', () => {
    channel.syncPlaybackAudio(project, a, 1, true);
    engine.stop.mockReset();
    channel.stopPlaybackAudio(project);
    expect(engine.stop).toHaveBeenCalledTimes(1);

    // Resuming in the same scene must not be treated as a boundary cut, because the
    // store's `setScene` already tore the audio down.
    engine.stop.mockReset();
    channel.syncPlaybackAudio(project, a, 2, true);
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('schedules nothing for a scene the project does not contain', () => {
    channel.syncPlaybackAudio(project, 'no-such-scene', 1, true);
    expect(engine.schedule).not.toHaveBeenCalled();
  });
});
