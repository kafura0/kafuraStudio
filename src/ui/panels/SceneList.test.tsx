/**
 * The scene list, including the part that builds a cut.
 *
 * The membership row exists because the exporter's unit is the episode. Without it there is
 * no way to get a scene into one from the app, and an episode with no scenes has nothing to
 * export — so these tests are about the cut being reachable and stated, not about layout.
 *
 * The `<details>` is left closed. A closed element still has its contents in the DOM, which
 * is what makes the menu assertable without pretending to test disclosure behaviour that
 * belongs to the browser.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SceneList } from './SceneList';
import { createEpisode, createScene } from '../../core/document/factories';
import type { Episode } from '../../core/types';

const sceneA = createScene('One', 'env.1');
const sceneB = createScene('Two', 'env.1');

function episode(title: string, sceneIds: string[]): Episode {
  return { ...createEpisode(title), id: `episode.${title}`, sceneIds };
}

type Props = Parameters<typeof SceneList>[0];

function renderList(over: Partial<Props> = {}) {
  const props: Props = {
    scenes: [sceneA, sceneB],
    activeSceneId: sceneA.id,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    ...over,
  };
  return { ...render(<SceneList {...props} />), props };
}

describe('SceneList', () => {
  it('lists the scenes with their duration and content counts', () => {
    renderList();
    expect(screen.getByText('One')).toBeTruthy();
    expect(screen.getByText('Two')).toBeTruthy();
    // The counts are what tells an operator whether a scene is finished, so they are
    // asserted rather than left to a snapshot. Two scenes, so two identical count lines.
    expect(screen.getAllByText(/12\.0s · 0 actors · 0 lines/)).toHaveLength(2);
  });

  it('marks the open scene as current', () => {
    renderList();
    expect(screen.getByText('One').closest('button')?.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Two').closest('button')?.getAttribute('aria-current')).toBeNull();
  });

  it('calls onSelect with the scene that was clicked', () => {
    const { props } = renderList();
    fireEvent.click(screen.getByText('Two'));
    expect(props.onSelect).toHaveBeenCalledWith(sceneB.id);
  });

  it('creates a scene through onCreate', () => {
    const { props } = renderList();
    fireEvent.click(screen.getByText('+ New scene'));
    expect(props.onCreate).toHaveBeenCalled();
  });

  describe('episode membership', () => {
    it('renders no menu when no cut actions are wired', () => {
      // A caller that has not opted in gets the list it asked for, not a dead control that
      // cannot do anything.
      renderList();
      expect(screen.queryByText('Not in an episode')).toBeNull();
    });

    it('says a scene is in no episode when it belongs to none', () => {
      renderList({ episodes: [episode('Episode 001', [])], onAddToEpisode: vi.fn() });
      expect(screen.getAllByText('Not in an episode')).toHaveLength(2);
    });

    it('names the episode a scene is already in', () => {
      renderList({ episodes: [episode('Episode 001', [sceneA.id])], onAddToEpisode: vi.fn() });
      expect(screen.getByText('In: Episode 001')).toBeTruthy();
      // Only the other scene is unmembered, so exactly one row says so.
      expect(screen.getAllByText('Not in an episode')).toHaveLength(1);
    });

    it('counts rather than names when a scene is in several cuts', () => {
      renderList({
        episodes: [episode('A', [sceneA.id]), episode('B', [sceneA.id])],
        onAddToEpisode: vi.fn(),
      });
      expect(screen.getByText('In 2 episodes')).toBeTruthy();
    });

    it('offers the new-episode action when the project has no episodes', () => {
      renderList({ episodes: [], onAddToEpisode: vi.fn(), onCreateEpisode: vi.fn() });
      expect(screen.getAllByText('No episodes in this project yet.')).toHaveLength(2);
      expect(screen.getAllByText('+ New episode with this scene')).toHaveLength(2);
    });

    it('adds the scene to the chosen episode', () => {
      const { props } = renderList({
        episodes: [episode('Episode 001', [])],
        onAddToEpisode: vi.fn(),
      });
      // One row per scene, so the first is scene A's.
      const buttons = screen.getAllByText('+ Episode 001 (0)');
      const first = buttons[0];
      if (!first) throw new Error('expected an add action per scene');
      fireEvent.click(first);
      expect(props.onAddToEpisode).toHaveBeenCalledWith(sceneA.id, 'episode.Episode 001');
    });

    it('will not offer to add a scene to a cut it is already in', () => {
      // The action is a no-op at that point, and a clickable "+" next to a ✓ invites the
      // user to find out for themselves.
      const { props } = renderList({
        episodes: [episode('Episode 001', [sceneA.id])],
        onAddToEpisode: vi.fn(),
      });
      const already = screen.getByText('✓ Episode 001 (1)');
      expect((already as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(already);
      expect(props.onAddToEpisode).not.toHaveBeenCalled();
    });

    it('asks for a new episode through the wired callback', () => {
      const { props } = renderList({
        episodes: [episode('Episode 001', [])],
        onCreateEpisode: vi.fn(),
      });
      const buttons = screen.getAllByText('+ New episode with this scene');
      const first = buttons[0];
      if (!first) throw new Error('expected a new-episode action per scene');
      fireEvent.click(first);
      expect(props.onCreateEpisode).toHaveBeenCalledTimes(1);
    });

    it('names the scene the click came from, not the open one', () => {
      // The menu hangs off every row, so a callback that resolved the scene itself would
      // build the cut out of whatever happened to be on stage. The button's own text claims
      // the scene, so the id has to match the claim.
      const { props } = renderList({
        episodes: [episode('Episode 001', [])],
        onCreateEpisode: vi.fn(),
      });
      const second = screen.getAllByText('+ New episode with this scene')[1];
      if (!second) throw new Error('expected a new-episode action per scene');
      fireEvent.click(second);
      expect(props.onCreateEpisode).toHaveBeenCalledWith(sceneB.id);
    });
  });
});
