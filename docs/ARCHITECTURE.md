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
renderScene(ctx, project, scene, time, options?) -> void
```

No engine, no retained mode, no imperative scene graph. `options` carries the things
`core` is not allowed to read for itself — viewport size, device pixel ratio, subtitle
visibility, and any decoded images — because `core` has no `window` to ask.

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
not shown to matter. Environment layers are sorted by `z` once when the render index
for a scene is built — not per frame, and not by the author. Revisit only if profiling
a heavy scene justifies it.

**The loop skips idle frames.** `src/ui/Stage.tsx` redraws only when something the
renderer reads has changed: the resolved library, the scene object, the scene-local
time, the subtitle flag, the device pixel ratio, or the stage width. Documents are
immutable, so object identity is the revision — an edit to another scene leaves this
scene's object untouched and the pixels provably unchanged, while an edit to this
scene produces a new object and redraws. An idle editor costs a store read and a
`requestAnimationFrame` tick, not a full redraw; the transport's own clock never
advances while paused (`advancePlayback` is a no-op), so a paused scene is exactly
still, every frame.

---

## 3. STATE MANAGEMENT — IMMUTABLE DOCUMENT + SNAPSHOT HISTORY

`src/state/editorStore.ts` holds one thing that matters: the **project document**.

The history-relevant part of the store, abridged from the real interface (which also
carries `sceneId`, `dirty`, the project list, and session status):

```ts
export interface HistoryEntry {
  label: string;
  project: Project;
}

interface EditorState {
  project: Project | null;
  past: HistoryEntry[];     // previous project snapshots
  future: HistoryEntry[];   // redo stack
  selection: { kind: SelectionKind; id: Id | null };
  playhead: number;
  playing: boolean;
}
```

A `HistoryEntry` is a whole project snapshot plus the label the UI shows in the undo
menu — not a patch and not a diff.

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
PartDef.rest:    Transform2D    // the neutral rest transform, per part, relative to its parent
```

**The rest state lives on the part, not on the character.** Each `PartDef` carries its
own `rest` transform, `pivot`, `z`, `parent`, `slot` and `visible`. There is no
`CharacterDef.restPose` field and no character-wide rest map; a part that is not drawn
at rest is expressed by a part-level transform, which is what makes a rig composable
from parts authored independently.

**Four** override layers are composed at resolve time:

1. **Rest** — `PartDef.rest`
2. **Pose** — `PoseDef.slots` (a *partial* map; only the slots it names)
3. **Expression** — `ExpressionDef.slots` (per-slot shape, colour, transform and alpha)
4. **Keyframe** — `Clip.keyframes[].props` (may carry a transform and a pose/expression id)

Layers 1–3 are composed inside `src/core/render/resolve.ts`; layer 4 is applied by the
caller in `src/core/render/render.ts` after resolution, because a keyframe may name a
pose or expression that has to be re-resolved for that time. The effective order is
therefore `rest <- pose <- expression <- keyframe`, and nothing bypasses it.

`resolveRig(rig, { pose, expression })` walks the rig once and produces a flat draw
list, with a transform stack for nesting (an arm part may itself contain a forearm
child). `resolveCharacter(character, options)` is the public entry point that adds the
character's placement transform and default pose/expression on top.

**Expressions are not keyframed art.** They are per-slot overrides —
`{ shape?: ShapeId, scale?, rotation?, alpha? }` — plus a mouth shape. This lets a
smirk be `browL: rotate(-6deg) + mouth: narrow` and reuse across every character.
It also means the app produces a real animated scene with **zero binary art
assets**, which is what makes the MVP achievable before any artwork exists.

Parts are `ShapeDef`s — the vector primitives `ellipse`, `rect`, `roundRect` and
`path`. Painted-art parts are planned, not present: the image branch that existed in
`render.ts` was deleted in Phase 15 (R5) because no caller supplied the `images` map
it read — a dead code path in the pure core was a liability, not a feature. When the
art pipeline lands, `{ kind: 'image', src, w, h }` returns together with an
`ImageResolver` that supplies decoded bitmaps; that addition is a data change plus a
resolver, not a change to the existing vector path.

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

Clip windows are **half-open**: a track contributes a value only while
`clip.start <= t < clip.start + clip.duration`. There is no `clampTime()` helper by
that name; the window test lives with the samplers in `src/core/animation/`, and
`src/core/animation/frame.invariants.test.ts` is what pins the boundary behaviour down.
Before or after a clip the actor falls back to its scene-authored rest state, so
deleting a clip can never strand a character in an animated position.

---

## 7. PERSISTENCE

`ProjectRepository` is an interface, and `IndexedDbProjectRepository` is its only
implementation.

```
src/core/persistence/repository.ts        // interface + DTOs
src/core/persistence/db.browser.ts        // the database schema: one version, one upgrade
src/core/persistence/indexedDb.browser.ts // the repository implementation
src/core/persistence/media.browser.ts     // the media store, same database
```

`db.browser.ts` is the one place that knows the shape of the local database. The
project repository and the media store deliberately share it, because splitting the
schema across two modules is how a database ends up at version 2 with a `media` store
that only exists if some other module happened to open it first. The `*.browser.ts`
files in this directory are the only code that opens IndexedDB; `src/state/` imports
the repository and the availability probe, never the raw API.

Core stays pure because the interface is pure; only the `*.browser.ts` files may use
browser globals (per RULE 5). A future `HttpProjectRepository` slots in without the
editor noticing.

Serialization writes `{ formatVersion, project }` and **migrates forward** on load.
`MIGRATIONS` in `src/core/serialize.ts` is an ordered array of
`(project, fromVersion) => project`; index *i* upgrades a project from version *i+1* to
*i+2*. There is one step today — v1 to v2, which backfills the fields v2 added and
refuses to guess where a guess would be wrong. Adding a field means appending a step and
bumping `CURRENT_FORMAT_VERSION`; old projects keep opening. `src/core/io/projectIo.ts`
refuses to write a file it could not reopen, so the ladder and the writer cannot drift
apart silently.

**Media is not embedded.** The project JSON references audio by `AudioDef.id`/`src`;
binary blobs live in the `media` store in the same IndexedDB database. A
`.zanza.json` file is diffable and versionable, which is the point of a structured
project format.

Autosave debounces 800 ms after the last commit and also flushes on `pagehide` and
`visibilitychange` (`src/state/autosaveLifecycle.browser.ts`), so a tab closed or
backgrounded within the debounce window does not lose the last edit.

**Boot does not auto-open or auto-seed anything.** On launch the app shows the project
browser; the user opens, imports, or creates a project. The ZANZA demo project exists
as `SEED_PROJECT` in `src/data/seed.ts` and is the fixture the tests run against, but
the app does not write it into a fresh database. That is deliberate — a tool that
silently invents a project in your storage is a tool you have to go clean up.

---

## 8. TESTABILITY AS A DESIGN CONSTRAINT

The renderer is pure, so it is unit-testable with a **recording canvas context**
(`src/test/recordingContext.ts`) that logs draw calls. That lets us assert *what was
drawn* — draw order, that a camera zoom changed the emitted transform, that an
expression swapped a part's shape — without a GPU, a browser, or a snapshot library.
Draw-order assertions are how layer and `z` regressions get caught; a named
character being occluded by a foreground layer is a scene-specific expectation and is
not a test that exists today.

The single most valuable test in the repo is the **determinism test**:
`renderScene` at the same `(scene, time)` must produce an identical draw-command
log. If that ever fails, export is broken. See `src/data/render.test.ts`.

---

## 9. LAYER DEPENDENCY RULE

```
ui  ->  state  ->  core  ->  (nothing)
```

- `core` imports no React, no DOM globals, no Zustand, and no `data/`.
- `state` imports `core` and may use browser APIs inside `.browser.ts` files.
- `ui` imports `state` and `core` types. UI components never mutate the project.
- `data` imports from `core` — mostly types, but also real values such as the shape
  constructors in `src/core/render/shapes.ts` and the factories in
  `src/core/document/factories.ts`. `data` is the only place ZANZA canon lives, and it
  is still downstream of `core`, so the arrow above is unchanged. What the rule forbids
  is the reverse: `core` importing content.

**The arrow is enforced for all four edges.** A custom ESLint rule,
`local/no-upward-imports` in `eslint.config.js`, fails the build when a file in
`src/core` reaches up into `src/state` or `src/ui`, or when `src/state` reaches into
`src/ui`. Adding an upward import to a `core` file produces
`Upward import: "../state/editorStore" jumps from the 1 layer to the 2 layer` as an error.

On top of it, `src/arch/layering.test.ts` (Phase 14) walks the import graph for everything
the lint tiers cannot see. It forbids `core` imports of `state`, `ui`, `ai` and `data` from
implementation and from test doubles alike; forbids `react` imports in `core`; forbids
`window.`, `document.`, `indexedDB` and `React` outside `*.browser.ts` core modules; and holds
`data` and (when it exists) `ai` to the same boundary against `state` and `ui`. That closes
the edge the tier rule alone left open: a `core` module importing the seed was invisible to
lint, because `core` and `data` sit on the same tier — the graph test now catches it. The
single remaining seam is `*.browser.ts`, the explicitly-named exception every browser-facing
module in `core` uses.

Content-agnosticism, by contrast, **is** tested directly:
`src/data/rule3.test.ts` seeds a synthetic character `char.synthetic_tester` and
asserts the renderer and selectors handle it identically to the seed cast. That is
RULE 3 made mechanical.

---

## 10. RISKS AND KNOWN LIMITS

| Risk | Impact | Mitigation |
|---|---|---|
| Vector art looks crude | Poor perceived quality | Palette + palette-slot theming; swap to image parts per part, no renderer change |
| Snapshot history memory | Cap memory | Hard cap at 100; documents are small JSON |
| No single-file video output | Nothing to upload to a social platform | **Not built, and stated as such.** Export is a PNG sequence plus a WAV mixdown. `docs/adr/001-video-encoding.md` records why no muxer is present; `MediaRecorder` is a browser-dependent WebM path and is deliberately not taken |
| No lip sync | Dialogue looks static | Mouth shapes swap per line; real phoneme sync is a later phase |
| Single user, no cloud | Can't collaborate | Repository interface is the seam; no editor code assumes local storage |
| No audio assets ship | Exported mixdown is silent or near-silent | The audio pipeline is real and tested with synthesised buffers, but the seed content has no real audio, so a fresh export is silent unless audio is attached. Shipping sample audio is a content task, not an engineering one |
| Stage loop redraw cost | Idle editor could redraw at 60 fps | **Resolved in Phase 15.** The loop compares the renderer's inputs — library, scene object, scene time, subtitle flag, pixel ratio, width — against the previous draw and skips the draw when nothing changed (`src/ui/Stage.tsx`). An idle editor costs a store read and a rAF tick |
| Layer rule is unenforced | An upward import could land unnoticed | **Resolved in Phase 14.** `local/no-upward-imports` covers the lint half; `src/arch/layering.test.ts` walks the import graph, bans browser globals outside `*.browser.ts`, and closes the `core → data` edge |

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

The loop skips the draw while the renderer's inputs are unchanged (§2), so an idle
editor holds its last frame at display refresh instead of repainting it. React owns
chrome; the loop owns pixels.
