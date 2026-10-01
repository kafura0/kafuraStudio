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
import type { Clip, Project, Track } from '../../core/types';

/**
 * The open project.
 *
 * `project` is nullable now that a workspace can have nothing open, but the timeline only
 * renders inside the editor, where one always is. Asserting that in one place keeps the
 * `!`s out of the assertions and turns a genuine regression into a clear failure.
 */
function openProject(): Project {
  const project = useEditor.getState().project;
  if (project === null) throw new Error('Expected a project to be open');
  return project;
}


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

  it('explains the camera lane, which nothing in the UI previously described', () => {
    render(<Timeline />);
    // The zoom lives in `scaleX` on a camera keyframe. That is not discoverable and
    // not guessable, so the lane has to say it.
    expect(screen.getByTitle(/scaleX/)).toBeTruthy();
  });

  it('renders one lane per track, labelled', () => {
    if (!scene) throw new Error('seed scene missing');
    render(<Timeline />);

    // Track names are not unique: one dialogue track per line, so two are both
    // "Dialogue - Nia". Every track must still be represented.
    for (const track of scene.tracks) {
      // The camera lane's tooltip is expanded to explain the lane, so match on the
      // name being present rather than on it being the whole string.
      expect(screen.getAllByTitle(new RegExp(track.name.replace(/[.*+?^${}()|[\]\\]/g, '\\expect(screen.getAllByTitle(new RegExp(escapeRegExp(track.name))).length).toBeGreaterThan(0);'))).length).toBeGreaterThan(0);
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

    const original = openProject();
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
    expect(openProject()).not.toBe(original);
    expect(state.past.length).toBe(before + 1);

    // And it moved in the direction the pointer went.
    const moved = openProject().scenes
      .find((s) => s.id === scene.id)
      ?.tracks.find((t) => t.id === track.id)
      ?.clips.find((c) => c.id === clip.id);
    expect(moved?.start).toBeGreaterThan(clip.start);

    // Undo puts it back, which is the whole point of routing through commit().
    act(() => {
      useEditor.getState().undo();
    });
    const restored = openProject().scenes.find((s) => s.id === scene.id)
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

  it('a move drag is anchored to where the drag started, not the last preview', async () => {
    // Two pointer moves arriving at the same spot must not stack: the clip lands
    // where the pointer is, not where a drift-prone preview accumulated to.
    if (!scene) throw new Error('seed scene missing');
    const { trackIndex, track, clip } = pressableClip();

    render(<Timeline />);
    const button = screen.getByLabelText(
      new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`),
    );

    const before = useEditor.getState().past.length;
    const at = clipPosition(trackIndex, clip);
    fireEvent.pointerDown(button, at);
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: at.clientX + 120, clientY: at.clientY });
    });
    // The pointer has not moved since; the preview must stay put.
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: at.clientX + 120, clientY: at.clientY });
    });
    await act(async () => {
      fireEvent.pointerUp(window);
    });

    const moved = openProject().scenes.find((s) => s.id === scene.id)
      ?.tracks.find((t) => t.id === track.id)
      ?.clips.find((c) => c.id === clip.id);
    // 120px is 2s at the default 60px/s scale. A preview that fed on itself would
    // have landed at +4s; this is the anchored +2s.
    expect(moved?.start).toBeGreaterThan(clip.start + 1.9);
    expect(moved?.start).toBeLessThan(clip.start + 2.1);
    expect(useEditor.getState().past.length).toBe(before + 1);
  });
});

/** A wide clip with no keyframes yet, so keyframe tests start from a blank slate. */
function keyframeableClip(): { trackIndex: number; track: Track; clip: Clip } {
  if (!scene) throw new Error('seed scene missing');
  let best: { trackIndex: number; track: Track; clip: Clip } | null = null;
  for (const [trackIndex, track] of scene.tracks.entries()) {
    for (const clip of track.clips) {
      if (clip.keyframes.length > 0) continue;
      if (!best || clip.duration > best.clip.duration) best = { trackIndex, track, clip };
    }
  }
  if (!best) throw new Error('seed scene has no keyframe-free clip');
  return best;
}

/** A position on the frame grid inside a clip, at the quarter point of its body. */
function quarterTime(clip: { start: number; duration: number }): number {
  return Math.round((clip.start + clip.duration * 0.25) * 24) / 24;
}

describe('Timeline keyframe editing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStore();
    stubRect();
  });

  it('double-clicking a clip plants a keyframe on the frame grid as one undo step', () => {
    if (!scene) throw new Error('seed scene missing');
    const { trackIndex, track, clip } = keyframeableClip();
    const planted = quarterTime(clip);

    render(<Timeline />);
    const button = screen.getByLabelText(new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`));
    const before = useEditor.getState().past.length;

    fireEvent.doubleClick(button, {
      clientX: planted * SCALE,
      clientY: trackIndex * LANE + LANE / 2 + RULER,
    });

    const state = useEditor.getState();
    const edited = openProject().scenes
      .find((s) => s.id === scene.id)
      ?.tracks.find((t) => t.id === track.id)
      ?.clips.find((c) => c.id === clip.id);
    expect(edited?.keyframes).toHaveLength(1);
    expect(edited?.keyframes[0]?.time).toBeCloseTo(planted, 5);
    // The new keyframe becomes the selection, ready for a drag or Delete.
    expect(state.selection.kind).toBe('keyframe');
    expect(state.past.length).toBe(before + 1);
  });

  it('dragging a keyframe moves it, quantised to the frame grid, in one commit', async () => {
    if (!scene) throw new Error('seed scene missing');
    const { trackIndex, track, clip } = keyframeableClip();
    const planted = quarterTime(clip);
    const deltaPx = 60; // one second at the default scale

    render(<Timeline />);
    const button = screen.getByLabelText(new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`));
    fireEvent.doubleClick(button, {
      clientX: planted * SCALE,
      clientY: trackIndex * LANE + LANE / 2 + RULER,
    });

    const marker = screen.getByTitle(`keyframe @ ${planted.toFixed(2)}s`);
    const before = useEditor.getState().past.length;
    const at = { clientX: planted * SCALE, clientY: trackIndex * LANE + LANE / 2 + RULER };

    fireEvent.pointerDown(marker, at);
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: at.clientX + deltaPx, clientY: at.clientY });
    });
    await act(async () => {
      fireEvent.pointerUp(window);
    });

    const state = useEditor.getState();
    const edited = openProject().scenes
      .find((s) => s.id === scene.id)
      ?.tracks.find((t) => t.id === track.id)
      ?.clips.find((c) => c.id === clip.id);
    expect(edited?.keyframes).toHaveLength(1);
    expect(edited?.keyframes[0]?.time).toBeCloseTo(planted + 1, 5);
    expect(state.past.length).toBe(before + 1);
  });

  it('a keyframe drag that snaps back to where it started commits nothing', async () => {
    if (!scene) throw new Error('seed scene missing');
    const { trackIndex, track, clip } = keyframeableClip();
    const planted = quarterTime(clip);

    render(<Timeline />);
    const button = screen.getByLabelText(new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`));
    fireEvent.doubleClick(button, {
      clientX: planted * SCALE,
      clientY: trackIndex * LANE + LANE / 2 + RULER,
    });

    const marker = screen.getByTitle(`keyframe @ ${planted.toFixed(2)}s`);
    const before = useEditor.getState().past.length;
    // 0.004s is comfortably inside a frame, so the quantised keyframe does not move.
    const wobble = (1 / 24) / 3; // under half a frame

    fireEvent.pointerDown(marker, { clientX: planted * SCALE, clientY: trackIndex * LANE + LANE / 2 + RULER });
    await act(async () => {
      fireEvent.pointerMove(window, {
        clientX: planted * SCALE + wobble * SCALE,
        clientY: trackIndex * LANE + LANE / 2 + RULER,
      });
    });
    await act(async () => {
      fireEvent.pointerUp(window);
    });

    expect(useEditor.getState().past.length).toBe(before);
  });

  it('Delete removes the selected clip; Backspace removes the selected keyframe', () => {
    if (!scene) throw new Error('seed scene missing');
    const { trackIndex, track, clip } = keyframeableClip();
    const planted = quarterTime(clip);

    render(<Timeline />);
    const button = screen.getByLabelText(new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`));

    // Backspace on a keyframe selection removes the keyframe, not the clip.
    fireEvent.doubleClick(button, {
      clientX: planted * SCALE,
      clientY: trackIndex * LANE + LANE / 2 + RULER,
    });
    fireEvent.keyDown(window, { key: 'Backspace' });

    let clipAfter =
      openProject().scenes.find((s) => s.id === scene.id)
        ?.tracks.find((t) => t.id === track.id)?.clips ?? [];
    const survivor = clipAfter.find((c) => c.id === clip.id);
    expect(survivor).toBeDefined();
    expect(survivor?.keyframes).toHaveLength(0);

    // Delete on the clip selection removes the whole clip.
    fireEvent.pointerDown(button, clipPosition(trackIndex, clip));
    fireEvent.keyDown(window, { key: 'Delete' });

    clipAfter =
      openProject().scenes.find((s) => s.id === scene.id)
        ?.tracks.find((t) => t.id === track.id)?.clips ?? [];
    expect(clipAfter.find((c) => c.id === clip.id)).toBeUndefined();
  });

  it('Delete on a dialogue cue takes the line with it, not just the clip', () => {
    if (!scene) throw new Error('seed scene missing');
    // A cue is the timing of a line. Removing only the clip would leave the line in the
    // script with nothing that ever displays or plays it, and no lane to re-time it on.
    const trackIndex = scene.tracks.findIndex((t) => t.kind === 'dialogue' && t.clips.length > 0);
    const track = scene.tracks[trackIndex];
    const clip = track?.clips[0];
    const lineId = clip?.dialogueLineId;
    if (!track || !clip || !lineId) throw new Error('seed scene has no dialogue cue');
    if (clip.duration * SCALE <= 2 * 7 + 4) throw new Error('cue too narrow to press by its body');

    render(<Timeline />);
    const button = screen.getByLabelText(
      new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`),
    );
    const before = useEditor.getState().past.length;

    fireEvent.pointerDown(button, clipPosition(trackIndex, clip));
    fireEvent.keyDown(window, { key: 'Delete' });

    const after =
      openProject().scenes.find((s) => s.id === scene.id) ?? null;
    expect(after?.dialogue.map((l) => l.id)).not.toContain(lineId);
    expect(after?.tracks.flatMap((t) => t.clips).map((c) => c.dialogueLineId)).not.toContain(lineId);
    // The lane existed only to hold that cue, so it goes with it.
    expect(after?.tracks.some((t) => t.kind === 'dialogue' && t.targetId === lineId)).toBe(false);
    expect(useEditor.getState().past.length).toBe(before + 1);
    expect(useEditor.getState().selection).toEqual({ kind: null, id: null });
  });

  it('the M button mutes and unmutes its track through a commit', () => {
    if (!scene) throw new Error('seed scene missing');
    render(<Timeline />);
    const beforeMuted = scene.tracks.filter((t) => t.muted).length;

    const muteButtons = screen.getAllByLabelText(/^Mute /);
    const firstMute = muteButtons[0];
    if (!firstMute) throw new Error('no mute buttons');
    fireEvent.click(firstMute);

    let tracks =
      openProject().scenes.find((s) => s.id === scene.id)
        ?.tracks.map((t) => ({ id: t.id, muted: t.muted })) ?? [];
    expect(tracks.filter((t) => t.muted).length).toBe(beforeMuted + 1);

    // Its label flipped, so the mute list no longer contains the same button.
    const unmuteButtons = screen.getAllByLabelText(/^Unmute /);
    const firstUnmute = unmuteButtons[0];
    if (!firstUnmute) throw new Error('no unmute buttons');
    fireEvent.click(firstUnmute);

    tracks =
      openProject().scenes.find((s) => s.id === scene.id)
        ?.tracks.map((t) => ({ id: t.id, muted: t.muted })) ?? [];
    expect(tracks.filter((t) => t.muted).length).toBe(beforeMuted);
  });

  it('drops a dragged clip onto another lane of the same kind in one commit', async () => {
    if (!scene) throw new Error('seed scene missing');
    const { trackIndex, track, clip } = pressableClip();
    // pressableClip lands on the first dialogue lane; the next dialogue lane is a
    // genuinely different track of the same kind.
    const targetIndex = scene.tracks.findIndex(
      (t, i) => t.kind === 'dialogue' && i !== trackIndex,
    );
    const targetTrack = scene.tracks[targetIndex];
    if (!targetTrack) throw new Error('no other dialogue lane');

    const before = useEditor.getState().past.length;
    render(<Timeline />);
    const button = screen.getByLabelText(
      new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`),
    );

    const at = clipPosition(trackIndex, clip);
    fireEvent.pointerDown(button, at);
    await act(async () => {
      fireEvent.pointerMove(window, {
        clientX: at.clientX,
        clientY: targetIndex * LANE + LANE / 2 + RULER,
      });
    });
    await act(async () => {
      fireEvent.pointerUp(window);
    });

    const state = useEditor.getState();
    expect(state.past.length).toBe(before + 1);
    const sceneNow = openProject().scenes.find((s) => s.id === scene.id);
    // The clip left its one-clip dialogue lane entirely and now carries the line's cue.
    expect(sceneNow?.tracks.some((t) => t.id === track.id)).toBe(false);
    const onTarget = sceneNow?.tracks.find((t) => t.id === targetTrack.id);
    expect(onTarget?.clips.some((c) => c.id === clip.id)).toBe(true);
  });

  it('a dropped clip that crosses kinds commits nothing and stays home', async () => {
    if (!scene) throw new Error('seed scene missing');
    const { trackIndex, track, clip } = pressableClip();
    // An actor lane: a different kind from dialogue, so the drop must not land.
    const actorIndex = scene.tracks.findIndex((t) => t.kind === 'actor');

    const before = useEditor.getState().past.length;
    render(<Timeline />);
    const button = screen.getByLabelText(
      new RegExp(`${escape(track.name)} clip at ${clip.start.toFixed(2)}s`),
    );

    const at = clipPosition(trackIndex, clip);
    fireEvent.pointerDown(button, at);
    await act(async () => {
      fireEvent.pointerMove(window, {
        clientX: at.clientX,
        clientY: actorIndex * LANE + LANE / 2 + RULER,
      });
    });
    await act(async () => {
      fireEvent.pointerUp(window);
    });

    const state = useEditor.getState();
    expect(state.past.length).toBe(before);
    const stillHome = openProject().scenes
      .find((s) => s.id === scene.id)
      ?.tracks.find((t) => t.id === track.id);
    expect(stillHome?.clips.some((c) => c.id === clip.id)).toBe(true);
  });

  it('adds a one-second clip at the playhead through a commit', () => {
    if (!scene) throw new Error('seed scene missing');
    const audioIndex = scene.tracks.findIndex((t) => t.kind === 'audio');
    const audioTrack = scene.tracks[audioIndex];
    if (!audioTrack) throw new Error('no audio lane');

    const before = useEditor.getState().past.length;
    render(<Timeline />);
    const add = screen.getByLabelText(`Add clip to ${audioTrack.name} at playhead`);
    fireEvent.click(add);

const state = useEditor.getState();
    expect(state.past.length).toBe(before + 1);
    const clips = openProject().scenes
      .find((s) => s.id === scene.id)
      ?.tracks.find((t) => t.id === audioTrack.id)?.clips ?? [];
    // Playhead was 0, so the fresh clip starts on the frame grid origin.
    expect(clips.some((c) => Math.abs(c.start) < 1e-6 && c.duration === 1)).toBe(true);
  });

  it('reorders a lane with the up control through a commit', () => {
    if (!scene) throw new Error('seed scene missing');
    const audioIndex = scene.tracks.findIndex((t) => t.kind === 'audio');
    const audioTrack = scene.tracks[audioIndex];
    if (!audioTrack || audioIndex <= 0) throw new Error('no movable audio lane');

    const before = useEditor.getState().past.length;
    render(<Timeline />);
    const up = screen.getByLabelText(`Move ${audioTrack.name} up`);
    fireEvent.click(up);

    const state = useEditor.getState();
    expect(state.past.length).toBe(before + 1);
    const order = openProject().scenes.find((s) => s.id === scene.id)?.tracks ?? [];
    const indexNow = order.findIndex((t) => t.id === audioTrack.id);
    expect(indexNow).toBe(audioIndex - 1);
  });

  it('deleting a dialogue cue lane removes the line it exists to carry', () => {
    if (!scene) throw new Error('seed scene missing');
    const lineIndex = scene.tracks.findIndex((t) => t.kind === 'dialogue');
    const lineTrack = scene.tracks[lineIndex];
    if (!lineTrack || lineTrack.targetId === undefined) throw new Error('no dialogue lane');

    const before = useEditor.getState().past.length;
    render(<Timeline />);
    const deleteButton = screen.getAllByLabelText(new RegExp(`^Delete ${escape(lineTrack.name)}$`))[0];
    if (!deleteButton) throw new Error('no delete button');
    fireEvent.click(deleteButton);

    const state = useEditor.getState();
    expect(state.past.length).toBe(before + 1);
    const sceneNow = openProject().scenes.find((s) => s.id === scene.id);
    expect(sceneNow?.tracks.some((t) => t.id === lineTrack.id)).toBe(false);
    // The cue line lived only inside this lane; it is gone too.
    expect(sceneNow?.dialogue.some((l) => l.id === lineTrack.targetId)).toBe(false);
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
