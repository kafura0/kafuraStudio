/**
 * The project browser.
 *
 * The store tests next door cover what open, archive and delete *do* to a document. What
 * is only visible here is what the operator is shown and asked for, and those are where
 * irreversible mistakes happen:
 *
 *  - Delete has to say what it is deleting before it does it. There is no undo for it and
 *    no quarantine, so a single unconfirmed click destroys a project.
 *  - Archive has to be reversible from the same screen. Hidden with no way back is a
 *    delete wearing a kinder label.
 *  - The list is the startup screen, so it has to be honest about having nothing rather
 *    than opening a document the operator did not choose.
 *
 * The listing is driven through the repository rather than pushed into the store by hand.
 * The component reloads it on mount, so a test that seeded the store directly would be
 * asserting against a screen that only existed for a microtask.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProjectBrowser } from './ProjectBrowser';
import { useEditor } from '../state/editorStore';
import type { ProjectSummary, SeriesSummary } from '../core/persistence/repository';
import type { SeriesDef } from '../core/types';

const summary = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'proj.1',
  name: 'ZANZA — Pilot',
  updatedAt: '2026-01-01T00:00:00.000Z',
  sceneCount: 2,
  episodeCount: 1,
  archivedAt: null,
  // A free project, since these tests are about the browser chrome rather than about
  // ownership. Stated explicitly so a future change to the summary shape fails here rather
  // than defaulting to a show and quietly reinterpreting what the test is checking.
  seriesId: null,
  ...over,
});

/** The workspace, as the repository would report it. */
const db = vi.hoisted(() => ({
  summaries: [] as { id: string; name: string; updatedAt: string; sceneCount: number; episodeCount: number; archivedAt: string | null }[],
}));

const repository = vi.hoisted(() => ({
  save: vi.fn(async () => {}),
  loadMostRecent: vi.fn(async () => null),
  load: vi.fn(async () => null),
  remove: vi.fn(async () => {}),
  list: vi.fn(async () => db.summaries),
}));

vi.mock('../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => true,
  IndexedDbProjectRepository: vi.fn(() => repository),
  IndexedDbSeriesRepository: vi.fn(() => ({
    save: vi.fn(async (_series: SeriesDef) => {}),
    load: vi.fn(async (_id: string): Promise<SeriesDef | null> => null),
    list: vi.fn(async (): Promise<SeriesSummary[]> => []),
    remove: vi.fn(async () => {}),
  })),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  db.summaries = [];
  repository.save.mockClear();
  repository.remove.mockClear();
  useEditor.setState({
    project: null,
    past: [],
    future: [],
    projects: [],
    status: 'ready',
    statusMessage: null,
  });
});

/**
 * Render and let the mount effect's `refreshProjects` settle.
 *
 * The browser reloads the listing when it appears, which is an async state update. Awaiting
 * it inside `act` is what keeps React from warning about an update that landed after the
 * test thought it was finished — and it means each test asserts against a real, settled
 * screen.
 */
async function renderBrowser(): Promise<void> {
  await act(async () => {
    render(<ProjectBrowser />);
  });
}

describe('ProjectBrowser', () => {
  it('says so when there is nothing, instead of showing an empty editor', async () => {
    await renderBrowser();
    expect(screen.getByText(/No projects yet/)).toBeTruthy();
  });

  it('lists the projects it is given', async () => {
    db.summaries = [summary(), summary({ id: 'proj.2', name: 'Episode 002' })];
    await renderBrowser();
    expect(screen.getByText('ZANZA — Pilot')).toBeTruthy();
    expect(screen.getByText('Episode 002')).toBeTruthy();
  });

  it('hides archived projects until asked, and shows them again on request', async () => {
    db.summaries = [
      summary(),
      summary({ id: 'proj.old', name: 'Old Cut', archivedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    await renderBrowser();

    // The default list is the live projects. An archive that does not hide anything is not
    // an archive.
    expect(screen.getByText('ZANZA — Pilot')).toBeTruthy();
    expect(screen.queryByText('Old Cut')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    expect(screen.getByText('Old Cut')).toBeTruthy();
    expect(screen.queryByText('ZANZA — Pilot')).toBeNull();
  });

  it('offers to restore an archived project', async () => {
    db.summaries = [summary({ archivedAt: '2026-02-01T00:00:00.000Z' })];
    await renderBrowser();
    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
  });

  it('asks before deleting, and does nothing when the answer is no', async () => {
    db.summaries = [summary()];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderBrowser();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // The prompt has to name the project, or "are you sure?" is answerable without knowing
    // what is about to be destroyed.
    expect(confirmSpy).toHaveBeenCalled();
    expect(confirmSpy.mock.calls[0]?.[0]).toContain('ZANZA — Pilot');
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('deletes when the answer is yes', async () => {
    db.summaries = [summary()];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderBrowser();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(repository.remove).toHaveBeenCalledWith('proj.1');
  });

  it('opens a project on request', async () => {
    db.summaries = [summary()];
    await renderBrowser();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    });
    expect(repository.load).toHaveBeenCalledWith('proj.1');
  });

  it('shows a recovery message rather than swallowing it', async () => {
    useEditor.setState({
      status: 'error',
      statusMessage: 'A saved project could not be read and has been set aside.',
    });
    await renderBrowser();
    // Quarantine is invisible to a user who is not told. The record is safe, but they have
    // to know it exists and that something went wrong.
    expect(screen.getByRole('status').textContent).toContain('set aside');
  });
});
