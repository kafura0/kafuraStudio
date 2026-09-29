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
import { syncPlaybackAudio, stopPlaybackAudio } from './audioChannel';

export type SelectionKind = 'actor' | 'prop' | 'clip' | 'keyframe' | 'anchor' | 'line' | null;

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];

  // Transient: never recorded in history.
  playhead: number;
  playing: boolean;
  /** Draw the subtitle bar. A view preference, not a document setting. */
  showSubtitles: boolean;
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
  toggleSubtitles: () => void;
  /**
   * Advance the playhead by `dt` seconds, wrapping at the end of the active scene.
   * A no-op unless playing.
   *
   * This is the clock. The Stage's animation frame calls it, and everything else
   * reads `playhead` — the transport readout, the timeline playhead, the stage
   * itself. There is deliberately only one of them: a second clock held privately by
   * the stage would be correct on screen and frozen everywhere else, so the scrubber
   * and the playhead marker would sit still during playback.
   *
   * Not a commit: the playhead is transient view state and must never enter history.
   */
  advancePlayback: (dt: number) => void;
  /** Duration of the active scene in seconds; 0 when the project has no scenes. */
  activeDuration: () => number;
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

/**
 * Serialises writes to the repository.
 *
 * `save` awaits IndexedDB, and two overlapping saves can otherwise land out of order,
 * so the older document wins in the database even though the newer one is what the
 * user last edited.
 *
 * This holds the last queued *write*, and is awaited by the next save before it starts
 * its own. A rejected write is absorbed here rather than in the queue, so one failure
 * cannot poison every save that follows it.
 */
let pendingSave: Promise<unknown> = Promise.resolve();

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
    showSubtitles: true,
    sceneId: SEED_PROJECT.scenes[0]?.id ?? '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,

    setScene: (sceneId) => {
      stopPlaybackAudio(get().project);
      set({ sceneId, playhead: 0, selection: { kind: null, id: null } });
    },
    setPlayhead: (time) => set({ playhead: Math.max(0, time) }),
    play: () => set({ playing: true }),
    pause: () => {
      stopPlaybackAudio(get().project);
      set({ playing: false });
    },
    toggleSubtitles: () => set((s) => ({ showSubtitles: !s.showSubtitles })),

    activeDuration: () => {
      const { project, sceneId } = get();
      return project.scenes.find((s) => s.id === sceneId)?.duration ?? 0;
    },

    advancePlayback: (dt) => {
      const state = get();
      if (!state.playing || dt <= 0) return;
      const duration = state.activeDuration();
      if (duration <= 0) return;
      // Wrap rather than clamp: the stage loops its scene, and stopping dead at the
      // end would leave the playhead pinned while the transport still reads "Play".
      const next = (state.playhead + dt) % duration;
      set({ playhead: next < 0 ? 0 : next });
      syncPlaybackAudio(state.project, state.sceneId, next, true);
    },

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
        //
        // History is cleared because it belongs to the document that was open before
        // the load. Left in place, Ctrl+Z would restore a whole different project, and
        // a selection could name an actor that this project does not contain.
        set({
          project: saved,
          sceneId: saved.scenes[0]?.id ?? '',
          playhead: 0,
          playing: false,
          past: [],
          future: [],
          selection: { kind: null, id: null },
          dirty: false,
          lastSavedAt: saved.updatedAt,
        });
      } catch (error) {
        // A corrupt or unreadable record must not stop the editor from opening; the
        // seed project is a working state, so the user loses nothing but the bad file.
        console.warn('Could not restore the last project; starting from the seed.', error);
      }
    },

    /**
     * Write the current document.
     *
     * Two things here are deliberate and were both bugs.
     *
     * The `await` yields, and the user can edit during it. The document that comes
     * back from this function is therefore possibly older than what is in the store.
     * Writing it back unconditionally would silently destroy whatever was committed
     * while the write was in flight, so the result is only adopted if the store still
     * holds the document that was actually saved. If it does not, the newer edit stays
     * dirty and its own autosave will persist it.
     *
     * Writes are chained. Two overlapping saves could otherwise reach IndexedDB out of
     * order, and the older one would win.
     */
    save: async () => {
      const project = get().project;
      if (!isIndexedDbAvailable()) return;

      const stamped = touch(project);
      // The repository call itself is queued, not just the awaiting of it. Chaining
      // `pendingSave` after starting the write would leave every save running
      // concurrently with all the others, and it is the completion order - not the
      // start order - that decides which document ends up in the database.
      const write = pendingSave.then(
        () => repository.save(stamped),
        () => repository.save(stamped),
      );
      // The queue must survive a failed write, or one rejected save would reject every
      // save after it and the project would silently stop persisting.
      pendingSave = write.then(
        () => undefined,
        () => undefined,
      );
      await write;

      if (get().project === project) {
        set({ project: stamped, dirty: false, lastSavedAt: stamped.updatedAt });
      }
    },
  };
});

export { AUTOSAVE_DEBOUNCE_MS };
