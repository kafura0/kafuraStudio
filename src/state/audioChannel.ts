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
import type { Id, Project } from '../core/types';

let engine: AudioEngine | null | undefined;

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

function getEngine(project: Project): AudioEngine | null {
  if (engine !== undefined) return engine;
  engine = createBrowserAudioEngine(project.assets.audio as readonly { id: Id; src: string | null }[]);
  return engine;
}

/** Feed the current scene time into the engine each frame while playing. */
export function syncPlaybackAudio(
  project: Project,
  sceneId: Id,
  time: number,
  playing: boolean,
): void {
  const current = getEngine(project);
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
  current.schedule(project, scene, time);
}

/** Tear down every scheduled source (pause, scene switch, scrub stop). */
export function stopPlaybackAudio(project: Project): void {
  scheduledSceneId = null;
  getEngine(project)?.stop();
}
