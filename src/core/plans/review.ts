/**
 * Plan review — the pure half of Phase 18's review workflow (ARCHITECTURE_SPEC.md §14.1,
 * §24.9).
 *
 * A reviewer needs three answers before they are willing to press Apply:
 *
 *  - is this plan *legal*   (`validatePlan` — errors block, warnings do not, §14.1 step 2);
 *  - what document would it *produce* (`applyPlan` — compile and fold with the exact
 *    allocator, §13.3), and
 *  - what would that *change* about the project I already have (`planDiff`, §14.1 step 3).
 *
 * This function answers all three from a `PlanContext` and an envelope and returns them in
 * one value, so the React layer derives everything it shows from a single pure call and
 * never has to sequence the three itself. That is what makes "re-validate and re-preview on
 * every keystroke" (§13.4) cheap and side-effect-free: it recomputes, it does not commit.
 *
 * Determinism is the caller's, not this function's: `options` supplies the allocator and the
 * clock, so a preview built with a fixed pair is byte-comparable to the document the store
 * would commit with the same pair (G8). The store's real Apply uses the real allocator, which
 * is why the preview and the applied document can differ in generated id suffixes; that is
 * recorded in `docs/ARCHITECTURE_SPEC.md` (Phase 18 correction) because §11.5's sketch implied
 * a shared fixed seed, which would collide across two applies in one session.
 */
import type { Command } from '../commands/types';
import type { Project } from '../types';
import { planDiff, type PlanDiff } from '../planDiff';
import { applyPlan, type PlanApplyError, type PlanApplyOptions } from './apply';
import type { Assumption, PlanContext, PlanDiagnostic, PlanEnvelope, PlanValidation } from './types';
import { validatePlan } from './validate';

export type PlanReview = PlanReviewOk | PlanReviewBlocked;

export interface PlanReviewOk {
  ok: true;
  /** The full diagnostic report: warnings and infos are shown even on success. */
  validation: PlanValidation;
  /** The document the plan would produce (not the current one). */
  preview: Project;
  /** Preview versus the project it would be applied to. */
  diff: PlanDiff;
  /** The commands that would run, in emission order (§11.6). */
  commands: Command[];
  warnings: PlanDiagnostic[];
  assumptions: Assumption[];
}

export type PlanReviewBlocked = {
  ok: false;
  validation: PlanValidation;
  error: PlanApplyError;
};

/**
 * Validate, preview and diff one plan against one project.
 *
 * `validation` is always present, even when the fold fails: a plan that validates with
 * errors, and a plan that validates clean but cannot fold (a command fails, or the result
 * breaks an invariant), both need the diagnostic list rendered identically (§14.4 — never
 * apply on `ok` alone).
 */
export function reviewPlan(
  ctx: PlanContext,
  envelope: PlanEnvelope,
  options: PlanApplyOptions,
): PlanReview {
  const validation = validatePlan(ctx, envelope);
  const applied = applyPlan(ctx, envelope, options);
  if (!applied.ok) return { ok: false, validation, error: applied.error };
  return {
    ok: true,
    validation,
    preview: applied.project,
    diff: planDiff(ctx.project, applied.project, ctx.series ?? null),
    commands: applied.commands,
    warnings: applied.warnings,
    assumptions: applied.assumptions,
  };
}

/** True when a review carries an `error` diagnostic, so Apply must be refused (§14.1 step 2). */
export function blocksApply(review: PlanReview): boolean {
  return review.validation.diagnostics.some((diagnostic) => diagnostic.severity === 'error') || !review.ok;
}

/**
 * The scene a three-still preview should render (ARCHITECTURE_SPEC.md §13.3).
 *
 * A plan that creates its own scene — the worked example does — has no scene in the *current*
 * project to point a viewport at, so the preview must name the scene in the *previewed*
 * document. The new scene is the last one appended (that is all `CreateScene` ever does), so
 * it is found the same way the store's `addScene` finds it. A modifying plan leaves the scene
 * pool untouched, so the target keeps its id and is found by name.
 */
export function previewSceneId(review: PlanReview): string | null {
  if (!review.ok) return null;
  const added = review.diff.scenes.find((scene) => scene.kind === 'added');
  if (added) return added.id;
  const changed = review.diff.scenes.find((scene) => scene.kind === 'changed');
  if (changed) return changed.id;
  // A plan that only touches cast or dialogue changes no scene row, but every actor/line row
  // it does change names the scene it lives in.
  const touched = review.diff.actors[0]?.sceneId ?? review.diff.lines[0]?.sceneId;
  if (touched) return touched;
  return review.preview.scenes[0]?.id ?? null;
}
