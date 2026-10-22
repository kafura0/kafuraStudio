/**
 * Per-value `Edited` computation (ARCHITECTURE_SPEC.md §14.3, §24.9, §26 Phase 18 step 8).
 *
 * The review panel must be able to say, per field, "a human changed this after it was
 * proposed" — the neutral `Edited` badge of §14.2. It must be impossible to display `AI`
 * for something a person wrote, so the badge is computed by *comparing* the plan under
 * review with the plan as it arrived, never inferred from context (§14.3).
 *
 * This is deliberately a comparison of two `ScenePlan`s and not of document records: a
 * plan is edited in the review panel before it is ever applied, so "edited" is a fact
 * about the instruction, not about the document it has not yet produced. The document-level
 * `Provenance` that Level 2 adds to `DialogueLine`/`SceneActor` is Phase 19.
 *
 * Paths are body-relative and dotted, matching `PlanDiagnostic.path` (§10.2) so the editor
 * and the diagnostics list speak one vocabulary: `newScene.duration`, `cast[1].anchorId`,
 * `dialogue[0].text`, `camera.keyframes[2].zoom`.
 */

/** A value that can be reached by a dotted body path: JSON, since a plan is JSON (D7). */
type Json = unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Collect the dotted paths at or below which `edited` differs from `original`.
 *
 * A whole subtree that changed is reported at its leaves, not at its root, so the editor
 * can badge the one field a reviewer actually touched rather than the object that contains
 * it. A value present in one and absent in the other is a change at that path.
 */
export function editedFieldPaths(original: Json, edited: Json, path = ''): string[] {
  if (original === edited) return [];

  if (Array.isArray(original) || Array.isArray(edited)) {
    const before = Array.isArray(original) ? original : [];
    const after = Array.isArray(edited) ? edited : [];
    // A length change is a change to the array itself; the elements are still walked so a
    // reviewer sees which line was added, not only that the list grew.
    const paths: string[] = [];
    if (before.length !== after.length) paths.push(path);
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
      const child = `${path}[${index}]`;
      if (index >= shared) paths.push(child);
      else paths.push(...editedFieldPaths(before[index] ?? null, after[index] ?? null, child));
    }
    return paths;
  }

  if (isPlainObject(original) && isPlainObject(edited)) {
    const keys = [...new Set([...Object.keys(original), ...Object.keys(edited)])].sort();
    const paths: string[] = [];
    for (const key of keys) {
      const child = path === '' ? key : `${path}.${key}`;
      const hadKey = key in original;
      const hasKey = key in edited;
      if (!hadKey || !hasKey) paths.push(child);
      else paths.push(...editedFieldPaths(original[key] as Json, edited[key] as Json, child));
    }
    return paths;
  }

  // A scalar (or a type change) that differs.
  return [path];
}
