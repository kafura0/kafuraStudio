/**
 * A no-provider capability that returns a plan from a fixture file/shape.
 *
 * Proves the full workflow with no vendor: capability -> parseResponse (envelope) ->
 * validatePlan -> reviewPlan (preview/diff) -> applyPlan via store dispatch -> undo.
 * Content-agnostic: the fixture is passed in as input.
 */
import { parsePlan } from '../../core/plans/parse';
import type { AICapability, AIRequest, AIResponse, PlanEnvelope, Result } from '../types';

export interface TestFixtureInput {
  /** A raw JSON string of a PlanEnvelope, or a PlanEnvelope object. */
  plan: string | PlanEnvelope;
  provider?: string;
  model?: string;
}

export function createTestFixtureCapability(): AICapability {
  return {
    id: 'testFixture',
    label: 'Test fixture',
    promptVersion: '1.0.0',
    maxSeverity: 'warning',
    allowedCommandKinds: ['CreateScene', 'PlaceCharacter', 'AddDialogueLine', 'AddClip', 'AddKeyframe', 'ApplyCameraPreset', 'SetSceneCamera', 'ClearCameraMoves'],
    buildRequest(input: unknown): AIRequest {
      const i = input as TestFixtureInput;
      const text = typeof i.plan === 'string' ? i.plan : JSON.stringify(i.plan);
      return {
        capability: 'testFixture',
        input: text,
        maxOutputTokens: 4096,
        expectJson: true,
      };
    },
    parseResponse(response: AIResponse): Result<PlanEnvelope, { code: 'invalid-response'; message: string; raw?: string }> {
      const result = parsePlan(response.text);
      if (!result.ok) {
        return { ok: false, error: { code: 'invalid-response', message: describe(result.error.code), raw: response.text } };
      }
      if (result.value.kind !== 'scene') {
        return { ok: false, error: { code: 'invalid-response', message: 'testFixture only accepts scene plans.', raw: response.text } };
      }
      return { ok: true, value: result.value };
    },
  };
}

function describe(code: string): string {
  if (code === 'not-json') return 'Not valid JSON.';
  if (code === 'schema') return 'Plan does not match schema.';
  return 'Could not parse plan.';
}
