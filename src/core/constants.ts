/**
 * Shared constants. Anything a "magic number" would otherwise be lives here so the
 * value is named and searchable.
 */

/** Authored frame for the whole product. */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;
export const STAGE_FPS = 24;

/** Sitcom shot length guide, used by the timeline's default scene duration. */
export const DEFAULT_SCENE_DURATION = 12;

/** Hard cap on retained undo snapshots. See ARCHITECTURE.md §3. */
export const HISTORY_LIMIT = 100;

/** Autosave debounce, ms. */
export const AUTOSAVE_DEBOUNCE_MS = 800;

/** Timeline snapping tolerance, in seconds. */
export const SNAP_THRESHOLD_SECONDS = 0.08;

/** Time format used throughout the UI and the exporter. */
export function formatTimecode(seconds: number, fps: number = STAGE_FPS): string {
  const safe = Math.max(0, seconds);
  const totalFrames = Math.round(safe * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60);
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

/** Round to the nearest frame boundary, so edits snap to the grid. */
export function quantizeToFrame(seconds: number, fps: number = STAGE_FPS): number {
  return Math.round(seconds * fps) / fps;
}
