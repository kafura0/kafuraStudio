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

/**
 * Document format version this build writes.
 *
 * Lives here rather than in `serialize.ts` because both the serializer and the project
 * factory need it: a factory that stamped a stale version would produce a document the
 * parser had to migrate, and a `serialize` -> `factories` import already exists for the
 * empty asset library. Defining it in the cycle-free module keeps one source of truth.
 */
export const CURRENT_FORMAT_VERSION = 3;

/** Hard cap on retained undo snapshots. See ARCHITECTURE.md §3. */
export const HISTORY_LIMIT = 100;

/**
 * Autosave quiet period, ms.
 *
 * How long a burst of edits is allowed to keep going before the accumulated change is
 * written. Only meaningful for the *second and later* edits in a burst: the first edit of
 * a burst is written immediately (see `AUTOSAVE_LEADING_EDGE`).
 */
export const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * Autosave hard cap, ms.
 *
 * The longest a burst of edits may stay unpersisted, whatever it keeps doing. A drag
 * restarts the quiet period on every pointer move, so without a cap the quiet period can
 * be reset indefinitely and a long continuous gesture is never written at all until it
 * ends. See `createAutosave` for why the first edit is written immediately and what that
 * does and does not buy.
 */
export const AUTOSAVE_MAX_DELAY_MS = 3000;

/**
 * Whether the first edit of a burst is written immediately.
 *
 * The measured reason this exists: a trailing-only debounce lost a real edit. Committing
 * a change and reloading the page within the quiet period discarded it, because the
 * page-lifecycle flush cannot rescue it -- see `createAutosave`.
 */
export const AUTOSAVE_LEADING_EDGE = true;

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
