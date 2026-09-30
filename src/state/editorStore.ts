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
import { clamp } from '../core/geometry';
import type { Id, Project } from '../core/types';
import { SEED_PROJECT } from '../data/seed';
import { validateProject } from '../core/document/invariants';
import { touch } from '../core/document/projectOps';
import { IndexedDbProjectRepository, isIndexedDbAvailable } from '../core/persistence/indexedDb.browser';
import {
  buildEpisodeTimeline,
  safeEpisodeTime,
  sceneAtTime,
  timeOfScene,
  type EpisodeTimeline,
} from '../core/timeline/episode';
import { createAutosave } from './autosave';
import { syncPlaybackAudio, stopPlaybackAudio } from './audioChannel';

export type SelectionKind = 'actor' | 'prop' | 'clip' | 'keyframe' | 'anchor' | 'line' | null;

/**
 * What the clock wraps at.
 *
 * `scene-wrap` loops the open scene forever, which is the behaviour a single scene's
 * loop preview wants. `episode-advance` walks the whole cut and only wraps at the end
 * of the episode, so the transport crosses scene boundaries instead of resetting — the
 * difference between watching a scene and watching an episode.
 *
 * The mode is a view preference, not a document setting: it is not part of the project
 * and does not belong in history.
 */
export type PlaybackMode = 'scene-wrap' | 'episode-advance';

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];

  // Transient: never recorded in history.
  /**
   * The playhead, in the units the active playback mode uses: seconds into the open
   * scene in `scene-wrap`, seconds into the episode in `episode-advance`.
   *
   * One number rather than two, because two would be two clocks. `playhead` is the
   * clock; `sceneId` is derived from it in `episode-advance` mode. See `setScene`.
   */
  playhead: number;
  playing: boolean;
  playbackMode: PlaybackMode;
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
  setPlaybackMode: (mode: PlaybackMode) => void;
  /**
   * Advance the playhead by `dt` seconds. A no-op unless playing.
   *
   * This is the clock. The Stage's animation frame calls it, and everything else
   * reads `playhead` — the transport readout, the timeline playhead, the stage
   * itself. There is deliberately only one of them: a second clock held privately by
   * the stage would be correct on screen and frozen everywhere else, so the scrubber
   * and the playhead marker would sit still during playback.
   *
   * In `episode-advance` this resolves the new episode time to a scene and a
   * scene-local time, and moves `sceneId` with it. The arithmetic lives in
   * `src/core/timeline/episode.ts`; this function only decides what to do with the
   * answer.
   *
   * Not a commit: the playhead is transient view state and must never enter history.
   */
  advancePlayback: (dt: number) => void;
  /** Duration of the active scene in seconds; 0 when the project has no scenes. */
  activeDuration: () => number;
  /**
   * Total length of the active episode in seconds, or 0 when the project has no
   * episode to play.
   */
  episodeDuration: () => number;
  /**
   * The scene-local time the renderer should be given, and the scene it belongs to.
   *
   * This is the seam between the episode transport and the renderer. The transport
   * decides *which* scene and *what* local time; `renderScene` still decides how that
   * scene looks. Anything asking the store what to draw asks this, rather than
   * re-deriving the mapping.
   */
  playbackPosition: () => { sceneId: Id; sceneTime: number };
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

/**
 * The database name the editor has always used.
 *
 * Persistence is named by the product, not by a show, so the engine carries only a
 * default. This app still opens its original name because that is where existing
 * projects live: changing it would present an empty project list and quietly orphan
 * every saved document. Renaming the on-disk store is a storage migration with a
 * copy-forward step, and it belongs in the phase that owns that migration rather than
 * being smuggled in here.
 */
const LEGACY_DB_NAME = 'zanza-studio';

const repository = new IndexedDbProjectRepository({ dbName: LEGACY_DB_NAME });

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

/**
 * The episode the transport plays.
 *
 * The first episode in document order. A project today has one, and choosing
 * "the first" is deterministic rather than arbitrary — a selector would be a way to
 * pick which episode is playing, which is a different feature and gets its own state
 * when it earns one.
 */
function activeEpisodeId(project: Project): Id | null {
  return project.episodes[0]?.id ?? null;
}

export const useEditor = create<EditorState>((set, get) => {
  const autosave = createAutosave(() => {
    void get().save();
  });

  /** The episode timeline for the current project. Rebuilt per call, never cached. */
  const timeline = (project: Project): EpisodeTimeline | null => {
    const id = activeEpisodeId(project);
    return id ? buildEpisodeTimeline(project, id) : null;
  };

  return {
    project: SEED_PROJECT,
    past: [],
    future: [],
    playhead: 0,
    playing: false,
    // Episode playback is the shipped behaviour; scene-wrap is what the single-scene
    // loop preview wants and is kept as a mode rather than a second clock.
    playbackMode: 'episode-advance',
    showSubtitles: true,
    sceneId: SEED_PROJECT.scenes[0]?.id ?? '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,

    setScene: (sceneId) => {
      const state = get();
      stopPlaybackAudio(state.project);
      // In episode mode the playhead means "where in the episode", so picking a scene
      // has to move it to that scene's first frame. Leaving it at 0 would teleport the
      // transport back to the top of the cut while the panel shows another scene, and
      // pressing play would jump away from where the user just clicked.
      const playhead =
        state.playbackMode === 'episode-advance'
          ? timeOfScene(timeline(state.project), sceneId)
          : 0;
      set({ sceneId, playhead, selection: { kind: null, id: null } });
    },

    setPlayhead: (time) => {
      const state = get();
      if (state.playbackMode === 'episode-advance') {
        const at = safeEpisodeTime(time, timeline(state.project)?.duration ?? 0);
        // Scrubbing across a boundary has to move the scene with it, or the stage would
        // keep drawing the old scene until playback happened to cross over.
        const position = sceneAtTime(timeline(state.project), at);
        set({ playhead: at, ...(position.scene ? { sceneId: position.scene.id } : {}) });
        return;
      }
      set({ playhead: Math.max(0, time) });
    },

    play: () => set({ playing: true }),
    pause: () => {
      stopPlaybackAudio(get().project);
      set({ playing: false });
    },
    toggleSubtitles: () => set((s) => ({ showSubtitles: !s.showSubtitles })),
    setPlaybackMode: (mode) => {
      // Switching mode has to re-express the current position in the new clock, or the
      // playhead would keep its number while meaning something different.
      const state = get();
      if (mode === state.playbackMode) return;
      if (mode === 'scene-wrap') {
        const local = sceneAtTime(timeline(state.project), state.playhead).sceneTime;
        set({ playbackMode: mode, playhead: local });
        return;
      }
      const at = timeOfScene(timeline(state.project), state.sceneId);
      set({ playbackMode: mode, playhead: at });
    },

    activeDuration: () => {
      const { project, sceneId } = get();
      return project.scenes.find((s) => s.id === sceneId)?.duration ?? 0;
    },

    episodeDuration: () => timeline(get().project)?.duration ?? 0,

    playbackPosition: () => {
      const state = get();
      if (state.playbackMode === 'scene-wrap') {
        // Clamp to the open scene. `sceneAtTime` guarantees the range in episode mode,
        // but a scene-wrap scrub is bounded only at the bottom, and the renderer must
        // never be handed a time outside the scene it was asked to draw.
        const duration = state.activeDuration();
        return { sceneId: state.sceneId, sceneTime: clamp(state.playhead, 0, duration) };
      }
      const position = sceneAtTime(timeline(state.project), state.playhead);
      return { sceneId: position.sceneId, sceneTime: position.sceneTime };
    },

    advancePlayback: (dt) => {
      const state = get();
      if (!state.playing || dt <= 0) return;

      if (state.playbackMode === 'scene-wrap') {
        const duration = state.activeDuration();
        if (duration <= 0) return;
        // Wrap rather than clamp: the stage loops its scene, and stopping dead at the
        // end would leave the playhead pinned while the transport still reads "Play".
        const next = (state.playhead + dt) % duration;
        set({ playhead: next < 0 ? 0 : next });
        syncPlaybackAudio(state.project, state.sceneId, next, true);
        return;
      }

      const projectTimeline = timeline(state.project);
      const duration = projectTimeline?.duration ?? 0;
      if (duration <= 0) return;

      const next = state.playhead + dt;
      const position = sceneAtTime(projectTimeline, next);

      // The end of the *episode* wraps; the end of a scene does not. The distinction is
      // the whole point of the mode: a scene boundary is a place the transport passes
      // through with the clock still running, and only the end of the cut restarts.
      if (position.ended) {
        // Modulo, not a single subtraction. The stage clamps its own dt, but a caller
        // that does not — a backgrounded tab, a slow frame — would otherwise leave the
        // playhead at 10^6 with the transport reading "Play" and nothing on screen.
        const wrapped = ((next % duration) + duration) % duration;
        const at = sceneAtTime(projectTimeline, wrapped);
        set({ playhead: wrapped, sceneId: at.sceneId });
        syncPlaybackAudio(state.project, at.sceneId, at.sceneTime, true);
        return;
      }

      set({ playhead: next, sceneId: position.sceneId });
      syncPlaybackAudio(state.project, position.sceneId, position.sceneTime, true);
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
