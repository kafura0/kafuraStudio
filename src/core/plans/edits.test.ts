import { describe, expect, it } from 'vitest';
import { editedFieldPaths } from './edits';
import { WORKED_EXAMPLE_PLAN } from '../../data/plans';
import { parseScenePlan } from './parse';
import type { ScenePlan } from './types';

function body(envelope: typeof WORKED_EXAMPLE_PLAN): ScenePlan {
  const parsed = parseScenePlan(envelope.body);
  if (!parsed.ok) throw new Error('fixture body must parse');
  return parsed.value;
}

describe('editedFieldPaths', () => {
  it('reports nothing when the plan is untouched', () => {
    const plan = body(WORKED_EXAMPLE_PLAN);
    expect(editedFieldPaths(plan, structuredClone(plan))).toEqual([]);
  });

  it('names the exact scalar a reviewer changed', () => {
    const original = body(WORKED_EXAMPLE_PLAN);
    const edited = structuredClone(original);
    edited.newScene!.duration = 20;
    expect(editedFieldPaths(original, edited)).toEqual(['newScene.duration']);
  });

  it('names a change inside an array element by index', () => {
    const original = body(WORKED_EXAMPLE_PLAN);
    const edited = structuredClone(original);
    edited.dialogue![1]!.text = 'I am building a napkin empire.';
    expect(editedFieldPaths(original, edited)).toEqual(['dialogue[1].text']);
  });

  it('names a nested camera keyframe field', () => {
    const original = body(WORKED_EXAMPLE_PLAN);
    const edited = structuredClone(original);
    edited.camera!.keyframes![1]!.zoom = 1.6;
    expect(editedFieldPaths(original, edited)).toEqual(['camera.keyframes[1].zoom']);
  });

  it('marks a whole added line at its index, not the whole dialog list', () => {
    const original = body(WORKED_EXAMPLE_PLAN);
    const edited = structuredClone(original);
    edited.dialogue!.push({ speaker: 'NIA', actorRef: 'char.nia', text: 'Sure.', emotion: 'flat' });
    const paths = editedFieldPaths(original, edited);
    expect(paths).toContain('dialogue');
    expect(paths).toContain('dialogue[2]');
    expect(paths).not.toContain('dialogue[0].text');
  });
});
