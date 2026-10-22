import { describe, expect, it, beforeEach } from 'vitest';
import { usePlan } from './planStore';
import { WORKED_EXAMPLE_PLAN } from '../data/plans';
import { parseScenePlan } from '../core/plans/parse';
import type { ScenePlan } from '../core/plans/types';

function body(envelope: typeof WORKED_EXAMPLE_PLAN): ScenePlan {
  const parsed = parseScenePlan(envelope.body);
  if (!parsed.ok) throw new Error('fixture body must parse');
  return parsed.value;
}

beforeEach(() => {
  usePlan.setState({ envelope: null, original: null });
});

describe('planStore', () => {
  it('loads a plan as both the working copy and the untouched original', () => {
    usePlan.getState().load(WORKED_EXAMPLE_PLAN);
    const { envelope, original } = usePlan.getState();
    expect(envelope).toEqual(WORKED_EXAMPLE_PLAN);
    expect(original).toEqual(WORKED_EXAMPLE_PLAN);
    // Two independent copies: editing one must never read through to the other.
    expect(envelope).not.toBe(original);
  });

  it('does not alias the plan it was handed', () => {
    const handed = structuredClone(WORKED_EXAMPLE_PLAN);
    usePlan.getState().load(handed);
    (handed as { title: string }).title = 'mutated after load';
    expect(usePlan.getState().envelope!.title).toBe(WORKED_EXAMPLE_PLAN.title);
  });

  it('edits the working copy without changing the original', () => {
    usePlan.getState().load(WORKED_EXAMPLE_PLAN);
    const edited = structuredClone(WORKED_EXAMPLE_PLAN);
    body(edited).dialogue![0]!.text = 'Rewritten by a reviewer.';
    usePlan.getState().edit(edited);

    expect(usePlan.getState().original!.body).toEqual(WORKED_EXAMPLE_PLAN.body);
    expect(usePlan.getState().envelope!.body).not.toEqual(WORKED_EXAMPLE_PLAN.body);
  });

  it('reset discards edits and returns to the original', () => {
    usePlan.getState().load(WORKED_EXAMPLE_PLAN);
    usePlan.getState().edit({ ...WORKED_EXAMPLE_PLAN, title: 'Edited title' });
    usePlan.getState().reset();
    expect(usePlan.getState().envelope).toEqual(WORKED_EXAMPLE_PLAN);
  });

  it('close clears the review', () => {
    usePlan.getState().load(WORKED_EXAMPLE_PLAN);
    usePlan.getState().close();
    expect(usePlan.getState().envelope).toBeNull();
    expect(usePlan.getState().original).toBeNull();
  });
});
