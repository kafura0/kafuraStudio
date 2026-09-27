/**
 * THE EDITOR STORE.
 *
 * One store, one source of truth. Every mutation goes through `commit()`, which is
 * the only place a document is replaced — so undo/redo cannot be bypassed by
 * accident (AGENTS.md RULE 7).
 *
 * Transient view state (playhead, selection, zoom, panel sizes) lives here too but
 * is deliberately kept out of history: scrubbing the playhead must never cost the
 * user an undo step.
 */

import { create } from 'zustand';
import { AUTOSAVE_DEBOUNCE_MS, HISTORY_LIMIT } from '../core/constants';
import type { Id, Project } from '../core/types';
import { SEED_PROJECT } from '../data/seed';
import { validateProject } from '../core/document/invariants';
import { touch } from '../core/document/projectOps';
import { IndexedDbProjectRepository, isIndexedDbAvailable } from '../core/persistence/indexedDb.browser';
import { createAutosave } from './autosave';

export type SelectionKind = 'actor' | 'prop' | 'clip' | 'keyframe' | 'anchor' | null;

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];

  // Transient: never recorded in history.
  playhead: number;
  playing: boolean;
  /** The scene the editor is showing. Always a member of `project.scenes`. */
  sceneId: Id;
  selection: { kind: SelectionKind; id: Id | null };
  dirty: boolean;
  lastSavedAt: string | null;

  /* --- navigation --- */
  setScene: (sceneId: Id) => void;
  setPlayhead: (time: number) => void;
  play: () => void;
  pause: () => void;
  select: (kind: SelectionKind, id: Id | null) => void;

  /* --- history --- */
  commit: (next: Project, label?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /* --- persistence --- */
  hydrate: () => Promise<void>;
  save: () => Promise<void>;
}

const repository = new IndexedDbProjectRepository();

export const useEditor = create<EditorState>((set, get) => {
  const autosave = createAutosave(() => {
    void get().save();
  });

  return {
    project: SEED_PROJECT,
    past: [],
    future: [],
    playhead: 0,
    playing: false,
    sceneId: SEED_PROJECT.scenes[0]?.id ?? '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,

    setScene: (sceneId) => set({ sceneId, playhead: 0, selection: { kind: null, id: null } }),
    setPlayhead: (time) => set({ playhead: Math.max(0, time) }),
    play: () => set({ playing: true }),
    pause: () => set({ playing: false }),
    select: (kind, id) => set({ selection: { kind, id } }),

    /**
     * The single mutation path.
     *
     * A no-op document is not committed: `commit` may be called from an effect or
     * an event handler, and pushing an identical snapshot would make undo feel
     * broken (one Ctrl+Z appearing to do nothing).
     */
    commit: (next, label) => {
      const state = get();
      if (next === state.project) return;

      const issues = validateProject(next);
      if (issues.length > 0) {
        // A mutation that breaks an invariant is a bug, not a user error. Refuse it
        // loudly in dev rather than letting a broken document into history.
        if (import.meta.env.DEV) {
          throw new Error(
            `Refusing to commit an invalid document${label ? ` (${label})` : ''}: ` +
              issues.map((i) => `${i.path}: ${i.message}`).join('; '),
          );
        }
        return;
      }

      const past = [...state.past, state.project].slice(-HISTORY_LIMIT);
      autosave.schedule();
      set({
        project: next,
        past,
        future: [],
        dirty: true,
      });
    },

    undo: () => {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (!previous) return;
      autosave.schedule();
      set({
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
    },

    redo: () => {
      const state = get();
      const [next, ...rest] = state.future;
      if (!next) return;
      autosave.schedule();
      set({
        project: next,
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: rest,
        dirty: true,
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    hydrate: async () => {
      if (!isIndexedDbAvailable()) return;
      try {
        const saved = await repository.loadMostRecent();
        if (!saved) return;
        // The open scene must belong to the project we just loaded, or the stage
        // would be pointing at an id that no longer exists.
        set({
          project: saved,
          sceneId: saved.scenes[0]?.id ?? '',
          playhead: 0,
          dirty: false,
          lastSavedAt: saved.updatedAt,
        });
      } catch (error) {
        // A corrupt or unreadable record must not stop the editor from opening; the
        // seed project is a working state, so the user loses nothing but the bad file.
        console.warn('Could not restore the last project; starting from the seed.', error);
      }
    },

    save: async () => {
      const state = get();
      const stamped = touch(state.project);
      if (!isIndexedDbAvailable()) return;
      await repository.save(stamped);
      set({ project: stamped, dirty: false, lastSavedAt: stamped.updatedAt });
    },
  };
});

export { AUTOSAVE_DEBOUNCE_MS };
