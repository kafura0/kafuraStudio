/**
 * Flushing the pending autosave when the page is going away.
 *
 * The autosave is a debounce, which is right for editing and wrong for leaving. A
 * document that was changed in the last second of a session sat in a timer that never
 * fired, and closing the tab lost it. This binds the two page-lifecycle events that
 * actually fire on the way out:
 *
 * - `visibilitychange` to `hidden`: switching tabs, minimising, and on most mobile
 *   browsers backgrounding. Fires reliably and early.
 * - `pagehide`: navigation and tab close.
 *
 * Honest limitation, because it decides how much this is worth: a `pagehide` handler
 * cannot await. The save is an async IndexedDB write, so whether it completes before the
 * document is torn down is up to the browser. `visibilitychange` is the one that
 * reliably wins the race, which is why it is bound and not just `pagehide`. The real fix
 * for a hard crash is the next save, not this handler.
 */

export interface LifecycleBinding {
  /** Remove both listeners. Call on unmount so a remount does not double-save. */
  unbind: () => void;
}

export interface PageLifecycleTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface PageLifecycleOptions {
  window?: PageLifecycleTarget | undefined;
  document?: (PageLifecycleTarget & { visibilityState?: string }) | undefined;
}


/**
 * Run `flush` when the page is going away. Returns the unbind function.
 *
 * Takes a callback rather than the `Autosave` so the caller decides what flushing means.
 * The store owns the scheduler; the DOM event belongs to the UI, and neither needs to
 * know about the other.
 *
 * Targets are injectable so the behaviour is testable without a browser and without
 * reaching for a global.
 */
export function bindFlushToPageLifecycle(
  flush: () => void,
  options: PageLifecycleOptions = {},
): LifecycleBinding {
  const globalTarget = globalThis as unknown as {
    window?: PageLifecycleTarget;
    document?: PageLifecycleTarget & { visibilityState?: string };
  };
  const targetWindow = options.window ?? globalTarget.window;
  const targetDocument = options.document ?? globalTarget.document;

  if (!targetWindow || !targetDocument) {
    // Nothing to bind to, such as a test environment without a DOM. Autosave still
    // works through its timer; only the flush-on-exit is unavailable.
    return { unbind: () => undefined };
  }

  const onVisibilityChange = (): void => {
    if (targetDocument.visibilityState === 'hidden') flush();
  };

  const onPageHide = (): void => {
    flush();
  };

  targetDocument.addEventListener('visibilitychange', onVisibilityChange);
  targetWindow.addEventListener('pagehide', onPageHide);

  return {
    unbind: () => {
      targetDocument.removeEventListener('visibilitychange', onVisibilityChange);
      targetWindow.removeEventListener('pagehide', onPageHide);
    },
  };
}
