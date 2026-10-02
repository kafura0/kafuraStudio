/**
 * Editor store behaviour.
 *
 * The store is the one place where a pure document operation becomes a user-visible
 * edit, so it is the seam where undo, autosave, and the playback clock are decided.
 * It had no tests, which meant none of that was actually pinned.
 *
 * Two things are worth noticing about what is asserted here:
 *
 *  - The playhead is transient. It is never recorded in history, so undo moves the
 *    document backwards without also rewinding the viewer to wherever the playhead
 *    happened to be. Scrubbing must not cost an undo step.
 *  - Duration is per scene. The clock wraps against the scene that is open, not the
 *    first scene in the project, which is the bug that made the transport disagree
 *    with the timeline.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createScene, createProject } from '../core/document/factories';
import { setSceneDuration } from '../core/document/projectOps';
import { SEED_PROJECT } from '../data/seed';
import { attachAudioMedia } from '../core/document/projectOps';
import { useEditor, episodeExportTarget } from './editorStore';
import type { Project } from '../core/types';

// jsdom has no IndexedDB, so the repository is stubbed. `vi.mock` is hoisted above
// the imports by vitest, which is what lets the store pick this up when it constructs
// its repository at module scope.
//
// The `unknown` in these signatures is loadMostRecent's, not save's: the store has to
// treat whatever comes back out of the database as untrusted, so `save` is typed with
// the real document and the queueing tests can read the scene duration off the
// argument they were handed.
const repository = vi.hoisted(() => ({
  save: vi.fn(async (_project: Project) => {}),
  loadMostRecent: vi.fn(async (): Promise<unknown> => null),
  load: vi.fn(async (_id: string): Promise<unknown> => null),
}));

vi.mock('../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => true,
  IndexedDbProjectRepository: vi.fn(() => repository),
}));

/**
 * The open project, for assertions that only make sense when one is open.
 *
 * `project` is nullable now that a workspace can legitimately have nothing open, so these
 * tests state that expectation once here instead of scattering `!` through every
 * assertion. A test that runs with nothing open gets a clear failure rather than a
 * `Cannot read properties of null` at some unrelated line.
 */
function currentProject(): Project {
  const project = useEditor.getState().project;
  if (project === null) throw new Error('Expected a project to be open');
  return project;
}

const reset = (): void => {
  repository.save.mockClear();
  repository.loadMostRecent.mockReset();
  repository.loadMostRecent.mockResolvedValue(null);
  useEditor.setState({
    project: SEED_PROJECT,
    past: [],
    future: [],
    playhead: 0,
    playing: false,
    playbackMode: 'scene-wrap',
    sceneId: SEED_PROJECT.scenes[0]?.id ?? '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,
  });
};

describe('editorStore playback clock', () => {
  beforeEach(reset);

  it('does not advance while paused', () => {
    useEditor.getState().setPlayhead(1);
    useEditor.getState().advancePlayback(0.5);
    expect(useEditor.getState().playhead).toBe(1);
  });

  it('advances while playing', () => {
    useEditor.getState().play();
    useEditor.getState().advancePlayback(0.5);
    expect(useEditor.getState().playhead).toBeCloseTo(0.5, 6);
  });

  it('accumulates across successive frames', () => {
    useEditor.getState().play();
    const store = useEditor.getState();
    for (let i = 0; i < 10; i += 1) store.advancePlayback(1 / 60);
    expect(useEditor.getState().playhead).toBeCloseTo(10 / 60, 6);
  });

  it('wraps at the end of the scene instead of clamping to it', () => {
    useEditor.getState().play();
    const duration = useEditor.getState().activeDuration();
    useEditor.getState().setPlayhead(duration - 0.25);
    useEditor.getState().advancePlayback(0.5);

    const { playhead } = useEditor.getState();
    expect(playhead).toBeCloseTo(0.25, 6);
    expect(playhead).toBeLessThan(duration);
  });

  it('wraps against the open scene, not the first scene in the project', () => {
    const first = SEED_PROJECT.scenes[0];
    const second = SEED_PROJECT.scenes[1];
    if (!first || !second) throw new Error('Seed project needs at least two scenes');

    // Make the first scene long and the second short, so reading the wrong one is
    // impossible to miss.
    useEditor.setState({
      project: setSceneDuration(setSceneDuration(SEED_PROJECT, first.id, 30), second.id, 4),
      sceneId: second.id,
    });

    expect(useEditor.getState().activeDuration()).toBe(4);
    useEditor.getState().play();
    useEditor.getState().setPlayhead(3.5);
    useEditor.getState().advancePlayback(1);

    // Wrapped at 4s, not left sitting at 4s because the first scene is 30s.
    expect(useEditor.getState().playhead).toBeCloseTo(0.5, 6);
  });

  it('ignores a non-positive or absurd delta', () => {
    useEditor.getState().play();
    useEditor.getState().setPlayhead(2);
    const store = useEditor.getState();
    store.advancePlayback(0);
    store.advancePlayback(-1);
    expect(useEditor.getState().playhead).toBe(2);
  });

  it('clamps a scrub to zero', () => {
    useEditor.getState().setPlayhead(-5);
    expect(useEditor.getState().playhead).toBe(0);
  });

  it('resets the playhead when the scene changes', () => {
    const second = SEED_PROJECT.scenes[1];
    if (!second) throw new Error('Seed project needs a second scene');
    useEditor.getState().setPlayhead(4);
    useEditor.getState().setScene(second.id);
    expect(useEditor.getState().playhead).toBe(0);
  });

  it('reports no duration for a project with no scenes', () => {
    const empty = createProject('Empty');
    useEditor.setState({ project: empty, sceneId: '' });
    expect(useEditor.getState().activeDuration()).toBe(0);
    // Must not divide by zero or produce NaN.
    useEditor.getState().play();
    useEditor.getState().advancePlayback(1);
    expect(useEditor.getState().playhead).toBe(0);
  });
});

describe('editorStore history', () => {
  beforeEach(reset);

  it('records a commit and restores it on undo', () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');
    const actorId = first.actors[0]?.id;
    if (!actorId) throw new Error('First scene has no actors');

    const before = currentProject();
    useEditor.getState().commit(setSceneDuration(before, first.id, 25), 'duration');

    expect(currentProject().scenes[0]?.duration).toBe(25);
    expect(useEditor.getState().past).toHaveLength(1);

    useEditor.getState().undo();
    expect(currentProject().scenes[0]?.duration).toBe(before.scenes[0]?.duration);
  });

  it('redo restores the committed document', () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');

    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 25), 'duration');
    useEditor.getState().undo();
    useEditor.getState().redo();

    expect(currentProject().scenes[0]?.duration).toBe(25);
    expect(useEditor.getState().future).toHaveLength(0);
  });

  it('does not record a commit that changes nothing', () => {
    // An effect or handler may call commit with the document it already has; that
    // would make undo appear broken.
    useEditor.getState().commit(currentProject(), 'noop');
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it('keeps the playhead out of history', () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');

    useEditor.getState().setPlayhead(3);
    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 25), 'duration');
    useEditor.getState().undo();

    // The document rewound; the viewer stayed where the user put it.
    expect(useEditor.getState().playhead).toBe(3);
  });

  it('clears the redo stack once a new edit follows an undo', () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');

    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 25), 'a');
    useEditor.getState().undo();
    expect(useEditor.getState().future).toHaveLength(1);

    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 12), 'b');
    expect(useEditor.getState().future).toHaveLength(0);
  });
});

describe('editorStore persistence races', () => {
  beforeEach(reset);

  // `save` awaits IndexedDB, so the store is free to accept an edit while the write
  // is in flight. Folding the saved document back into the store unconditionally
  // discarded that edit with no error and no undo step: silent data loss.
  //
  // jsdom has no IndexedDB, so the repository is stubbed and `save` is made to yield
  // at a controllable point. An edit landing in that gap is the whole scenario.

  it('does not let a save discard an edit committed while it was writing', async () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');

    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 25), 'edited');

    const saving = useEditor.getState().save();
    // The user's next edit lands while the write is still in flight.
    useEditor.getState().commit(
      setSceneDuration(currentProject(), first.id, 42),
      'edited during save',
    );
    await saving;

    expect(currentProject().scenes[0]?.duration).toBe(42);
    // Still dirty: this document has never reached the database.
    expect(useEditor.getState().dirty).toBe(true);
    // The write itself did happen, so the timestamp is real.
    expect(repository.save).toHaveBeenCalled();
  });

  it('keeps the saved document when nothing else changed', async () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');

    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 25), 'edited');
    await useEditor.getState().save();

    expect(currentProject().scenes[0]?.duration).toBe(25);
    expect(useEditor.getState().dirty).toBe(false);
    expect(useEditor.getState().lastSavedAt).not.toBeNull();
  });

  it('stores the document that was current, not the one that started the write', async () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');

    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 25), 'edited');
    const saving = useEditor.getState().save();
    useEditor.getState().commit(
      setSceneDuration(currentProject(), first.id, 42),
      'later',
    );
    await saving;

    // The in-flight write holds 25. It must not clobber the store, which holds 42,
    // and the 42 document is still awaiting its own autosave.
    const written = repository.save.mock.calls.at(-1)?.[0] as { scenes: { duration: number }[] };
    expect(written.scenes[0]?.duration).toBe(25);
    expect(currentProject().scenes[0]?.duration).toBe(42);
  });

  it('does not start a second write until the first has finished', async () => {
    // The point of the queue is that the repository is never asked to write two
    // documents at once. Merely chaining the awaiting would still start both writes,
    // and it is the order they *complete* in that decides which one ends up stored.
    // So the first write is held open here and the second is checked to be untouched
    // until it is released.
    let releaseFirst: () => void = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    repository.save.mockImplementationOnce(() => firstWrite).mockImplementation(async () => {});

    const a = useEditor.getState().save();
    const b = useEditor.getState().save();
    await Promise.resolve();

    expect(repository.save).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([a, b]);

    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('stores the newer document last when two saves overlap', async () => {
    // The failure this guards against is the older document winning the database. The
    // first write is made slow and the second fast, so with concurrent writes the
    // second would finish first and the stale document would be the one left stored.
    const stored: number[] = [];
    let call = 0;
    repository.save.mockImplementation(async (project: Project) => {
      const delay = call++ === 0 ? 20 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      stored.push(project.scenes[0]?.duration ?? -1);
    });

    const sceneId = SEED_PROJECT.scenes[0]?.id ?? '';
    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, sceneId, 11), 'first');
    // Issued before the second edit, so it captures the 11s document.
    const a = useEditor.getState().save();
    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, sceneId, 22), 'second');
    const b = useEditor.getState().save();

    await Promise.all([a, b]);

    expect(stored).toEqual([11, 22]);
    expect(currentProject().scenes[0]?.duration).toBe(22);
  });

  it('keeps saving after a write fails', async () => {
    // A rejected write must not reject the queue itself, or every later save fails
    // without ever reaching the database and the project silently stops persisting.
    repository.save.mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(useEditor.getState().save()).rejects.toThrow('quota exceeded');

    repository.save.mockImplementation(async () => {});
    await expect(useEditor.getState().save()).resolves.toBeUndefined();
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('clears history and selection when a different project is hydrated', async () => {
    useEditor.getState().commit(
      setSceneDuration(SEED_PROJECT, SEED_PROJECT.scenes[0]?.id ?? '', 25),
      'edited',
    );
    useEditor.getState().select('actor', 'nia');
    useEditor.getState().setPlayhead(3);
    useEditor.getState().play();

    repository.loadMostRecent.mockResolvedValue({
      ...createProject('Other'),
      scenes: [{ ...createScene('Loaded', 'env_missing', { duration: 8 }) }],
    });

    await useEditor.getState().hydrate();

    // Undo must not restore a document from the project that was open before the
    // load, and nothing may stay selected from it.
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().future).toHaveLength(0);
    expect(useEditor.getState().selection).toEqual({ kind: null, id: null });
    expect(useEditor.getState().playhead).toBe(0);
    expect(useEditor.getState().playing).toBe(false);
    expect(currentProject().name).toBe('Other');
  });
});

describe('editorStore episode playback', () => {
  // The seed episode is five scenes: 10s, 8s, 7s, 7s, 6s — 38s in total, with
  // boundaries at 10, 18, 25 and 32. Every number below is checked against that table
  // rather than against a duration read back out of the store, because a test that
  // derives its own expectation from the code under test proves nothing.
  const CUT = [10, 8, 7, 7, 6] as const;
  const TOTAL = 38;
  const BOUNDARIES = [10, 18, 25, 32];

  const seedIds = (): string[] => {
    const ids = SEED_PROJECT.episodes[0]?.sceneIds ?? [];
    if (ids.length !== CUT.length) {
      throw new Error(`Seed episode has ${ids.length} scenes, expected ${CUT.length}`);
    }
    return ids;
  };

  /** The seed project in episode mode at its first frame. */
  const startEpisode = (): void => {
    const [first] = seedIds();
    useEditor.setState({
      project: SEED_PROJECT,
      past: [],
      future: [],
      playhead: 0,
      playing: true,
      playbackMode: 'episode-advance',
      sceneId: first ?? '',
      selection: { kind: null, id: null },
      dirty: false,
      lastSavedAt: null,
    });
  };

  /** Step the clock in frames, the way the stage's animation loop does. */
  const run = (seconds: number, fps = 24): void => {
    const dt = 1 / fps;
    const frames = Math.round(seconds * fps);
    for (let i = 0; i < frames; i += 1) useEditor.getState().advancePlayback(dt);
  };

  beforeEach(() => {
    reset();
    startEpisode();
  });

  it('plays the whole cut rather than one scene', () => {
    expect(useEditor.getState().episodeDuration()).toBe(TOTAL);
  });

  it('advances through the first scene', () => {
    run(4);
    const state = useEditor.getState();
    expect(state.sceneId).toBe(seedIds()[0]);
    expect(state.playhead).toBeCloseTo(4, 1);
    expect(state.playbackPosition()).toEqual({ sceneId: seedIds()[0], sceneTime: expect.closeTo(4, 1) });
  });

  it('crosses the first boundary without resetting the clock', () => {
    // The whole phase in one assertion: a scene boundary must not be a reset.
    run(9.5);
    const before = useEditor.getState();
    expect(before.sceneId).toBe(seedIds()[0]);
    const beforeTime = before.playhead;

    run(1);
    const after = useEditor.getState();

    expect(after.sceneId).toBe(seedIds()[1]);
    expect(after.playhead).toBeGreaterThan(beforeTime);
    expect(after.playhead).toBeCloseTo(10.5, 1);
    // Explicitly not zero: this is the failure this phase exists to prevent.
    expect(after.playhead).not.toBe(0);
    expect(after.playbackPosition()).toEqual({
      sceneId: seedIds()[1],
      sceneTime: expect.closeTo(0.5, 1),
    });
  });

  it('crosses every boundary in the cut, moving the playhead forward each time', () => {
    let lastTime = -1;
    let lastScene = '';
    for (const boundary of BOUNDARIES) {
      run(boundary - useEditor.getState().playhead + 0.5);
      const state = useEditor.getState();
      expect(state.playhead).toBeGreaterThan(lastTime);
      expect(state.sceneId).not.toBe(lastScene);
      lastTime = state.playhead;
      lastScene = state.sceneId;
    }
    // Four boundaries crossed, and the playhead ended up inside the fifth scene.
    expect(useEditor.getState().sceneId).toBe(seedIds()[4]);
    expect(useEditor.getState().playhead).toBeCloseTo(32.5, 1);
  });

  it('reports the local time within whichever scene is active', () => {
    const ids = seedIds();
    // 14s is 4s into the second scene, which starts at 10.
    run(14);
    expect(useEditor.getState().playbackPosition()).toEqual({
      sceneId: ids[1],
      sceneTime: expect.closeTo(4, 1),
    });
    // 27s is 2s into the fourth, which starts at 25.
    run(13);
    expect(useEditor.getState().playbackPosition()).toEqual({
      sceneId: ids[3],
      sceneTime: expect.closeTo(2, 1),
    });
  });

  it('reaches the end of the episode and wraps to the start', () => {
    run(TOTAL - 0.5);
    expect(useEditor.getState().sceneId).toBe(seedIds()[4]);

    run(1);
    const state = useEditor.getState();
    // The end of the *cut* restarts the episode; the end of a scene does not.
    expect(state.playhead).toBeCloseTo(0.5, 1);
    expect(state.sceneId).toBe(seedIds()[0]);
  });

  it('stops and resumes where it left off', () => {
    run(7);
    const at = useEditor.getState().playhead;
    useEditor.getState().pause();
    run(3, 24);
    expect(useEditor.getState().playhead).toBeCloseTo(at, 6);

    useEditor.getState().play();
    run(0.5);
    expect(useEditor.getState().playhead).toBeCloseTo(at + 0.5, 1);
  });

  it('resolves the right scene when the playhead is scrubbed across a boundary', () => {
    const ids = seedIds();
    useEditor.getState().setPlayhead(20);
    const state = useEditor.getState();
    expect(state.playhead).toBe(20);
    expect(state.sceneId).toBe(ids[2]);
    expect(state.playbackPosition().sceneTime).toBeCloseTo(2, 6);
  });

  it('clamps a scrub to the episode rather than to the scene', () => {
    useEditor.getState().setPlayhead(-5);
    expect(useEditor.getState().playhead).toBe(0);
    useEditor.getState().setPlayhead(9999);
    expect(useEditor.getState().playhead).toBe(TOTAL);
  });

  it('moves the playhead to a scene the user picks, rather than to zero', () => {
    // Picking scene 3 in episode mode means "put me at scene 3", not "restart the
    // episode" — otherwise pressing play jumps away from where the user just clicked.
    useEditor.getState().setScene(seedIds()[2] ?? '');
    expect(useEditor.getState().playhead).toBe(18);
    expect(useEditor.getState().sceneId).toBe(seedIds()[2]);
  });

  it('clamps the local time to the open scene in scene-wrap mode', () => {
    // The renderer is handed a scene and a time and must never be asked for a time
    // outside that scene. Episode mode is bounded by `sceneAtTime`; scene-wrap has no
    // episode timeline behind it, so the store has to do it.
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');
    useEditor.setState({ playbackMode: 'scene-wrap', sceneId: first.id, playhead: 999 });

    expect(useEditor.getState().playbackPosition()).toEqual({
      sceneId: first.id,
      sceneTime: first.duration,
    });
  });

  it('resets the playhead when a scene is picked in scene-wrap mode', () => {
    useEditor.getState().setPlaybackMode('scene-wrap');
    useEditor.getState().setPlayhead(3);
    useEditor.getState().setScene(seedIds()[2] ?? '');
    expect(useEditor.getState().playhead).toBe(0);
  });

  it('re-expresses the position when the mode changes', () => {
    // Switching mode has to re-express the playhead, or the number keeps its value while
    // changing what it means — 20 is 20s into the cut, or 2s into scene 3.
    useEditor.getState().setPlayhead(20);
    useEditor.getState().setPlaybackMode('scene-wrap');
    expect(useEditor.getState().playhead).toBeCloseTo(2, 6);

    useEditor.getState().setPlaybackMode('episode-advance');
    expect(useEditor.getState().playhead).toBe(18);
  });

  it('keeps the episode playhead out of history', () => {
    run(12);
    expect(useEditor.getState().playhead).toBeCloseTo(12, 1);
    expect(useEditor.getState().past).toHaveLength(0);

    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');
    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 25), 'duration');
    useEditor.getState().undo();
    expect(useEditor.getState().playhead).toBeCloseTo(12, 1);
  });

  it('does not advance a project with no episode to play', () => {
    const empty = { ...createProject('No episode'), scenes: SEED_PROJECT.scenes };
    useEditor.setState({ project: empty, playhead: 0 });
    useEditor.getState().advancePlayback(1);
    expect(useEditor.getState().playhead).toBe(0);
    expect(useEditor.getState().episodeDuration()).toBe(0);
  });

  it('ignores a non-positive delta in episode mode too', () => {
    useEditor.getState().setPlayhead(5);
    useEditor.getState().advancePlayback(0);
    useEditor.getState().advancePlayback(-1);
    expect(useEditor.getState().playhead).toBe(5);
  });

  it('ignores a huge delta that would skip the whole cut', () => {
    // A single frame should never be able to jump the transport to the end: the stage
    // clamps dt for exactly this reason, and the clock must survive a caller that does
    // not.
    useEditor.getState().advancePlayback(1e6);
    expect(useEditor.getState().playhead).toBeLessThanOrEqual(TOTAL);
  });
});

/**
 * Building a cut, which is the only way a scene becomes exportable.
 *
 * The episode is the exporter's unit, so this pair of actions is the whole difference
 * between a project you can export and one you cannot. Both go through `commit`, so both are
 * undoable — a mis-click on a cut list should never cost more than one step back.
 */
describe('editorStore episodes', () => {
  beforeEach(reset);

  /** The cut of the episode just created, located by the id the action handed back. */
  function newCut(episodeId: string | null): string[] {
    if (episodeId === null) throw new Error('episode not created');
    const found = currentProject().episodes.find((e) => e.id === episodeId);
    if (!found) throw new Error(`episode ${episodeId} is not in the document`);
    return found.sceneIds;
  }

  it('creates an episode and hands back its id', () => {
    const id = useEditor.getState().createEpisode('Cut 002');
    expect(id).not.toBeNull();
    // The seed already has an episode, so the new one is located by id rather than by
    // position — a test that assumed index 0 would pass for the wrong reason.
    expect(currentProject().episodes.map((e) => e.title)).toContain('Cut 002');
    expect(currentProject().episodes.some((e) => e.id === id)).toBe(true);
  });

  it('returns no id when there is no project to add an episode to', () => {
    useEditor.setState({ project: null });
    expect(useEditor.getState().createEpisode('Cut 002')).toBeNull();
  });

  it('puts a scene into the episode', () => {
    const scene = currentProject().scenes[1];
    if (!scene) throw new Error('Seed project needs a second scene');
    const episodeId = useEditor.getState().createEpisode('Cut 002');

    useEditor.getState().addSceneToEpisode(scene.id, episodeId ?? '');

    expect(newCut(episodeId)).toEqual([scene.id]);
  });

  it('undoes putting a scene into the episode', () => {
    const scene = currentProject().scenes[1];
    if (!scene) throw new Error('Seed project needs a second scene');
    const episodeId = useEditor.getState().createEpisode('Cut 002');

    useEditor.getState().addSceneToEpisode(scene.id, episodeId ?? '');
    useEditor.getState().undo();

    expect(newCut(episodeId)).toEqual([]);
  });

  it('appends rather than replacing, so the cut keeps its order', () => {
    const [first, second] = currentProject().scenes;
    if (!first || !second) throw new Error('Seed project needs two scenes');
    const episodeId = useEditor.getState().createEpisode('Cut 002');
    const id = episodeId ?? '';

    useEditor.getState().addSceneToEpisode(first.id, id);
    useEditor.getState().addSceneToEpisode(second.id, id);

    expect(newCut(episodeId)).toEqual([first.id, second.id]);
  });

  it('records nothing when the scene is already in the cut', () => {
    const scene = currentProject().scenes[1];
    if (!scene) throw new Error('Seed project needs a second scene');
    const episodeId = useEditor.getState().createEpisode('Cut 002');
    const id = episodeId ?? '';
    useEditor.getState().addSceneToEpisode(scene.id, id);

    const depth = useEditor.getState().past.length;
    useEditor.getState().addSceneToEpisode(scene.id, id);

    // A history entry that undoes nothing is worse than none: the user presses undo and the
    // cut appears unchanged, so they press it again and lose real work.
    expect(useEditor.getState().past.length).toBe(depth);
    expect(newCut(episodeId)).toEqual([scene.id]);
  });

  it('refuses an episode that is not in the document', () => {
    const scene = currentProject().scenes[1];
    if (!scene) throw new Error('Seed project needs a second scene');
    const depth = useEditor.getState().past.length;

    useEditor.getState().addSceneToEpisode(scene.id, 'episode.nope');

    expect(useEditor.getState().status).toBe('error');
    expect(useEditor.getState().past.length).toBe(depth);
  });
});

/**
 * Putting a slot into the scene, which is the difference between a recording that exists and
 * a sound the cut plays.
 *
 * The defect this exists to prevent is silent and total: with no clip, an episode full of
 * attached audio exports a WAV of the right length containing nothing, and every layer above
 * reports success. The seed's slots are all fileless, so these tests attach a synthetic
 * reference rather than relying on the demo's silence.
 */
describe('editorStore audio placement', () => {
  // Slots the seed does not already place in the first scene, so "not yet in the scene" is a
  // real starting state rather than a claim about the demo project.
  const SLOT = 'audio.ambience.street';
  const oneShot = 'audio.sfx.door_open';

  /** The open scene's audio clips, as `audioPlan` will read them. */
  function placedClips(audioId: string): { duration: number; start: number }[] {
    const scene = currentProject().scenes.find((s) => s.id === useEditor.getState().sceneId);
    if (!scene) throw new Error('no open scene');
    return scene.tracks
      .filter((t) => t.kind === 'audio')
      .flatMap((t) => t.clips)
      .filter((c) => c.audioId === audioId)
      .map((c) => ({ duration: c.duration, start: c.start }));
  }

  function attach(audioId: string, duration: number): void {
    useEditor.setState({
      project: attachAudioMedia(currentProject(), audioId, `media_${audioId}`, duration),
    });
  }

  beforeEach(() => {
    reset();
    const scene = currentProject().scenes[0];
    if (!scene) throw new Error('Seed project needs a scene');
    useEditor.setState({ sceneId: scene.id, playbackMode: 'scene-wrap' });
  });

  it('reports a slot with no clip as not in the scene', () => {
    expect(useEditor.getState().audioSlotIsPlacedInScene(SLOT)).toBe(false);
  });

  it('places an ambience slot for the length of the scene', () => {
    const scene = currentProject().scenes[0];
    if (!scene) throw new Error('Seed project needs a scene');
    attach(SLOT, 2);

    useEditor.getState().placeAudioSlotInScene(SLOT);

    // Ambience loops inside its window, so the window is the whole scene and the 2s file
    // repeats to fill it. Clipping it to 2s would make a bed that stops in a 12s scene.
    expect(placedClips(SLOT)).toEqual([{ start: 0, duration: scene.duration }]);
    expect(useEditor.getState().audioSlotIsPlacedInScene(SLOT)).toBe(true);
  });

  it('places a one-shot for its measured length rather than the scene length', () => {
    const scene = currentProject().scenes[0];
    if (!scene) throw new Error('Seed project needs a scene');
    expect(scene.duration).toBeGreaterThan(3);
    attach(oneShot, 1.5);

    useEditor.getState().placeAudioSlotInScene(oneShot);

    expect(placedClips(oneShot)).toEqual([{ start: 0, duration: 1.5 }]);
  });

  it('refuses a slot with no file behind it', () => {
    useEditor.getState().placeAudioSlotInScene(SLOT);
    expect(placedClips(SLOT)).toEqual([]);
    expect(useEditor.getState().status).toBe('error');
  });

  it('refuses a one-shot whose length was never measured', () => {
    // A window guessed at 0 is a clip that either plays nothing or plays something the
    // operator did not choose. Neither is an acceptable answer.
    attach(oneShot, 0);
    useEditor.getState().placeAudioSlotInScene(oneShot);
    expect(placedClips(oneShot)).toEqual([]);
    expect(useEditor.getState().status).toBe('error');
  });

  it('undoes the placement', () => {
    attach(SLOT, 2);
    useEditor.getState().placeAudioSlotInScene(SLOT);
    useEditor.getState().undo();
    expect(placedClips(SLOT)).toEqual([]);
  });

  it('places the same slot only once, however many times it is asked', () => {
    attach(SLOT, 2);
    useEditor.getState().placeAudioSlotInScene(SLOT);
    const depth = useEditor.getState().past.length;

    useEditor.getState().placeAudioSlotInScene(SLOT);

    // A doubled bed is the kind of mistake nobody notices until the export is mixed, and
    // the record that undoes nothing is how it survives an undo.
    expect(placedClips(SLOT)).toHaveLength(1);
    expect(useEditor.getState().past.length).toBe(depth);
  });

  it('places into whichever scene is open, not the first one', () => {
    const second = currentProject().scenes[1];
    if (!second) throw new Error('Seed project needs a second scene');
    attach(SLOT, 2);
    useEditor.setState({ sceneId: second.id });

    useEditor.getState().placeAudioSlotInScene(SLOT);

    const first = currentProject().scenes[0];
    const firstClips =
      first?.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips).filter((c) => c.audioId === SLOT) ?? [];
    expect(firstClips).toEqual([]);
    expect(placedClips(SLOT)).toHaveLength(1);
  });
});

/**
 * The exporter reads the transport from the other side: its position has to be on the
 * episode clock even when the playhead is on the scene clock.
 *
 * Getting this wrong is silent. The panel would still draw, still produce the right number
 * of frames, and still write files — it would just export scene one over and over, or
 * export the wrong half of the cut, and nothing in the file says so.
 */
describe('episodeExportTarget', () => {
  const SECOND = SEED_PROJECT.scenes[1];
  if (!SECOND) throw new Error('Seed project needs a second scene');

  it('reports no target when there is no project or no episode', () => {
    expect(episodeExportTarget(null, 'scene-wrap', '', 0)).toEqual({ episodeId: null, episodeTime: 0 });
    const noEpisode = createProject('No episode');
    expect(episodeExportTarget(noEpisode, 'scene-wrap', '', 0)).toEqual({
      episodeId: null,
      episodeTime: 0,
    });
  });

  it('passes the playhead through in episode-advance mode', () => {
    const target = episodeExportTarget(SEED_PROJECT, 'episode-advance', SECOND.id, 7);
    expect(target.episodeId).toBe(SEED_PROJECT.episodes[0]?.id);
    expect(target.episodeTime).toBeCloseTo(7, 6);
  });

  it('offsets a scene-local playhead by where the scene starts in the cut', () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project needs a first scene');
    const sceneLocal = episodeExportTarget(SEED_PROJECT, 'scene-wrap', SECOND.id, 0);
    const episodeLocal = episodeExportTarget(SEED_PROJECT, 'episode-advance', SECOND.id, 0);

    // The whole point: the same playhead means two different instants, and the exporter
    // must be told the later one. Scene one is 12s in the seed, so the second scene's local
    // zero is not the episode's zero.
    expect(sceneLocal.episodeTime).toBeCloseTo(first.duration, 6);
    expect(sceneLocal.episodeTime).not.toBeCloseTo(episodeLocal.episodeTime, 3);
  });

  it('clamps a scene playhead to that scene, not to the cut', () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project needs a first scene');
    const past = episodeExportTarget(SEED_PROJECT, 'scene-wrap', SECOND.id, 9999);
    expect(past.episodeTime).toBeCloseTo(first.duration + SECOND.duration, 6);
  });

  it('never reports a position past the end of the episode', () => {
    const episode = SEED_PROJECT.episodes[0];
    if (!episode) throw new Error('Seed project needs an episode');
    const expected = episode.sceneIds.reduce((total, id) => {
      const scene = SEED_PROJECT.scenes.find((s) => s.id === id);
      if (!scene) throw new Error(`Seed episode references missing scene ${id}`);
      return total + scene.duration;
    }, 0);

    const target = episodeExportTarget(SEED_PROJECT, 'episode-advance', SECOND.id, 9999);
    expect(target.episodeTime).toBeCloseTo(expected, 6);
  });
});
