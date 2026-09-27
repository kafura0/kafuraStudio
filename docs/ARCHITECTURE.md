# ZANZA STUDIO — ARCHITECTURE

> The reasoning layer. `DATA_MODEL.md` describes the shapes; this file explains
> **why** the system is built this way and what was deliberately rejected.

---

## 1. THE PRODUCT SHAPE

ZANZA STUDIO is a **document editor**, not an application that happens to draw pixels.

The distinction drives every decision below:

| | A game runtime | A document editor |
|---|---|---|
| Source of truth | live object graph | serialized, versionable document |
| Time | its own loop | a value the user owns and scrubs |
| State changes | imperative, per frame | pure functions, reversible |
| Output | a running window | a deterministic frame at any `t` |

A production tool must be able to answer *"render exactly `t = 7.42s` of scene 3"*
with no hidden accumulated state. That is only possible if rendering is a pure
function of `(document, sceneId, time)`.

```
renderScene(ctx, project, scene, time) -> void
```

No engine, no retained mode, no imperative scene graph.

---

## 2. RENDERING — WHY NATIVE CANVAS 2D

The prompt listed PixiJS / Konva / Canvas / WebGL as candidates. Canvas 2D was
chosen. The argument, recorded so it is not re-litigated casually:

**Why not a WebGL engine (PixiJS)?**
1. **Determinism.** WebGL state is a machine for making "same input, same output"
   hard. Shader warm-up, texture uploads, batch ordering. Determinism is a hard
   requirement for tests and for frame-accurate export.
2. **Export friction.** Reading pixels back from WebGL requires
   `preserveDrawingBuffer`, which costs real performance in the editor loop. Canvas 2D
   hands over `toBlob()` for free.
3. **Scale does not justify it.** This is limited animation: a scene is roughly
   3 environment layers + 6 actors + 12 props + overlays. That is tens of draws per
   frame. Canvas 2D does tens of thousands. The GPU is not the bottleneck; the
   timeline UI is.
4. **Dependency cost.** An engine is a large surface area to own, test, and upgrade.

**Why not Konva?** It is a reasonable library, but it is a scene graph, which
reintroduces retained state — the exact thing being avoided. It would also be a
dependency for a problem Canvas 2D does not have.

**What is given up, and how it is bounded.** Canvas 2D cannot batch thousands of
sprites or do shader effects. Neither is in scope for a limited-animation sitcom
with a few dozen elements per shot. **If a future phase needs WebGL, the correct
move is a second `renderScene` implementation behind the same pure signature**,
selected by capability. The document model does not change, because the document
model never knew about the renderer. That is the payoff of the pure-function rule.

**Allocation in the hot path.** `resolveRig()` does allocate: one `ResolvedPart`
per rig part, per actor, per frame. A three-character scene allocates a few hundred
short-lived objects per frame, which is immaterial at 60 fps and far below the cost of
the canvas fills themselves. A scratch-buffer pool is deliberately **not**
implemented — it would complicate the resolver to remove a cost that measurement has
not shown to matter. Layers are pre-sorted by `z` when the environment is authored,
and the render loop skips the frame entirely when nothing has changed. Revisit only if
profiling a heavy scene justifies it.

---

## 3. STATE MANAGEMENT — IMMUTABLE DOCUMENT + SNAPSHOT HISTORY

`src/state/editorStore.ts` holds one thing that matters: the **project document**.

```ts
interface EditorState {
  project: Project | null;
  past: HistoryEntry[];     // previous project snapshots
  future: HistoryEntry[];   // redo stack
  selection: Selection;
  playhead: number;
  playing: boolean;
}
```

Every mutation is a pure function in `src/core/document/`:

```ts
const next = setActorTransform(project, sceneId, actorId, { x: 400 });
commit(next, 'Move Nia');
```

`commit()` pushes the previous document onto `past`, truncates `future`, and swaps
in the new document. **Undo is `project = past.pop()`.** That is the whole engine.

**Why snapshots and not a command/patch history?** A patch history
(`{path, before, after}`) is asymptotically better for very large documents. It is
also substantially more bug-prone: every mutation site must supply a correct
inverse, and one wrong inverse corrupts the timeline. MVP documents are
kilobytes-to-low-megabytes of JSON; 100 retained snapshots is a few tens of MB worst
case and is trivially correct. Snapshot history is the simpler production-ready
choice, and it is *exactly* reversible.

The cost is recorded honestly: history is capped at `HISTORY_LIMIT = 100` entries
and is **not** deduplicated. A migration to a patch-based history is a contained
change to `commit()`/`undo()` alone, because the rest of the app never touches
`past`/`future`.

**React never owns scene state.** Components read via selectors from the store and
call `commit()`-wrapped actions. There are no `useState` copies of scene data, so
there is no sync bug surface.

---

## 4. ASSET REUSE — THE CORE INVARIANT

Everything expensive is defined once in `project.assets` and referenced by id:

```
project.assets.characters   -> CharacterDef   (Nia, Kito, Mama Nia, The Landlord)
project.assets.environments -> EnvironmentDef (Nia Apartment, Zanza Street, Lounge)
project.assets.props        -> PropDef        (phone, mug, tablet, mic, ...)
project.assets.poses        -> PoseDef        (standing, sitting, arms crossed, ...)
project.assets.expressions  -> ExpressionDef  (neutral, smug, shocked, ...)
project.assets.audio        -> AudioDef       (dialogue, sfx, music, ambience)
```

A `Scene` stores **ids**, never definitions:

```ts
interface SceneActor {
  id: string;
  characterId: string;     // -> CharacterDef
  poseId: string;          // -> PoseDef
  expressionId: string;    // -> ExpressionDef
  transform: Transform2D;  // placement only
}
```

Change Nia's palette in one place and all 400 scenes that reference her change.
This is enforced structurally: `Scene` has no field that can hold a copy of a
character.

**Poses and expressions are global libraries, not per-character.** This is what
makes limited animation cheap — a `sitting` pose is written once and applied to
whichever actor is staged on the couch. Characters declare which slots they
possess; a pose that touches a slot a character lacks simply has no effect there.

---

## 5. LIMITED ANIMATION AS TRANSFORM OVERRIDES

A character is a **rig**: an ordered list of named parts (slots).

```
CharacterDef.rig: PartDef[]     // head, torso, armL, armR, legL, legR, hair, ...
CharacterDef.restPose: SlotTransforms   // the neutral T-pose-ish rest state
```

Three independent override layers are composed at resolve time:

1. **Rest pose** — `CharacterDef.restPose`
2. **Pose** — `PoseDef.slots` (a *partial* map; only the slots it names)
3. **Keyframe** — `Clip.keyframes[].props` (may carry a transform and a pose/expression id)

`resolveActor(character, pose, expression, time)` walks the rig once and produces a
flat draw list. Composition order is `rest <- pose <- keyframe`, with a transform
stack for nesting (an arm part may itself contain a forearm child).

**Expressions are not keyframed art.** They are per-slot overrides —
`{ shape?: ShapeId, scale?, rotation?, alpha? }` — plus a mouth shape. This lets a
smirk be `browL: rotate(-6deg) + mouth: narrow` and reuse across every character.
It also means the app produces a real animated scene with **zero binary art
assets**, which is what makes the MVP achievable before any artwork exists.

Parts are `ShapeDef`s — vector primitives (`ellipse`, `roundRect`, `path`, `poly`)
with palette slots. A part may later be swapped for an image via
`{ kind: 'image', src }`; the renderer already handles both, so replacing vector
parts with painted art is a data change, not a code change.

---

## 6. TIMELINE MODEL

One uniform model serves characters, props, camera, dialogue and audio:

```
Track  { kind, targetId, clips[] }
Clip   { start, duration, keyframes[], audioId?, dialogueLineId? }
```

Because the model is uniform, the timeline UI is written **once**. A dialogue line
is a clip on a `dialogue` track whose `dialogueLineId` points at
`DialogueLine { speaker, text, emotion, subtitle }`. **Timing lives on the clip;
content lives on the line.** This avoids the classic bug where a dragged dialogue
clip and a separately-timed dialogue line disagree.

Interpolation (`src/core/animation/sample.ts`) blends the numeric channels
(`x`, `y`, `rotation`, `scaleX`, `scaleY`, `alpha`) across the segment a keyframe
leaves, using that keyframe's `ease`. The **discrete** channels — `poseId`,
`expressionId`, `visible`, `flipX` — always hold and cut, whatever the easing: an
expression should change, not smear between two faces. `ease: 'step'` additionally
makes motion stepped.

`clampTime()` semantics: a track contributes a value only while
`clip.start <= t < clip.start + clip.duration`. Before/after a clip, the actor falls
back to its scene-authored rest state, so deleting a clip can never strand a
character in an animated position.

---

## 7. PERSISTENCE

`ProjectRepository` is an interface. `IndexedDbProjectRepository` is the only
implementation and the only place in the codebase that touches IndexedDB.

```
src/core/persistence/repository.ts        // interface + DTOs
src/core/persistence/indexedDb.browser.ts // implementation
```

Core stays pure because the interface is pure; only the `*.browser.ts` file may use
browser globals (per RULE 5). A future `HttpProjectRepository` slots in without the
editor noticing.

Serialization writes `{ formatVersion, project }` and **migrates forward** on load.
`migrateProject` is an ordered list of `(version) => (doc) => doc`. Adding a field
means appending a step and bumping the version — old projects keep opening.

**Media is not embedded.** The project JSON references audio by `AudioDef.id`/`src`;
binary blobs live in IndexedDB. A `.zanza.json` file is diffable and versionable,
which is the point of a structured project format.

Autosave debounces 800 ms after the last commit and also flushes on
`visibilitychange`. On boot the store loads the last project, or seeds the
ZANZA demo project if the database is empty.

---

## 8. TESTABILITY AS A DESIGN CONSTRAINT

The renderer is pure, so it is unit-testable with a **recording canvas context**
(`src/test/recordingContext.ts`) that logs draw calls. That lets us assert *what was
drawn* — draw order, that Kito is occluded by the foreground, that the camera
applied a zoom — without a GPU, a browser, or a snapshot library.

The single most valuable test in the repo is the **determinism test**:
`renderScene` at the same `(scene, time)` must produce an identical draw-command
log. If that ever fails, export is broken. See `src/core/render/render.test.ts`.

---

## 9. LAYER DEPENDENCY RULE

```
ui  ->  state  ->  core  ->  (nothing)
```

- `core` imports no React, no DOM globals, no Zustand, and no `data/`.
- `state` imports `core` and may use browser APIs inside `.browser.ts` files.
- `ui` imports `state` and `core` types. UI components never mutate the project.
- `data` imports `core` types only. `data` is the only place ZANZA canon lives.

Content-agnosticism is tested directly: a test seeds a synthetic character
`"test.puppet"` and asserts the renderer and selectors handle it identically to
Nia. That is RULE 3 made mechanical.

---

## 10. RISKS AND KNOWN LIMITS

| Risk | Impact | Mitigation |
|---|---|---|
| Vector art looks crude | Poor perceived quality | Palette + palette-slot theming; swap to image parts per part, no code change |
| Snapshot history memory | Cap memory | Hard cap at 100; documents are small JSON |
| `MediaRecorder` WebM export | Chrome/Firefox support differs, no MP4 | Feature-detect and report honestly; PNG-sequence fallback is planned |
| No lip sync | Dialogue looks static | Mouth shapes swap per line; real phoneme sync is a later phase |
| Single user, no cloud | Can't collaborate | Repository interface is the seam; no editor code assumes local storage |
| No audio assets ship | Export is video-only | Audio pipeline is real and exercised by tests with generated tones; sample audio is a content task |

**Honest status labels** are used throughout the docs and UI: *implemented*,
*prototype*, *placeholder*, *planned*. A greyed-out button is labelled *planned*,
never shipped as if it worked (RULE 9).

---

## 11. WHY THE STAGE IS NOT REACT-DRIVEN

The stage is a single `<canvas>` driven by a `requestAnimationFrame` loop that
reads `playhead` from the store via `getState()` — **not** via a React subscription.
React re-renders panels on state change; the canvas redraws independently at display
refresh. A 60 fps playhead would otherwise cause 60 React renders/second of the
whole panel tree.

The loop skips the frame entirely when nothing is animating and the playhead has
not changed, so an idle editor costs no CPU. React owns chrome; the loop owns pixels.
