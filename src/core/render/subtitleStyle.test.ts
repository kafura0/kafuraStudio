/**
 * Subtitle wrapping and styling (ARCHITECTURE_SPEC.md §18.3 R8).
 *
 * The regression the suite guards is "a long line must stack, never squash". A subtitle
 * that fits stays one line exactly as before — one `fillText` carrying the same
 * `maxWidth` — because the colour/box/layout defaults are the renderer's and a document
 * that never mentioned a style draws identically to a pre-R8 one.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLE_STYLE, activeDialogue, renderScene, wrapSubtitle } from './render';
import type { SceneContext } from '../types';
import { SEED_PROJECT, seedContext } from '../../data/seed';
import { RecordingContext, renderToRecording } from '../../test/recordingContext';

const scene1 = SEED_PROJECT.scenes[0]!;

/** A word-count measure that mirrors the recording context: 8px per character. */
const perChar = (line: string): number => line.length * 8;

/** 572+ characters, so at a 1920-wide stage it far exceeds `maxWidth` (1651.2px). */
const LONG_LINE = `${'the grid feeds first '.repeat(26).trim()}, they said.`;

/** A scene in which the line speaking at t=3.0 carries `subtitle` instead of its own text. */
function sceneWithSubtitle(subtitle: string): typeof scene1 {
  const active = activeDialogue(scene1, 3);
  if (!active) throw new Error('seed scene 1 must have dialogue at t=3.0');
  return {
    ...scene1,
    dialogue: scene1.dialogue.map((line) =>
      line.id === active.id ? { ...line, subtitle } : line,
    ),
  };
}

describe('wrapSubtitle', () => {
  it('keeps a fitting line whole, word boundaries intact', () => {
    expect(wrapSubtitle('Out. OUT!', 1000, perChar)).toEqual(['Out. OUT!']);
  });

  it('does not trim or rejoin whitespace around a fitting line', () => {
    expect(wrapSubtitle('  two words  ', 1000, perChar)).toEqual(['two words']);
  });

  it('returns nothing for blank text', () => {
    expect(wrapSubtitle('', 1000, perChar)).toEqual([]);
    expect(wrapSubtitle('   ', 1000, perChar)).toEqual([]);
  });

  it('stacks a line that would overflow', () => {
    // `perChar` is 8px per character, so a width of 24 fits exactly two words.
    const lines = wrapSubtitle('a b c d', 24, perChar);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('a b');
    expect(lines[1]).toBe('c d');
  });

  it('marks dropped text with an ellipsis instead of silently cutting', () => {
    // Fits two words per line: the fifth word would need a third line and is cut.
    expect(wrapSubtitle('a b c d e f', 24, perChar)).toEqual(['a b', 'c d…']);
  });

  it('gives an unbreakable long word a line of its own rather than squashing it', () => {
    const lines = wrapSubtitle('supercalifragilisticexpialidocious x', 100, perChar);
    expect(lines[0]).toBe('supercalifragilisticexpialidocious');
    expect(lines[1]).toBe('x');
  });
});

describe('drawSubtitle', () => {
  it('draws a fitting line as a single squashed-allowance fillText (legacy pixels)', () => {
    const ctx = renderToRecording(seedContext(), scene1, 3);
    const draws = ctx.opsFor('fillText');
    expect(draws).toHaveLength(1);
    expect(String(draws[0]?.args[0])).toBe('Building my empire.');
    // The single-line path retains the historical `maxWidth` argument.
    expect(draws[0]?.args[3]).toBe(1920 * 0.86);
  });

  it('renders a long line as two stacked fillTexts with no squash', () => {
    const ctx = new RecordingContext();
    renderScene(ctx, seedContext(), sceneWithSubtitle(LONG_LINE), 3);

    const draws = ctx.opsFor('fillText');
    expect(draws).toHaveLength(2);
    const [top, bottom] = draws;
    expect(top && bottom).toBeDefined();
    if (!top || !bottom) return;

    // No `maxWidth` arg: the stack was computed by measure, it is not squeezed.
    expect(top.args[3]).toBeUndefined();
    expect(bottom.args[3]).toBeUndefined();
    // The bottom line sits one lineHeight below the top (`fillText`'s y is arg 2).
    expect(Number(bottom.args[2]) - Number(top.args[2])).toBe(DEFAULT_SUBTITLE_STYLE.lineHeight);
    // Text that would need a third line is cut visibly, not dropped silently.
    expect(String(bottom.args[0])).toMatch(/…$/);
  });

  it('renders identically for a document that never declared a subtitleStyle', () => {
    const { subtitleStyle: _dropped, ...settings } = seedContext().settings;
    void _dropped;
    const doc: SceneContext = { ...seedContext(), settings };
    const ctx = new RecordingContext();
    renderScene(ctx, doc, scene1, 3);
    const draws = ctx.opsFor('fillText');
    expect(draws).toHaveLength(1);
    expect(draws[0]?.args[3]).toBe(1920 * 0.86);
    const fillStyles = ctx.opsFor('set:fillStyle').map((op) => op.args[0]);
    expect(fillStyles).toContain(DEFAULT_SUBTITLE_STYLE.boxColor);
    expect(fillStyles).toContain(DEFAULT_SUBTITLE_STYLE.textColor);
  });

  it('honours overrides from a declared subtitleStyle', () => {
    const custom: SceneContext = {
      ...seedContext(),
      settings: {
        ...seedContext().settings,
        subtitleStyle: {
          ...DEFAULT_SUBTITLE_STYLE,
          textColor: '#aabbcc',
          lineHeight: 64,
        },
      },
    };
    const ctx = new RecordingContext();
    renderScene(ctx, custom, sceneWithSubtitle(LONG_LINE), 3);

    expect(ctx.opsFor('set:fillStyle').map((op) => op.args[0])).toContain('#aabbcc');

    const draws = ctx.opsFor('fillText');
    expect(draws).toHaveLength(2);
    const [top, bottom] = draws;
    expect(top && bottom).toBeDefined();
    if (!top || !bottom) return;
    expect(Number(bottom.args[2]) - Number(top.args[2])).toBe(64);
  });
});