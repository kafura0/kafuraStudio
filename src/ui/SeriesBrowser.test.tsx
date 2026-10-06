/**
 * The series browser.
 *
 * Phase 14 added a second pane to the project browser: the tab that manages *shows* rather
 * than productions. What is only visible here is the operator-facing behaviour the store
 * tests cannot reach — the confirmations, the refusal message, and the fact that a created
 * series appears in the workspace's own listing (which is what makes a second show
 * authorable in the UI at all).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SeriesBrowser } from './SeriesBrowser';
import { ProjectBrowser } from './ProjectBrowser';
import { useEditor } from '../state/editorStore';
import type { SeriesDef } from '../core/types';
import type { SeriesSummary } from '../core/persistence/repository';

const db = vi.hoisted(() => ({
  series: [] as SeriesDef[],
}));

const seriesRepository = vi.hoisted(() => ({
  save: vi.fn(async (series: SeriesDef) => {
    db.series = [...db.series.filter((s) => s.id !== series.id), series];
  }),
  load: vi.fn(async (id: string): Promise<SeriesDef | null> => {
    return db.series.find((s) => s.id === id) ?? null;
  }),
  list: vi.fn(async (): Promise<SeriesSummary[]> => {
    return db.series.map((s) => ({
      id: s.id,
      name: s.name,
      updatedAt: s.updatedAt,
      projectCount: 0,
    }));
  }),
  remove: vi.fn(async (id: string) => {
    db.series = db.series.filter((s) => s.id !== id);
  }),
}));

vi.mock('../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => true,
  IndexedDbProjectRepository: vi.fn(() => ({
    save: vi.fn(async () => {}),
    loadMore: vi.fn(async () => null),
    load: vi.fn(async () => null),
    loadMostRecent: vi.fn(async () => null),
    remove: vi.fn(async () => {}),
    list: vi.fn(async () => []),
  })),
  IndexedDbSeriesRepository: vi.fn(() => seriesRepository),
}));

beforeEach(() => {
  db.series = [];
  vi.clearAllMocks();
  useEditor.setState({
    project: null,
    series: null,
    context: null,
    past: [],
    future: [],
    projects: [],
    seriesList: [],
    status: 'ready',
    statusMessage: null,
  });
});

/** Render and let the mount effect's `refreshSeries` settle. */
async function renderSeries(): Promise<void> {
  await act(async () => {
    render(<SeriesBrowser />);
  });
}

describe('SeriesBrowser', () => {
  it('says so when there are no series', async () => {
    await renderSeries();
    expect(screen.getByText(/No series yet/)).toBeTruthy();
  });

  it('creates a series and shows it in the listing', async () => {
    await renderSeries();
    fireEvent.change(screen.getByPlaceholderText('The second show…'), {
      target: { value: 'WORLD 9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'New series' }));

    // The store action is fire-and-forget from the component's point of view, so the tab
    // updates asynchronously — wait on the persisted and listed result, not on a microtask.
    await waitFor(() => {
      expect(useEditor.getState().seriesList.map((s) => s.name)).toContain('WORLD 9');
    });
    expect(seriesRepository.save).toHaveBeenCalled();
    expect(screen.getByText('WORLD 9')).toBeTruthy();
  });

  it('is reachable from the project browser as a tab', async () => {
    await act(async () => {
      render(<ProjectBrowser />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Series \(0\)/ }));
    });
    expect(screen.getByPlaceholderText('The second show…')).toBeTruthy();
  });

  it('asks before deleting, and names the series in the question', async () => {
    db.series = [{
      id: 'series-vanish',
      name: 'The Vanishing',
      description: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      formatVersion: 3,
      assets: { characters: [], environments: [], poses: [], expressions: [], props: [], audio: [] },
      cameraPresets: [],
      metadata: {},
    }];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderSeries();

    await waitFor(() => expect(screen.getByText('The Vanishing')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(confirmSpy.mock.calls[0]?.[0]).toContain('The Vanishing');
    expect(seriesRepository.remove).toHaveBeenCalledWith('series-vanish');
  });

  it('does not delete when the answer is no', async () => {
    db.series = [{
      id: 'series-vanish',
      name: 'The Vanishing',
      description: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      formatVersion: 3,
      assets: { characters: [], environments: [], poses: [], expressions: [], props: [], audio: [] },
      cameraPresets: [],
      metadata: {},
    }];
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderSeries();

    await waitFor(() => expect(screen.getByText('The Vanishing')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(seriesRepository.remove).not.toHaveBeenCalled();
  });

  it('surfaces a refused deletion as the status message', async () => {
    db.series = [{
      id: 'series-zanza',
      name: 'ZANZA',
      description: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      formatVersion: 3,
      assets: { characters: [], environments: [], poses: [], expressions: [], props: [], audio: [] },
      cameraPresets: [],
      metadata: {},
    }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    seriesRepository.remove.mockRejectedValueOnce(
      new Error('2 projects still reference it. Reassign or delete those projects first.'),
    );
    await renderSeries();

    await waitFor(() => expect(screen.getByText('ZANZA')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('still reference it');
    });
  });
});