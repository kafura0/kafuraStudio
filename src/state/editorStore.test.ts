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

import { describe, expect, it, beforeEach } from 'vitest';
import { useEditor } from './editorStore';
import { SEED_PROJECT } from '../data/seed';
import { setSceneDuration } from '../core/document/projectOps';
import { createProject } from '../core/document/factories';

const reset = (): void => {
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
