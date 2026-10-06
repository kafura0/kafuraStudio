/**
 * Store ↔ engine adapter for the playback clock.
 *
 * The store owns time (advancePlayback); this adapter feeds that time to the Web
 * Audio engine each frame while playing and stops it on pause or scene switch. It
 * is deliberately thin — all decisions live in pure `audioPlan` and in the engine.
 *
 * The engine is built lazily on the first playing frame, so nothing in this module
 * touches `AudioContext` at import time (headless tests and the static build never
 * construct it). When the browser has no audio, the adapter is permanently silent —
 * which is also what the seed data produces today (all slots are `src: null`).
 */
import { type AudioEngine, createBrowserAudioEngine } from '../core/audio/audioEngine.browser';
import type { Id, Project, SceneContext } from '../core/types';
import { mediaStore } from './mediaLibrary';

let engine: AudioEngine | null | undefined;

/**
 * Which project's asset library the engine was built for.
 *
 * This is a fix for a real bug. The engine resolves clip ids to files once, at
 * construction, from the asset list it was handed. Caching it without recording *whose*
 * assets those were meant one project forever: switching projects left the engine
 * playing the first project's recordings against the second project's clips, which
 * sounds like silence or like the wrong scene rather than like an error.
 */
let engineProjectId: Id | null = null;

/**
 * The scene the engine last scheduled for.
 *
 * The engine keys its "already scheduled" bookkeeping by clip id and forgets everything
 * only on `stop()`. Two scenes can therefore share a clip id — or, more to the point,
 * the old scene's sources keep running and its clips stay marked as scheduled — so a
 * boundary crossing has to clear the engine explicitly. Detecting the change here means
 * the store does not have to remember whether a boundary is the first frame of a scene
 * or the five-hundredth.
 */
let scheduledSceneId: Id | null = null;

function getEngine(project: Project, context: SceneContext): AudioEngine | null {
  if (engine !== undefined && engineProjectId === project.id) return engine;
  // A different project, or an engine cleared by hand. Whatever was sounding belongs to
  // the document we are leaving, so it is stopped rather than allowed to ring on.
  engine?.stop();
  // The byte source is what makes an *attached* file audible: a local `src` is a media id,
  // and the engine can only read it through the store that holds the bytes.
  //
  // The slot list is the *resolved* library, never `project.assets`. After the split the
  // voices live on the series, so a project-only list hands the engine an empty vocabulary
  // and every line goes quiet — a silent scene is indistinguishable from a broken mixer,
  // which is why this takes the context explicitly instead of reaching into the document.
  engine = createBrowserAudioEngine(
    context.assets.audio as readonly {
      id: Id;
      src: string | null;
      srcKind: 'local' | 'external' | null;
    }[],
    async (mediaId) => (await mediaStore().get(mediaId))?.data ?? null,
  );
  engineProjectId = project.id;
  scheduledSceneId = null;
  return engine;
}

/**
 * Forget the engine entirely.
 *
 * Called when a project is closed or the workspace goes back to having nothing open, so
 * the next project gets an engine built from its own assets rather than inheriting one.
 */
export function resetPlaybackAudio(): void {
  engine?.stop();
  engine = undefined;
  engineProjectId = null;
  scheduledSceneId = null;
}

/** Feed the current scene time into the engine each frame while playing. */
export function syncPlaybackAudio(
  project: Project,
  context: SceneContext,
  sceneId: Id,
  time: number,
  playing: boolean,
): void {
  const current = getEngine(project, context);
  if (!current) return;
  if (!playing) {
    current.stop();
    scheduledSceneId = null;
    return;
  }
  // A scene change is a hard cut: whatever the previous scene was sounding has to stop
  // before the new scene's segments are scheduled, or an ambience bed runs on across a
  // location change.
  if (scheduledSceneId !== null && scheduledSceneId !== sceneId) {
    current.stop();
  }
  scheduledSceneId = sceneId;
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return;
  current.schedule(context, scene, time);
}

/** Tear down every scheduled source (pause, scene switch, scrub stop). */
export function stopPlaybackAudio(project: Project, context: SceneContext): void {
  scheduledSceneId = null;
  getEngine(project, context)?.stop();
}

/**
 * Play a slot's file once, outside the timeline.
 *
 * This exists so an attachment can be checked the moment it is made, and it deliberately
 * goes through the same engine and the same media-backed resolver as scene playback rather
 * than opening an `<audio>` element. That is the whole reason the feature is trustworthy:
 * if preview used a different path, "it played in the preview" would say nothing about
 * whether the file plays in the cut.
 *
 * The engine is stopped first and afterwards, so a preview cannot ring on underneath a
 * transport that has been paused — the panel's own Stop button, a scene change, or the
 * next preview.
 *
 * Returns whether a file was actually started. An empty slot, a missing record, and an
 * undecodable buffer are all silence, and reporting them as "played" would make the panel
 * claim success for the exact case the user needs to know about.
 */
export async function previewAudioAsset(
  project: Project,
  context: SceneContext,
  audioId: Id,
): Promise<boolean> {
  const current = getEngine(project, context);
  if (!current) return false;
  const started = await current.preview(context, audioId);
  return started;
}
