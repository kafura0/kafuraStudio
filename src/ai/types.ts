/**
 * The AI boundary's vocabulary (ARCHITECTURE_SPEC.md §12, §24.10).
 *
 * This file knows about plans and provider-shaped data. It does not know about a project,
 * a document operation, a store, or the DOM. A capability's only output is a `PlanEnvelope`;
 * the plan reaches a document through Phase 18's review gate, never from here.
 */
import type { PlanEnvelope, Result, Severity } from '../core/plans/types';

export type { PlanEnvelope, Provenance, Result, Severity } from '../core/plans/types';

/** A capability id is a string, not an enum: adding one must not edit a switch. */
export type CapabilityId = string;

export interface AIRequest {
  capability: string;
  /** Plain serialisable input. The provider may not interpret anything else. */
  input: unknown;
  /** Hard ceiling. The provider must respect it or fail. */
  maxOutputTokens: number;
  /** Not a schema — a hint. The real enforcement is PlanValidator. */
  expectJson: boolean;
  signal?: AbortSignal;
}

export interface AIResponse {
  /** Raw text. Nothing is trusted, including this. */
  text: string;
  provider: string;
  model: string;
  /** Milliseconds, for the review UI. Not a claim about quality. */
  durationMs: number;
  /** Provider-reported token counts if available. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

export type AIUnavailableReason = 'not-configured' | 'not-implemented' | 'cancelled' | 'error';

/**
 * The one value the default provider can produce.
 *
 * `AIProvider.complete` returns this instead of an `AIResponse`, so a caller cannot
 * mistake "nothing ran" for "the model returned an empty string".
 */
export interface AIUnavailable {
  unavailable: true;
  reason: AIUnavailableReason;
  message: string;
}

export type AICompletion = AIResponse | AIUnavailable;

export function isAIUnavailable(value: AICompletion): value is AIUnavailable {
  return (value as AIUnavailable).unavailable === true;
}

/**
 * A named, single-purpose, stateless transformation (ARCHITECTURE_SPEC.md §12.6).
 *
 * The capability chooses the prompt and parses the answer; the provider only transports
 * bytes. That split is what lets a fake provider drive every test without a vendor.
 */
export interface AICapability {
  readonly id: CapabilityId;
  readonly label: string;
  readonly promptVersion: string;
  /** The strictest diagnostic this capability may emit. `error` is not allowed. */
  readonly maxSeverity: Severity;
  /** Command kinds this capability is permitted to compile to. Enforced by test. */
  readonly allowedCommandKinds: readonly string[];
  buildRequest(input: unknown): AIRequest;
  parseResponse(response: AIResponse): Result<PlanEnvelope, AICapabilityError>;
}

export type AICapabilityErrorCode = 'invalid-input' | 'invalid-response' | 'wrong-plan-kind';

export interface AICapabilityError {
  code: AICapabilityErrorCode;
  message: string;
  /** The raw response, preserved when parsing failed. */
  raw?: string;
}

export interface ScenePlannerAsset {
  id: string;
  name: string;
}

export interface ScenePlannerCharacter extends ScenePlannerAsset {
  poses: string[];
  expressions: string[];
}

export interface ScenePlannerEnvironment extends ScenePlannerAsset {
  anchors: string[];
}

export interface ScenePlannerExistingLine {
  speaker: string;
  text: string;
}

/**
 * Everything the planner is allowed to know, as plain serialisable data.
 *
 * The brief is data inside a delimited block in the prompt; an instruction in it cannot
 * create an asset because no capability can emit an asset-creating command.
 */
export interface ScenePlannerInput {
  brief: string;
  sceneId: string;
  sceneName: string;
  durationSeconds: number;
  environment: ScenePlannerEnvironment;
  characters: ScenePlannerCharacter[];
  existingLines: ScenePlannerExistingLine[];
  targetDurationSeconds?: number;
}

export interface ScenePlannerResult {
  envelope: PlanEnvelope;
  /** The provider's text, before validation. Kept so a rejected plan can be inspected. */
  raw: string;
  provider: string;
  model: string;
  durationMs: number;
}
