/**
 * The transport bar.
 *
 * The timing maths is tested in `core/timeline/episode.ts`. What is tested here is the
 * one thing the component decides for itself: what range the scrubber spans and what
 * number it reports. A scrubber whose range is the scene's length while its value is
 * episode time is a control that lies about the transport — the slider reaches its end
 * at 10s and then does nothing, which reads as a broken editor rather than a bug.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransportBar } from './TransportBar';
import { useEditor } from '../../state/editorStore';
import { SEED_PROJECT } from '../../data/seed';

vi.mock('../../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => false,
  IndexedDbProjectRepository: vi.fn(() => ({
    save: vi.fn(async () => {}),
    loadMostRecent: vi.fn(async () => null),
    load: vi.fn(async () => null),
  })),
  IndexedDbSeriesRepository: vi.fn(() => ({
    save: vi.fn(async () => {}),
    load: vi.fn(async () => null),
    list: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
  })),
}));

const SCENE = SEED_PROJECT.scenes[0];
const TOTAL = 38;

function renderBar(): void {
  if (!SCENE) throw new Error('Seed project has no scenes');
  render(
    <TransportBar
      scene={SCENE}
      projectName={SEED_PROJECT.name}
      fps={24}
      canUndo={false}
      canRedo={false}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onSave={vi.fn()}
    />,
  );
}

const scrubber = (): HTMLInputElement => {
  const input = screen.getByRole('slider');
  if (!(input instanceof HTMLInputElement)) throw new Error('no range input');
  return input;
};

const timecode = (): string => {
  // The bar renders the seconds readout and the timecode; the readout is the one that
  // says which unit is being displayed.
  const readout = screen.getByTitle(/Episode time|Scene time/);
  return readout.textContent ?? '';
};

describe('TransportBar in episode mode', () => {
  beforeEach(() => {
    useEditor.setState({
      project: SEED_PROJECT,
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      playbackMode: 'episode-advance',
      sceneId: SEED_PROJECT.scenes[0]?.id ?? '',
      selection: { kind: null, id: null },
      dirty: false,
      lastSavedAt: null,
    });
  });

  it('spans the whole cut, not the open scene', () => {
    renderBar();
    // 10s is the first scene. A 10s range here would be the bug, not the feature.
    expect(scrubber().max).toBe(String(TOTAL));
    expect(timecode()).toContain(`0.00 / ${TOTAL.toFixed(2)}s`);
  });

  it('scrubs to an episode time and resolves the scene that contains it', () => {
    renderBar();
    // 20s is two seconds into scene three of the seed cut.
    fireEvent.change(scrubber(), { target: { value: '20' } });

    const state = useEditor.getState();
    expect(state.playhead).toBe(20);
    expect(state.sceneId).toBe(SEED_PROJECT.episodes[0]?.sceneIds[2]);
    expect(timecode()).toContain(`20.00 / ${TOTAL.toFixed(2)}s`);
  });

  it('labels the readout as episode time', () => {
    renderBar();
    expect(timecode()).toContain('/');
    expect(screen.getByRole('slider').getAttribute('aria-label')).toBe('Episode playhead');
  });

  it('switches to the scene and re-labels the range in scene-loop mode', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Episode' }));

    const state = useEditor.getState();
    expect(state.playbackMode).toBe('scene-wrap');
    // The clock was 0, which is the start of scene one, so it stays 0 — but the range
    // is now that scene's length.
    expect(scrubber().max).toBe(String(SCENE?.duration));
    expect(screen.getByRole('slider').getAttribute('aria-label')).toBe('Playhead');

    // And back again.
    fireEvent.click(screen.getByRole('button', { name: 'Scene loop' }));
    expect(useEditor.getState().playbackMode).toBe('episode-advance');
    expect(scrubber().max).toBe(String(TOTAL));
  });

  it('keeps the slider inside its range when the clock is past the end', () => {
    // The store can hold a playhead at the exact end of the cut after a scrub, or a
    // document can be shortened under the transport. React warns and the input renders
    // out of range otherwise.
    useEditor.setState({ playhead: TOTAL });
    renderBar();
    expect(scrubber().value).toBe(String(TOTAL));
  });

  it('toggles play and pause from the button', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(useEditor.getState().playing).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(useEditor.getState().playing).toBe(false);
  });
});
