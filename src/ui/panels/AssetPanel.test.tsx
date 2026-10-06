/**
 * The asset library panel.
 *
 * One thing is asserted here, and it is the Phase 8 gate: the audio list must not let a
 * user believe a recording exists when none does. Every slot in the library ships
 * `src: null`, so a panel that listed names and kinds without saying so would be
 * asserting a falsehood 15 times (RULE 9).
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssetPanel } from './AssetPanel';
import { seedContext } from '../../data/seed';
import type { AssetLibrary } from '../../core/types';

// The resolved library, exactly as the panel receives it in the app. Sourced from
// `seedContext()` rather than `SEED_PROJECT.assets` because the library moved to the series:
// reading the project's own list would give an empty collection and every count assertion
// below would pass against nothing.
const assets = seedContext().assets;

describe('AssetPanel', () => {
  it('lists every asset group with its count', () => {
    render(<AssetPanel assets={assets} />);
    for (const group of [
      'Characters',
      'Environments',
      'Poses',
      'Expressions',
      'Props',
      'Audio',
    ]) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    expect(screen.getByText('Asset library')).toBeTruthy();
  });

  it('marks every fileless audio slot as having no recording', () => {
    expect(assets.audio.length).toBeGreaterThan(0);
    render(<AssetPanel assets={assets} />);

    // The seed ships declared slots, so every one of them is honest about being empty.
    expect(screen.getAllByTestId('asset-audio-no-file')).toHaveLength(assets.audio.length);
    expect(screen.queryByText(/file attached/)).toBeNull();
  });

  it('says a slot has a file once one is attached, and keeps the rest honest', () => {
    const withOne: AssetLibrary = {
      ...assets,
      audio: assets.audio.map((a, i) => (i === 0 ? { ...a, src: 'audio/line1.wav' } : a)),
    };

    render(<AssetPanel assets={withOne} />);
    expect(screen.getAllByText(/file attached/)).toHaveLength(1);
    expect(screen.getAllByTestId('asset-audio-no-file')).toHaveLength(withOne.audio.length - 1);
  });

  it('shows each slot its kind and declared length', () => {
    render(<AssetPanel assets={assets} />);
    const first = assets.audio[0];
    if (!first) throw new Error('no audio slots');
    expect(screen.getByText(first.name)).toBeTruthy();
    // Kinds repeat across slots, so this counts the slots that share the kind rather
    // than expecting one match.
    expect(screen.getAllByText(first.kind).length).toBe(
      assets.audio.filter((a) => a.kind === first.kind).length,
    );
    expect(screen.getAllByText(`${first.duration.toFixed(1)}s`).length).toBeGreaterThan(0);
  });
});
