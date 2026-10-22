/**
 * The only import surface the UI is allowed to use (ARCHITECTURE_SPEC.md §12.2).
 *
 * `src/ai/**` is never imported from `src/core/**`. UI code that needs AI must import
 * only from this module, and only on demand (dynamic import) so that deleting `src/ai/**`
 * does not break non-AI builds/tests.
 */
export type {
  AICapability,
  AICapabilityError,
  AICapabilityErrorCode,
  AICompletion,
  AIRequest,
  AIResponse,
  AIUnavailable,
  AIUnavailableReason,
  CapabilityId,
  PlanEnvelope,
  Provenance,
  Result,
  ScenePlannerCharacter,
  ScenePlannerEnvironment,
  ScenePlannerExistingLine,
  ScenePlannerInput,
  ScenePlannerResult,
  Severity,
} from './types';
export { isAIUnavailable } from './types';
export type { AIProvider as IAIProvider } from './provider/AIProvider';
export { nullProvider } from './provider/nullProvider';
export type { StoredCredentials } from './credentials';
export { clearCredentials, hasCredentials, setCredentials } from './credentials';
export { clearCapabilities, getCapability, listCapabilities, registerCapability } from './capabilities/registry';
export { createTestFixtureCapability } from './capabilities/testFixture';
export { createScenePlannerCapability, SCENE_PLANNER_COMMAND_KINDS } from './capabilities/scenePlanner';
export { PROMPT_VERSION as SCENE_PLANNER_PROMPT_VERSION, buildUserPrompt as buildScenePlannerPrompt, SYSTEM as SCENE_PLANNER_SYSTEM } from './prompts/scenePlanner.v1';
