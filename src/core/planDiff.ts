/**
 * Plan diff (ARCHITECTURE_SPEC.md §14.1 step 3, §24.9, §26 Phase 18 step 1).
 *
 * The review panel's "what changes / what it breaks / what it does" view is a pure
 * comparison of two documents: the one on screen and the one a plan would produce. It
 * touches nothing and reads no clock, so it can run on every keystroke of a plan edit
 * without costing an undo step (§14.1 steps 3-5).
 *
 * The diff is deliberately structural and entity-level, not a textual patch:
 *
 * - `scenes`, `actors`, `lines` and `assets` are the units a reviewer thinks in.
 * - each is a list of `added` / `removed` / `changed` rows keyed by id, so a row can be
 *   clicked through to the thing it names (§14.4: "a summary count alone is not review").
 * - `issues` is the set of `validateProject` issues that **appear** in `next` and were
 *   not present before — "what it breaks". An issue that was already there is not the
 *   plan's fault and would be noise.
 *
 * A scene's own row reports the scene's *own* fields (name, environment, size, rest
 * camera); a change to its cast or its dialogue is reported on the actor and line rows
 * instead, so a scene is never both "changed" and "you have 4 new rows" for one edit.
 */
import { validateProject, type ValidationIssue } from './document/invariants';
import type { AssetLibrary, Id, Project, Scene, SeriesDef } from './types';

export type ChangeKind = 'added' | 'removed' | 'changed';

/** One entity that differs between two documents. `label` is for a human to read. */
export interface EntityChange {
  kind: ChangeKind;
  id: Id;
  label: string;
}

/** An actor change, carrying the scene it belongs to so the row can be located. */
export interface ActorChange extends EntityChange {
  sceneId: Id;
}

/** A dialogue-line change, carrying its scene. */
export interface LineChange extends EntityChange {
  sceneId: Id;
}

export interface PlanDiff {
  /** Additions, removals and edit to scenes themselves. */
  scenes: EntityChange[];
  /** Casting changes, across every scene. */
  actors: ActorChange[];
  /** Dialogue changes, across every scene. */
  lines: LineChange[];
  /** Project-scope asset overrides gained or lost. */
  assets: EntityChange[];
  /** Issues introduced by `next` that `project` did not have. */
  issues: ValidationIssue[];
}

/* ------------------------------------------------------------------ */
/* Structural equality                                                 */
/* ------------------------------------------------------------------ */

/**
 * Deep equality for plain JSON data (D7: a plan and a command are JSON).
 *
 * Key-order independent on purpose. `JSON.stringify` would call two documents equal or
 * unequal by the order an object happened to be built in, which is not a fact about the
 * document; the factories and the command layer do not promise a key order, so the diff
 * must not depend on one.
 */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => equal(value, b[index]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => equal(left[key], right[key]));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Collection diffs                                                    */
/* ------------------------------------------------------------------ */

interface Identified {
  id: Id;
}

/**
 * Diff two collections by id.
 *
 * Iteration is over ids sorted lexically, never array order, so the same pair of
 * documents always yields the same rows in the same order (a diff that reshuffles per
 * render is unusable, and a test for it would be flaky).
 */
function diffCollection<T extends Identified>(
  before: readonly T[],
  after: readonly T[],
  label: (item: T, present: boolean) => string,
): EntityChange[] {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
  const changes: EntityChange[] = [];
  for (const id of ids) {
    const wasThere = beforeById.get(id);
    const isThere = afterById.get(id);
    if (wasThere === undefined && isThere !== undefined) {
      changes.push({ kind: 'added', id, label: label(isThere, true) });
    } else if (wasThere !== undefined && isThere === undefined) {
      changes.push({ kind: 'removed', id, label: label(wasThere, false) });
    } else if (wasThere !== undefined && isThere !== undefined && !equal(wasThere, isThere)) {
      changes.push({ kind: 'changed', id, label: label(isThere, true) });
    }
  }
  return changes;
}

/** A scene's own identity, ignoring its cast, dialogue and tracks (those diff separately). */
function sceneShape(scene: Scene): unknown {
  return {
    name: scene.name,
    description: scene.description,
    environmentId: scene.environmentId,
    duration: scene.duration,
    backgroundColor: scene.backgroundColor,
    camera: scene.camera,
  };
}

function diffScenes(before: Project, after: Project): EntityChange[] {
  const beforeById = new Map(before.scenes.map((scene) => [scene.id, scene]));
  const afterById = new Map(after.scenes.map((scene) => [scene.id, scene]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
  const changes: EntityChange[] = [];
  for (const id of ids) {
    const wasThere = beforeById.get(id);
    const isThere = afterById.get(id);
    if (wasThere === undefined && isThere !== undefined) {
      changes.push({ kind: 'added', id, label: isThere.name });
    } else if (wasThere !== undefined && isThere === undefined) {
      changes.push({ kind: 'removed', id, label: wasThere.name });
    } else if (wasThere !== undefined && isThere !== undefined && !equal(sceneShape(wasThere), sceneShape(isThere))) {
      changes.push({ kind: 'changed', id, label: isThere.name });
    }
  }
  return changes;
}

function flattenActors(project: Project): { sceneId: Id; actor: Scene['actors'][number] }[] {
  return project.scenes.flatMap((scene) => scene.actors.map((actor) => ({ sceneId: scene.id, actor })));
}

function flattenLines(project: Project): { sceneId: Id; line: Scene['dialogue'][number] }[] {
  return project.scenes.flatMap((scene) => scene.dialogue.map((line) => ({ sceneId: scene.id, line })));
}

function diffActors(before: Project, after: Project): ActorChange[] {
  const beforeByKey = new Map(flattenActors(before).map((entry) => [entry.actor.id, entry]));
  const afterByKey = new Map(flattenActors(after).map((entry) => [entry.actor.id, entry]));
  const ids = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
  const changes: ActorChange[] = [];
  for (const id of ids) {
    const wasThere = beforeByKey.get(id);
    const isThere = afterByKey.get(id);
    const present = isThere ?? wasThere;
    if (present === undefined) continue;
    const label = present.actor.displayName;
    const sceneId = present.sceneId;
    if (wasThere === undefined) changes.push({ kind: 'added', id, label, sceneId });
    else if (isThere === undefined) changes.push({ kind: 'removed', id, label, sceneId });
    else if (!equal(wasThere.actor, isThere.actor)) changes.push({ kind: 'changed', id, label, sceneId });
  }
  return changes;
}

function lineLabel(line: Scene['dialogue'][number]): string {
  const text = line.text.length > 48 ? `${line.text.slice(0, 45)}…` : line.text;
  return `${line.speaker}: ${text}`;
}

function diffLines(before: Project, after: Project): LineChange[] {
  const beforeByKey = new Map(flattenLines(before).map((entry) => [entry.line.id, entry]));
  const afterByKey = new Map(flattenLines(after).map((entry) => [entry.line.id, entry]));
  const ids = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
  const changes: LineChange[] = [];
  for (const id of ids) {
    const wasThere = beforeByKey.get(id);
    const isThere = afterByKey.get(id);
    const present = isThere ?? wasThere;
    if (present === undefined) continue;
    const label = lineLabel(present.line);
    const sceneId = present.sceneId;
    if (wasThere === undefined) changes.push({ kind: 'added', id, label, sceneId });
    else if (isThere === undefined) changes.push({ kind: 'removed', id, label, sceneId });
    else if (!equal(wasThere.line, isThere.line)) changes.push({ kind: 'changed', id, label, sceneId });
  }
  return changes;
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

const ASSET_GROUPS: { key: keyof AssetLibrary; noun: string }[] = [
  { key: 'characters', noun: 'character' },
  { key: 'environments', noun: 'environment' },
  { key: 'poses', noun: 'pose' },
  { key: 'expressions', noun: 'expression' },
  { key: 'props', noun: 'prop' },
  { key: 'audio', noun: 'audio' },
];

function diffAssets(before: AssetLibrary, after: AssetLibrary): EntityChange[] {
  const changes: EntityChange[] = [];
  for (const group of ASSET_GROUPS) {
    const rows = diffCollection(
      before[group.key] as { id: Id; name: string }[],
      after[group.key] as { id: Id; name: string }[],
      (item) => `${group.noun}: ${item.name}`,
    );
    changes.push(...rows);
  }
  return changes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* ------------------------------------------------------------------ */
/* planDiff                                                            */
/* ------------------------------------------------------------------ */

function issueKey(issue: ValidationIssue): string {
  return `${issue.severity}|${issue.path}|${issue.message}`;
}

/**
 * Compare the open document with the document a plan would produce.
 *
 * `series` is the owning series, threaded to `validateProject` so the "what it breaks"
 * list resolves references against the same library the renderer and the store use. A
 * free project passes `null`; a series-owned project that omits it would be diffed
 * against an unknown library, which reports every asset as missing.
 */
export function planDiff(project: Project, next: Project, series: SeriesDef | null = null): PlanDiff {
  const beforeIssues = new Set(validateProject(project, series).map(issueKey));
  const issues = validateProject(next, series).filter((issue) => !beforeIssues.has(issueKey(issue)));

  return {
    scenes: diffScenes(project, next),
    actors: diffActors(project, next),
    lines: diffLines(project, next),
    assets: diffAssets(project.assets, next.assets),
    issues,
  };
}

/** True when the diff has nothing to show. A plan that changes nothing is worth saying so. */
export function isEmptyDiff(diff: PlanDiff): boolean {
  return (
    diff.scenes.length === 0 &&
    diff.actors.length === 0 &&
    diff.lines.length === 0 &&
    diff.assets.length === 0 &&
    diff.issues.length === 0
  );
}
