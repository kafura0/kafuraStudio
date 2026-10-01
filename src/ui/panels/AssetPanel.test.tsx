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
import { SEED_PROJECT } from '../../data/seed';
import type { Project } from '../../core/types';

const project = SEED_PROJECT as Project;

describe('AssetPanel', () => {
  it('lists every asset group with its count', () => {
    render(<AssetPanel project={project} />);
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
    expect(project.assets.audio.length).toBeGreaterThan(0);
    render(<AssetPanel project={project} />);

    // The seed ships declared slots, so every one of them is honest about being empty.
    expect(screen.getAllByTestId('asset-audio-no-file')).toHaveLength(project.assets.audio.length);
    expect(screen.queryByText(/file attached/)).toBeNull();
  });

  it('says a slot has a file once one is attached, and keeps the rest honest', () => {
    const withOne = {
      ...project,
      assets: {
        ...project.assets,
        audio: project.assets.audio.map((a, i) => (i === 0 ? { ...a, src: 'audio/line1.wav' } : a)),
      },
    } satisfies Project;

    render(<AssetPanel project={withOne} />);
    expect(screen.getAllByText(/file attached/)).toHaveLength(1);
    expect(screen.getAllByTestId('asset-audio-no-file')).toHaveLength(withOne.assets.audio.length - 1);
  });

  it('shows each slot its kind and declared length', () => {
    render(<AssetPanel project={project} />);
    const first = project.assets.audio[0];
    if (!first) throw new Error('no audio slots');
    expect(screen.getByText(first.name)).toBeTruthy();
    // Kinds repeat across slots, so this counts the slots that share the kind rather
    // than expecting one match.
    expect(screen.getAllByText(first.kind).length).toBe(
      project.assets.audio.filter((a) => a.kind === first.kind).length,
    );
    expect(screen.getAllByText(`${first.duration.toFixed(1)}s`).length).toBeGreaterThan(0);
  });
});
