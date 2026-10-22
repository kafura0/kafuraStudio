/**
 * Applying a plan through the store (ARCHITECTURE_SPEC.md §14.1, §24.9).
 *
 * The load-bearing claims here are the transaction's: a plan is *one* commit and *one*
 * undo, an invalid plan commits nothing, and the provenance a plan carries (or that an
 * editor overrides) is what lands in history. The preview/review behaviour that makes a
 * plan editable before apply is tested in `planStore`/`review` — this file is only about
 * the single moment the document changes.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SEED_PROJECT, SEED_SERIES, seedContext } from '../data/seed';
import { MISSING_CHARACTER_PLAN, WORKED_EXAMPLE_PLAN } from '../data/plans';
import { useEditor } from './editorStore';
import { usePlan } from './planStore';
import type { Provenance, Project, SeriesDef } from '../core/types';
import type { SeriesSummary } from '../core/persistence/repository';

const AT = '2026-10-17T00:00:00.000Z';

const repository = vi.hoisted(() => ({
  save: vi.fn(async (_project: Project) => {}),
  loadMostRecent: vi.fn(async (): Promise<unknown> => null),
  load: vi.fn(async (_id: string): Promise<unknown> => null),
}));

const seriesRepository = vi.hoisted(() => ({
  save: vi.fn(async (_series: SeriesDef) => {}),
  load: vi.fn(async (_id: string): Promise<SeriesDef | null> => null),
  list: vi.fn(async (): Promise<SeriesSummary[]> => []),
  remove: vi.fn(async () => {}),
}));

vi.mock('../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => true,
  IndexedDbProjectRepository: vi.fn(() => repository),
  IndexedDbSeriesRepository: vi.fn(() => seriesRepository),
}));

function currentProject(): Project {
  const project = useEditor.getState().project;
  if (project === null) throw new Error('Expected a project to be open');
  return project;
}

beforeEach(() => {
  useEditor.setState({
    project: SEED_PROJECT,
    series: SEED_SERIES,
    context: seedContext(),
    past: [],
    future: [],
    playhead: 0,
    playing: false,
    playbackMode: 'scene-wrap',
    sceneId: SEED_PROJECT.scenes[0]?.id ?? '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,
    status: 'ready',
    statusMessage: null,
  });
  usePlan.setState({ envelope: null, original: null });
});

describe('applying a plan is one commit and one undo', () => {
  it('folds the plan into the document and records a single history step', () => {
    const before = currentProject();
    const scenesBefore = before.scenes.length;

    const result = useEditor.getState().dispatch({ plan: WORKED_EXAMPLE_PLAN });

    expect(result.ok).toBe(true);
    expect(currentProject().scenes.length).toBe(scenesBefore + 1);
    const past = useEditor.getState().past;
    expect(past).toHaveLength(1);
    expect(past[0]!.label).toBe('Apply scene plan: "EP001 s2 — Nia overhears the plan"');
  });

  it('carries the plan\'s own provenance into the history entry', () => {
    useEditor.getState().dispatch({ plan: WORKED_EXAMPLE_PLAN });
    expect(useEditor.getState().past[0]!.provenance.actor).toBe('ai');
  });

  it('lets a human-provenance edit override the plan\'s provenance (§13.4)', () => {
    const human: Provenance = { actor: 'human', at: AT };
    useEditor.getState().dispatch({ plan: WORKED_EXAMPLE_PLAN, provenance: human });
    expect(useEditor.getState().past[0]!.provenance).toEqual(human);
  });

  it('is undone in one step, restoring the exact pre-plan document', () => {
    const before = currentProject();
    useEditor.getState().dispatch({ plan: WORKED_EXAMPLE_PLAN });
    expect(currentProject()).not.toBe(before);

    useEditor.getState().undo();

    expect(currentProject()).toBe(before);
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it('commits nothing and records no history when the plan is invalid', () => {
    const before = currentProject();

    const result = useEditor.getState().dispatch({ plan: MISSING_CHARACTER_PLAN });

    expect(result.ok).toBe(false);
    expect(currentProject()).toBe(before);
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().status).toBe('error');
  });
});
