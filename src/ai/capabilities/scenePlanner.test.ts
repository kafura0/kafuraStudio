import { describe, expect, it } from 'vitest';
import { compilePlan } from '../../core/plans/compile';
import { WORKED_EXAMPLE_PLAN, seedPlanContext } from '../../data/plans';
import type { AIResponse, ScenePlannerInput } from '../types';
import { SCENE_PLANNER_COMMAND_KINDS, createScenePlannerCapability } from './scenePlanner';

function response(text: string): AIResponse {
  return { text, provider: 'fake', model: 'fake-1', durationMs: 1 };
}

const input: ScenePlannerInput = {
  brief: 'Nia confronts Kito about the napkin.',
  sceneId: 'scene.ep001.s2',
  sceneName: 'Overheard',
  durationSeconds: 12,
  environment: { id: 'env.nia_apartment', name: 'Nia Apartment', anchors: ['anchor.nia_couch'] },
  characters: [
    { id: 'char.nia', name: 'Nia', poses: ['pose.sittingSofa'], expressions: ['expr.neutral'] },
  ],
  existingLines: [],
};

describe('scenePlanner capability (Phase 19)', () => {
  it('emits a request carrying the prompt version and brief as data', () => {
    const capability = createScenePlannerCapability();
    const request = capability.buildRequest(input);
    expect(request.capability).toBe('scenePlanner');
    expect(request.expectJson).toBe(true);
    expect(capability.promptVersion).toBe('scenePlanner.v1');
    const payload = request.input as { user: string };
    expect(payload.user).toContain('<<<BRIEF');
    expect(payload.user).toContain('Nia confronts Kito');
  });

  it('parses a valid scene plan from a model response', () => {
    const capability = createScenePlannerCapability();
    const result = capability.parseResponse(response(JSON.stringify(WORKED_EXAMPLE_PLAN)));
    expect(result.ok).toBe(true);
  });

  it('rejects a non-JSON response and preserves the raw text', () => {
    const capability = createScenePlannerCapability();
    const result = capability.parseResponse(response('I will not do that.'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-response');
      expect(result.error.raw).toBe('I will not do that.');
    }
  });

  it('the ceiling is warning and never error', () => {
    expect(createScenePlannerCapability().maxSeverity).toBe('warning');
  });

  it('its compiled commands never create or delete an asset or a scene', () => {
    const ctx = seedPlanContext();
    const compiled = compilePlan(ctx, WORKED_EXAMPLE_PLAN);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    for (const command of compiled.commands) {
      expect(SCENE_PLANNER_COMMAND_KINDS).toContain(command.kind);
    }
  });
});
