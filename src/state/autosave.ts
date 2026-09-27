/**
 * Autosave scheduling.
 *
 * A debounce, not a throttle: dragging a keyframe produces a commit per frame, and
 * writing all of those to IndexedDB would cost more than the edit is worth. We
 * save once the user pauses, plus a hard interval so a long continuous drag still
 * gets captured.
 */

import { AUTOSAVE_DEBOUNCE_MS } from '../core/constants';

export interface Autosave {
  /** Request a save. Repeated calls within the window collapse into one. */
  schedule: () => void;
  /** Run any pending save immediately. */
  flush: () => void;
  /** Cancel a pending save without running it. */
  cancel: () => void;
  /** True while a save is pending. */
  isPending: () => boolean;
}

export function createAutosave(save: () => void, delay = AUTOSAVE_DEBOUNCE_MS): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = (): void => {
    timer = null;
    save();
  };

  return {
    schedule: () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(run, delay);
    },
    flush: () => {
      if (timer === null) return;
      clearTimeout(timer);
      run();
    },
    cancel: () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
    isPending: () => timer !== null,
  };
}
