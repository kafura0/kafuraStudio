/**
 * The plan review workflow as a user meets it (ARCHITECTURE_SPEC.md §14.1, §13.3, §24.9).
 *
 * The load-bearing assertions: the three stills draw the *previewed* document rather than
 * the current one; an error diagnostic refuses Apply while a warning does not; editing the
 * plan re-previews without committing; and Apply is a single history step.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PlanReviewPanel } from './PlanReviewPanel';
import { useEditor } from '../../state/editorStore';
import { setPlanRepository, usePlan } from '../../state/planStore';
import { MemoryPlanRepository } from '../../core/persistence/plans';
import { SEED_PROJECT, SEED_SERIES, seedContext } from '../../data/seed';
import { MISSING_CHARACTER_PLAN, WORKED_EXAMPLE_PLAN } from '../../data/plans';
import { renderScene } from '../../core/render/render';
import type { PlanEnvelope, ScenePlan } from '../../core/plans/types';
import type { Project, SeriesDef } from '../../core/types';
import type { SeriesSummary } from '../../core/persistence/repository';

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

vi.mock('../../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => false,
  IndexedDbProjectRepository: vi.fn(() => repository),
  IndexedDbSeriesRepository: vi.fn(() => seriesRepository),
}));

// The panel draws stills with the real, pure renderer. Mocking it lets the test assert
// *what* was drawn — and, crucially, *which document* it was drawn from.
vi.mock('../../core/render/render', async (importOriginal) => ({
  ...(await importOriginal()),
  renderScene: vi.fn(),
}));

const plan = (envelope: PlanEnvelope, over: { title?: string; body?: unknown } = {}): PlanEnvelope => ({
  ...envelope,
  ...(over.title !== undefined ? { title: over.title } : {}),
  ...(over.body !== undefined ? { body: over.body } : {}),
});

function openWith(envelope: PlanEnvelope | null): void {
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
  usePlan.setState(
    envelope === null
      ? { envelope: null, original: null, history: [], recordId: null }
      : {
          envelope: structuredClone(envelope),
          original: structuredClone(envelope),
          history: [],
          recordId: null,
        },
  );
}

beforeEach(() => {
  vi.mocked(renderScene).mockClear();
  // A fresh, empty history per test: the store's repository is module-level, so without this
  // a proposal persisted by one test would show up in the next test's "Recent plans".
  setPlanRepository(new MemoryPlanRepository());
  // jsdom's canvas has no 2d context; the stills only need one to exist so `renderScene`
  // (mocked) is called with the arguments the test asserts on.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PlanReviewPanel', () => {
  it('offers to paste a plan and touches nothing until one is loaded', () => {
    openWith(null);
    render(<PlanReviewPanel />);
    expect(screen.getByLabelText('Paste a plan as JSON')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load plan' })).toBeDisabled();
  });

  it('renders the three stills from the previewed document, not the current one', () => {
    openWith(WORKED_EXAMPLE_PLAN);
    render(<PlanReviewPanel />);

    const calls = vi.mocked(renderScene).mock.calls;
    expect(calls).toHaveLength(3);

    const times = calls.map((call) => call[3]);
    // The created scene is 12s; the stills are at 10%, 50% and 90% of it (§13.3).
    expect(times[0]).toBeCloseTo(1.2, 5);
    expect(times[1]).toBeCloseTo(6, 5);
    expect(times[2]).toBeCloseTo(10.8, 5);

    // Each still draws a scene the *current* project does not contain.
    for (const call of calls) {
      const scene = call[2] as { id: string };
      expect(SEED_PROJECT.scenes.some((candidate) => candidate.id === scene.id)).toBe(false);
    }

    // And from the previewed document's merged library, not an empty one.
    const drawnContext = calls[0]![1] as { assets: { characters: { length: number } } };
    expect(drawnContext.assets.characters.length).toBeGreaterThan(0);
  });

  it('refuses Apply on an error diagnostic and reports why', () => {
    openWith(MISSING_CHARACTER_PLAN);
    render(<PlanReviewPanel />);

    expect(screen.getByRole('button', { name: 'Apply plan' })).toBeDisabled();
    expect(screen.getByRole('status').textContent).toContain('cannot be applied');
  });

  it('does not refuse Apply on a warning alone', () => {
    const sceneId = SEED_PROJECT.scenes[0]!.id;
    openWith(
      plan(WORKED_EXAMPLE_PLAN, {
        title: 'Zoom warning',
        body: { sceneId, camera: { keyframes: [{ at: 0, zoom: 12 }, { at: 5, zoom: 1 }] } },
      }),
    );
    render(<PlanReviewPanel />);

    expect(screen.getByRole('button', { name: 'Apply plan' })).toBeEnabled();
    expect(screen.getByText(/beyond the tested range/)).toBeInTheDocument();
  });

  it('re-previews an edited plan without committing a history step', () => {
    openWith(WORKED_EXAMPLE_PLAN);
    render(<PlanReviewPanel />);
    vi.mocked(renderScene).mockClear();

    const body = structuredClone(WORKED_EXAMPLE_PLAN.body) as ScenePlan;
    body.dialogue![0]!.text = 'Rewritten by a reviewer.';
    body.newScene!.duration = 20;
    act(() => {
      usePlan.getState().edit(plan(WORKED_EXAMPLE_PLAN, { body }));
    });

    // No document mutation, no history step (§13.4, §24.9).
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().project).toBe(SEED_PROJECT);

    // The preview re-ran: the 10% still is now 2.0s, not 1.2s.
    const times = vi.mocked(renderScene).mock.calls.map((call) => call[3]);
    expect(times[0]).toBeCloseTo(2.0, 5);

    // The reviewer's own edit is the only thing marked `Edited` (§14.3).
    expect(screen.getAllByText('Edited').length).toBeGreaterThan(0);
  });

  it('applies an edited plan as exactly one undoable step, then closes', () => {
    openWith(WORKED_EXAMPLE_PLAN);
    render(<PlanReviewPanel />);

    // A text-only edit keeps the plan valid (shrinking the scene would strand the plan's
    // camera keyframe at 12s, which the validator rejects).
    const body = structuredClone(WORKED_EXAMPLE_PLAN.body) as ScenePlan;
    body.dialogue![0]!.text = 'Applied by a reviewer.';
    act(() => {
      usePlan.getState().edit(plan(WORKED_EXAMPLE_PLAN, { body }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply plan' }));

    expect(useEditor.getState().past).toHaveLength(1);
    expect(useEditor.getState().project!.scenes).toHaveLength(SEED_PROJECT.scenes.length + 1);
    expect(usePlan.getState().envelope).toBeNull();

    act(() => {
      useEditor.getState().undo();
    });
    expect(useEditor.getState().project).toBe(SEED_PROJECT);
  });

  it('records a pasted plan in the review history (§9.5, Phase 18 step 7)', async () => {
    openWith(null);
    render(<PlanReviewPanel />);

    fireEvent.change(screen.getByLabelText('Paste a plan as JSON'), {
      target: { value: JSON.stringify(WORKED_EXAMPLE_PLAN) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load plan' }));
    await act(async () => {});

    await act(async () => {
      await usePlan.getState().refreshHistory();
    });
    expect(usePlan.getState().history.map((entry) => entry.title)).toEqual([WORKED_EXAMPLE_PLAN.title]);
    // The proposal is recorded as `ai`, the actor it arrived with.
    expect(usePlan.getState().history[0]!.actor).toBe('ai');
  });

  it('reopens a proposal from the history', async () => {
    openWith(null);
    usePlan.getState().load(WORKED_EXAMPLE_PLAN);
    await act(async () => {
      await usePlan.getState().persist();
    });
    usePlan.getState().close();

    render(<PlanReviewPanel />);
    const entry = await screen.findByRole('button', { name: WORKED_EXAMPLE_PLAN.title });
    fireEvent.click(entry);
    await act(async () => {});

    expect(usePlan.getState().envelope).toEqual(WORKED_EXAMPLE_PLAN);
    // Reopened as unedited: nothing is marked `Edited`.
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
  });

  it('drops the history row once the plan is applied, and only then', async () => {
    openWith(WORKED_EXAMPLE_PLAN);
    await act(async () => {
      await usePlan.getState().persist();
    });
    await act(async () => {
      await usePlan.getState().refreshHistory();
    });
    expect(usePlan.getState().history).toHaveLength(1);

    render(<PlanReviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply plan' }));
    await act(async () => {});

    expect(useEditor.getState().past).toHaveLength(1);
    expect(usePlan.getState().history).toHaveLength(0);
  });
});
