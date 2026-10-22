/**
 * The Scene Planner capability (ARCHITECTURE_SPEC.md §12, §24.10, §19.5).
 *
 * It is a capability, not an agent (A§12.6): a named, stateless transformation with a
 * typed input and a typed output. Its output is a `PlanEnvelope` and nothing else — it
 * cannot produce a `Project`, because that requires `applyCommands`, which `src/ai/**`
 * may not import.
 *
 * The ceiling (§19.5) is `maxSeverity: 'warning'`: any `error` diagnostic refuses the
 * capability, and the emitted-command allow-list forbids creating or deleting an asset,
 * character, environment, or scene. `scenePlanner` may only modify or create **scene
 * contents**.
 */
import { parsePlan } from '../../core/plans/parse';
import type { PlanEnvelope } from '../../core/plans/types';
import type { AICapability, AICapabilityError, AIRequest, AIResponse, Result, ScenePlannerInput } from '../types';
import { PROMPT_VERSION, SYSTEM, buildUserPrompt } from '../prompts/scenePlanner.v1';

/**
 * Commands a scene plan is allowed to compile to. Anything that creates or deletes an
 * asset (`CreateCharacter`, `DeleteScene`, …) is absent by design. The allow-list test
 * enumerates a compiled plan's kinds against this list.
 */
export const SCENE_PLANNER_COMMAND_KINDS: readonly string[] = [
  'CreateScene',
  'PlaceCharacter',
  'AddDialogueLine',
  'AddClip',
  'AddKeyframe',
  'ApplyCameraPreset',
  'SetSceneCamera',
  'ClearCameraMoves',
];

export function createScenePlannerCapability(): AICapability {
  return {
    id: 'scenePlanner',
    label: 'Scene Planner',
    promptVersion: PROMPT_VERSION,
    maxSeverity: 'warning',
    allowedCommandKinds: SCENE_PLANNER_COMMAND_KINDS,
    buildRequest(input: unknown): AIRequest {
      const sceneInput = input as ScenePlannerInput;
      return {
        capability: 'scenePlanner',
        input: { system: SYSTEM, user: buildUserPrompt(sceneInput), sceneId: sceneInput.sceneId },
        maxOutputTokens: 4096,
        expectJson: true,
      };
    },
    parseResponse(response: AIResponse): Result<PlanEnvelope, AICapabilityError> {
      const parsed = parsePlan(response.text);
      if (!parsed.ok) {
        return {
          ok: false,
          error: { code: 'invalid-response', message: describeParseError(parsed.error.code), raw: response.text },
        };
      }
      if (parsed.value.kind !== 'scene') {
        return {
          ok: false,
          error: { code: 'wrong-plan-kind', message: `Expected a scene plan, received "${String(parsed.value.kind)}".`, raw: response.text },
        };
      }
      return { ok: true, value: parsed.value };
    },
  };
}

function describeParseError(code: string): string {
  if (code === 'not-json') return 'The model did not return JSON.';
  if (code === 'schema') return 'The model returned JSON that is not a scene plan.';
  if (code === 'unknown-kind') return 'The model returned a plan of an unsupported kind.';
  if (code === 'unsupported-version') return 'The model returned an unsupported plan version.';
  return 'The model returned something that is not a usable plan.';
}
