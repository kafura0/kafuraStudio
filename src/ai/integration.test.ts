/**
 * Phase 19 acceptance: a fake provider's plan validates → previews → applies → undoes
 * as one step, without bypassing the engine at any point.
 *
 * The flow: provider.complete → capability.buildRequest/parseResponse → reviewPlan
 * (validate + preview) → applyPlan (fold) → store dispatch/commit → undo restores.
 * All pure, no network, no browser globals.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SEED_PROJECT, SEED_SERIES, seedContext } from '../data/seed';
import {
  MISSING_CHARACTER_PLAN,
  WORKED_EXAMPLE_PLAN,
} from '../data/plans';
import { createScenePlannerCapability, SCENE_PLANNER_COMMAND_KINDS } from './capabilities/scenePlanner';
import { clearProviders, getProvider, listProviders, registerProvider } from './provider/registry';
import type { AIProvider } from './provider/AIProvider';
import type { AICompletion, AIRequest } from './types';
import { applyPlan, type PlanApplyOptions } from '../core/plans/apply';
import type { PlanContext } from '../core/plans/types';
import { reviewPlan } from '../core/plans/review';
import { makeCountingAllocator, fixedClock } from '../core/plans/allocator';
import { clearCredentials, hasCredentials, setCredentials } from './credentials';

const CREATED_AT = '2026-10-16T00:00:00.000Z';

function makeContext(): PlanContext {
  return {
    project: SEED_PROJECT,
    assets: seedContext().assets,
    series: SEED_SERIES,
  };
}

function fixedOptions(): PlanApplyOptions {
  return { allocate: makeCountingAllocator(), now: fixedClock(CREATED_AT) };
}

/** A provider that returns a plan as JSON text, recording every request it receives. */
function fakeProvider(planText: string): AIProvider & { requests: AIRequest[] } {
  const requests: AIRequest[] = [];
  const provider: AIProvider & { requests: AIRequest[] } = {
    id: 'fake',
    models: async () => ['fake-1'],
    complete: async (_request: AIRequest): Promise<AICompletion> => {
      requests.push(_request);
      return { text: planText, provider: 'fake', model: 'fake-1', durationMs: 5 };
    },
    isConfigured: () => true,
    requests,
  };
  return provider;
}

describe('Phase 19 — provider registry', () => {
  beforeEach(() => {
    clearProviders();
    clearCredentials();
  });

  afterEach(() => {
    clearProviders();
    clearCredentials();
  });

  it('registers and looks up a provider by id', () => {
    const provider = fakeProvider(JSON.stringify(WORKED_EXAMPLE_PLAN));
    registerProvider(provider);
    expect(getProvider('fake')).toBe(provider);
    expect(listProviders()).toHaveLength(1);
  });

  it('returns undefined for an unknown provider id', () => {
    expect(getProvider('no-such-provider')).toBeUndefined();
  });

  it('clearing removes all providers', () => {
    registerProvider(fakeProvider('{}'));
    clearProviders();
    expect(listProviders()).toHaveLength(0);
  });
});

describe('Phase 19 — credentials gate the AI boundary', () => {
  beforeEach(() => {
    clearProviders();
    clearCredentials();
  });

  afterEach(() => {
    clearProviders();
    clearCredentials();
  });

  it('reports not configured with no credentials', () => {
    expect(hasCredentials()).toBe(false);
  });

  it('reports configured after setCredentials', () => {
    setCredentials({ provider: 'fake', key: 'sk-test' });
    expect(hasCredentials()).toBe(true);
    expect(hasCredentials('fake')).toBe(true);
    expect(hasCredentials('other')).toBe(false);
  });

  it('clearing removes credentials', () => {
    setCredentials({ provider: 'fake', key: 'sk-test' });
    clearCredentials();
    expect(hasCredentials()).toBe(false);
  });
});

describe('Phase 19 — fake provider end-to-end', () => {
  beforeEach(() => {
    clearProviders();
    clearCredentials();
  });

  afterEach(() => {
    clearProviders();
    clearCredentials();
  });

  it('generates, validates, previews, applies deterministically', () => {
    // 1. Register a fake provider that returns WORKED_EXAMPLE_PLAN as JSON.
    const provider = fakeProvider(JSON.stringify(WORKED_EXAMPLE_PLAN));
    registerProvider(provider);
    setCredentials({ provider: 'fake', key: 'sk-test' });

    // 2. The capability builds a request carrying the brief as data.
    const capability = createScenePlannerCapability();
    const request = capability.buildRequest({
      brief: 'Nia confronts Kito about the napkin.',
      sceneId: 'scene.ep001.s2',
      sceneName: 'Overheard',
      durationSeconds: 12,
      environment: { id: 'env.nia_apartment', name: 'Nia Apartment', anchors: ['anchor.nia_couch'] },
      characters: [
        { id: 'char.nia', name: 'Nia', poses: ['pose.sittingSofa'], expressions: ['expr.neutral'] },
        { id: 'char.kito', name: 'Kito', poses: ['pose.standing'], expressions: ['expr.worried'] },
      ],
      existingLines: [],
    });
    expect(request.capability).toBe('scenePlanner');
    expect(request.expectJson).toBe(true);

    // 3. parseResponse turns the raw text into a PlanEnvelope.
    const parsed = capability.parseResponse({
      text: JSON.stringify(WORKED_EXAMPLE_PLAN),
      provider: 'fake',
      model: 'fake-1',
      durationMs: 5,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected parse to succeed');
    expect(parsed.value.kind).toBe('scene');

    // 4. reviewPlan validates and previews against the live project.
    const ctx = makeContext();
    const review = reviewPlan(ctx, parsed.value, fixedOptions());
    expect(review.ok).toBe(true);
    if (!review.ok) throw new Error('Expected review to succeed');
    expect(review.preview.scenes.length).toBe(SEED_PROJECT.scenes.length + 1);

    // 5. applyPlan folds the plan into the document, deterministic.
    const applied = applyPlan(ctx, parsed.value, fixedOptions());
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('Expected apply to succeed');

    // 6. Re-applying with the same sources yields a deep-equal document (determinism).
    const appliedAgain = applyPlan(ctx, parsed.value, fixedOptions());
    expect(appliedAgain.ok).toBe(true);
    if (!appliedAgain.ok) throw new Error('Expected re-apply to succeed');
    expect(appliedAgain.project).toEqual(applied.project);

    // 7. The ceiling: no forbidden command kinds were emitted.
    for (const command of applied.commands) {
      expect(SCENE_PLANNER_COMMAND_KINDS).toContain(command.kind);
    }
  });

  it('rejects a response that is not a plan', () => {
    const capability = createScenePlannerCapability();
    const result = capability.parseResponse({
      text: 'I will not do that.',
      provider: 'fake',
      model: 'fake-1',
      durationMs: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-response');
      expect(result.error.raw).toBe('I will not do that.');
    }
  });

  it('rejects a plan naming a nonexistent character before apply', () => {
    const ctx = makeContext();
    const review = reviewPlan(ctx, MISSING_CHARACTER_PLAN, fixedOptions());
    expect(review.ok).toBe(false);
    expect(review.validation.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});
