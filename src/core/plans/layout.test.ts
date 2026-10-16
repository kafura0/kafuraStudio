import { describe, expect, it } from 'vitest';
import type { PlannedLine } from './types';
import {
  DIALOGUE_CUE_GAP,
  DIALOGUE_CUE_OVERLAP_TOLERANCE,
  estimateCueDuration,
  layoutDialogue,
} from './layout';
import { MIN_CLIP_DURATION } from '../document/trackOps';

function line(overrides: Partial<PlannedLine> = {}): PlannedLine {
  return { speaker: 'NIA', actorRef: 'char.nia', text: 'Hello there.', emotion: 'flat', ...overrides };
}

describe('estimateCueDuration', () => {
  it('follows the characters / 3 / 4.2 model', () => {
    expect(estimateCueDuration('abcdef')).toBeCloseTo(6 / 3 / 4.2, 10);
  });

  it('floors an empty line at the minimum clip duration', () => {
    expect(estimateCueDuration('')).toBe(MIN_CLIP_DURATION);
  });
});

describe('layoutDialogue — generated cues', () => {
  it('lays consecutive lines out from the default start with the default gap', () => {
    const layout = layoutDialogue({ lines: [line(), line({ text: 'Ok.' })], sceneDuration: 30, mode: 'create' });

    const first = layout.cues[0];
    const second = layout.cues[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.start).toBe(0);
    expect(first?.generated).toBe(true);
    expect(first?.truncated).toBe(false);
    expect(second?.start).toBeCloseTo((first?.duration ?? 0) + DIALOGUE_CUE_GAP, 10);
    expect(second?.duration).toBe(estimateCueDuration('Ok.'));
  });

  it('honours an explicit timing block', () => {
    const layout = layoutDialogue({
      lines: [line(), line()],
      sceneDuration: 30,
      mode: 'create',
      timing: { dialogueStart: 1.5, dialogueGap: 0.5 },
    });

    expect(layout.defaults).toEqual({ start: 1.5, gap: 0.5 });
    expect(layout.cues[0]?.start).toBe(1.5);
    expect(layout.cues[1]?.start).toBeCloseTo(1.5 + (layout.cues[0]?.duration ?? 0) + 0.5, 10);
  });

  it('keeps a fully explicit window verbatim', () => {
    const layout = layoutDialogue({ lines: [line({ start: 2, duration: 1.25 })], sceneDuration: 30, mode: 'modify' });

    expect(layout.cues[0]).toEqual({ start: 2, duration: 1.25, generated: false, truncated: false });
    expect(layout.extended).toBe(false);
    expect(layout.sceneDuration).toBe(30);
  });

  it('marks a window generated when either half is missing', () => {
    const layout = layoutDialogue({
      lines: [line({ start: 2 }), line({ duration: 1.25 })],
      sceneDuration: 30,
      mode: 'create',
    });

    expect(layout.cues[0]?.generated).toBe(true);
    expect(layout.cues[0]?.duration).toBe(estimateCueDuration(line().text));
    expect(layout.cues[1]?.generated).toBe(true);
    expect(layout.cues[1]?.start).toBeGreaterThan(2);
    expect(layout.cues[1]?.duration).toBe(1.25);
  });

  it('clamps negative explicit values without dropping the line', () => {
    const layout = layoutDialogue({ lines: [line({ start: -3, duration: -1 })], sceneDuration: 30, mode: 'modify' });

    expect(layout.cues[0]?.start).toBe(0);
    expect(layout.cues[0]?.duration).toBe(0);
  });

  it('reports nothing for an empty plan', () => {
    const layout = layoutDialogue({ lines: [], sceneDuration: 6, mode: 'create' });

    expect(layout.cues).toEqual([]);
    expect(layout.extended).toBe(false);
    expect(layout.sceneDuration).toBe(6);
  });
});

describe('layoutDialogue — create mode extends', () => {
  it('extends the scene to cover generated cues that overrun it', () => {
    const layout = layoutDialogue({ lines: [line({ text: 'a'.repeat(300) })], sceneDuration: 2, mode: 'create' });

    const end = (layout.cues[0]?.start ?? 0) + (layout.cues[0]?.duration ?? 0);
    expect(layout.extended).toBe(true);
    expect(layout.sceneDuration).toBeCloseTo(end, 10);
    expect(layout.cues[0]?.truncated).toBe(false);
  });

  it('extends to the furthest cue, not merely the last one', () => {
    const layout = layoutDialogue({
      lines: [line({ start: 40, duration: 2 }), line({ start: 1, duration: 1 })],
      sceneDuration: 6,
      mode: 'create',
    });

    expect(layout.extended).toBe(true);
    expect(layout.sceneDuration).toBe(42);
  });

  it('leaves a scene that already fits alone', () => {
    const layout = layoutDialogue({ lines: [line({ duration: 1 })], sceneDuration: 6, mode: 'create' });

    expect(layout.extended).toBe(false);
    expect(layout.sceneDuration).toBe(6);
  });
});

describe('layoutDialogue — modify mode truncates', () => {
  it('shortens a cue that would cross the scene end', () => {
    const layout = layoutDialogue({
      lines: [line({ start: 8, duration: 5 })],
      sceneDuration: 10,
      mode: 'modify',
    });

    expect(layout.cues[0]).toEqual({ start: 8, duration: 2, generated: false, truncated: true });
    expect(layout.sceneDuration).toBe(10);
  });

  it('parks a cue that starts at the scene end at the tail of the scene', () => {
    const layout = layoutDialogue({
      lines: [line({ start: 10, duration: 2 })],
      sceneDuration: 10,
      mode: 'modify',
    });

    expect(layout.cues[0]?.start).toBeCloseTo(10 - MIN_CLIP_DURATION, 10);
    expect(layout.cues[0]?.duration).toBeCloseTo(MIN_CLIP_DURATION, 10);
    expect((layout.cues[0]?.start ?? 0) + (layout.cues[0]?.duration ?? 0)).toBeCloseTo(10, 10);
    expect(layout.cues[0]?.truncated).toBe(true);
  });

  it('keeps a window that already fits', () => {
    const layout = layoutDialogue({ lines: [line({ start: 1, duration: 2 })], sceneDuration: 10, mode: 'modify' });

    expect(layout.cues[0]?.truncated).toBe(false);
  });
});

describe('layoutDialogue — overlap detection', () => {
  it('flags a cue whose start lands inside its predecessor', () => {
    const layout = layoutDialogue({
      lines: [line({ start: 0, duration: 3 }), line({ start: 2, duration: 1 })],
      sceneDuration: 30,
      mode: 'modify',
    });

    expect(layout.overlapIndices).toEqual([1]);
  });

  it('accepts windows that merely touch', () => {
    const layout = layoutDialogue({
      lines: [line({ start: 0, duration: 2 }), line({ start: 2, duration: 1 })],
      sceneDuration: 30,
      mode: 'modify',
    });

    expect(layout.overlapIndices).toEqual([]);
  });

  it('accepts a gap inside the tolerance', () => {
    const layout = layoutDialogue({
      lines: [line({ start: 0, duration: 2 }), line({ start: 2 - DIALOGUE_CUE_OVERLAP_TOLERANCE, duration: 1 })],
      sceneDuration: 30,
      mode: 'modify',
    });

    expect(layout.overlapIndices).toEqual([]);
  });

  it('flags every overlapping line, not only the first', () => {
    const layout = layoutDialogue({
      lines: [line({ start: 0, duration: 3 }), line({ start: 1, duration: 3 }), line({ start: 2, duration: 1 })],
      sceneDuration: 30,
      mode: 'modify',
    });

    expect(layout.overlapIndices).toEqual([1, 2]);
  });
});
