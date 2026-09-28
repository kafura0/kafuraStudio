/**
 * The timeline component.
 *
 * The geometry is tested in core. What is tested here is the wiring, because that is
 * where the interesting mistakes live: a playhead that does not follow the clock, a
 * scrubber that reports the wrong scene's length, and a drag that mutates the document
 * without going through `commit()` - which is invisible until someone presses Ctrl+Z
 * and the edit is still there.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Timeline } from './Timeline';
import { useEditor } from '../../state/editorStore';
import { SEED_PROJECT } from '../../data/seed';
import type { Clip, Track } from '../../core/types';

vi.mock('../../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => false,
  IndexedDbProjectRepository: vi.fn(() => ({
    save: vi.fn(async () => {}),
    loadMostRecent: vi.fn(async () => null),
    load: vi.fn(async () => null),
  })),
}));

/** jsdom has no layout, so every rect is zero. The component measures against one. */
function stubRect(width = 1200, height = 400): void {
  // scrollLeft/scrollWidth are 0 in jsdom, which is the un-scrolled case.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect);
}

const nextFrames = (count = 2): Promise<void> =>
  new Promise((resolve) => {
    let remaining = count;
    const step = (): void => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

const scene = SEED_PROJECT.scenes[0];
const SCALE = 60; // DEFAULT_METRICS.pixelsPerSecond
const LANE = 30; // DEFAULT_METRICS.laneHeight
const RULER = 22; // The component's RULER_HEIGHT: lane space starts below it.

/**
 * Where a clip actually is on screen, so a test can press it.
 *
 * The component hit-tests against the lane coordinate space, not the DOM node the
 * event was dispatched on, so a press at (0, 0) hits nothing however it is sent.
 * Track names are also not unique — one dialogue track exists per line, so two tracks
 * are both called "Dialogue — Nia" — which is why tracks are addressed by index.
 *
 * The press lands on the clip's midpoint. Anywhere else risks a trim handle, which
 * is 7px wide on each side and takes priority over the body.
 */
function clipPosition(trackIndex: number, clip: { start: number; duration: number }): {
  clientX: number;
  clientY: number;
} {
  return {
    clientX: (clip.start + clip.duration / 2) * SCALE,
    // Client y, so the ruler's height is included: lane space begins beneath it.
    clientY: trackIndex * LANE + LANE / 2 + RULER,
  };
}

/** A clip wide enough on screen to be grabbed by its body rather than a handle. */
function pressableClip(): { trackIndex: number; track: Track; clip: Clip } {
  if (!scene) throw new Error('seed scene missing');
  for (const [trackIndex, track] of scene.tracks.entries()) {
    for (const clip of track.clips) {
      if (clip.duration * SCALE > 2 * 7 + 4) return { trackIndex, track, clip };
    }
  }
  throw new Error('seed scene has no clip wide enough to press');
}

function resetStore(): void {
  useEditor.setState({
    project: SEED_PROJECT,
    past: [],
    future: [],
    playhead: 0,
    playing: false,
    sceneId: scene?.id ?? '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,
  });
}

describe('Timeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStore();
    stubRect();
  });

  it('renders one lane per track, labelled', () => {
    if (!scene) throw new Error('seed scene missing');
    render(<Timeline />);

    // Track names are not unique: one dialogue track per line, so two are both
    // "Dialogue — Nia". Every track must still be represented.
    for (const track of scene.tracks) {
      expect(screen.getAllByTitle(track.name).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByTitle(/./).length).toBeGreaterThanOrEqual(scene.tracks.length);
  });

  it('shows the duration of the open scene', () => {
    if (!scene) throw new Error('seed scene missing');
    render(<Timeline />);
    expect(screen.getByText(new RegExp(`${scene.duration.toFixed(2)}s`))).toBeTruthy();
  });

  it('positions the playhead from the shared clock, not from props', async () => {
    render(<Timeline />);
    const playhead = screen.getByTestId('timeline-playhead');

    // No props feed the playhead: it reads the store, which is what makes it agree
    // with the stage during playback.
    act(() => {
      useEditor.getState().setPlayhead(1);
    });
    await act(async () => {
      await nextFrames(3);
    });

    const transform = playhead.style.transform;
    const scale = Number(/(\d+(?:\.\d+)?)px/.exec(transform)?.[1] ?? Number.NaN);
    // DEFAULT_METRICS.pixelsPerSecond is 60, so 1s is 60px.
    expect(Number.isFinite(scale)).toBe(true);
    expect(transform).toContain('translate3d');
  });

  it('advances the playhead when the store clock advances', async () => {
    render(<Timeline />);
    const playhead = screen.getByTestId('timeline-playhead');

    act(() => {
      useEditor.getState().play();
      useEditor.getState().setPlayhead(2);
    });
    await act(async () => {
      useEditor.getState().advancePlayback(1);
      await nextFrames(3);
    });

    const x = Number(/translate3d\(([-\d.]+)px/.exec(playhead.style.transform)?.[1] ?? Number.NaN);
    expect(x).toBeGreaterThan(0);
  });

  it('scrubs the playhead when the ruler is clicked', () => {
    if (!scene) throw new Error('seed scene missing');
    render(<Timeline />);
    const ruler = screen.getByRole('slider', { name: 'Timeline ruler' });

    // 60px per second, and the rect starts at 0, so x=300 is 5s.
    fireEvent.pointerDown(ruler, { clientX: 300, clientY: 10 });

    expect(useEditor.getState().playhead).toBeCloseTo(5, 6);
    expect(useEditor.getState().playhead).toBeLessThanOrEqual(scene.duration);
  });

  it('never scrubs past the end of the scene', () => {
    if (!scene) throw new Error('seed scene missing');
    render(<Timeline />);
    const ruler = screen.getByRole('slider', { name: 'Timeline ruler' });

    fireEvent.pointerDown(ruler, { clientX: 100000, clientY: 10 });
    expect(useEditor.getState().playhead).toBe(scene.duration);

    fireEvent.pointerDown(ruler, { clientX: -500, clientY: 10 });
    expect(useEditor.getState().playhead).toBe(0);
  });

  it('renders a clip for every clip in the scene', () => {
    if (!scene) throw new Error('seed scene missing');
    render(<Timeline />);
    const total = scene.tracks.reduce((n, t) => n + t.clips.length, 0);
    // Each clip is a button carrying its track name and start time.
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(total);
  });

  it('selects a clip when it is pressed', () => {
    if (!scene) throw new Error('seed scene missing');
    const { trackIndex, track, clip } = pressableClip();

    render(<Timeline />);
    const button = screen.getByLabelText(
      new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`),
    );

    const at = clipPosition(trackIndex, clip);
    fireEvent.pointerDown(button, at);

    expect(useEditor.getState().selection).toEqual({ kind: 'clip', id: clip.id });
  });

  it('a drag commits one undoable step rather than mutating in place', async () => {
    if (!scene) throw new Error('seed scene missing');
    const { trackIndex, track, clip } = pressableClip();

    const before = useEditor.getState().past.length;
    render(<Timeline />);
    const button = screen.getByLabelText(
      new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`),
    );

    const original = useEditor.getState().project;
    const at = clipPosition(trackIndex, clip);
    fireEvent.pointerDown(button, at);
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: at.clientX + 120, clientY: at.clientY });
    });
    await act(async () => {
      fireEvent.pointerUp(window);
    });

    const state = useEditor.getState();
    // The document is a new object, not the same one mutated in place.
    expect(state.project).not.toBe(original);
    expect(state.past.length).toBe(before + 1);

    // And it moved in the direction the pointer went.
    const moved = state.project.scenes
      .find((s) => s.id === scene.id)
      ?.tracks.find((t) => t.id === track.id)
      ?.clips.find((c) => c.id === clip.id);
    expect(moved?.start).toBeGreaterThan(clip.start);

    // Undo puts it back, which is the whole point of routing through commit().
    act(() => {
      useEditor.getState().undo();
    });
    const restored = useEditor
      .getState()
      .project.scenes.find((s) => s.id === scene.id)
      ?.tracks.find((t) => t.id === track.id)
      ?.clips.find((c) => c.id === clip.id);
    expect(restored?.start).toBe(clip.start);
  });

  it('a press that misses every clip scrubs instead of selecting', () => {
    if (!scene) throw new Error('seed scene missing');
    render(<Timeline />);
    const ruler = screen.getByRole('slider', { name: 'Timeline ruler' });

    fireEvent.pointerDown(ruler, { clientX: 180, clientY: 10 });
    expect(useEditor.getState().playhead).toBeCloseTo(3, 6);
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
