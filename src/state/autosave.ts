/**
 * Autosave scheduling.
 *
 * A debounce, not a throttle: dragging a keyframe produces a commit per frame, and
 * writing all of those to IndexedDB would cost more than the edit is worth. We
 * save once the user pauses, plus a hard cap so a long continuous drag still
 * gets captured.
 *
 * There is one more rule, and it is the important one, because the leading edge is not an
 * optimisation. A trailing-only debounce *loses edits*, and it was measured losing them:
 * commit a change, reload inside the quiet period, and the change is gone. The obvious
 * rescue is to flush on `visibilitychange` and `pagehide`, which the store does bind, and
 * those events do fire -- measured, in order, a couple of milliseconds before teardown.
 * It does not help. The save is an async IndexedDB write, `pagehide` cannot await it, and
 * Chrome discards the transaction when the document goes away. Issuing the write on the
 * same edit instead of on the way out is what actually lands:
 *
 *     edit, then immediate reload        -> edit lost        (no flush at all)
 *     edit + flush issued at edit time   -> edit persisted  (write already in flight)
 *
 * So a burst of edits is written on both edges:
 *
 * - leading: the first edit of a burst is written immediately. A discrete edit -- adding
 *   a scene, naming a shot, attaching audio -- is the overwhelming majority of what a user
 *   does, and it is now durable the moment it is committed.
 * - trailing: later edits in the same burst are collapsed and written once the user pauses,
 *   so a drag still costs one write instead of one per frame.
 * - cap: a burst that keeps going is written at least every `maxDelay`, so a long
 *   continuous gesture cannot stay unpersisted indefinitely.
 *
 * What this still does not buy, stated plainly rather than implied: a hard kill (the
 * process is killed, the machine sleeps and dies) runs no event handler at all, so the
 * only defence there is that the previous write already happened. That is the cap's job,
 * and it is why the cap exists. Zero loss for an edit made microseconds before a hard
 * kill is not achievable with IndexedDB, which has no synchronous write path.
 */

import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_LEADING_EDGE,
  AUTOSAVE_MAX_DELAY_MS,
} from '../core/constants';

export interface Autosave {
  /**
   * Request a save. Repeated calls within the window collapse into one.
   *
   * Call this *after* the state to be persisted has been applied. The leading write runs
   * synchronously inside this call, so scheduling ahead of the state update hands the
   * write the document that is being replaced.
   */
  schedule: () => void;
  /** Run any pending save immediately. */
  flush: () => void;
  /** Cancel a pending save without running it. */
  cancel: () => void;
  /** True while a save is pending. */
  isPending: () => boolean;
}

export function createAutosave(
  save: () => void,
  delay = AUTOSAVE_DEBOUNCE_MS,
  maxDelay = AUTOSAVE_MAX_DELAY_MS,
  leadingEdge = AUTOSAVE_LEADING_EDGE,
): Autosave {
  /** Trailing timer: fires when the user has paused. */
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cap timer: fires when a burst has been going on too long to keep waiting. */
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Closes a burst that went quiet after a single leading write.
   *
   * The leading write arms no save timer, so a silent burst is otherwise indistinguishable
   * from a burst that is still going. Without this the burst stays open forever, every
   * later edit falls through to the trailing path, and the leading edge only ever fires on
   * the very first edit of the session — which was measured: only one edit per page load
   * was written immediately, everything else waited the full debounce.
   */
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Whether a burst is open, meaning this scheduler has already written for it and owes
   * the rest of it a trailing write.
   *
   * Tracked separately from the timers because the leading write arms no save timer:
   * deriving "is a burst underway" from a *save* timer instead makes every edit look like
   * the first of its burst, and the debounce silently never engages.
   */
  let burstOpen = false;

  const clearQuiet = (): void => {
    if (quietTimer !== null) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }
  };

  const clearCap = (): void => {
    if (capTimer !== null) {
      clearTimeout(capTimer);
      capTimer = null;
    }
  };

  const clearClose = (): void => {
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  /** The burst is over: nothing more is owed until the next edit. */
  const endBurst = (): void => {
    burstOpen = false;
    clearQuiet();
    clearCap();
    clearClose();
  };

  /** Close a silent burst. Never writes. */
  const closeBurst = (): void => {
    closeTimer = null;
    // A quiet and a cap both mean a second edit has joined the burst, so the trailing save
    // is already owed. Closing now would discard it.
    if (quietTimer === null && capTimer === null) burstOpen = false;
  };

  /**
   * Run the cap save. Re-arms itself while the burst continues, so a gesture that never
   * pauses is still captured at a steady rate instead of once at the end.
   */
  const runCap = (): void => {
    capTimer = null;
    save();
    if (quietTimer !== null) capTimer = setTimeout(runCap, maxDelay);
  };

  return {
    schedule: () => {
      if (leadingEdge && !burstOpen) {
        burstOpen = true;
        save();
        closeTimer = setTimeout(closeBurst, delay);
        return;
      }

      burstOpen = true;
      clearQuiet();
      quietTimer = setTimeout(() => {
        quietTimer = null;
        save();
        endBurst();
      }, delay);

      // The cap only matters once there is a burst to interrupt. Arming it on the leading
      // edge instead would double every discrete edit into a redundant second write.
      if (capTimer === null) capTimer = setTimeout(runCap, maxDelay);
    },
    flush: () => {
      if (quietTimer === null && capTimer === null) return;
      save();
      endBurst();
    },
    cancel: () => {
      endBurst();
    },
    isPending: () => quietTimer !== null || capTimer !== null,
  };
}
