/**
 * The stage's wiring to the renderer.
 *
 * `renderScene` is a pure function and is tested as one. What is not pure is the glue:
 * the option `subtitles` was accepted by the renderer, honoured by it, and passed by
 * nobody, so the flag was dead and the subtitle bar could not be turned off. A toggle
 * that renders no effect is a placeholder (RULE 9), and this is the test that says
 * otherwise.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Stage } from './Stage';
import { useEditor } from '../state/editorStore';
import { SEED_PROJECT } from '../data/seed';
import { renderScene } from '../core/render/render';

vi.mock('../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => false,
  IndexedDbProjectRepository: vi.fn(() => ({
    save: vi.fn(async () => {}),
    loadMostRecent: vi.fn(async () => null),
    load: vi.fn(async () => null),
  })),
}));

vi.mock('../core/render/render', () => ({ renderScene: vi.fn() }));

/** jsdom's canvas has no 2d context; the stage only needs one to exist. */
function stubContext(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
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

function lastOptions(): { subtitles?: boolean; width?: number } {
  const calls = vi.mocked(renderScene).mock.calls;
  const last = calls[calls.length - 1];
  return (last?.[4] ?? {}) as { subtitles?: boolean; width?: number };
}

describe('Stage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(renderScene).mockClear();
    stubContext();
    useEditor.setState({
      project: SEED_PROJECT,
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      showSubtitles: true,
      sceneId: SEED_PROJECT.scenes[0]?.id ?? '',
      selection: { kind: null, id: null },
      dirty: false,
      lastSavedAt: null,
    });
  });

  it('passes the subtitle preference to the renderer, so the toggle is not dead', async () => {
    render(<Stage width={320} />);
    await act(async () => {
      await nextFrames(3);
    });
    expect(lastOptions().subtitles).toBe(true);

    act(() => useEditor.getState().toggleSubtitles());
    await act(async () => {
      await nextFrames(3);
    });
    expect(lastOptions().subtitles).toBe(false);
  });

  it('renders the scene that is open, at the size the stage was given', async () => {
    render(<Stage width={320} />);
    await act(async () => {
      await nextFrames(3);
    });

    const calls = vi.mocked(renderScene).mock.calls;
    const last = calls[calls.length - 1];
    expect(last?.[1]).toBe(useEditor.getState().project);
    expect(last?.[2]?.id).toBe(SEED_PROJECT.scenes[0]?.id);
    expect(lastOptions().width).toBe(320);
  });
});
