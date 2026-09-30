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

  it('renders the scene-local time, not the episode time', async () => {
    // The renderer draws a single scene from 0, so handing it episode time would push
    // every scene after the first to its final frame the moment the cut advanced.
    const ids = SEED_PROJECT.episodes[0]?.sceneIds ?? [];
    const second = ids[1];
    if (!second) throw new Error('Seed episode needs a second scene');
    const [first, secondScene] = [SEED_PROJECT.scenes[0], SEED_PROJECT.scenes[1]];
    if (!first || !secondScene) throw new Error('Seed project needs two scenes');

    useEditor.setState({
      playbackMode: 'episode-advance',
      // 12s of a 10s-then-8s cut: 2s into the second scene.
      playhead: 12,
      sceneId: second,
    });

    render(<Stage width={320} />);
    await act(async () => {
      await nextFrames(3);
    });

    const calls = vi.mocked(renderScene).mock.calls;
    const last = calls[calls.length - 1];
    expect(last?.[2]?.id).toBe(second);
    expect(last?.[3]).toBeCloseTo(2, 5);
    expect(last?.[3]).not.toBeCloseTo(12, 1);
    expect(first.duration).toBeLessThan(12);
  });

  it('never hands the renderer a time past the end of the open scene', async () => {
    // A renderer asked to interpolate outside the range it was built for holds whatever
    // its last keyframe happened to be, which is a subtly wrong frame rather than a
    // visible error. The store owns that clamp, so this asserts the stage receives it.
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');

    // Scene-wrap at a playhead past the scene's own end: the mode that has no episode
    // timeline to bound it.
    useEditor.setState({
      playbackMode: 'scene-wrap',
      playhead: first.duration + 4,
      sceneId: first.id,
    });

    render(<Stage width={320} />);
    await act(async () => {
      await nextFrames(3);
    });

    const calls = vi.mocked(renderScene).mock.calls;
    const last = calls[calls.length - 1];
    expect(last?.[2]?.id).toBe(first.id);
    expect(last?.[3]).toBe(first.duration);
  });
});
