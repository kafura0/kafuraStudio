/**
 * The plan editor (§13.4, §24.9, §26 Phase 18 step 4).
 *
 * The editor is a form over `ScenePlan`, never over the document: every commit hands a
 * *new plan* up to `onPlan` / `onTitle` and mutates nothing. The other half of its contract
 * is the neutral `Edited` badge, which appears only for the paths the panel says a human
 * changed — never inferred from the value.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanEditor } from './PlanEditor';
import { WORKED_EXAMPLE_PLAN } from '../../data/plans';
import { parseScenePlan } from '../../core/plans/parse';
import type { ScenePlan } from '../../core/plans/types';

function workedPlan(): ScenePlan {
  const parsed = parseScenePlan(WORKED_EXAMPLE_PLAN.body);
  if (!parsed.ok) throw new Error('fixture body failed to parse');
  return structuredClone(parsed.value);
}

function renderEditor(
  over: {
    plan?: ScenePlan;
    title?: string;
    edited?: ReadonlySet<string>;
    onTitle?: ReturnType<typeof vi.fn>;
    onPlan?: ReturnType<typeof vi.fn>;
  } = {},
): { onTitle: ReturnType<typeof vi.fn>; onPlan: ReturnType<typeof vi.fn> } {
  const onTitle: ReturnType<typeof vi.fn> = over.onTitle ?? vi.fn();
  const onPlan: ReturnType<typeof vi.fn> = over.onPlan ?? vi.fn();
  render(
    <PlanEditor
      plan={over.plan ?? workedPlan()}
      title={over.title ?? WORKED_EXAMPLE_PLAN.title}
      edited={over.edited ?? new Set<string>()}
      onTitle={onTitle}
      onPlan={onPlan}
    />,
  );
  return { onTitle, onPlan };
}

describe('PlanEditor', () => {
  it('shows the plan title and the new scene it would create', () => {
    renderEditor();
    expect(screen.getByLabelText('Plan title')).toHaveValue(WORKED_EXAMPLE_PLAN.title);
    expect(screen.getByLabelText('Name')).toHaveValue('Overheard');
    expect(screen.getByLabelText('Duration (s)')).toHaveValue('12');
  });

  it('marks nothing as Edited when no human has touched the plan', () => {
    renderEditor();
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
  });

  it('marks exactly the field a human changed, and no other', () => {
    renderEditor({ edited: new Set(['dialogue[0].text']) });
    // One TextField's badge only.
    expect(screen.getAllByText('Edited')).toHaveLength(1);
  });

  it('marks a numeric field by its body path', () => {
    renderEditor({ edited: new Set(['newScene.duration']) });
    expect(screen.getAllByText('Edited')).toHaveLength(1);
  });

  it('hands a new plan (and nothing else) up when a line is rewritten', () => {
    const plan = workedPlan();
    const { onPlan } = renderEditor({ plan });

    const line = screen.getAllByLabelText('Line')[0]!;
    fireEvent.change(line, { target: { value: 'A rewritten line.' } });
    fireEvent.blur(line);

    expect(onPlan).toHaveBeenCalledTimes(1);
    const next = onPlan.mock.calls[0]![0] as ScenePlan;
    expect(next).not.toBe(plan);
    expect(next.dialogue![0]!.text).toBe('A rewritten line.');
    // Everything else is carried over untouched — including the sibling lines.
    expect(next.dialogue![1]).toBe(plan.dialogue![1]);
    expect(next.cast).toBe(plan.cast);
    expect(next.newScene).toBe(plan.newScene);
  });

  it('hands the new title up through onTitle', () => {
    const { onTitle, onPlan } = renderEditor();
    const title = screen.getByLabelText('Plan title');
    fireEvent.change(title, { target: { value: 'A better title' } });
    fireEvent.blur(title);

    expect(onTitle).toHaveBeenCalledWith('A better title');
    expect(onPlan).not.toHaveBeenCalled();
  });

  it('omits the sections a plan does not have', () => {
    renderEditor({
      plan: { sceneId: 'scene_0001', camera: { preset: 'camp.establishing' } },
    });
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Line')).not.toBeInTheDocument();
  });
});
