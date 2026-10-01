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
import { probeAudioDuration } from '../core/audio/probe.browser';
import { createId } from '../core/id';
import { clamp } from '../core/geometry';
import type { Id, Project } from '../core/types';
import { createProject as newProject } from '../core/document/factories';
import { validateProject } from '../core/document/invariants';
import {
  addEpisode,
  attachAudioMedia,
  createSceneInProject,
  deleteScene as deleteSceneOp,
  detachAudioMedia,
  touch,
} from '../core/document/projectOps';
import { starterAssetLibrary } from '../data/starter';
import { duplicateProject, importProject } from '../core/io/projectIo';
import { ProjectParseError } from '../core/serialize';
import type { ProjectSummary } from '../core/persistence/repository';
import { IndexedDbProjectRepository, isIndexedDbAvailable } from '../core/persistence/indexedDb.browser';
import { adoptLegacyWorkspace } from '../core/persistence/adoptLegacyWorkspace.browser';
import {
  buildEpisodeTimeline,
  safeEpisodeTime,
  sceneAtTime,
  timeOfScene,
  type EpisodeTimeline,
} from '../core/timeline/episode';
import { createAutosave } from './autosave';
import {
  previewAudioAsset,
  resetPlaybackAudio,
  syncPlaybackAudio,
  stopPlaybackAudio,
} from './audioChannel';
import { mediaStore } from './mediaLibrary';

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

/**
 * One undoable step.
 *
 * The label is the point. "Undo" that cannot say what it is undoing forces the user to
 * undo, look, and undo again to find out. The label describes the action that moved
 * *away* from `project`, so `undo()` can report "Undid: Move actor" without the caller
 * having to remember what it did.
 */
export interface HistoryEntry {
  label: string;
  project: Project;
}

/**
 * Whether there is anything to edit.
 *
 * `loading` exists so the shell can say "opening…" instead of flashing the project
 * browser every time a project is switched, and `error` exists so a failure is shown
 * rather than swallowed. The old code logged a warning and displayed the seed, which is
 * indistinguishable from success.
 */
export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EditorState {
  /**
   * The open document, or `null` when nothing is open.
   *
   * `null` is a real state, not a loading artefact: the editor is a multi-project
   * workspace, and "no project open" is what the project browser shows. It is also what
   * makes a failed open honest — a failed open leaves `null` rather than a project the
   * user never chose.
   */
  project: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  status: SessionStatus;
  /** Why the last open or import failed, in words. Cleared by the next attempt. */
  statusMessage: string | null;
  /** The workspace listing, for the project browser. Refreshed on demand. */
  projects: ProjectSummary[];

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
  /** Run a pending autosave immediately. See the note on the implementation. */
  flushAutosave: () => void;

  /* --- project lifecycle --- */
  /** Reload the workspace listing. */
  refreshProjects: () => Promise<void>;
  /** Open a project by id. Leaves `project` null and reports if it fails. */
  openProject: (id: Id) => Promise<void>;
  /** Close the open project. Flushes pending work first. */
  closeProject: () => void;
  /** Create a project from the factory, save it, and open it. */
  createProject: (name: string) => Promise<void>;
  /** Copy the open project. No-op when nothing is open. */
  duplicateOpenProject: (name?: string) => Promise<void>;
  /** Import a serialized project and open it. Writes nothing if the file is unreadable. */
  importProjectText: (text: string, filename: string) => Promise<void>;
  /**
   * Read a project without opening it.
   *
   * Separate from `openProject` on purpose: exporting a project must not switch the
   * workspace over to it. A read that changes what is on screen is a side effect dressed
   * as a getter, and the first version of this did exactly that.
   */
  peekProject: (id: Id) => Promise<Project | null>;
  deleteProject: (id: Id) => Promise<void>;
  /**
   * Hide a project from the browser, or bring a hidden one back.
   *
   * Archive is specified as "hidden from the default list, not deleted" — which only
   * means something if there is a way to undo it. This toggles, because an archive with
   * no un-archive is a delete with extra steps and a reassuring label.
   */
  archiveProject: (id: Id, archived?: boolean) => Promise<void>;
  /**
   * Add an episode to a project by id, whether or not it is the one open.
   *
   * The browser lists projects rather than the episodes inside them, so this is how a new
   * episode gets made before anything is open. It writes straight through when the target
   * is closed — there is no session to undo into for a document nobody is editing — and
   * routes through `commit` when it is the open one, so an episode added from the browser
   * while that project happens to be open is still undoable.
   */
  addEpisodeToProject: (id: Id, title: string) => Promise<void>;
  /** Dismiss the status message. */
  clearStatus: () => void;

  /* ---- Document actions ------------------------------------------- */
  /*
   * Phase 11 exists because the previous phase left a workspace with no way in or out of
   * a document: `project` was always a seed, and there was no such thing as an empty one.
   * These three are the mutations a multi-project workspace needs to be usable at all, and
   * they are here rather than in the panels because every document mutation goes through
   * `commit` — which is what makes it undoable (RULE 7). A panel that built a document by
   * hand and pushed it into the store would be a mutation with no history.
   */

  /**
   * Add a scene and make it the active one.
   *
   * An empty project is the state `createProject` leaves behind, and it is legal (§ see the
   * scoped asset invariant) but useless: an open project with no scenes has nothing to
   * edit, nothing to render, and no timeline. This is the action that makes a project
   * created in the browser into something the user can actually work in.
   *
   * `environmentId` defaults to the first environment in the library, because a scene
   * needs a background and a brand new project has none — the alternative is a button
   * that is disabled on every project the user just created.
   */
  createScene: (name: string, environmentId?: Id) => void;
  /** Add an episode. Episodes are containers for scenes, so this is safe on an empty project. */
  createEpisode: (title: string) => void;
  /** Delete a scene, and drop it from every episode that referenced it. */
  deleteScene: (sceneId: Id) => void;

  /* ---- Audio slots ---------------------------------------------- */
  /**
   * Attach a local audio file to a slot, and save it to the media store.
   *
   * The two writes are ordered deliberately: the bytes go in first, then the document is
   * committed. The reverse order can produce a document that references media which was
   * never written — an attachment that survives a reload as a broken reference.
   *
   * Undoable, because the document half goes through `commit` like everything else. Undo
   * restores the previous `src`; the bytes stay in the store, because a duplicate or an
   * undo may still need them.
   */
  attachAudioFile: (audioId: Id, file: File) => Promise<void>;
  /**
   * Forget the media a slot points at, leaving the slot declared but empty.
   *
   * Does not delete the bytes: undo brings the attachment back, and a duplicated project
   * shares the same media id. Reclaiming storage is a separate sweep.
   */
  clearAudioFile: (audioId: Id) => void;
  /**
   * Play a slot's file once, for checking an attachment without a timeline.
   *
   * Uses the same engine and the same resolver as scene playback, so a preview that is
   * audible is evidence the slot is audible. Reports whether anything was actually played:
   * a slot with no file, or bytes the browser cannot decode, is silence and must not read
   * as success.
   */
  previewAudio: (audioId: Id) => Promise<boolean>;
}

/**
 * The workspace database is the core default, `kafura-studio`, and this module does not
 * override it.
 *
 * It used to hardcode the original name so that existing projects kept appearing, which
 * worked only because nothing ever moved them. The rename is now a real migration --
 * `adoptLegacyWorkspace` copies the original database forward on first launch -- so the
 * active name is the product name and there is exactly one place that decides it, in core.
 *
 * The media store resolves the same name from the same default (`mediaLibrary.ts`). One
 * workspace, one database: if the two opened different names, a document could reference
 * media bytes that live in a database nothing reads.
 */
const repository = new IndexedDbProjectRepository();

/**
 * The database this app originally wrote, kept for the copy-forward in `hydrate`.
 *
 * This is the one place allowed to know the show's name: it is a storage name from this
 * app's history, not creative content, and it lives in the state layer precisely so that
 * `core` can provide the migration without knowing what it is migrating.
 */
const LEGACY_WORKSPACE_DB_NAME = 'zanza-studio';

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

/** A message a person can act on, from an unknown thrown value. */
function describe(error: unknown): string {
  if (error instanceof ProjectParseError) return error.message;
  if (error instanceof Error && error.message !== '') return error.message;
  return 'Something went wrong. Your project has not been changed.';
}

/**
 * What to say when a stored project would not open.
 *
 * The distinction that matters: the document is safe, it is in quarantine, and the reason
 * is named. The old behaviour — a console warning and the seed on screen — told the
 * operator nothing and then let the next save overwrite the very record that failed.
 */
function quarantineMessage(error: unknown): string {
  const reason = describe(error);
  return (
    `A saved project could not be read and has been set aside rather than overwritten. ` +
    `Reason: ${reason} Nothing else was lost, and you can restore or discard it from the project list.`
  );
}

/** Import failures are read errors, and saying so is more useful than a raw parser error. */
function importFailureMessage(error: unknown): string {
  if (error instanceof ProjectParseError) {
    return `That file is not a readable project, so nothing was imported. ${error.message}`;
  }
  return `That file could not be imported, so nothing was changed. ${describe(error)}`;
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
    // Nothing is open at startup. The previous version started on the seed, which meant
    // the editor always looked like a working session — so the project browser was
    // unreachable, and a first-time operator was dropped into a show they did not create
    // with no way back. `hydrate` decides what is open by looking at what is stored.
    project: null,
    past: [],
    future: [],
    // Loading, not ready: until `hydrate` has asked the database, the honest answer to
    // "is anything open" is "we do not know yet", and the browser shows that rather than
    // flashing an empty list before the records arrive.
    status: 'loading',
    statusMessage: null,
    projects: [],
    playhead: 0,
    playing: false,
    // Episode playback is the shipped behaviour; scene-wrap is what the single-scene
    // loop preview wants and is kept as a mode rather than a second clock.
    playbackMode: 'episode-advance',
    showSubtitles: true,
    sceneId: '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,

    setScene: (sceneId) => {
      const state = get();
      // See `setPlayhead`: with no project open these viewer actions are no-ops. They can
      // still be reached from a keyboard shortcut or a click that lands in the frame
      // between the project closing and the editor unmounting, and taking the tab down
      // for that would be the worst possible trade.
      if (state.project === null) return;
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
      // With no project open there is no clock to snap to, so the scrub is a no-op rather
      // than a throw. `episode-advance` is the default mode, which means this was the
      // *likely* path: any stray scrub while the project browser was showing would have
      // taken the editor down, and a viewer that is not on screen cannot be scrubbed in
      // the first place.
      if (state.project === null) return;
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

    play: () => {
      // Same reasoning as `setPlayhead`: with no project there is no clock to run. The
      // spacebar shortcut is bound to `window`, so it fires on the project browser too,
      // and a transport flag set there would be a state nothing can ever clear.
      if (get().project === null) return;
      set({ playing: true });
    },
    pause: () => {
      // Stopping audio is the point of pausing, but with nothing open there is nothing to
      // stop — and a null here is normal rather than exceptional.
      const project = get().project;
      if (project !== null) stopPlaybackAudio(project);
      set({ playing: false });
    },
    toggleSubtitles: () => set((s) => ({ showSubtitles: !s.showSubtitles })),
    setPlaybackMode: (mode) => {
      // Switching mode has to re-express the current position in the new clock, or the
      // playhead would keep its number while meaning something different.
      const state = get();
      if (mode === state.playbackMode) return;
      if (state.project === null) {
        // The mode is still worth recording — it is a preference, and it survives the
        // project — but there is no position to re-express it against.
        set({ playbackMode: mode });
        return;
      }
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
      if (project === null) return 0;
      return project.scenes.find((s) => s.id === sceneId)?.duration ?? 0;
    },

    episodeDuration: () => {
      const project = get().project;
      return project === null ? 0 : (timeline(project)?.duration ?? 0);
    },

    playbackPosition: () => {
      const state = get();
      if (state.project === null) return { sceneId: '', sceneTime: 0 };
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
      if (!state.playing || dt <= 0 || state.project === null) return;
      const project = state.project;

      if (state.playbackMode === 'scene-wrap') {
        const duration = state.activeDuration();
        if (duration <= 0) return;
        // Wrap rather than clamp: the stage loops its scene, and stopping dead at the
        // end would leave the playhead pinned while the transport still reads "Play".
        const next = (state.playhead + dt) % duration;
        set({ playhead: next < 0 ? 0 : next });
        syncPlaybackAudio(project, state.sceneId, next, true);
        return;
      }

      const projectTimeline = timeline(project);
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
        syncPlaybackAudio(project, at.sceneId, at.sceneTime, true);
        return;
      }

      set({ playhead: next, sceneId: position.sceneId });
      syncPlaybackAudio(project, position.sceneId, position.sceneTime, true);
    },

    select: (kind, id) => set({ selection: { kind, id } }),

    createScene: (name, environmentId) => {
      const state = get();
      if (state.project === null) return;
      // A scene without a background is not a scene, so the environment is chosen rather
      // than asked for. Taking the first one means the button works on a project that has
      // been imported, duplicated, or copied from the pilot, without asking the caller to
      // know what is in the library.
      const environment = environmentId ?? state.project.assets.environments[0]?.id;
      if (environment === undefined) {
        // Nothing to put the scene in. Saying so beats inventing an id, which would
        // produce a scene that fails validation and draws nothing.
        set({
          status: 'error',
          statusMessage: 'This project has no environment yet, so there is nothing to add a scene to.',
        });
        return;
      }
      const { project, sceneId } = createSceneInProject(state.project, {
        name,
        environmentId: environment,
      });
      state.commit(project, `add scene "${name}"`);
      // Land on what was just made. Selecting nothing would leave the stage showing the
      // previous scene while the list highlights the new one.
      set({ sceneId, selection: { kind: null, id: null } });
    },

    createEpisode: (title) => {
      const state = get();
      if (state.project === null) return;
      state.commit(addEpisode(state.project, title), `add episode "${title}"`);
    },

    deleteScene: (sceneId) => {
      const state = get();
      if (state.project === null) return;
      const next = deleteSceneOp(state.project, sceneId);
      if (next === state.project) return;
      state.commit(next, 'delete scene');
      // Deleting the scene being viewed would leave the editor pointing at nothing while
      // history still holds the document, so move to whatever is now first.
      if (state.sceneId === sceneId) {
        set({ sceneId: next.scenes[0]?.id ?? '', playhead: 0, selection: { kind: null, id: null } });
      }
    },

    attachAudioFile: async (audioId, file) => {
      const state = get();
      if (state.project === null) return;
      const def = state.project.assets.audio.find((a) => a.id === audioId);
      if (!def) {
        set({ status: 'error', statusMessage: 'That audio slot no longer exists.' });
        return;
      }
      // A cancelled file input reports an empty name, and reading it yields zero bytes that
      // would decode to nothing and then be reported as a successfully attached file.
      if (!file || file.size === 0) {
        set({ status: 'error', statusMessage: 'That file is empty, so there is nothing to attach.' });
        return;
      }
      try {
        const bytes = await file.arrayBuffer();
        const duration = await probeAudioDuration(bytes);
        if (duration === null) {
          set({
            status: 'error',
            statusMessage: `"${file.name}" could not be decoded as audio by this browser.`,
          });
          return;
        }
        // A fresh id every time. Reusing the previous id would overwrite the bytes an undo
        // would then want to restore, so attaching a replacement would make undo lose the
        // file it is supposed to bring back.
        const mediaId = createId('media');
        const createdAt = new Date().toISOString();
        await mediaStore().put({
          id: mediaId,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: bytes.byteLength,
          createdAt,
          duration,
          data: bytes,
        });
        get().commit(
          attachAudioMedia(get().project as Project, audioId, mediaId, duration),
          `attach audio "${file.name}"`,
        );
        // The engine caches decoded buffers per project, so an engine built while this slot
        // was empty holds a cached "nothing" for it. Dropping the engine makes the next
        // playback resolve the file that is now attached.
        resetPlaybackAudio();
        set({ status: 'ready', statusMessage: `Attached "${file.name}" to "${def.name}".` });
      } catch (error) {
        set({ status: 'error', statusMessage: describe(error) });
      }
    },

    clearAudioFile: (audioId) => {
      const state = get();
      if (state.project === null) return;
      const def = state.project.assets.audio.find((a) => a.id === audioId);
      if (!def) return;
      get().commit(detachAudioMedia(get().project as Project, audioId), `clear audio "${def.name}"`);
      // Same reason as attach: the cached buffer for this asset is stale either way, and
      // clearing must not leave the previous file audible.
      resetPlaybackAudio();
    },

    previewAudio: async (audioId) => {
      const project = get().project;
      if (project === null) return false;
      return previewAudioAsset(project, audioId);
    },

    /**
     * The single mutation path.
     *
     * A no-op document is not committed: `commit` may be called from an effect or
     * an event handler, and pushing an identical snapshot would make undo feel
     * broken (one Ctrl+Z appearing to do nothing).
     */
    commit: (next, label) => {
      const state = get();
      if (next === state.project || state.project === null) return;

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

      // The label goes on the state being *left behind*, so undo can name the action it
      // is reversing without the caller telling it again.
      const past = [...state.past, { label: label ?? 'Edit', project: state.project }].slice(-HISTORY_LIMIT);
      set({
        project: next,
        past,
        future: [],
        dirty: true,
      });
      // After the state is applied, never before. The autosave leads its burst by writing
      // synchronously inside this call, so scheduling ahead of `set` would hand the write
      // the document being replaced and drop the edit.
      autosave.schedule();
    },

    undo: () => {
      const state = get();
      const entry = state.past[state.past.length - 1];
      if (!entry || state.project === null) return;
      set({
        project: entry.project,
        past: state.past.slice(0, -1),
        // Redo replays the action named by the entry we just consumed.
        future: [{ label: entry.label, project: state.project }, ...state.future].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
      autosave.schedule();
    },

    redo: () => {
      const state = get();
      const [entry, ...rest] = state.future;
      if (!entry || state.project === null) return;
      set({
        project: entry.project,
        past: [...state.past, { label: entry.label, project: state.project }].slice(0, HISTORY_LIMIT),
        future: rest,
        dirty: true,
      });
      autosave.schedule();
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    hydrate: async () => {
      // Before anything reads: the workspace database was renamed, and a project saved
      // under the original name has to be present in the active store or the operator sees
      // an empty workspace and assumes their work is gone. It copies forward only when the
      // active store is empty and never writes to the old one, so it is safe to attempt on
      // every launch. A failure here is not fatal — the active workspace is still usable,
      // and a legacy project is still readable in the old database.
      try {
        await adoptLegacyWorkspace(LEGACY_WORKSPACE_DB_NAME);
      } catch {
        // Deliberately swallowed. Failing to adopt must not stop the editor from opening:
        // a workspace with no legacy data is the normal case, and that must not look like
        // an error. The old records are untouched either way.
      }
      await get().refreshProjects();
      if (!isIndexedDbAvailable()) return;
      set({ status: 'loading', statusMessage: null });
      try {
        const saved = await repository.loadMostRecent();
        if (!saved) {
          set({ status: 'ready' });
          return;
        }
        // The open scene must belong to the project we just loaded, or the stage
        // would be pointing at an id that no longer exists.
        //
        // History is cleared because it belongs to the document that was open before
        // the load. Left in place, Ctrl+Z would restore a whole different project, and
        // a selection could name an actor that this project does not contain.
        resetPlaybackAudio();
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
          status: 'ready',
        });
      } catch (error) {
        // The record has already been moved to quarantine by the repository, so the
        // operator's bytes survive. What matters now is that this is *reported* rather
        // than logged: the old path warned to the console and left the seed on screen,
        // which looks exactly like a successful restore.
        await get().refreshProjects();
        set({
          status: 'error',
          statusMessage: quarantineMessage(error),
        });
      }
    },

    refreshProjects: async () => {
      if (!isIndexedDbAvailable()) return;
      try {
        set({ projects: await repository.list() });
      } catch (error) {
        set({ status: 'error', statusMessage: describe(error) });
      }
    },

    openProject: async (id) => {
      if (!isIndexedDbAvailable()) return;
      // Switching is Close then Open, and Close flushes. Without this the project being
      // left behind keeps its unsaved edits only in memory: the debounce has not fired,
      // `dirty` is about to stop meaning anything, and the work is gone with no error and
      // no undo step. The target is the same project that is being opened, so a redundant
      // reload of it would be a pointless write, not a safety measure.
      if (get().project !== null && get().project?.id !== id) {
        get().flushAutosave();
        resetPlaybackAudio();
      }
      set({ status: 'loading', statusMessage: null });
      try {
        const opened = await repository.load(id);
        if (!opened) {
          set({ status: 'error', statusMessage: 'That project no longer exists.' });
          return;
        }
        // The engine resolves clip ids against the asset list it was built with, so a
        // project switch has to tear it down. Without this it kept serving the previous
        // project's recordings.
        resetPlaybackAudio();
        set({
          project: opened,
          sceneId: opened.scenes[0]?.id ?? '',
          playhead: 0,
          playing: false,
          past: [],
          future: [],
          selection: { kind: null, id: null },
          dirty: false,
          lastSavedAt: opened.updatedAt,
          status: 'ready',
        });
        await get().refreshProjects();
      } catch (error) {
        await get().refreshProjects();
        set({ status: 'error', statusMessage: describe(error) });
      }
    },

    closeProject: () => {
      // Anything not yet written has to be written before the document leaves the store,
      // otherwise closing a project is a silent discard.
      get().flushAutosave();
      resetPlaybackAudio();
      set({
        project: null,
        sceneId: '',
        playhead: 0,
        playing: false,
        past: [],
        future: [],
        selection: { kind: null, id: null },
        dirty: false,
        lastSavedAt: null,
        status: 'idle',
        statusMessage: null,
      });
      void get().refreshProjects();
    },

    createProject: async (name) => {
      if (!isIndexedDbAvailable()) return;
      set({ status: 'loading', statusMessage: null });
      try {
        // A brand new project starts from the factory plus the starter library, not from
        // the seed's contents. The seed is one show; a second project is the operator's
        // own, and shipping them the pilot's scenes would be a content decision leaking
        // into a workflow.
        const created = newProject(name.trim() === '' ? 'Untitled Project' : name.trim());
        await repository.save({
          ...created,
          // The starter set is what makes a new project a place to work rather than a
          // valid document with nothing in it: the project invariant demands a character
          // and an environment as soon as there is a scene, and there is no asset UI in
          // this phase to supply them. See `src/data/starter.ts`.
          assets: starterAssetLibrary(),
        });
        // Deliberately not opened. Creating a project and landing in an empty editor is
        // not the same as asking to work in it, and a browser that jumps away from the
        // list the moment you add a row is a list you cannot add a second row to. The
        // new project appears in the list and opens when it is chosen.
        set({ status: 'ready', statusMessage: `Created "${created.name}". Open it to start.` });
        await get().refreshProjects();
      } catch (error) {
        set({ status: 'error', statusMessage: describe(error) });
      }
    },

    duplicateOpenProject: async (name) => {
      const current = get().project;
      if (current === null) return;
      if (!isIndexedDbAvailable()) return;
      set({ status: 'loading', statusMessage: null });
      try {
        const copy = duplicateProject(current, name);
        await repository.save(copy);
        resetPlaybackAudio();
        set({
          project: copy,
          sceneId: copy.scenes[0]?.id ?? '',
          playhead: 0,
          playing: false,
          past: [],
          future: [],
          selection: { kind: null, id: null },
          dirty: false,
          lastSavedAt: copy.updatedAt,
          status: 'ready',
        });
        await get().refreshProjects();
      } catch (error) {
        set({ status: 'error', statusMessage: describe(error) });
      }
    },

    importProjectText: async (text, filename) => {
      if (!isIndexedDbAvailable()) return;
      set({ status: 'loading', statusMessage: null });
      try {
        // Parsed before anything is written. An unreadable file must not leave a
        // half-created project behind, which is why the import returns a project or
        // throws and never a partial one.
        const result = importProject(text, filename);
        await repository.save(result.project);
        resetPlaybackAudio();
        set({
          project: result.project,
          sceneId: result.project.scenes[0]?.id ?? '',
          playhead: 0,
          playing: false,
          past: [],
          future: [],
          selection: { kind: null, id: null },
          dirty: false,
          lastSavedAt: result.project.updatedAt,
          status: 'ready',
          statusMessage: result.warnings[0] ?? null,
        });
        await get().refreshProjects();
      } catch (error) {
        // The open project is untouched. A failed import must not cost the operator the
        // document they were editing.
        set({ status: 'error', statusMessage: importFailureMessage(error) });
      }
    },

    peekProject: async (id) => {
      if (!isIndexedDbAvailable()) return null;
      try {
        return await repository.load(id);
      } catch (error) {
        set({ status: 'error', statusMessage: describe(error) });
        return null;
      }
    },

    deleteProject: async (id) => {
      if (!isIndexedDbAvailable()) return;
      const wasOpen = get().project?.id === id;
      try {
        await repository.remove(id);
        if (wasOpen) get().closeProject();
        await get().refreshProjects();
      } catch (error) {
        set({ status: 'error', statusMessage: describe(error) });
      }
    },

    addEpisodeToProject: async (id, title) => {
      if (!isIndexedDbAvailable()) return;
      const trimmed = title.trim() === '' ? 'New Episode' : title.trim();
      try {
        const project = await repository.load(id);
        // An episode added to a project that cannot be read is a no-op, not a crash: the
        // row is either archived-and-gone or quarantined, and neither is somewhere a new
        // episode could be stored.
        if (!project) {
          set({ status: 'error', statusMessage: 'That project could not be read.' });
          await get().refreshProjects();
          return;
        }
        // `addEpisode` applies `touch`, so this does move the project to the top of a
        // modification-sorted list — which is correct here, unlike archiving.
        const next = addEpisode(project, trimmed);
        if (get().project?.id === id) {
          // Editing the project that happens to be open goes through history like any
          // other document change, so the episode can be taken back out.
          get().commit(next, `add episode "${trimmed}"`);
          return;
        }
        await repository.save(next);
        set({ status: 'ready', statusMessage: `Added "${trimmed}".` });
        await get().refreshProjects();
      } catch (error) {
        set({ status: 'error', statusMessage: describe(error) });
      }
    },

    archiveProject: async (id, archived = true) => {
      if (!isIndexedDbAvailable()) return;
      try {
        const project = await repository.load(id);
        // Archiving a record that is quarantined or missing is a no-op, not an error the
        // operator has to dismiss: they asked to hide something already hidden.
        if (!project) {
          await get().refreshProjects();
          return;
        }
        await repository.save({
          ...project,
          // `touch` is deliberately not applied: archiving is a filing decision, not an
          // edit, and bumping `updatedAt` would float the project to the top of a list
          // sorted by modification time.
          metadata: { ...project.metadata, archived: archived ? new Date().toISOString() : null },
        });
        if (get().project?.id === id) get().closeProject();
        await get().refreshProjects();
      } catch (error) {
        set({ status: 'error', statusMessage: describe(error) });
      }
    },

    clearStatus: () => set({ statusMessage: null }),

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
      if (!isIndexedDbAvailable() || project === null) return;

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

    /**
     * Write any pending autosave right now.
     *
     * The store owns the debounce, but the page-lifecycle events are the UI's to bind.
     * This is the seam between them. Without it the autosave timer is the only thing
     * that can ever start a save, and an edit made in the last second of a session is
     * lost when the tab closes.
     */
    flushAutosave: () => {
      autosave.flush();
    },
  };
});

/**
 * The open project, for components that only exist inside the editor.
 *
 * Panels cannot render without a project, and `App` guarantees one is open before it
 * mounts any of them. This states that guarantee in one place instead of making every
 * panel re-check a nullable value it has no way to handle — there is no sensible panel
 * layout for "no project", because the correct answer to that is the project browser,
 * which is a different screen entirely.
 *
 * Throwing rather than returning a placeholder is deliberate. A null reaching here means
 * a component was mounted outside the editor, which is a wiring bug; failing loudly at
 * the point of the mistake beats a blank panel that looks like an empty project.
 */
export function useOpenProject(): Project {
  const project = useEditor((s) => s.project);
  if (project === null) {
    throw new Error(
      'useOpenProject was called while no project is open. Components using it must only ' +
        'be mounted inside the editor, not in the project browser.',
    );
  }
  return project;
}

export { AUTOSAVE_DEBOUNCE_MS };
