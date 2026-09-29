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
    return;
  }
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return;
  current.schedule(project, scene, time);
}

/** Tear down every scheduled source (pause, scene switch, scrub stop). */
export function stopPlaybackAudio(project: Project): void {
  getEngine(project)?.stop();
}