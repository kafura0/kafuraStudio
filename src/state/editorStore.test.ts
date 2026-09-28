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
import { useEditor } from './editorStore';
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

    const before = useEditor.getState().project;
    useEditor.getState().commit(setSceneDuration(before, first.id, 25), 'duration');

    expect(useEditor.getState().project.scenes[0]?.duration).toBe(25);
    expect(useEditor.getState().past).toHaveLength(1);

    useEditor.getState().undo();
    expect(useEditor.getState().project.scenes[0]?.duration).toBe(before.scenes[0]?.duration);
  });

  it('redo restores the committed document', () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');

    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 25), 'duration');
    useEditor.getState().undo();
    useEditor.getState().redo();

    expect(useEditor.getState().project.scenes[0]?.duration).toBe(25);
    expect(useEditor.getState().future).toHaveLength(0);
  });

  it('does not record a commit that changes nothing', () => {
    // An effect or handler may call commit with the document it already has; that
    // would make undo appear broken.
    useEditor.getState().commit(useEditor.getState().project, 'noop');
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
      setSceneDuration(useEditor.getState().project, first.id, 42),
      'edited during save',
    );
    await saving;

    expect(useEditor.getState().project.scenes[0]?.duration).toBe(42);
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

    expect(useEditor.getState().project.scenes[0]?.duration).toBe(25);
    expect(useEditor.getState().dirty).toBe(false);
    expect(useEditor.getState().lastSavedAt).not.toBeNull();
  });

  it('stores the document that was current, not the one that started the write', async () => {
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');

    useEditor.getState().commit(setSceneDuration(SEED_PROJECT, first.id, 25), 'edited');
    const saving = useEditor.getState().save();
    useEditor.getState().commit(
      setSceneDuration(useEditor.getState().project, first.id, 42),
      'later',
    );
    await saving;

    // The in-flight write holds 25. It must not clobber the store, which holds 42,
    // and the 42 document is still awaiting its own autosave.
    const written = repository.save.mock.calls.at(-1)?.[0] as { scenes: { duration: number }[] };
    expect(written.scenes[0]?.duration).toBe(25);
    expect(useEditor.getState().project.scenes[0]?.duration).toBe(42);  });

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
    expect(useEditor.getState().project.scenes[0]?.duration).toBe(22);
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
    expect(useEditor.getState().project.name).toBe('Other');
  });
});
