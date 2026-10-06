/**
 * The camera panel component.
 *
 * The operations are tested in core. What is tested here is the wiring, because that is
 * where the mistakes live: a field that commits per keystroke (one undo step per
 * digit), a preset that silently repositions the shot, and a "frame the selection"
 * button that frames something the user did not have selected.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CameraPanel } from './CameraPanel';
import { useEditor } from '../../state/editorStore';
import { SEED_PROJECT, SEED_SERIES } from '../../data/seed';
import { resolveAssets } from '../../core/document/scopes';
import { cameraClips } from '../../core/document/cameraOps';
import type { Project, Scene } from '../../core/types';

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

const scene = SEED_PROJECT.scenes[0] as Scene;

function resetStore(project: Project = SEED_PROJECT): void {
  useEditor.setState({
    project,
    // Camera presets are the series' reusable layer, so the panel reads the resolved library
    // rather than the project. A store with no series lists no presets, which is a correct
    // answer to an empty workspace and the wrong one for a test about the seeded vocabulary.
    series: SEED_SERIES,
    context: resolveAssets(project, SEED_SERIES),
    past: [],
    future: [],
    playhead: 0,
    playing: false,
    showSubtitles: true,
    sceneId: scene?.id ?? '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,
  });
}

function currentScene(): Scene {
  const state = useEditor.getState();
  // `project` is nullable now that a workspace can have nothing open, but this panel only
  // renders inside the editor, where one always is.
  const project = state.project;
  if (project === null) throw new Error('Expected a project to be open');
  return project.scenes.find((s) => s.id === state.sceneId) as Scene;
}

function typeInto(label: string, value: string): void {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('CameraPanel', () => {
  beforeEach(() => resetStore());

  it('shows the rest framing as numbers', () => {
    render(<CameraPanel />);
    const camera = currentScene().camera;
    expect(screen.getByLabelText('X')).toHaveValue(String(camera.x));
    expect(screen.getByLabelText('Y')).toHaveValue(String(camera.y));
    expect(screen.getByLabelText('Zoom')).toHaveValue(String(camera.zoom));
  });

  it('shows the rotation in degrees, which is what an artist types', () => {
    render(<CameraPanel />);
    const degrees = (currentScene().camera.rotation * 180) / Math.PI;
    // The document stores radians; the field must not.
    expect(screen.getByLabelText('Rotation (degrees)')).toHaveValue(String(Number(degrees.toFixed(2))));
  });

  it('commits a numeric edit once, on blur — not one undo step per keystroke', () => {
    render(<CameraPanel />);
    act(() => {
      typeInto('Zoom', '1.4');
    });
    expect(currentScene().camera.zoom).toBeCloseTo(1.4, 6);
    expect(useEditor.getState().past).toHaveLength(1);
  });

  it('stores degrees as radians, so the renderer receives a real angle', () => {
    render(<CameraPanel />);
    act(() => {
      typeInto('Rotation (degrees)', '8');
    });
    expect(currentScene().camera.rotation).toBeCloseTo((8 * Math.PI) / 180, 6);
  });

  it('leaves the document alone when a field is blurred unchanged', () => {
    render(<CameraPanel />);
    const before = currentScene().camera;
    act(() => {
      typeInto('Zoom', String(before.zoom));
    });
    // An identical blur must not fill the undo stack with a no-op.
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it('ignores a value it cannot read, rather than writing NaN into the document', () => {
    render(<CameraPanel />);
    const before = currentScene().camera;
    act(() => {
      typeInto('Zoom', 'not a number');
    });
    expect(currentScene().camera).toEqual(before);
  });

  it('lists the seeded presets by name', () => {
    render(<CameraPanel />);
    const select = screen.getByLabelText('Preset') as HTMLSelectElement;
    const names = [...select.options].map((o) => o.textContent);
    expect(names.some((n) => n?.includes('Close-up'))).toBe(true);
  });

  it('applies a preset as one undo step', () => {
    render(<CameraPanel />);
    const select = screen.getByLabelText('Preset') as HTMLSelectElement;
    const closeUp = [...select.options].find((o) => o.textContent?.includes('Close-up'))!;

    act(() => {
      fireEvent.change(select, { target: { value: closeUp.value } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /apply preset/i }));
    });

    const camera = currentScene().camera;
    expect(camera.zoom).toBeCloseTo(2.6, 6);
    // The framing alone is one document, and the clip it lays is not a second step.
    expect(useEditor.getState().past).toHaveLength(1);
  });

  it('lays one camera move when a preset is applied', () => {
    render(<CameraPanel />);
    const select = screen.getByLabelText('Preset') as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: select.options[1]!.value } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /apply preset/i }));
    });
    expect(cameraClips(currentScene())).toHaveLength(1);
  });

  it('reports the camera move honestly, including when there is none', () => {
    // Seed scene 1 has a push-in, so a camera-less copy is the honest "none" case.
    resetStore({ ...SEED_PROJECT, scenes: [{ ...scene, tracks: [] }] });
    render(<CameraPanel />);
    expect(cameraClips(currentScene())).toEqual([]);
    expect(screen.getByText(/no camera move on the timeline/i)).toBeTruthy();
  });

  it('says a scene is open when the store points at a scene that is gone', () => {
    useEditor.setState({ sceneId: 'scene_missing' });
    render(<CameraPanel />);
    expect(screen.getByText(/no scene open/i)).toBeTruthy();
  });

  it('frames the selected actor as one undo step', () => {
    const actor = scene.actors[0]!;
    useEditor.setState({ selection: { kind: 'actor', id: actor.id } });
    render(<CameraPanel />);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /frame selection/i }));
    });

    const camera = currentScene().camera;
    // The camera centres on the selected actor.
    expect(camera.x).toBeCloseTo(actor.transform.x, 6);
    expect(useEditor.getState().past).toHaveLength(1);
  });

  it('frames every visible actor when nothing is selected, and says so', () => {
    render(<CameraPanel />);
    expect(screen.getByText(/all visible actors/i)).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /frame selection/i }));
    });
    expect(currentScene().camera.x).not.toBe(0);
  });

  it('disables framing when the scene has nobody in it', () => {
    resetStore({ ...SEED_PROJECT, scenes: [{ ...scene, actors: [] }] });
    render(<CameraPanel />);
    expect(screen.getByRole('button', { name: /frame selection/i })).toBeDisabled();
  });

  it('says so when the scene has no actors to frame', () => {
    resetStore({ ...SEED_PROJECT, scenes: [{ ...scene, actors: [] }] });
    render(<CameraPanel />);
    expect(screen.getByText(/no actors in this scene/i)).toBeTruthy();
  });

  it('removes the camera move as one undo step', () => {
    render(<CameraPanel />);
    expect(cameraClips(currentScene()).length).toBeGreaterThan(0);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /remove camera move/i }));
    });
    expect(cameraClips(currentScene())).toEqual([]);
    expect(useEditor.getState().past).toHaveLength(1);
  });
});
