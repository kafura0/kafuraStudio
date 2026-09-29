/**
 * The dialogue panel component.
 *
 * The operations are tested in core. What is tested here is the wiring, because that is
 * where the interesting mistakes live: a field that commits per keystroke (one undo step
 * per letter), a gain slider that buries a drag under dozens of undo steps, a re-time
 * that edits the document but not the clip the subtitle is drawn from, and a voice slot
 * presented as though a recording existed behind it.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DialoguePanel } from './DialoguePanel';
import { useEditor } from '../../state/editorStore';
import { SEED_PROJECT } from '../../data/seed';
import type { AudioDef, Clip, Project, Scene } from '../../core/types';

vi.mock('../../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => false,
  IndexedDbProjectRepository: vi.fn(() => ({
    save: vi.fn(async () => {}),
    loadMostRecent: vi.fn(async () => null),
    load: vi.fn(async () => null),
  })),
}));

const scene = SEED_PROJECT.scenes[0] as Scene;

function resetStore(project: Project = SEED_PROJECT): void {
  useEditor.setState({
    project,
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

/** Open the first line of the scene, the way clicking the list does. */
function selectFirstLine(): string {
  const first = scene?.dialogue[0];
  if (!first) throw new Error('seed scene has no dialogue');
  act(() => useEditor.getState().select('line', first.id));
  return first.id;
}

function currentScene(): Scene {
  const id = useEditor.getState().sceneId;
  const found = useEditor.getState().project.scenes.find((s) => s.id === id);
  if (!found) throw new Error('scene missing from the store');
  return found;
}

function cueFor(lineId: string): Clip | undefined {
  return currentScene().tracks.flatMap((t) => t.clips).find((c) => c.dialogueLineId === lineId);
}

function lineById(lineId: string) {
  return currentScene().dialogue.find((l) => l.id === lineId);
}

function historyLength(): number {
  return useEditor.getState().past.length;
}

describe('DialoguePanel', () => {
  beforeEach(() => {
    resetStore();
  });

  it('lists every line in the scene and opens the one that is clicked', () => {
    render(<DialoguePanel />);
    for (const line of scene?.dialogue ?? []) {
      expect(screen.getAllByText(line.speaker).length).toBeGreaterThan(0);
    }

    fireEvent.click(screen.getAllByRole('button', { name: /Bro, where have you been/ })[0] as HTMLElement);
    // The editor opened, and it is showing that line.
    expect((screen.getByLabelText('Line') as HTMLTextAreaElement).value).toBe(
      'Bro, where have you been?',
    );
  });

  it('opens the line behind a selected cue clip, not only a selected line', () => {
    const line = scene?.dialogue[0];
    const cue = line ? cueFor(line.id) : undefined;
    if (!line || !cue) throw new Error('seed scene has no cued line');
    // The timeline selects clips, so a clip selection is the common case.
    act(() => useEditor.getState().select('clip', cue.id));

    render(<DialoguePanel />);
    expect((screen.getByLabelText('Line') as HTMLTextAreaElement).value).toBe(line.text);
  });

  it('shows the cue window it is editing, and shows nothing when there is no cue', () => {
    const lineId = selectFirstLine();
    const { unmount } = render(<DialoguePanel />);
    const cue = cueFor(lineId);
    expect((screen.getByLabelText('Cue start') as HTMLInputElement).value).toBe(
      String(cue?.start ?? 0),
    );
    unmount();

    // A line with no cue must say so rather than offering a window that does not exist.
    act(() => useEditor.setState((s) => ({ project: withoutFirstCue(s.project) })));
    render(<DialoguePanel />);
    expect((screen.getByLabelText('Cue start') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/No cue on the timeline/)).toBeTruthy();
  });

  it('commits a text edit once, on blur — not one undo step per keystroke', () => {
    const lineId = selectFirstLine();
    render(<DialoguePanel />);

    const field = screen.getByLabelText('Line');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Bro. Where. Have you been?' } });
    // Typed, not committed: the document is untouched and history has not moved.
    expect(historyLength()).toBe(0);
    expect(lineById(lineId)?.text).toBe('Bro, where have you been?');

    fireEvent.blur(field);
    expect(historyLength()).toBe(1);
    expect(lineById(lineId)?.text).toBe('Bro. Where. Have you been?');
  });

  it('re-times the cue from the panel, on the clip the subtitle is drawn from', () => {
    const lineId = selectFirstLine();
    render(<DialoguePanel />);

    const start = screen.getByLabelText('Cue start');
    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: '7.25' } });
    fireEvent.blur(start);

    expect(cueFor(lineId)?.start).toBeCloseTo(7.25, 6);
    expect(historyLength()).toBe(1);
  });

  it('re-times the duration without moving the start', () => {
    const lineId = selectFirstLine();
    const before = cueFor(lineId);
    render(<DialoguePanel />);

    const duration = screen.getByLabelText('Cue duration');
    fireEvent.focus(duration);
    fireEvent.change(duration, { target: { value: '3.5' } });
    fireEvent.blur(duration);

    const after = cueFor(lineId);
    expect(after?.start).toBeCloseTo(before?.start ?? 0, 6);
    expect(after?.duration).toBeCloseTo(3.5, 6);
  });

  it('treats a gain drag as one gesture, so it costs one undo step', () => {
    const lineId = selectFirstLine();
    render(<DialoguePanel />);

    const slider = screen.getByLabelText('Gain');
    fireEvent.change(slider, { target: { value: '0.4' } });
    // Moving across the slider must not spam history.
    fireEvent.change(slider, { target: { value: '0.35' } });
    expect(historyLength()).toBe(0);
    expect(screen.getByTestId('gain-readout').textContent).toBe('0.35');

    fireEvent.pointerUp(slider);
    expect(historyLength()).toBe(1);
    expect(cueFor(lineId)?.gain).toBeCloseTo(0.35, 6);

    act(() => useEditor.getState().undo());
    expect(cueFor(lineId)?.gain).toBeCloseTo(1, 6);
  });

  it('says a slot has no recording instead of implying a file exists', () => {
    const lineId = selectFirstLine();
    // The seed's voices are declared slots with `src: null`, which is the real state of
    // the project. Claiming otherwise is the dishonesty the phase gate forbids.
    const voiceId = lineById(lineId)?.voiceAudioId;
    expect(voiceId).toBeTruthy();

    render(<DialoguePanel />);
    expect(screen.getByText(/No recording/)).toBeTruthy();
    expect(screen.getByText(/Plays silent/)).toBeTruthy();

    // Once a file is attached, the panel says so instead.
    act(() => useEditor.setState((s) => ({ project: withRecording(s.project, voiceId as string) })));
    render(<DialoguePanel />);
    expect(screen.getAllByText(/Recording attached/).length).toBeGreaterThan(0);
  });

  it('reports an unassigned voice as silent rather than broken', () => {
    const lineId = selectFirstLine();
    act(() =>
      useEditor.setState((s) => ({
        project: withVoice(s.project, lineId, null),
      })),
    );
    render(<DialoguePanel />);
    expect(screen.getByText(/No voice assigned/)).toBeTruthy();
  });

  it('adds a line at the playhead in one commit and selects it', () => {
    act(() => useEditor.getState().setPlayhead(3));
    const before = currentScene().dialogue.length;
    render(<DialoguePanel />);

    fireEvent.click(screen.getByLabelText('Add line'));

    const after = currentScene().dialogue;
    expect(after).toHaveLength(before + 1);
    expect(historyLength()).toBe(1);
    const added = after[after.length - 1];
    expect(cueFor(added?.id ?? '')?.start).toBeCloseTo(3, 6);
    expect(useEditor.getState().selection).toEqual({ kind: 'line', id: added?.id });
  });

  it('deletes the line with its cue and its lane, and clears the selection', () => {
    const lineId = selectFirstLine();
    const lanes = currentScene().tracks.filter((t) => t.kind === 'dialogue').length;
    render(<DialoguePanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete line' }));

    expect(lineById(lineId)).toBeUndefined();
    expect(cueFor(lineId)).toBeUndefined();
    expect(currentScene().tracks.filter((t) => t.kind === 'dialogue')).toHaveLength(lanes - 1);
    expect(useEditor.getState().selection).toEqual({ kind: null, id: null });
    expect(historyLength()).toBe(1);
  });

  it('overrides the subtitle and puts the line text back', () => {
    const lineId = selectFirstLine();
    render(<DialoguePanel />);

    const field = screen.getByLabelText('Subtitle');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'BRO?!' } });
    fireEvent.blur(field);
    expect(lineById(lineId)?.subtitle).toBe('BRO?!');

    fireEvent.click(screen.getByRole('button', { name: 'Use line text' }));
    expect(lineById(lineId)?.subtitle).toBeNull();
  });

  it('edits the speaker and the emotion, and offers the project its own expressions', () => {
    const lineId = selectFirstLine();
    render(<DialoguePanel />);

    const speaker = screen.getByLabelText('Speaker');
    fireEvent.focus(speaker);
    fireEvent.change(speaker, { target: { value: 'Nia (over coffee)' } });
    fireEvent.blur(speaker);
    expect(lineById(lineId)?.speaker).toBe('Nia (over coffee)');

    const emotion = screen.getByLabelText('Emotion');
    fireEvent.focus(emotion);
    fireEvent.change(emotion, { target: { value: 'smug' } });
    fireEvent.blur(emotion);
    expect(lineById(lineId)?.emotion).toBe('smug');

    const options = Array.from(
      (screen.getByLabelText('Emotion') as HTMLInputElement).list?.options ?? [],
    ).map((o) => o.value);
    // The suggestions come from the project's own expression assets, not from a list
    // hard-coded into the panel (RULE 3).
    for (const expression of useEditor.getState().project.assets.expressions) {
      expect(options).toContain(expression.name);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Project fixtures                                                    */
/* ------------------------------------------------------------------ */

/** The seed with every dialogue cue removed, leaving lines that cannot be heard. */
function withoutFirstCue(project: Project): Project {
  const id = useEditor.getState().sceneId;
  return {
    ...project,
    scenes: project.scenes.map((s) =>
      s.id === id
        ? { ...s, tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !c.dialogueLineId) })) }
        : s,
    ),
  };
}

function withRecording(project: Project, audioId: string): Project {
  return {
    ...project,
    assets: {
      ...project.assets,
      audio: project.assets.audio.map((a: AudioDef) =>
        a.id === audioId ? { ...a, src: 'audio/line1.wav' } : a,
      ),
    },
  };
}

function withVoice(project: Project, lineId: string, audioId: string | null): Project {
  const sceneId = useEditor.getState().sceneId;
  return {
    ...project,
    scenes: project.scenes.map((s) =>
      s.id === sceneId
        ? {
            ...s,
            dialogue: s.dialogue.map((l) => (l.id === lineId ? { ...l, voiceAudioId: audioId } : l)),
            tracks: s.tracks.map((t) => ({
              ...t,
              clips: t.clips.map((c) => (c.dialogueLineId === lineId ? { ...c, audioId } : c)),
            })),
          }
        : s,
    ),
  };
}
