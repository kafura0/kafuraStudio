/**
 * Keyboard transport in the app shell.
 *
 * `docs/MVP.md` acceptance check 3 claims a spacebar transport and check 8 claims undo
 * shortcuts. Undo was real; the spacebar was not. This test exists so the claim cannot
 * quietly go back to being false, and so the part that matters is pinned down: the
 * shortcut has to stop being a shortcut the moment the user is typing a line of dialogue,
 * because swallowing a space in a text field is a data-loss bug wearing a keyboard
 * binding's clothes.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from './App';
import { useEditor } from '../state/editorStore';
import { SEED_PROJECT, SEED_SERIES, seedContext } from '../data/seed';

vi.mock('../core/persistence/indexedDb.browser', () => ({
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

vi.mock('../core/render/render', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, renderScene: vi.fn() };
});

describe('App keyboard transport', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    useEditor.setState({
      project: SEED_PROJECT,
      // The shell renders nothing but a project browser until the resolved context exists,
      // so a test that opens the editor has to supply the series and the library derived
      // from it. Without both, `App` is technically correct and the test sees no editor.
      series: SEED_SERIES,
      context: seedContext(),
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

  const space = (target: Element | null = document.body): void => {
    fireEvent.keyDown(target ?? document.body, { key: ' ' });
  };

  it('toggles playback on the spacebar', () => {
    render(<App />);
    expect(useEditor.getState().playing).toBe(false);

    space();
    expect(useEditor.getState().playing).toBe(true);

    space();
    expect(useEditor.getState().playing).toBe(false);
  });

  it('toggles from wherever the focus happens to be, unless the user is typing', () => {
    // The line editor only exists once a line is selected, which is also the state a
    // user is in when they are actually typing dialogue.
    const lineId = SEED_PROJECT.scenes[0]?.dialogue[0]?.id;
    if (!lineId) throw new Error('Seed scene has no dialogue');
    act(() => useEditor.getState().select('line', lineId));

    render(<App />);
    const dialogue = screen.getByRole('textbox', { name: 'Line' });

    // Focus in the dialogue field: space belongs to the text.
    act(() => dialogue.focus());
    space(dialogue);
    expect(useEditor.getState().playing).toBe(false);

    // The transport did not start. A shortcut that eats a space mid-sentence is a
    // data-loss bug, not a convenience.
    fireEvent.change(dialogue, { target: { value: 'Two words here' } });
    expect((dialogue as HTMLTextAreaElement).value).toBe('Two words here');

    // Focus back on the body: now it is transport.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    space(document.body);
    expect(useEditor.getState().playing).toBe(true);
  });

  it('leaves space alone on a focused control', () => {
    render(<App />);
    const play = screen.getByRole('button', { name: 'Play' });
    act(() => play.focus());

    // A focused button uses space to activate itself. Toggling here as well would start
    // playback and immediately let the button's own handler run against a stale state.
    space(play);
    expect(useEditor.getState().playing).toBe(false);
  });

  it('ignores space with a modifier held, so Ctrl+Space is not hijacked', () => {
    render(<App />);
    fireEvent.keyDown(document.body, { key: ' ', ctrlKey: true });
    expect(useEditor.getState().playing).toBe(false);
  });

  it('still routes Ctrl+Z to undo', () => {
    render(<App />);
    // A dirty document is what makes undo mean anything; the shortcut must not depend on
    // the spacebar having been wired first.
    const first = SEED_PROJECT.scenes[0];
    if (!first) throw new Error('Seed project has no scenes');
    act(() => useEditor.getState().commit({ ...SEED_PROJECT, name: 'Edited' }, 'edit'));
    expect(useEditor.getState().past).toHaveLength(1);

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(useEditor.getState().past).toHaveLength(0);
  });
});

describe('App with no project open', () => {
  beforeEach(() => {
    useEditor.setState({
      project: null,
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      sceneId: '',
      selection: { kind: null, id: null },
      status: 'ready',
      statusMessage: null,
      projects: [],
    });
  });

  it('shows the project browser rather than an editor with nothing in it', async () => {
    // The workspace opens on this screen now, so it is the first thing anyone sees. A null
    // project reaching a panel that assumes one would take the whole tab down.
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByRole('button', { name: 'New project' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('survives a spacebar with nothing loaded', async () => {
    // The transport shortcut is bound to `window`, so it is live on the browser screen too.
    await act(async () => {
      render(<App />);
    });
    expect(() => fireEvent.keyDown(document.body, { key: ' ' })).not.toThrow();
    expect(useEditor.getState().playing).toBe(false);
  });
});
