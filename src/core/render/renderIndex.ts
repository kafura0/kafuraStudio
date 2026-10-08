/**
 * The render index (ARCHITECTURE_SPEC.md §18.2 R4, §18.3 R10).
 *
 * `renderScene` is called once per animation frame, and the frame's work used to include
 * an `O(actors × assets)` scan for characters, poses and expressions, an
 * `O(actors + props)` scan of every track per target, one whole-scene clip walk per actor
 * for the talk pulse, and a fresh sort of the environment's layers. All of that depends
 * only on `(context, scene)` — never on `time` — so it is computed here once per identity
 * change instead of once per frame.
 *
 * Two invariants make this safe:
 *
 * 1. **Purity.** `resolveRenderIndex` is a plain function over plain data. It never
 *    mutates the document: the sorted layer list is a copy, and the clip arrays are
 *    fresh arrays that merely share the clips.
 * 2. **Identity is revision.** Documents are immutable (AGENTS.md RULE 6), so an edited
 *    scene or a re-resolved library is a *new object*. Memoising on object identity
 *    therefore rebuilds exactly when the document could have changed — the
 *    `(context, sceneId, documentRevision)` key the spec asks for, with identity playing
 *    the role of revision, and no counter to keep honest.
 *
 * Time-dependent answers stay out of the index: what is speaking at `t` is derived per
 * frame by `speakingAt`/`dialogueAt` in one pass over the pre-resolved dialogue, once per
 * frame rather than once per actor.
 */

import type {
  CharacterDef,
  Clip,
  DialogueLine,
  EnvironmentDef,
  EnvLayer,
  ExpressionDef,
  Id,
  PoseDef,
  PropDef,
  Scene,
  SceneContext,
  TrackKind,
} from '../types';

/** A dialogue clip with its resolved line and its half-open `[start, end)` window. */
export interface DialogueEntry {
  clip: Clip;
  line: DialogueLine;
  start: number;
  end: number;
}

export interface RenderIndex {
  characters: Map<Id, CharacterDef>;
  poses: Map<Id, PoseDef>;
  expressions: Map<Id, ExpressionDef>;
  props: Map<Id, PropDef>;
  /** The scene's environment, or `null` when the reference is dangling. */
  environment: EnvironmentDef | null;
  /** `environment.layers` in ascending `z`, pre-sorted (§18.3 R10). */
  layers: EnvLayer[];
  /** Unmuted clips by track kind. The camera sampler reads `'camera'` and ignores targets. */
  clipsByKind: Map<TrackKind, Clip[]>;
  /** Unmuted clips by `(kind, targetId)` — replaces the per-target track scan. */
  tracksByKindTarget: Map<TrackKind, Map<Id, Clip[]>>;
  /** Unmuted dialogue clips with resolved lines, in track order. */
  dialogue: DialogueEntry[];
}

/** First-wins by id, exactly what the array `.find()` lookups this replaces did. */
function byId<T extends { id: Id }>(items: readonly T[]): Map<Id, T> {
  const map = new Map<Id, T>();
  for (const item of items) {
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return map;
}

function pushInto<V>(map: Map<Id, V[]>, key: Id, values: readonly V[]): void {
  const slot = map.get(key);
  if (slot === undefined) {
    map.set(key, [...values]);
  } else {
    slot.push(...values);
  }
}

export function resolveRenderIndex(context: SceneContext, scene: Scene): RenderIndex {
  const environment =
    context.assets.environments.find((e) => e.id === scene.environmentId) ?? null;

  const clipsByKind = new Map<TrackKind, Clip[]>();
  const tracksByKindTarget = new Map<TrackKind, Map<Id, Clip[]>>();
  const dialogue: DialogueEntry[] = [];
  const linesById = byId(scene.dialogue);

  // One pass over the tracks serves every clip lookup. Muted tracks are skipped whole,
  // matching what the per-frame scans did: the renderer never played a muted track's clips.
  for (const track of scene.tracks) {
    if (track.muted) continue;

    const kindSlot = clipsByKind.get(track.kind);
    if (kindSlot === undefined) {
      clipsByKind.set(track.kind, [...track.clips]);
    } else {
      kindSlot.push(...track.clips);
    }

    let byTarget = tracksByKindTarget.get(track.kind);
    if (byTarget === undefined) {
      byTarget = new Map();
      tracksByKindTarget.set(track.kind, byTarget);
    }
    pushInto(byTarget, track.targetId, track.clips);

    if (track.kind === 'dialogue') {
      for (const clip of track.clips) {
        if (clip.dialogueLineId === null) continue;
        const line = linesById.get(clip.dialogueLineId);
        // A clip pointing at a missing line is skipped, not resolved to nothing —
        // the same `if (line)` guard the per-frame walk had.
        if (line === undefined) continue;
        dialogue.push({ clip, line, start: clip.start, end: clip.start + clip.duration });
      }
    }
  }

  return {
    characters: byId(context.assets.characters),
    poses: byId(context.assets.poses),
    expressions: byId(context.assets.expressions),
    props: byId(context.assets.props),
    environment,
    layers: environment === null ? [] : [...environment.layers].sort((a, b) => a.z - b.z),
    clipsByKind,
    tracksByKindTarget,
    dialogue,
  };
}

const memo = new WeakMap<SceneContext, WeakMap<Scene, RenderIndex>>();

/**
 * The index for `(context, scene)`, built on first use and reused after.
 *
 * Safe to memoise because both keys are immutable objects: a caller that still holds the
 * same context and scene is holding the same document, and a caller that changed either
 * one misses the memo and rebuilds. Callers therefore never manage the index themselves —
 * `renderScene` gets the benefit without its frozen signature (§29 D12) gaining a parameter.
 */
export function renderIndexFor(context: SceneContext, scene: Scene): RenderIndex {
  let byScene = memo.get(context);
  if (byScene === undefined) {
    byScene = new WeakMap();
    memo.set(context, byScene);
  }
  let index = byScene.get(scene);
  if (index === undefined) {
    index = resolveRenderIndex(context, scene);
    byScene.set(scene, index);
  }
  return index;
}

/** The dialogue clip live at `time`, in track order, or `null`. */
export function dialogueAt(index: RenderIndex, time: number): DialogueEntry | null {
  for (const entry of index.dialogue) {
    if (time >= entry.start && time < entry.end) return entry;
  }
  return null;
}

/**
 * The actor ids with an unmuted line live at `time`.
 *
 * One pass over the pre-resolved dialogue, once per frame — where the walk it replaces
 * ran once *per actor* over the whole clip list.
 */
export function speakingAt(index: RenderIndex, time: number): Set<Id> {
  const speaking = new Set<Id>();
  for (const entry of index.dialogue) {
    if (time < entry.start || time >= entry.end) continue;
    if (entry.line.actorId !== null) speaking.add(entry.line.actorId);
  }
  return speaking;
}
