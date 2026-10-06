/**
 * Series lifecycle behaviour.
 *
 * Phase 14 made the workspace two-scoped: a project sits inside a series, and the series
 * owns the reusable library. The store's series actions are thin on top of the repository
 * and the core document ops, but thin does not mean absent — the refusals have to surface
 * as status errors, and renaming the show the open project belongs to has to rebuild the
 * context that names it.
 *
 * What these tests exist to pin:
 *
 *  - A created series is persisted and listed, and a project can be created inside it and
 *    lists under it.
 *  - Deleting a series refuses while a project references it, and the refusal is a status
 *    error rather than a swallowed rejection.
 *  - Removing a series asset refuses while any project of the show references it, because a
 *    series asset belongs to every project of the show and removing it resolves them all to
 *    nothing.
 *  - Renaming the open project's series rebuilds the resolved context, so the editor stops
 *    naming the old row.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { addSeriesAsset } from '../core/document/seriesOps';
import { createSeries as newSeriesDef } from '../core/document/factories';
import type { Project, SeriesDef } from '../core/types';
import type { SeriesSummary } from '../core/persistence/repository';
import { NIA } from '../data/characters';
import { SEED_PROJECT, SEED_SERIES } from '../data/seed';
import { useEditor } from './editorStore';

const repository = vi.hoisted(() => {
  const stored = new Map<string, string>();
  return {
    stored,
    save: vi.fn(async (project: Project) => {
      stored.set(project.id, JSON.stringify({ formatVersion: project.formatVersion, project }));
    }),
    load: vi.fn(async (id: string): Promise<unknown> => {
      const raw = stored.get(id);
      if (raw === undefined) return null;
      return JSON.parse(raw).project as Project;
    }),
    loadMostRecent: vi.fn(async (): Promise<unknown> => null),
    remove: vi.fn(async (id: string) => {
      stored.delete(id);
    }),
    list: vi.fn(async (seriesId?: string | null) => {
      const rows: { id: string; seriesId: string | null }[] = [];
      for (const raw of stored.values()) {
        const parsed = JSON.parse(raw).project as { id: string; seriesId: string | null };
        if (seriesId === undefined || parsed.seriesId === seriesId) rows.push(parsed);
      }
      return rows;
    }),
  };
});

const seriesRepository = vi.hoisted(() => {
  const stored = new Map<string, string>();
  return {
    stored,
    save: vi.fn(async (series: SeriesDef) => {
      stored.set(series.id, JSON.stringify({ formatVersion: series.formatVersion, series }));
    }),
    load: vi.fn(async (id: string): Promise<unknown> => {
      const raw = stored.get(id);
      if (raw === undefined) {
        return id === SEED_SERIES.id ? SEED_SERIES : null;
      }
      return JSON.parse(raw).series as SeriesDef;
    }),
    list: vi.fn(async (): Promise<SeriesSummary[]> => {
      const summarise = (series: SeriesDef): SeriesSummary => ({
        id: series.id,
        name: series.name,
        updatedAt: series.updatedAt,
        projectCount: null,
      });
      const rows = [...stored.values()].map((raw) => JSON.parse(raw).series as SeriesDef);
      // The workspace's own show is always listed by the real repository. Keep that here so
      // the browser renders the same world.
      return [summarise(SEED_SERIES), ...rows.filter((s) => s.id !== SEED_SERIES.id).map(summarise)];
    }),
    remove: vi.fn(async (id: string) => {
      stored.delete(id);
    }),
  };
});

vi.mock('../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => true,
  IndexedDbProjectRepository: vi.fn(() => repository),
  IndexedDbSeriesRepository: vi.fn(() => seriesRepository),
}));

const reset = (): void => {
  repository.stored.clear();
  seriesRepository.stored.clear();
  for (const mock of [
    repository.save,
    repository.load,
    repository.remove,
    repository.list,
    seriesRepository.save,
    seriesRepository.load,
    seriesRepository.list,
    seriesRepository.remove,
  ]) {
    mock.mockClear();
  }
  useEditor.setState({
    project: null,
    series: null,
    context: null,
    past: [],
    future: [],
    playhead: 0,
    playing: false,
    playbackMode: 'scene-wrap',
    sceneId: '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,
    status: 'ready',
    statusMessage: null,
    projects: [],
    seriesList: [],
  });
};

beforeEach(reset);

/** Create a series and a project inside it, then open the project. */
const openProjectInSeries = async (seriesName: string, projectName: string): Promise<string> => {
  await act(async () => {
    await useEditor.getState().createSeries(seriesName);
  });
  const seriesId = useEditor.getState().seriesList.find((s) => s.name === seriesName)?.id;
  expect(seriesId).toBeDefined();
  await act(async () => {
    await useEditor.getState().createProject(projectName, seriesId);
  });
  const projectId = useEditor.getState().projects[0]?.id;
  expect(projectId).toBeDefined();
  await act(async () => {
    await useEditor.getState().openProject(projectId as string);
  });
  expect(useEditor.getState().project?.id).toBe(projectId);
  return seriesId as string;
};

describe('creating a series', () => {
  it('persists it and adds it to the listing', async () => {
    await act(async () => {
      await useEditor.getState().createSeries('Zanza: Tower Block 9');
    });

    expect([...seriesRepository.stored.keys()]).toHaveLength(1);
    const created = JSON.parse([...seriesRepository.stored.values()][0] as string)
      .series as SeriesDef;
    expect(created.name).toBe('Zanza: Tower Block 9');
    expect(useEditor.getState().seriesList.map((s) => s.id)).toContain(created.id);
  });

  it('returns its id, and a blank name becomes a fallback', async () => {
    const id = await act(async () => useEditor.getState().createSeries('   '));
    expect(id).not.toBeNull();
    expect(useEditor.getState().seriesList.find((s) => s.id === id)?.name).toBe(
      'Untitled Series',
    );
  });

  it('accepts a project created inside it, which lists under its id', async () => {
    await act(async () => {
      await useEditor.getState().createSeries('Zanza: Tower Block 9');
    });
    const id = useEditor.getState().seriesList[1]?.id;
    expect(id).toBeDefined();

    await act(async () => {
      await useEditor.getState().createProject('Tower Block 9 — 001', id);
    });

    const members = await repository.list(id as string);
    expect(members).toHaveLength(1);
    expect(useEditor.getState().projects.length).toBe(1);
  });
});

describe('deleting a series', () => {
  it('removes a series nobody uses', async () => {
    await act(async () => {
      await useEditor.getState().createSeries('Empty Show');
    });
    const id = useEditor.getState().seriesList.find((s) => s.name === 'Empty Show')?.id;

    await act(async () => {
      await useEditor.getState().deleteSeries(id as string);
    });

    expect(useEditor.getState().seriesList.map((s) => s.id)).not.toContain(id);
    expect([...seriesRepository.stored.keys()]).not.toContain(id);
    expect(useEditor.getState().status).toBe('ready');
  });

  it('refuses while a project references it, and the refusal is a status error', async () => {
    await openProjectInSeries('Zanza: Tower Block 9', 'Tower Block 9 — 001');
    const id = useEditor.getState().seriesList.find((s) => s.name === 'Zanza: Tower Block 9')?.id;

    seriesRepository.remove.mockRejectedValueOnce(
      new Error('2 projects still reference it. Reassign or delete those projects first.'),
    );

    await act(async () => {
      await useEditor.getState().deleteSeries(id as string);
    });

    expect(useEditor.getState().status).toBe('error');
    expect(useEditor.getState().statusMessage).toMatch(/still reference it/);
    expect(useEditor.getState().seriesList.map((s) => s.id)).toContain(id);
  });
});

describe('renaming a series', () => {
  it('persists the new name', async () => {
    const series: SeriesDef = { ...newSeriesDef('Old Name'), id: 'series-rename-test' };
    seriesRepository.stored.set(
      series.id,
      JSON.stringify({ formatVersion: series.formatVersion, series }),
    );

    await act(async () => {
      await useEditor.getState().renameSeries('series-rename-test', 'New Name');
    });

    const stored = JSON.parse(seriesRepository.stored.get(series.id) as string)
      .series as SeriesDef;
    expect(stored.name).toBe('New Name');
    expect(useEditor.getState().seriesList.find((s) => s.id === series.id)?.name).toBe(
      'New Name',
    );
  });

  it('rebuilds the open context when the open project belongs to the renamed series', async () => {
    const seriesId = await openProjectInSeries('Before Rename', 'Episode');
    expect(useEditor.getState().series?.id).toBe(seriesId);
    expect(useEditor.getState().series?.name).toBe('Before Rename');

    await act(async () => {
      await useEditor.getState().renameSeries(seriesId, 'After Rename');
    });

    expect(useEditor.getState().series?.name).toBe('After Rename');
    expect(useEditor.getState().context).not.toBeNull();
  });
});

describe('removing a series asset', () => {
  it('refuses while any project of the show references it, naming the project', async () => {
    // The seed show owns the library and the seed project casts it; this is the reference
    // case Phase 14 exists for. Seed both rows the reference check reads.
    const nia = SEED_SERIES.assets.characters.find((c) => c.id === NIA.id);
    expect(nia).toBeDefined();
    seriesRepository.stored.set(
      SEED_SERIES.id,
      JSON.stringify({ formatVersion: SEED_SERIES.formatVersion, series: SEED_SERIES }),
    );
    repository.stored.set(
      SEED_PROJECT.id,
      JSON.stringify({ formatVersion: SEED_PROJECT.formatVersion, project: SEED_PROJECT }),
    );

    await act(async () => {
      await useEditor.getState().removeSeriesAsset(
        SEED_SERIES.id,
        'characters',
        nia?.id as string,
      );
    });

    expect(useEditor.getState().status).toBe('error');
    expect(useEditor.getState().statusMessage).toMatch(/still used/);
    expect(useEditor.getState().statusMessage).toContain(SEED_PROJECT.name);
  });

it('removes the asset and rebuilds the context when nothing references it', async () => {
    const series = newSeriesDef('Spare Parts');
    const withProp = addSeriesAsset(series, 'props', {
      id: 'prop-older-sign',
      name: 'Older Sign',
      description: '',
      shape: null,
    } as never);
    seriesRepository.stored.set(
      withProp.id,
      JSON.stringify({ formatVersion: withProp.formatVersion, series: withProp }),
    );
    await act(async () => {
      await useEditor.getState().createProject('Episode', withProp.id);
    });
    const projectId = useEditor.getState().projects[0]?.id;
    await act(async () => {
      await useEditor.getState().openProject(projectId as string);
    });
    expect(useEditor.getState().series?.id).toBe(withProp.id);

    await act(async () => {
      await useEditor.getState().removeSeriesAsset(withProp.id, 'props', 'prop-older-sign');
    });

    const stored = JSON.parse(seriesRepository.stored.get(withProp.id) as string)
      .series as SeriesDef;
    expect(stored.assets.props.map((p) => p.id)).not.toContain('prop-older-sign');
    expect(useEditor.getState().status).not.toBe('error');
  });
});