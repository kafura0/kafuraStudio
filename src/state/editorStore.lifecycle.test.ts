/**
 * Project lifecycle behaviour.
 *
 * The store is a workspace now, not a single document with a save button, so most of what
 * it has to get right is about *which* project is open and what happens to the one that
 * is not. None of that is covered by the history and persistence-race tests next door.
 *
 * What these tests exist to pin, in order of how badly it hurts when it is wrong:
 *
 *  - A created project is openable. It used to be saved and then quarantined as unreadable
 *    on first open, because the factory's empty library failed a validation rule that no
 *    longer applies. That is a record in the list that can never be opened again.
 *  - Switching projects does not lose the project being left behind. The debounce has not
 *    fired, so nothing is on disk, and the in-memory document disappears with the store.
 *  - Nothing reaches across documents. History, selection, playhead and the audio engine
 *    all belong to one project, and a leftover from the previous one is a wrong edit.
 *  - Archive is reversible. It is specified as "hidden, not deleted".
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { createEpisode, createProject } from '../core/document/factories';
import { validateProject } from '../core/document/invariants';
import { setSceneDuration } from '../core/document/projectOps';
import { SEED_PROJECT } from '../data/seed';
import { useEditor } from './editorStore';
import type { Project } from '../core/types';

/**
 * A repository that actually stores what it is given.
 *
 * The stub in the store's own test file records calls and returns null, which is the right
 * shape for testing that a write happened. It is the wrong shape for testing what the
 * editor does *after* a write, because opening a project then finds nothing. So this one
 * keeps the documents, and — importantly — parses on read the way the real repository
 * does, so a document that could not be read fails here exactly as it would in the app.
 */
const repository = vi.hoisted(() => {
  const stored = new Map<string, string>();
  return {
    stored,
    save: vi.fn(async (project: Project) => {
      stored.set(project.id, JSON.stringify({ formatVersion: project.formatVersion, project }));
    }),
    load: vi.fn(async (id: string): Promise<unknown> => {
      const raw = stored.get(id);
      if (raw === undefined) return null;
      const { parseProject } = await import('../core/serialize');
      return parseProject(raw);
    }),
    loadMostRecent: vi.fn(async (): Promise<unknown> => null),
    remove: vi.fn(async (id: string) => {
      stored.delete(id);
    }),
    list: vi.fn(async () => [] as { id: string; name: string; updatedAt: string; sceneCount: number; episodeCount: number; archivedAt: string | null }[]),
  };
});

vi.mock('../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => true,
  IndexedDbProjectRepository: vi.fn(() => repository),
}));

const openProject = (): Project => {
  const project = useEditor.getState().project;
  if (project === null) throw new Error('Expected a project to be open');
  return project;
};

const seedStored = (...projects: Project[]): void => {
  repository.stored.clear();
  for (const project of projects) {
    repository.stored.set(
      project.id,
      JSON.stringify({ formatVersion: project.formatVersion, project }),
    );
  }
};

const reset = (): void => {
  repository.save.mockClear();
  repository.load.mockClear();
  repository.remove.mockClear();
  repository.list.mockClear();
  repository.loadMostRecent.mockReset();
  repository.loadMostRecent.mockResolvedValue(null);
  repository.list.mockResolvedValue([]);
  seedStored();
  useEditor.setState({
    project: null,
    past: [],
    future: [],
    playhead: 0,
    playing: false,
    playbackMode: 'scene-wrap',
    sceneId: '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,
    status: 'ready',
    statusMessage: null,
    projects: [],
  });
};

beforeEach(reset);

describe('a project that was just created', () => {
  it('is saved and then openable', async () => {
    // The regression this whole file opens with. `createProject` returns an empty
    // library; if that fails validation on read, the record is quarantined the moment
    // anyone opens it, and the list gains a row that is permanently dead.
    await useEditor.getState().createProject('Episode 002');

    const created = [...repository.stored.values()];
    expect(created).toHaveLength(1);

    const id = JSON.parse(created[0] as string).project.id as string;
    const loaded = await useEditor.getState().peekProject(id);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Episode 002');
  });

  it('is not opened, and says so', async () => {
    // Creating a row in a list should not navigate away from the list.
    await useEditor.getState().createProject('Episode 002');

    expect(useEditor.getState().project).toBeNull();
    expect(useEditor.getState().statusMessage).toContain('Episode 002');
  });

  it('falls back to a usable name when given a blank one', async () => {
    await useEditor.getState().createProject('   ');
    const raw = [...repository.stored.values()][0] as string;
    expect(JSON.parse(raw).project.name).toBe('Untitled Project');
  });
});

/**
 * A new project has to be somewhere to *work*, not merely somewhere to exist.
 *
 * This is the test that decides whether "New project" is a real feature. The project
 * invariant requires a character and an environment as soon as there is a scene, and this
 * phase has no asset-authoring UI, so a strictly empty project opens into an editor that
 * cannot hold a scene at all: `commit` refuses the document and the user is stuck. The
 * starter library exists to close that gap, and this is where it is proven rather than
 * assumed.
 */
describe('a new project can actually be worked in', () => {
  it('holds a valid scene on the first try, with no asset authoring in between', async () => {
    await useEditor.getState().createProject('Episode 002');
    const id = JSON.parse([...repository.stored.values()][0] as string).project.id as string;
    await useEditor.getState().openProject(id);

    // Opening must succeed on its own terms: a project that is quarantined on read can
    // never be repaired, because the repair UI would be inside the document it broke.
    expect(useEditor.getState().status).toBe('ready');

    const project = openProject();
    expect(project.assets.environments.length).toBeGreaterThan(0);
    expect(project.assets.characters.length).toBeGreaterThan(0);

    act(() => useEditor.getState().createScene('SC01'));

    const withScene = openProject();
    expect(withScene.scenes).toHaveLength(1);

    // The point of the whole exercise. If this fails, the first scene a user adds is
    // rejected and "New project" is a dead button.
    expect(validateProject(withScene)).toEqual([]);

    // And the scene the user lands on is the one they made, not the top of the list.
    expect(useEditor.getState().sceneId).toBe(withScene.scenes[0]?.id);
  });

  it('makes the first scene undoable, in one step', async () => {
    await useEditor.getState().createProject('Episode 002');
    const id = JSON.parse([...repository.stored.values()][0] as string).project.id as string;
    await useEditor.getState().openProject(id);

    act(() => useEditor.getState().createScene('SC01'));
    expect(openProject().scenes).toHaveLength(1);

    act(() => useEditor.getState().undo());
    // Back to the project as it was opened. A scene that could not be taken out again
    // would make every experiment in a new project permanent.
    expect(openProject().scenes).toHaveLength(0);
  });

  it('carries no ZANZA canon into a second project', async () => {
    // The starter is a scaffold, not a second show. A new project inheriting Nia would
    // mean the browser handed out content the operator never asked for.
    await useEditor.getState().createProject('Episode 002');
    const raw = [...repository.stored.values()][0] as string;
    const text = JSON.stringify(JSON.parse(raw));

    expect(text).not.toContain('Nia');
    expect(text).not.toContain('Kito');
    expect(text).not.toContain('apartment');
  });
});

describe('adding an episode from the browser', () => {
  const projectWithEpisodes = (count: number): Project => ({
    ...createProject('Episode 002'),
    // Built with the factory rather than by hand: `Episode` has more fields than the
    // obvious four, and a hand-rolled literal is a test that breaks when it grows.
    episodes: Array.from({ length: count }, (_, i) => createEpisode(`Episode ${i}`)),
  });

  it('writes to the project that is not open, without opening it', async () => {
    // The browser shows a list of projects, so this is how an episode gets added to one
    // nobody is editing. Opening it to do so would be a navigation the operator did not
    // ask for, on the same principle as `createProject` not opening what it makes.
    const closed = projectWithEpisodes(0);
    seedStored(closed);

    await useEditor.getState().addEpisodeToProject(closed.id, 'Episode 001');

    expect(useEditor.getState().project).toBeNull();
    const stored = await useEditor.getState().peekProject(closed.id);
    expect(stored?.episodes.map((e) => e.title)).toEqual(['Episode 001']);
  });

  it('keeps the episodes that were already there', async () => {
    const closed = projectWithEpisodes(2);
    seedStored(closed);

    await useEditor.getState().addEpisodeToProject(closed.id, 'Episode 003');

    const stored = await useEditor.getState().peekProject(closed.id);
    expect(stored?.episodes).toHaveLength(3);
    expect(stored?.episodes.map((e) => e.title)).toEqual(['Episode 0', 'Episode 1', 'Episode 003']);
  });

  it('falls back to a usable title rather than storing a blank one', async () => {
    const closed = projectWithEpisodes(0);
    seedStored(closed);

    await useEditor.getState().addEpisodeToProject(closed.id, '  ');

    const stored = await useEditor.getState().peekProject(closed.id);
    expect(stored?.episodes[0]?.title).toBe('New Episode');
  });

  it('is undoable when it happens to be the project that is open', async () => {
    // Two paths to the same change, deliberately: an episode added to a closed project has
    // no session to undo into, but the same click against the open project has to land in
    // history like any other edit.
    const open = projectWithEpisodes(0);
    seedStored(open);
    await useEditor.getState().openProject(open.id);

    await useEditor.getState().addEpisodeToProject(open.id, 'Episode 001');
    expect(openProject().episodes).toHaveLength(1);

    act(() => useEditor.getState().undo());
    expect(openProject().episodes).toHaveLength(0);
  });

  it('reports a project it cannot read instead of writing nothing quietly', async () => {
    seedStored();
    await useEditor.getState().addEpisodeToProject('proj.missing', 'Episode 001');

    expect(useEditor.getState().status).toBe('error');
    expect(useEditor.getState().statusMessage).toContain('could not be read');
  });
});

describe('switching projects', () => {
  it('writes the outgoing project before leaving it', async () => {
    seedStored(SEED_PROJECT);
    await useEditor.getState().openProject(SEED_PROJECT.id);
    const other = createProject('Other');
    await useEditor.getState().createProject('Other');
    repository.save.mockClear();

    const sceneId = openProject().scenes[0]?.id ?? '';
    // An edit the debounce has not yet written: this is the case that used to vanish.
    useEditor.getState().commit(setSceneDuration(openProject(), sceneId, 42), 'edited');
    expect(repository.save).not.toHaveBeenCalled();

    await useEditor.getState().openProject(other.id);

    // The outgoing project reached storage with the edit in it.
    const written = repository.save.mock.calls.map(([p]) => p as Project);
    expect(written.some((p) => p.id === SEED_PROJECT.id && p.scenes[0]?.duration === 42)).toBe(
      true,
    );
  });

  it('leaves nothing of the previous project reachable', async () => {
    const other = createProject('Other');
    seedStored(SEED_PROJECT, other);
    await useEditor.getState().openProject(SEED_PROJECT.id);
    const sceneId = openProject().scenes[0]?.id ?? '';

    useEditor.getState().commit(setSceneDuration(openProject(), sceneId, 42), 'edited');
    useEditor.getState().select('actor', 'nia');
    useEditor.getState().setPlayhead(3);

    await useEditor.getState().openProject(other.id);

    // Undo must not restore a document from the project that was open before the switch,
    // and nothing may stay selected from it.
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().future).toHaveLength(0);
    expect(useEditor.getState().selection).toEqual({ kind: null, id: null });
    expect(useEditor.getState().playhead).toBe(0);
    expect(useEditor.getState().sceneId).not.toBe(sceneId);
    expect(useEditor.getState().playing).toBe(false);
  });

  it('reports a project that is not there without changing what is open', async () => {
    seedStored(SEED_PROJECT);
    await useEditor.getState().openProject(SEED_PROJECT.id);
    const before = openProject().id;

    await useEditor.getState().openProject('missing');

    expect(openProject().id).toBe(before);
    expect(useEditor.getState().status).toBe('error');
  });
});

describe('closing', () => {
  it('empties the editor and writes what was pending', async () => {
    seedStored(SEED_PROJECT);
    await useEditor.getState().openProject(SEED_PROJECT.id);
    const sceneId = openProject().scenes[0]?.id ?? '';
    useEditor.getState().commit(setSceneDuration(openProject(), sceneId, 42), 'edited');
    repository.save.mockClear();

    useEditor.getState().closeProject();

    expect(useEditor.getState().project).toBeNull();
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().playhead).toBe(0);
    // The flush is fire-and-forget by design — `pagehide` cannot await — so the write
    // lands on a later microtask. The point is that it was started at all.
    await Promise.resolve();
    expect(repository.save).toHaveBeenCalled();
  });

  it('leaves the store usable with nothing open', async () => {
    // Every viewer action has to survive the empty state. These are reachable from a
    // keyboard shortcut or a click landing in the frame between closing the project and
    // the editor unmounting, and `episode-advance` — the default mode — is the branch
    // that reaches for the document.
    useEditor.setState({ playbackMode: 'episode-advance' });
    useEditor.getState().closeProject();

    expect(useEditor.getState().activeDuration()).toBe(0);
    expect(useEditor.getState().episodeDuration()).toBe(0);
    expect(useEditor.getState().playbackPosition()).toEqual({ sceneId: '', sceneTime: 0 });

    useEditor.getState().play();
    useEditor.getState().advancePlayback(1);
    expect(useEditor.getState().playhead).toBe(0);
    useEditor.getState().pause();
    // Must not throw, and must not invent a position.
    useEditor.getState().setPlayhead(5);
    useEditor.getState().setScene('scene.nowhere');
    expect(useEditor.getState().playhead).toBe(0);
    expect(useEditor.getState().sceneId).toBe('');
    // The preference survives even though there was nothing to re-express it against.
    useEditor.getState().setPlaybackMode('scene-wrap');
    expect(useEditor.getState().playbackMode).toBe('scene-wrap');
  });
});

describe('archive', () => {
  it('hides a project without deleting it', async () => {
    seedStored(SEED_PROJECT);
    await useEditor.getState().archiveProject(SEED_PROJECT.id);

    const raw = repository.stored.get(SEED_PROJECT.id);
    expect(raw).toBeDefined();
    const stored = JSON.parse(raw as string).project as Project;
    expect(stored.metadata.archived).not.toBeNull();
  });

  it('can be undone, or it is a delete with a kinder button', async () => {
    seedStored(SEED_PROJECT);
    await useEditor.getState().archiveProject(SEED_PROJECT.id);
    await useEditor.getState().archiveProject(SEED_PROJECT.id, false);

    const stored = JSON.parse(repository.stored.get(SEED_PROJECT.id) as string).project as Project;
    expect(stored.metadata.archived).toBeNull();
  });

  it('closes the project if it was open', async () => {
    seedStored(SEED_PROJECT);
    await useEditor.getState().openProject(SEED_PROJECT.id);
    await useEditor.getState().archiveProject(SEED_PROJECT.id);
    expect(useEditor.getState().project).toBeNull();
  });
});

describe('delete', () => {
  it('removes the record and closes the project if it was open', async () => {
    seedStored(SEED_PROJECT);
    await useEditor.getState().openProject(SEED_PROJECT.id);
    await useEditor.getState().deleteProject(SEED_PROJECT.id);

    expect(repository.stored.has(SEED_PROJECT.id)).toBe(false);
    expect(repository.remove).toHaveBeenCalledWith(SEED_PROJECT.id);
    expect(useEditor.getState().project).toBeNull();
  });

  it('leaves other projects alone', async () => {
    const other = createProject('Other');
    seedStored(SEED_PROJECT, other);
    await useEditor.getState().openProject(SEED_PROJECT.id);
    await useEditor.getState().deleteProject(SEED_PROJECT.id);

    expect(repository.stored.has(other.id)).toBe(true);
  });
});

describe('import', () => {
  it('opens an imported project under a new id and a name from the file', async () => {
    const { exportProject } = await import('../core/io/projectIo');
    const { text, filename } = exportProject(SEED_PROJECT);

    await useEditor.getState().importProjectText(text, filename);

    const opened = openProject();
    expect(opened.id).not.toBe(SEED_PROJECT.id);
    // The name comes from the file, not from the document inside it: "something the user
    // recognises as *this* file". A filename is lowercased and hyphenated to be safe on
    // disk, so the exact string is not worth pinning - the marker is what matters.
    expect(opened.name).toContain('(imported)');
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it('changes nothing at all when the file is unreadable', async () => {
    seedStored(SEED_PROJECT);
    await useEditor.getState().openProject(SEED_PROJECT.id);
    const before = openProject();

    await useEditor.getState().importProjectText('{ not json', 'broken.zanza.json');

    // The failure has to cost the operator the document they were editing, and nothing
    // else. A half-applied import is the worst outcome available here.
    expect(openProject().id).toBe(before.id);
    expect(useEditor.getState().status).toBe('error');
    expect(repository.stored.size).toBe(1);
  });
});

describe('history labels', () => {
  it('names the action that is being undone', async () => {
    seedStored(SEED_PROJECT);
    await useEditor.getState().openProject(SEED_PROJECT.id);
    const sceneId = openProject().scenes[0]?.id ?? '';

    useEditor.getState().commit(setSceneDuration(openProject(), sceneId, 25), 'Set duration');
    useEditor.getState().undo();

    // The label rides with the state being left behind, so undo can say what it reversed
    // without the caller repeating itself.
    expect(useEditor.getState().future[0]?.label).toBe('Set duration');
  });
});
