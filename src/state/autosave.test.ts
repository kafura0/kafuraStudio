/**
 * The debounce itself, and the page-lifecycle flush that was missing.
 *
 * The regression these protect is a data loss that is invisible until it happens: a
 * change made in the last second of a session, then a closed tab.
 *
 * The shape of these tests changed deliberately. They used to schedule one edit and
 * expect nothing to be written until the timer fired, which is a contract that was
 * measured losing real edits: commit a change, reload inside the quiet period, and the
 * change is gone, because the lifecycle flush cannot await an IndexedDB write during
 * teardown. The first edit of a burst is now written immediately, so a single `schedule()`
 * writes. Every test that needs something genuinely *pending* therefore schedules twice.
 * That is the new contract, not a relaxed assertion -- the assertions are tighter, because
 * they now cover the leading write, the cap, and the immediate-durability case that the
 * old suite structurally could not express.
 */

import { describe, expect, it, vi } from 'vitest';
import { createAutosave } from './autosave';
import {
  bindFlushToPageLifecycle,
  type PageLifecycleTarget,
} from './autosaveLifecycle.browser';

/** A minimal stand-in for `window` / `document`, so dispatching is synchronous. */
function fakeTarget(visibilityState = 'visible'): PageLifecycleTarget & { visibilityState: string; fire: (type: string) => void } {
  const listeners = new Map<string, Set<() => void>>();
  const target = {
    visibilityState,
    addEventListener(type: string, listener: () => void): void {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener);
    },
    removeEventListener(type: string, listener: () => void): void {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string): void {
      [...(listeners.get(type) ?? [])].forEach((listener) => listener());
    },
    count(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
  };
  return target as never;
}

describe('createAutosave', () => {
  it('writes the first edit of a burst immediately, with no timer involved', () => {
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    autosave.schedule();
    // Synchronously, with no timer advance. This is the property the measured data loss
    // turned on: the write has to be in flight before the user can leave the page.
    expect(save).toHaveBeenCalledTimes(1);
    autosave.schedule();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('leaves a single edit fully settled, so no redundant second write is queued', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    autosave.schedule();
    expect(autosave.isPending()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('collapses the rest of a burst into one trailing write', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    for (let i = 0; i < 20; i += 1) autosave.schedule();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('restarts the quiet period on each edit, so a long drag saves when it stops', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    autosave.schedule();
    autosave.schedule();
    vi.advanceTimersByTime(700);
    autosave.schedule();
    vi.advanceTimersByTime(700);
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('leads again for a fresh discrete edit once the burst has gone quiet', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    autosave.schedule();
    expect(save).toHaveBeenCalledTimes(1);
    // The burst sat for a full quiet period without another edit, so it is over.
    vi.advanceTimersByTime(800);
    autosave.schedule();
    // The next discrete edit is a new burst and is written immediately again.
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('captures a continuous burst at the cap, which a pure debounce never reaches', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosave(save, 800, 3000);
    autosave.schedule();
    autosave.schedule();
    // A drag that never pauses: the quiet period is restarted before it can ever elapse.
    for (let elapsed = 0; elapsed < 3500; elapsed += 700) {
      vi.advanceTimersByTime(700);
      autosave.schedule();
    }
    // The leading write plus the cap. A trailing-only debounce is still at 1 here.
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('flushes a pending burst immediately and cancels the timer', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    autosave.schedule();
    autosave.schedule();
    autosave.flush();
    expect(save).toHaveBeenCalledTimes(2);
    // And the timer is not left to fire a second time.
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does nothing on flush when nothing is pending', () => {
    const save = vi.fn();
    const autosave = createAutosave(save);
    autosave.flush();
    autosave.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('cancels a pending burst without running it', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    autosave.schedule();
    autosave.schedule();
    autosave.cancel();
    expect(autosave.isPending()).toBe(false);
    vi.advanceTimersByTime(2000);
    // The leading write already happened; the cancelled trailing write must not.
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('can be told not to lead, restoring a pure trailing debounce', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosave(save, 800, 3000, false);
    autosave.schedule();
    expect(save).not.toHaveBeenCalled();
    expect(autosave.isPending()).toBe(true);
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('page lifecycle', () => {
  it('saves a pending burst when the tab is hidden', () => {
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    const doc = fakeTarget('visible');
    const win = fakeTarget();
    bindFlushToPageLifecycle(() => autosave.flush(), { document: doc, window: win });

    autosave.schedule();
    autosave.schedule();
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('ignores a visibility change that is not going away', () => {
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    const doc = fakeTarget('visible');
    bindFlushToPageLifecycle(() => autosave.flush(), { document: doc, window: fakeTarget() });

    autosave.schedule();
    autosave.schedule();
    doc.fire('visibilitychange');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves a pending burst when the page is going away', () => {
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    const win = fakeTarget();
    bindFlushToPageLifecycle(() => autosave.flush(), { document: fakeTarget(), window: win });

    autosave.schedule();
    autosave.schedule();
    win.fire('pagehide');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not save on page hide when there was nothing pending', () => {
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    const win = fakeTarget();
    bindFlushToPageLifecycle(() => autosave.flush(), { document: fakeTarget(), window: win });

    win.fire('pagehide');
    expect(save).not.toHaveBeenCalled();
  });

  it('survives the flush timer firing afterwards without a second save', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    const win = fakeTarget();
    bindFlushToPageLifecycle(() => autosave.flush(), { document: fakeTarget(), window: win });

    autosave.schedule();
    autosave.schedule();
    win.fire('pagehide');
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('unbinds, so a remount does not leave two listeners saving twice', () => {
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    const doc = fakeTarget('hidden');
    const win = fakeTarget();
    const binding = bindFlushToPageLifecycle(() => autosave.flush(), { document: doc, window: win });

    binding.unbind();
    autosave.schedule();
    autosave.schedule();
    doc.fire('visibilitychange');
    win.fire('pagehide');
    // Only the leading write. Neither listener contributed, which is the point.
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('degrades quietly when there is no window to bind to', () => {
    const save = vi.fn();
    const autosave = createAutosave(save, 800);
    const binding = bindFlushToPageLifecycle(() => autosave.flush(), { document: undefined, window: undefined });
    expect(() => binding.unbind()).not.toThrow();
  });
});
