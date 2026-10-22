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
