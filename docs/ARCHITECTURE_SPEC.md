# ZANZA STUDIO — MASTER ARCHITECTURE SPECIFICATION

**Status:** design specification. No code in this document has been implemented.
**Audited baseline:** commit `3a3a144`.
**Baseline health:** 20 test files, 243 tests passing; `lint`, `typecheck`, `build` clean.
**Scope:** every remaining phase, from the current state to a multi-series, AI-assisted production platform.

---

## 0. EXECUTIVE SUMMARY

### 0.1 The verdict on the current architecture

The engine is sound. The Phase 8 audit's classification — *B, minor architectural refactoring recommended, core editor can remain intact* — is correct, and this specification confirms it after reading the source rather than the audit.

Five properties are already correct and must survive every phase in this document:

1. **The renderer is pure, deterministic and content-blind.** `renderScene` is a function of `(ctx, project, scene, time, options)` with no retained state, and `src/data/rule3.test.ts` proves an unknown character works with zero `core/` changes.
2. **Document operations are pure.** 114 exported functions and constants under `src/core/document/**` return new documents. No in-place mutation.
3. **There is exactly one mutation path.** `commit(next, label)` in `src/state/editorStore.ts:146` is the only place a document is replaced, which is what makes RULE 7 (undo is not optional) mechanically true rather than aspirational.
4. **The layering is enforced, not merely documented.** `eslint.config.js:75` runs `local/no-upward-imports` as an error. A `core` module importing `state` fails lint.
5. **A production can be built from generic operations.** `src/data/seed.ts` constructs EP001 entirely out of `placeCharacter`, `addKeyframe`, `addDialogueLineWithCue` and friends. This is the single most important fact for the AI layer, and it is already demonstrated.

**Recommendation: extend, do not rewrite.** No phase in this specification replaces the document model, the renderer, the sampling model, or the commit path. The largest structural change — introducing `Series` — is a scope-widening of asset resolution, not a re-architecture of the engine.

### 0.2 The eight findings that shape the roadmap

These are not carried over from the audit. Each was verified in the source at `3a3a144`.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | `scaleY` never reaches the pixels for actors or props | `render.ts:175` and `render.ts:207` both read only `sampled.scaleX` / `transform.scaleX`; `sampled.scaleY` is sampled (`sample.ts:21`) and then discarded | An author can keyframe `scaleY` on an actor or prop and get no result, with no error. The rig-internal `scaleY` (from `rest`, pose, expression) and the mouth pulse *do* work. This is a silent-wrong-answer bug, not a missing feature. |
| F2 | The talk pulse is keyed to the literal slot name `'mouth'` | `resolve.ts:179` | A character whose mouth part is named anything else never animates when speaking. Same class of hardcoded convention as the removed `if (character.id === 'nia')`. |
| F3 | `resolveColor` falls back silently | `resolve.ts:48` — `palette[colorKey] ?? colorKey` | A typo'd palette key becomes a CSS colour string that Canvas silently accepts (or ignores), producing a black or unstyled part. The validator does not check that a part's `colorKey` resolves. |
| F4 | `autosave.flush()` is never called | `autosave.ts:36` defines it; nothing invokes it; no `visibilitychange` or `pagehide` listener exists in the repository | An edit made within 800 ms of closing the tab is lost. `docs/ARCHITECTURE.md:236` claims otherwise. |
| F5 | A corrupt record is silently replaced by the seed | `editorStore.ts:224-228` catches the `ProjectParseError` from `parseProject`, warns, and leaves `SEED_PROJECT` open; the next commit autosaves over the bad record | The user's damaged project is overwritten without consent. This is data loss, not degradation. |
| F6 | The audio engine captures the first project's asset map forever | `audioChannel.ts:18-22` — the module-level `engine` is built once from `project.assets.audio` | Switching projects, or attaching a recording, leaves the engine resolving against a stale map. Also `createFetchingResolver` opens a fresh `AudioContext` per decoded file (`audioEngine.browser.ts:176`) and never closes it. |
| F7 | The render loop has no per-frame index | `render.ts:82,161,186,192,193` — `find` over assets per actor per frame; `render.ts:452-469` — track scan per target; `render.ts:513-521` — `allClips` scan per actor for the talk pulse | Cost is `O(actors × assets)` for lookups and `O(actors × clips)` for talking state, every frame. Fine at seed scale, not at episode scale. |
| F8 | `MIGRATIONS` is an empty array | `serialize.ts:93-96` | The migration ladder is scaffolding. `Project.formatVersion` also duplicates `ProjectFile.formatVersion`, and the two are never reconciled. Every phase that touches the persisted shape must fix this first. |

### 0.3 The roadmap in one line

Finish and prove the MVP (Phases 9–13) → widen scope to `Series` (14) → repair engine correctness and performance (15) → build the command/transaction layer (16) → build plans, validation and compilation (17) → build human review (18) → then, and only then, the AI boundary (19).

**The ordering argument.** The MVP must ship before the platform work, because the MVP is what proves the document model is right. The platform work must ship before the AI work, because `PlanCompiler` must be able to emit a command vocabulary that covers what the editor can actually do — and that vocabulary is only knowable once the editor is complete. Building the AI layer against the current partial editor would produce a command set that has to be rewritten when camera authoring, export and asset editing arrive.

### 0.4 What this specification deliberately does not do

It does not add a `Studio`, `Season`, `Shot`, `Script`, `StyleDef`, `SeriesBible` or `AssetRegistry` entity. Section 28 gives, for each, the specific signal that would justify it. Six of the seven are absent because nothing in the current system needs them yet, not because they are bad ideas.

---

## 1. CURRENT ARCHITECTURE BASELINE

### 1.1 Domain model

Defined in `src/core/types.ts` (416 lines), pure, no imports from anywhere else in the app.

**Asset definitions** — `AssetLibrary` holds six collections, all reusable and all referenced by id:

- `CharacterDef` — `palette: Record<string,string>`, `rig: PartDef[]`, `height`, `defaultPoseId`, `defaultExpressionId`
- `EnvironmentDef` — authored `width`/`height`, `layers: EnvLayer[]` (each with `z`, `parallax`, `parts`), `anchors: StagingAnchor[]`, `lighting: Lighting`
- `PoseDef` / `ExpressionDef` — identical shape, `slots: Record<string, SlotOverride>`
- `PropDef` — `parts: PartDef[]`, `pivot`, `defaultScale`
- `AudioDef` — `kind: 'dialogue'|'sfx'|'music'|'ambience'`, `src: string | null`, `duration`, `tags`

`PartDef` is the shared primitive for characters and props: `slot` (free-form string, by design), `parent`, `z`, `shape: ShapeDef`, `colorKey`, `pivot`, `rest: Transform2D`, `visible`. `ShapeDef` is a five-way union: `ellipse | rect | roundRect | path | image`.

**Scene data** — `Scene` holds `environmentId`, `actors: SceneActor[]`, `props: SceneProp[]`, `dialogue: DialogueLine[]`, `tracks: Track[]`, `camera: Camera`, `duration`, `backgroundColor`, `metadata`.

The load-bearing property: `SceneActor` can hold only `characterId`, `poseId`, `expressionId` plus placement. There is no field in which a copy of a rig could be stored. RULE 2 is enforced by the type system, not by discipline. This must never change.

**Timeline** — one uniform model for everything: `Track { kind, targetId, name, muted, locked, color, clips }` where `kind: 'actor'|'prop'|'camera'|'dialogue'|'audio'`, and `Clip { start, duration, keyframes, audioId, dialogueLineId, gain }`. `targetId` is a `SceneActor.id`, a `SceneProp.id`, the literal `'camera'`, a `DialogueLine.id`, or an `AudioDef.id`, depending on `kind`. Keyframes carry absolute scene time and a `props: KeyframeTarget` (partial transform plus `poseId`/`expressionId`/`flipX`/`visible`).

**Episodes and project** — `Episode { id, title, description, sceneIds, renderSettings, metadata }`. Scenes live in a **flat** `Project.scenes` array and the episode holds the order. `Project` carries `settings`, `assets`, `episodes`, `scenes`, plus identity and timestamps.

**Composition rule** — `resolveRig` composes four override layers, not three: `rest ← pose ← expression ← keyframe` (`resolve.ts:141-143`). `docs/ARCHITECTURE.md:167` and `docs/DATA_MODEL.md:102` both say three and are wrong.

### 1.2 State model

One Zustand store, `src/state/editorStore.ts`:

- **Document:** `project: Project` — non-nullable, initialised to `SEED_PROJECT`. There is no "no project open" state today, and adding one is part of Phase 11.
- **History:** `past: Project[]`, `future: Project[]`, capped at `HISTORY_LIMIT = 100`. Full snapshots, not patches. Only `commit`, `undo` and `redo` in this file read them.
- **Transient view state** (never in history): `playhead`, `playing`, `showSubtitles`, `sceneId`, `selection`, `dirty`, `lastSavedAt`.
- **The clock:** `advancePlayback(dt)` at `editorStore.ts:125` is the only thing that moves the playhead. `Stage` calls it once per rAF; the transport, the stage and the timeline all read the same value. This is the correct design and it should not be revisited.

Two details in `commit` worth naming because later phases depend on them:

- `commit` returns early when `next === state.project` (`editorStore.ts:147`), so an effect that commits an unchanged document costs no undo step.
- `commit` runs `validateProject` and **throws in dev** on an invalid document (`editorStore.ts:154-158`). This makes an invariant violation a loud programmer error rather than a silently corrupt document. Keep it.

### 1.3 Persistence model

`src/core/persistence/repository.ts` defines `ProjectRepository` (`save`, `load`, `list`, `remove`, `loadMostRecent`) plus `ProjectSummary`. Two implementations exist: `MemoryProjectRepository` (tests and fallback) and `IndexedDbProjectRepository` (`indexedDb.browser.ts`, the only module that touches IndexedDB).

- Database `zanza-studio`, `DB_VERSION = 1`
- Store `projects`, keyPath `id`, index on `updatedAt`
- Store `meta`, keyPath `key` — holds only `lastOpenedProjectId`
- Each record stores `id`, `name`, `updatedAt`, `sceneCount`, `episodeCount`, and `document: string` — the serialized `{ formatVersion, project }` text

Reads re-validate: `load` calls `parseProject(record.document)`, so a corrupt or newer-build record cannot enter the editor. Writes are chained through a module-level `pendingSave` promise so two overlapping saves cannot land out of order, and the saved document is only adopted into the store if the store still holds the document that was written (`editorStore.ts:267`).

There is **no** asset blob store. `AudioDef.src` is a string path; nothing in the repository writes or reads audio bytes. The "media lives in IndexedDB" claim in `docs/ARCHITECTURE.md:233` is not implemented.

### 1.4 Rendering model

`renderScene(ctx, project, scene, time, options?)` in `src/core/render/render.ts`. Draw order back to front: scene background → environment layers by ascending `z` with parallax → lighting wash and vignette → props and actors merged into one `z`-sorted list → subtitles.

Purity properties, all real:

- Establishes its own transform from `options.pixelRatio` rather than inheriting the caller's (`render.ts:89`)
- Resets `globalAlpha`, `globalCompositeOperation` and `imageSmoothingEnabled` on entry
- Balanced `save`/`restore` — asserted by `RecordingContext.isBalanced()` in `src/data/render.test.ts:23`
- Identical input produces an identical call log — asserted at `src/data/render.test.ts:32`

`docs/ARCHITECTURE.md:251` points at `src/core/render/render.test.ts` for the determinism test. That file does not exist. The test is real; the path is wrong.

Capabilities the renderer has today: vector fills, per-part palette resolution, four-layer override composition, depth-sorted actors and props, environment parallax, multiply/overlay lighting, radial vignette, subtitles, and an optional editor-only frame boundary.

Capabilities it does not have: strokes, image parts in practice (the `drawImage` branch at `render.ts:362` requires `options.images`, which no caller ever passes), and any use of instance or keyframed `scaleY` (F1).

### 1.5 Animation model

`src/core/animation/sample.ts` is pure and document-free: `(keyframes, time) → values`. Numeric channels `x, y, rotation, scaleX, scaleY, alpha` interpolate; discrete channels `poseId, expressionId, visible, flipX` hold and cut. Easing is read from the keyframe a segment *leaves* (the After Effects convention). Sampling is per-channel, not per-segment, so a channel omitted by a later keyframe holds its last keyed value rather than reverting. Holds before the first and after the last keyframe use the same per-channel fill. `sampleTarget` merges overlapping clips with later-start-wins.

Camera is the same mechanism: `Scene.camera` is the rest framing, and a `camera` track's clips override it. Zoom is stored as `scaleX` on the camera track for transform compatibility (`sample.ts:222`) — a documented hack, not an accident.

`talkPulseAt(time, syllablesPerSecond = 4.2)` is a two-step waveform returning a mouth scale. It is honest about being a stand-in for lip sync.

### 1.6 Audio model

Two pure pieces and one browser piece, cleanly separated:

- `audioPlan(project, scene)` → `AudioSegment[]` — pure, deterministic, unit-tested without a browser. Bounded by clip window ∩ scene duration ∩ asset duration. Muted and locked tracks are dropped. Ambience loops; everything else plays once.
- `AudioEngine` (`audioEngine.browser.ts`) — a scheduler with a 600 ms lookahead, constructed against an `AudioPort` interface so tests drive a hand-written fake. Never keeps its own clock; it is fed the store's time.
- `audioChannel.ts` — a thin store↔engine adapter, plus `hasRecording()` in `recording.ts`, the single predicate the UI uses to say "this line is silent".

All 13 seed audio slots have `src: null`. Playback is silent for content reasons, and the UI says so. This is RULE 9 done correctly and must not be "fixed" with a generated tone.

### 1.7 Asset model

`AssetLibrary` inside `Project`. Six collections, one global namespace — `validateProject` rejects a duplicate id across all six (`invariants.ts:135-151`). Poses and expressions are character-independent: a `sitting` pose is authored once and applied to any actor, and a slot a character does not have is inert. This is the strongest reuse mechanism in the system and it is already correct.

Reuse is **project-scoped**. There is no way to reference a character defined in another project, because there is no way to hold two projects.

### 1.8 Episode/scene relationship

Flat scene pool, ordered by `Episode.sceneIds`. No nesting. `episodeScenes`, `episodeDuration` and `scenesOfEpisode` resolve the order. Nesting would make "find scene by id" an O(n) walk on every frame, which is the stated reason for the flat pool. Correct decision; keep it.

### 1.9 Seed/data architecture

`src/data/` is content plus one shared rig builder. `rig.ts` exports `buildHumanRig(proportions(height, build), opts)` and the `circle`/`ellipse`/`limb`/`polyline`/`rect`/`roundRect` constructors — it imports **runtime values** from `core/render/shapes`, so `docs/ARCHITECTURE.md:264` ("data imports core types only") is false.

`seed.ts` builds EP001 "RENT IS DUE" — five scenes, four characters (Nia, Kito, Mama Nia, The Landlord), three environments, poses, expressions, props, 13 audio slots, four dialogue lines in scene 1. It is constructed exclusively from generic document operations, and it validates with zero issues.

`rule3.test.ts` is the load-bearing architectural test: it defines `char.synthetic_tester` inline, drops it into the real seed project, places it, poses it, keyframes it, and renders it — asserting validity, library reuse by id (and that the actor JSON contains no rig part id), palette resolution into actual fill styles, sampling through the ordinary sampler, and a pose change reaching pixels. Six tests, all green.

### 1.10 UI architecture

`App.tsx` is layout only. Components read the store through selectors and mutate only through `commit`. Layout: transport bar, left column (scene list, dialogue panel, asset library), stage, issue panel, timeline.

`Stage.tsx` is the only component touching canvas. It reads `useEditor.getState()` inside the rAF callback rather than subscribing, so advancing the playhead costs zero React renders. It matches the backing store to a capped `devicePixelRatio` and passes `pixelRatio` to the renderer. It redraws **unconditionally every frame** — `docs/ARCHITECTURE.md:69` claims it "skips the frame entirely when nothing has changed"; there is no such check.

Keyboard: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+S are bound in `App.tsx:40-55`. **There is no spacebar binding** — the transport has a Play/Pause button only. `docs/MVP.md:51` claims undo is "not yet wired to keyboard shortcuts", which is false; `docs/MVP.md:94` check 4 correctly relies on Ctrl+Z.

### 1.11 Testing architecture

Vitest 3 + Testing Library, jsdom, `src/test/setup.ts`. 20 files, 243 tests.

- **Pure core** — sampling, sparse keyframes, timeline geometry, transform composition, part resolution, audio plan, audio engine against a fake port, recording predicate
- **Document ops** — `trackOps.test.ts`, `dialogueOps.test.ts`; store behaviour in `editorStore.test.ts`
- **Data** — `seed.test.ts`, `ops.test.ts`, `rig.test.ts`, `rule3.test.ts`, `render.test.ts`
- **UI** — `Stage.test.tsx`, `Timeline.test.tsx`, `DialoguePanel.test.tsx`, `AssetPanel.test.tsx`

`src/test/recordingContext.ts` is the instrument that makes the renderer testable: a `Canvas2DLike` that logs every call. It is the reason determinism, draw order, occlusion and palette resolution are assertable without a browser. Any future renderer or migration work should reuse it rather than invent a second harness.

**Gap:** there is no test file for `invariants.ts` itself. `docs/DATA_MODEL.md:365` cites `src/core/document/invariants.test.ts`, which does not exist. The invariants are exercised indirectly (through `commit`, `parseProject` and `rule3.test.ts`) but never enumerated one by one.

### 1.12 Current roadmap, and the numbering conflict

`docs/ROADMAP.md` currently reads: 0–6 complete, 7 complete, 8 partial, 9 partial, 10 complete, 11 partial, 12 planned, 13 planned, then a post-MVP list of 14–21.

Three problems with it as a forward plan:

1. **It mixes "phase numbers that happened" with "phase numbers that are planned."** Phase 10 is complete and is *animation sampling*; the post-MVP list calls animation depth "Phase 15". Anyone reading the roadmap cannot tell which number means what.
2. **It has no platform track at all.** There is no `Series` phase, no command layer, no plan layer, no AI boundary. The Phase 8 audit identified all of these; the roadmap has not absorbed them.
3. **It stops at AI assistance in a way that implies AI is a near-term item.** It is not. It is Phase 19, behind eight phases of platform work.

Section 24 replaces it with one authoritative sequence and an explicit old→new mapping so nothing is lost.

### 1.13 What already works, what is partial, what is missing

**Works, and must not be rewritten:**

- Pure deterministic renderer with a recording test harness
- Four-layer rig composition with character-independent poses and expressions
- Uniform timeline model covering actors, props, camera, dialogue and audio
- Pure document operations and an enforced single-commit mutation path
- Snapshot undo/redo, one step per gesture
- Versioned serialization with defensive parsing and read-time revalidation
- One clock shared by stage, transport and timeline
- Pure audio plan separated from the Web Audio scheduler
- A seed production built entirely from generic operations
- A fifth character placeable with zero `core/` changes, proven by test
- A downward-only import rule enforced by ESLint

**Partial:**

- Camera (rest state and keyframed moves work; no authoring UI, no presets)
- Preview (scene-looping playback; no episode sequencing)
- Audio (the mechanism is real; no slot has a file and there is no way to attach one)
- Persistence (saves and restores one project; no project lifecycle, no IO, no asset blobs)

**Missing:**

- Export of any kind
- Any asset authoring UI (the library is read-only)
- Project/series lifecycle
- Command layer, plan layer, plan validation, plan compilation
- Provenance
- Review workflow
- Any AI architecture
- Continuity checking
- Reusable animation assets
- Per-frame indexing (F7)
- Undo labels
- Spacebar transport

---

## 2. FINAL TARGET DOMAIN MODEL

### 2.1 The decision rule

An entity is justified only when **all** of these are true:

1. It has data that cannot be expressed as a field or a collection on an existing entity.
2. It has a lifetime independent of its current owner.
3. At least two current or near-term use cases need it.
4. Its absence is costing something measurable today.

Anything failing criterion 1 is a field. Failing 2 is a child record. Failing 3 is speculation.

### 2.2 Entity-by-entity verdicts

| Entity | Exists? | Owner | Referenced by | Persistent | Reusable | Needed now | Verdict |
|---|---|---|---|---|---|---|---|
| **Studio** | **No** | — | — | — | — | No | **Reject.** One installation serves one operator. See §28.1. |
| **Series** | **Yes** | installation | Projects, series-level assets | Yes | Yes | Phase 14 | **Create.** The container that makes `ZANZA` content rather than architecture. |
| **Season** | **No** | — | — | — | — | No | **Reject.** `Episode` already carries ordering, title and `metadata`. See §28.2. |
| **Project** | **Yes** | Series | Episodes, project-level asset overrides | Yes | No | Yes | **Keep, redefined.** The unit of transaction, history, persistence and export. |
| **Episode** | **Yes** | Project | ordered `sceneIds` | Yes | No | Yes | **Keep unchanged.** |
| **Scene** | **Yes** | Project (flat pool) | `Episode.sceneIds` | Yes | No | Yes | **Keep unchanged.** |
| **Shot** | **No** | — | — | — | — | No | **Reject.** Multiple camera shots per scene are already expressible. See §17. |
| **Character** | **Yes** | Series, overridable per Project | `SceneActor.characterId` | Yes | Yes | Yes | **Keep; widen scope.** |
| **Environment** | **Yes** | Series, overridable per Project | `Scene.environmentId` | Yes | Yes | Yes | **Keep; widen scope.** |
| **Prop** | **Yes** | Series, overridable per Project | `SceneProp.propId` | Yes | Yes | Yes | **Keep; widen scope.** |
| **Pose** | **Yes** | Series, overridable per Project | `SceneActor.poseId`, keyframes | Yes | Yes | Yes | **Keep; widen scope.** |
| **Expression** | **Yes** | Series, overridable per Project | `SceneActor.expressionId`, keyframes | Yes | Yes | Yes | **Keep; widen scope.** |
| **Voice** (`VoiceDef`) | **Deferred** | Series | `DialogueLine.voiceAudioId` (via `AudioDef`) | Yes | Yes | No | **Phase 20+.** `DialogueLine.speaker` is a free string today and that is the gap. See §16.4. |
| **Audio** | **Yes** | Series, overridable per Project | clips, `voiceAudioId` | Yes (metadata) | Yes | Yes | **Keep; widen scope.** Blobs are a repository concern, not a document concern. |
| **Animation** (`AnimationAsset`) | **Deferred** | Series | scene clips by id | Yes | Yes | No | **Phase 20+.** See §16. |
| **Style** (`StyleDef`) | **No** | — | — | — | — | No | **Reject for now.** See §28.4. |
| **SeriesBible** | **No** | — | — | — | — | No | **Reject.** See §28.5. |
| **Script** | **No** | — | — | — | — | No | **Reject.** See §28.6. |
| **Asset** (unified type) | **No** | — | — | — | — | No | **Reject.** A discriminated `AssetLibrary` per collection is already type-safe; a unified `Asset` union with a `kind` tag would trade compile-time exhaustiveness for a runtime switch. See §28.3. |

### 2.3 What actually gets added

Only two things are added to the type system in Phase 14, and neither is a new content type:

```ts
/** Persisted at the installation level, not inside any Project. */
export interface SeriesDef {
  id: Id;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  formatVersion: number;
  /** Series-wide asset definitions. A Project may override any of these by id. */
  assets: AssetLibrary;
  metadata: Record<string, string>;
}
```

and the resolution result, which is not persisted at all — it is computed per open:

```ts
/** The merged, read-only view a renderer or document operation actually needs. */
export interface SceneContext {
  assets: AssetLibrary;
  settings: ProjectSettings;
}
```

`SceneContext` is the smallest possible change that makes the renderer series-aware, and §14.1 of the migration plan explains why it is a re-type rather than a rewrite.

### 2.4 The target hierarchy

```
Installation (no entity; a convention — one IndexedDB database, one local operator)
└── Series                        [NEW, Phase 14]
    ├── AssetLibrary              [series-scope, new home for reusable assets]
    ├── Project                   [existing; the transaction unit]
    │   ├── ProjectSettings
    │   ├── AssetLibrary          [project-scope overrides only, Phase 14]
    │   ├── Episode[]             [existing]
    │   └── Scene[]               [existing, flat pool]
    └── Project B, C ...          [coexist; the multi-series gate]
```

---

## 3. SERIES VS PROJECT SEMANTICS

This is the most consequential decision in the specification, because it determines whether ZANZA is the architecture or the first tenant of it.

### 3.1 The three candidate models

```
(a) Series → Project → Episode → Scene     [production-oriented]
(b) Series → Episode → Project → Scene     [broadcast-oriented]
(c) Project → Series (reference) → Episode [asset-oriented]
```

**Model (b) is rejected.** It inverts production reality. A series does not contain episodes that contain projects; a studio produces *projects*, and a project's deliverable is one or more episodes. Putting `Episode` above `Project` would force every project to belong to exactly one episode, which is wrong the moment a project is a season, a short, or a test reel. It also makes the transaction boundary wrong: you would want to undo within a project, and the project would be the wrong granularity.

**Model (c) is rejected** as a primary structure. It makes the series a bag of assets hanging off a project, which is precisely the conflation the audit flagged in the current `Project`. It also has no answer for "show me me all my shows".

### 3.2 The decision

**Model (a). `Series → Project → Episode → Scene`.**

The reasoning, in the order that actually decided it:

1. **It matches the unit of work.** A producer opens a project, works on it for days, exports it, and ships it. Undo history, autosave, export and the `ProjectRepository` interface are all already scoped to exactly that. A Series boundary does not disturb any of them.
2. **It keeps the current `Project` type almost intact.** `Project` becomes a `Series`-scoped record with a narrow override library. Every existing document operation, every existing test, and the seed all continue to work.
3. **It makes `ZANZA` a value, not a type.** The moment `Series` exists, `series.name === 'ZANZA'` is a row. Nothing in `core/` branches on it.
4. **It gives asset reuse a natural scope boundary without a second storage system.** A series owns the reusable assets; a project owns the things that differ for this production. See §4.

### 3.3 The relationships

```
ZANZA                                    [Series]
├── assets                              [series-scope: 4 characters, 3 environments,
│                                        poses, expressions, props, audio slots]
├── EP001 "RENT IS DUE" — Season pass    [Project, Phase 13]
│   ├── assets                          [project-scope overrides: none]
│   ├── Episode 001
│   │   └── sceneIds: [scene_1 .. scene_5]   [Scene lives in Project's flat pool]
│   └── Scene[]                         [5 scenes]
└── PILOT — Art test                     [Project, same Series, different assets]
    └── ...
```

**A note on the seed.** The seed is currently a single `Project` named after the episode. In the target it becomes one `Series` (`ZANZA`) containing one `Project` (`EP001`) holding the same five scenes. Nothing about the scene data changes. This is why the migration is render-neutral.

### 3.4 What `Series` is not

- Not a hard link. Deleting a `Project` must never touch its `Series`.
- Not a version-control boundary. Persistence and history remain per-`Project`.
- Not an authentication or tenancy boundary. There are no accounts (RULE 10).
- Not an export unit. Export is per-`Project`.

### 3.5 Scene ownership across projects

A `Scene` belongs to exactly one `Project`. It may reference assets from its own project or from its series, by id. Two projects in the same series may both reference `char.nia`; neither copies it.

This creates a real problem — **cross-project asset deletion** — which is why `removeAsset` needs a reference check in Phase 14 (§5.5, §32 R6).

---

## 4. ASSET OWNERSHIP

### 4.1 The principle

**An asset is owned at the narrowest scope that can express the variation, and referenced by id everywhere else.**

The current model is correct for one project and wrong for many, because `Project.assets` mixes two jobs: it holds the reusable library *and* it holds per-production overrides. Splitting those jobs is the whole of Phase 14.

### 4.2 Placement table

| Asset | Series-scope | Project-scope | Scene-level | Notes |
|---|---|---|---|---|
| `CharacterDef` | **Primary** | Override | Never | The classic case for series scope: Nia is the same in every episode. |
| `EnvironmentDef` | **Primary** | Override | Never | Same. |
| `PropDef` | **Primary** | Override | Never | Same. |
| `PoseDef` | **Primary** | Override | Never | Poses are character-independent by design, so they are maximally shareable. |
| `ExpressionDef` | **Primary** | Override | Never | Same. |
| `AudioDef` (slot) | **Primary** | Override | Never | Cast voice and recurring stingers belong to the show. |
| `AudioDef` (episode score) | Optional | **Primary** | Never | A cue sheet is per-episode, not per-series. |
| `AnimationAsset` | **Primary** | Override | Never | Phase 20+. Idle, walk, talk — these are the show's vocabulary. |
| `VoiceDef` | **Primary** | Override | Never | Phase 20+. |
| Image/sprite bytes | — | — | — | A repository concern, resolved at load. See §20.4. |
| `SceneActor` placement | — | — | **Yes** | Always scene-level. |
| `SceneProp` placement | — | — | **Yes** | Always scene-level. |
| `DialogueLine` | — | — | **Yes** | Always scene-level. |
| `Track` / `Clip` / `Keyframe` | — | — | **Yes** | Always scene-level. |
| `Camera` rest state | — | — | **Yes** | Always scene-level. |
| Camera presets | Series or Project | Yes | Referenced | Phase 9. Presets are *values*, not assets: `{ name, camera }`. |
| `EnvironmentDef.anchors` | With the environment | — | — | Anchors are part of the set, not the scene. |

### 4.3 The exact rule

1. `Project.assets` in the target contains **only assets that differ from the series**. A project with an empty override library is normal and correct.
2. Resolution is by id, series first, project second: `project.assets.X.find(a => a.id === id) ?? series.assets.X.find(a => a.id === id)`. **Project wins on collision.**
3. Ids are globally unique within a series. `validateProject` must gain the same cross-collection uniqueness check it already performs (`invariants.ts:135-151`), applied to the merged library.
4. **The merged view is computed, never persisted.** Writing the resolved library back into `Project.assets` would re-create the conflation and make the series a decoration.
5. A series asset is never deleted while a project in that series references it. See §5.5.

### 4.4 Why this, and not a separate `AssetRegistry` table

An `AssetRegistry` was considered and rejected. A registry would mean: assets are not in the project, assets are in a table, projects reference assets, and every load resolves through the registry. That adds a second persistence store, a referential-integrity problem across stores, and a resolution step in the hot path — to solve a problem (sharing across projects) that scope-plus-id-resolution already solves, because `Series` *is* the registry.

The registry only becomes justified if assets ever need to be shared **across series**, which is a different product (a stock-art marketplace) and is explicitly out of scope (§28.8).

### 4.5 How `Project.AssetLibrary` evolves

```
v1:  Project { assets: {4 characters, 3 environments, poses, expressions, props, audio},
                episodes, scenes }

v2:  Series  { assets: {everything} }                       [new store]
     Project { assets: {overrides only}, seriesId, episodes, scenes }

The migration for an existing v1 project:
  1. Create Series { id: <derived>, name: project.name, assets: project.assets }
  2. Set Project.assets = emptyAssetLibrary()          [NOT a copy — an empty library]
  3. Set Project.seriesId
  4. Project.scenes, episodes, settings: byte-identical
  5. Assert: renderScene(ctx, {series.assets, project}, scene, t) produces an
     identical draw log to renderScene(ctx, v1Project, scene, t)
```

Step 5 is the migration gate (§33 G4). Because `renderScene` only ever reads `project.assets.*` and `project.settings.*`, a project whose `assets` is the series library renders identically. That is the entire reason the migration is safe.

---

## 5. PROJECT LIFECYCLE

### 5.1 The registries

Two interfaces, in `src/core/persistence/`, both browser-free:

```ts
export interface SeriesSummary { id: string; name: string; updatedAt: string; projectCount: number }

export interface SeriesRepository {
  save(series: SeriesDef): Promise<void>;
  load(id: string): Promise<SeriesDef | null>;
  list(): Promise<SeriesSummary[]>;
  remove(id: string): Promise<void>;
}

/** Widened: takes a seriesId, and can enumerate across series. */
export interface ProjectRepository {
  save(project: Project): Promise<void>;
  load(id: string): Promise<Project | null>;
  list(seriesId?: string): Promise<ProjectSummary[]>;
  remove(id: string): Promise<void>;
  loadMostRecent(): Promise<Project | null>;
}
```

`ProjectRepository` already exists with four of these five members. The only signature change is `list()`, which becomes optional-scope. That is additive for every existing caller.

### 5.2 IndexedDB shape after Phase 14

```
DB: zanza-studio          DB_VERSION: 1 → 2
  ├─ projects   (keyPath id, index updatedAt)      [unchanged shape]
  ├─ series     (keyPath id, index updatedAt)      [new store]
  └─ meta       (keyPath key)                      [keys: lastOpenedProjectId,
                                                      lastOpenedSeriesId]
```

`DB_VERSION` goes 1 → 2 and the `onupgradeneeded` handler gains one `createObjectStore`. Existing records are untouched, which is the correct upgrade behaviour: the project→series promotion is a **record-level** migration applied on read, not a bulk `onupgradeneeded` rewrite, so a user who downgrades does not find their database scrambled.

### 5.3 Store shape after Phase 11

```ts
interface EditorState {
  project: Project | null;        // null = nothing open (the "no project" state)
  series: SeriesDef | null;       // the owning series, or null for a free project
  past: Project[]; future: Project[];

  // transient, unchanged
  playhead, playing, showSubtitles, sceneId, selection, dirty, lastSavedAt;

  // new in Phase 11
  projects: ProjectSummary[];     // populated on demand, not held
  status: { kind: 'idle' | 'loading' | 'ready' | 'error'; message?: string };
}
```

`project: Project | null` is the meaningful change. It forces every consumer to handle "no project open", which is the honest state of a project browser. It will surface a handful of `!` assertions in the UI, and that is the point.

### 5.4 The lifecycle operations

| Operation | Behaviour | Phase |
|---|---|---|
| **Create Series** | New `SeriesDef` with an empty library. Records `lastOpenedSeriesId`. | 14 |
| **Create Project** | Requires a `seriesId` in the target model. `createProject` gains it. New project is not opened. | 11 (no series) → 14 (with series) |
| **Create Episode** | `addEpisode` exists; no UI. Add to the project browser. | 11 |
| **Create Scene** | `createSceneInProject` exists; no UI. Add to the scene list. | 11 |
| **Open** | Load, migrate, validate, set `project`/`series`, reset history, set `sceneId` to a valid scene. | 11 |
| **Close** | Flush autosave, stop playback audio, `project = null`, `past/future` cleared. | 11 |
| **Switch** | `Close` then `Open`. History is **cleared** — a snapshot stack from another document must never be reachable. | 11 |
| **Duplicate** | Deep clone with **fresh ids** for the project, its episodes, its scenes, and every scene-local id (actors, props, dialogue, tracks, clips, keyframes). Asset ids are **kept** — duplicating a project must not duplicate the library. | 11 |
| **Archive** | `Project.metadata.archived = iso`. Hidden from the default list, not deleted. | 11 |
| **Delete** | Confirm, `repository.remove(id)`, remove from list. Never cascades to `Series`. | 11 |
| **Import** | File → `parseProject` → validate → **new id, new name** unless the user chooses keep. | 11 |
| **Export** | `serializeProject` to `.zanza.json`. Media referenced, not embedded. | 11 |
| **Autosave** | Debounced 800 ms; **plus `visibilitychange`/`pagehide` flush** (fixes F4). | 11 |
| **Recover** | On parse failure: **quarantine** the bad record, do not overwrite it, and surface a recovery state. (Fixes F5.) | 11 |

### 5.5 Multi-series coexistence

`ZANZA`, `SHOW_B`, `SHOW_C` coexist because:

- Each is a `SeriesDef` row in the `series` store.
- Each owns `Project` rows in the `projects` store.
- The engine has no knowledge of which series is open. `renderScene` receives a `SceneContext`; it does not know a series exists.
- The project browser lists series → projects. Opening any of them changes only what `SceneContext` is built from.

**Deletion safety.** `removeAsset` currently deletes unconditionally. In the target, a series-level asset deletion must be refused if any project in the series references it, and the refusal must name the referencing projects. A project-level override deletion is always safe (it falls back to the series asset). This is a Phase 14 requirement with a test.

### 5.6 The corruption path, specified

The current behaviour (`editorStore.ts:224-228`) is: catch, warn, fall back to seed, and let the next autosave overwrite the user's damaged project. The target behaviour:

```
load(id):
  1. record = store.get(id)
  2. try { project = parseProject(record.document) }
     catch (error) {
        3. move record to the `quarantine` store, keyed by id + timestamp
        4. record.document is NEVER written again
        5. surface a Recover state: "EP001 could not be opened. A copy of the
           damaged file has been kept at <path>. Open the copy to attempt a repair."
        6. do not open any project; project = null
     }
```

Step 3 is the load-bearing one. Data loss is worse than a failed load, always.

---

## 6. MIGRATION STRATEGY

Specified, not written (F8: `MIGRATIONS` is currently an empty array).

### 6.1 The version ladder

| From | To | Change | Reversible? |
|---|---|---|---|
| v1 | v2 | Introduce `Series`; promote `Project.assets` to `Series.assets`; add `Project.seriesId`. `Scene`, `Episode`, `Track`, `Clip`, `Keyframe` **byte-identical**. | Yes, in principle — but the series row is the only copy, so deletion is the real risk. |
| v2 | v3 | Add `VoiceDef` and `DialogueLine.voiceId`. `voiceAudioId` remains, deprecated but honoured. | Yes. |
| v3 | v4 | Add `AnimationAsset` and `Clip.animationId`. Keyframes stay absolute. | Yes. |

**Migrations are appended, never edited or reordered** (`serialize.ts:88-91` already says this). `CURRENT_FORMAT_VERSION` becomes 2 in Phase 14, 3 in Phase 20, 4 in Phase 21.

### 6.2 Resolving the duplicated version field

`ProjectFile.formatVersion` and `Project.formatVersion` both exist (`types.ts:392`). Nothing reconciles them, and `normaliseProject` overwrites the inner one with `CURRENT_FORMAT_VERSION` regardless of the outer. The v1→v2 migration must:

1. Treat the **outer** `ProjectFile.formatVersion` as authoritative.
2. If the inner value disagrees with the outer, prefer the **outer** and record a `ValidationWarning` — the inner field is the more likely to be wrong in a hand-edited file.
3. Deprecate the inner field in the type in Phase 14 and remove it in Phase 15. It is one field; leaving it is a permanent ambiguity.

### 6.3 The v1 → v2 migration, precisely

Applied to the record's `document` string at read time, in `migrateProject`, purely and identically on every platform.

```
input:  { formatVersion: 1, project: P }
output: { formatVersion: 2, project: P' }

steps:
  1. seriesId = 'series_' + P.id.replace(/^proj_/, '')   // proj_zanza_ep001 → series_zanza_ep001
     Deterministic, so re-running the migration is idempotent.
  2. series = {
       id: seriesId,
       name: P.name,
       description: P.description,
       createdAt: P.createdAt,
       updatedAt: P.updatedAt,
       formatVersion: 2,
       assets: P.assets,                 // moved, not copied
       metadata: {}
     }
  3. P' = { ...P, formatVersion: 2, seriesId, assets: emptyAssetLibrary() }
  4. P'.scenes, P'.episodes, P'.settings: unchanged references, unchanged values
```

**Why `seriesId` is derived and not random:** a project migrated twice, or a project file imported twice, must land in the same series or the user gets two half-shared series. Determinism is a correctness property here, not a convenience.

**Where the series row comes from:** `parseProject` returns a `Project`, but a v1 project implies a series that is not in the project document. Two options:

- (i) `parseProject` returns `{ project, impliedSeries }` — a signature change.
- (ii) A separate `migrateProjectFile(file)` returns `{ series, project }` and `parseProject` keeps its signature by returning only the project, with the series written by a repository-level step.

**Decision: (ii).** `parseProject` is called from three places (`indexedDb.browser.ts:96`, the importer, and tests). Changing its return type for the benefit of one caller is worse than adding one function. `migrateProjectFile` is the new entry point for anything that needs both.

### 6.4 What must not change in the migration

- **No scene id, episode id, or asset id may change.** Every id in a v1 document is a join key that a user may have external references to.
- **No `Keyframe.time` may change.** Keyframes are absolute scene time. The `AnimationAsset` design in §16 deliberately keeps it that way so that v3→v4 requires no keyframe rewrite.
- **No `Project.settings` may change.** `width`, `height`, `fps` are what `renderScene` reads.
- **No track, clip or lane may be reordered.** Ordering is data.

### 6.5 The render-neutrality gate

```
for every scene S in every migrated project:
    logBefore = RecordingContext(); renderScene(logBefore, v1Project, S, t)
    logAfter  = RecordingContext(); renderScene(logAfter,  v2Ctx(S),    S, t)
    assert(logBefore.calls deep-equals logAfter.calls)

for t in {0, 0.5, 1.0, 2.37, S.duration - 0.01, S.duration}
```

Run over all five seed scenes and all time samples. This is the strongest possible evidence that the Series change is a scope change and not a behaviour change, and it is cheap because `RecordingContext` already exists.

### 6.6 What the migration does to tests, seed and content

- **Tests.** All existing tests continue to pass unmodified except any that assert on `project.assets` population. `src/data/*.test.ts` builds on `SEED_PROJECT`; in the target, `SEED_PROJECT` becomes a fixture that returns `{ series, project }` and a helper `sceneContext()` so the renderer tests pass the merged view. Test *intent* is preserved; call sites need the new fixture shape. This is a mechanical change with a reviewable diff.
- **Seed.** `src/data/seed.ts` builds the asset library and the scenes separately today. It should build them separately forever: `seedSeries()` produces the series library, `seedProject(seriesId)` produces the project. This makes "ZANZA is content" literal in the code that defines ZANZA.
- **Existing user records.** Migrated lazily on read. A v1 record is never rewritten until it is opened, and the migration is idempotent, so a read that crashes mid-way costs nothing.
- **Docs.** `docs/DATA_MODEL.md` becomes "the v1 model" plus a delta. `docs/ROADMAP.md` is replaced by §31's table. See Appendix A.

---

## 7. COMMAND ARCHITECTURE

### 7.1 Why a command layer at all

The document operations are already good: 114 pure functions, uniformly typed, individually testable. A naive command layer would be a second vocabulary for the same thing, and the audit's real complaint was not "there are no commands" — it was that there is no *stable, named, serializable* seam between "a thing that wants to change the document" and "the document operations".

The command layer exists for exactly three consumers:

1. **The UI.** Today every panel builds a `next` document by hand and calls `commit`. A command gives that gesture a name, a parameter object, and one place to validate its arguments.
2. **The plan compiler.** §11 needs to emit a value that can be previewed, reviewed, serialised, and diffed. A `Project` is too large; an inline function call cannot be logged. A command is the right size.
3. **The review UI.** A preview must be able to say "this plan adds 3 scenes, 2 assets and 14 dialogue lines". A command list can be summarised by reading the command kinds.

It does **not** exist to replace the operations. Every command is a thin, named, validating wrapper over one or more existing operations.

### 7.2 What becomes a command, and what stays an operation

**Becomes a command** — anything a user, a plan, or a script performs as a *meaningful, nameable act*:

| Command | Maps to |
|---|---|
| `CreateScene` | `createSceneInProject` |
| `DeleteScene` | `deleteScene` (+ cascades the caller must supply) |
| `DuplicateScene` | `duplicateScene` |
| `SetSceneCamera` | `setSceneCamera` |
| `SetSceneDuration` | `setSceneDuration` |
| `UpdateScene` | `updateScene` |
| `PlaceCharacter` | `placeCharacter` |
| `SetActorPose` | `setActorPose` |
| `SetActorExpression` | `setActorExpression` |
| `SetActorTransform` | `setActorTransform` |
| `BindActorToAnchor` | `bindActorToAnchor` |
| `AddSceneProp` | `addPropToScene` |
| `SetPropTransform` | `setPropTransform` |
| `AddDialogueLine` | `addDialogueLineWithCue` |
| `SetDialogueLine` | `updateDialogueLine` |
| `SetDialogueCue` | `setDialogueCue` |
| `DeleteDialogueLine` | `removeDialogueLine` |
| `AddTrack` / `RemoveTrack` / `MoveTrack` | `addTrack`, `removeTrack`, `moveTrack` |
| `AddClip` / `RemoveClip` / `MoveClip` / `TrimClip` | `addClip`, `removeClip`, `moveClip`, `trimClip` |
| `AddKeyframe` / `MoveKeyframe` / `UpdateKeyframe` / `RemoveKeyframe` | same names |
| `SetClipGain` | `setClipGain` |
| `AddAsset` / `UpdateAsset` / `RemoveAsset` | `addAsset`, `updateAsset`, `removeAsset` |
| `CreateEpisode` / `UpdateEpisode` / `DeleteEpisode` | `addEpisode`, `updateEpisode`, `removeEpisode` |
| `AddSceneToEpisode` / `RemoveSceneFromEpisode` / `ReorderEpisodeScene` | same names |

**Stays an internal operation** — everything else:

- `factories.ts` — `createProject`, `createScene`, `createActor`, `createKeyframe`, `emptyAssetLibrary`, `defaultCamera`, … These are construction helpers, not user acts.
- `lookups.ts` — all 25 functions. Pure reads. A read is not a command and must never appear in one.
- `invariants.ts` — `validateProject`, `isProjectValid`.
- `touch` — an internal bookkeeping stamp applied by the commit pipeline, not by a caller.
- `replaceScene`, `mapScene`, `sortClips`, `sortKeyframes`, `pruneKeyframesToClip`, `snapToEdges`, `findOrCreateTrack`, `episodeScenes`, `episodeDuration`, `scenesOfEpisode`, `clipEnd`, `subtitleFor`, `environmentAnchors`, `bringActorToFront` — helpers, either derived or invoked by another command.

**Rule of thumb:** if a UI button or a plan step can cause it, it is a command. If only another command or an operation can cause it, it is not.

### 7.3 The interfaces

```ts
// src/core/commands/types.ts

/** Every command is a plain serialisable value. No functions, no classes. */
export interface Command {
  /** Stable discriminant. Never renamed; a rename is a breaking change. */
  readonly kind: string;
  /** Caller-supplied label for history and review. Optional. */
  readonly label?: string;
}

export type CommandContext = {
  project: Project;
  /** Merged asset view. Phase 14+. */
  assets?: AssetLibrary;
  /** Injectable id allocator. The ONLY source of new ids in a command fold. */
  allocate: (prefix: string) => Id;
  /** ISO timestamp provider. Injectable so a fold is deterministic in tests. */
  now: () => string;
};

export type CommandResult =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly error: CommandError };

export interface CommandError {
  code: CommandErrorCode;
  message: string;
  /** Dotted path into the document, for the issue panel. */
  path?: string;
}

export type CommandErrorCode =
  | 'not-found'        // the target id does not exist
  | 'invalid-argument' // wrong type, out of range, negative duration
  | 'conflict'         // id already taken, illegal state transition
  | 'invalid-result';  // the operation succeeded but the document is now invalid
```

```ts
// One module per command kind, or one registry. See §7.4.
// src/core/commands/registry.ts

export type CommandHandler = (command: Command, ctx: CommandContext) => CommandResult;

/** kind -> handler. The single dispatch point. */
export const COMMAND_REGISTRY: ReadonlyMap<string, CommandHandler>;

/**
 * Apply one command. Pure: never mutates `ctx.project`, never touches
 * Zustand, IndexedDB, Canvas, the DOM, Date, or crypto.
 */
export function applyCommand(command: Command, ctx: CommandContext): CommandResult;

/**
 * Apply a sequence. Atomic: the first failure returns the *original* project
 * with the failure, and no intermediate document is ever observable.
 */
export function applyCommands(commands: readonly Command[], ctx: CommandContext): CommandResult;
```

### 7.4 Why ids and time are injected

This is the difference between a command layer that can be tested and one that cannot.

- `createId` uses `globalThis.crypto.getRandomValues` (`id.ts:12`). A command that creates a scene generates a random id, so two identical folds produce different documents and a plan preview cannot be compared to the applied result.
- `applyCommands` therefore takes `allocate` and `now` from its context. In production the caller passes `createId` and `() => new Date().toISOString()`. In tests, and **in the plan preview**, it passes a deterministic counter and a fixed clock.

Consequence: `previewPlan(plan, project)` and `applyPlan(plan, project)` run the *same* fold with the *same* allocator seed and produce the *same* document. The preview is therefore not an estimate — it is the result. This is the single most important property in the whole plan architecture, and it is why §11 requires determinism from the compiler down.

### 7.5 Where commands live

`src/core/commands/`. They are pure functions over the document, so they belong in `core` beside `document/`. The eslint tier rule already permits this: `commands` sits at tier 1 like `document`.

Commands must **not** import from `state`, `ui`, or `ai`. A command that needed the store would be a UI action, not a command.

### 7.6 What the UI does with commands

```
before:  const next = setActorPose(project, sceneId, actorId, poseId);
         commit(next, 'Change pose');

after:   const result = applyCommand(
           { kind: 'SetActorPose', sceneId, actorId, poseId, label: 'Change pose' },
           context,
         );
         if (result.ok) commit(result.project, 'Change pose');
         else reportIssue(result.error);
```

The behavioural difference is small and the architectural difference is not: the command is a *value*. It can be recorded in history, shown in a preview list, serialised into a plan, logged, diffed, and replayed. The operations cannot.

### 7.7 Command coverage is a gate, not a promise

The risk with a command layer is drift: someone adds a UI control that calls an operation directly, and the command vocabulary quietly stops describing what the editor can do. That drift is exactly what would make the plan layer wrong later.

**Gate G6 (§33):** every `commit()` call site outside `src/core/` must be reachable from at least one command, and every command must be reachable from a UI or a plan. A test walks the import graph of `src/ui/**` and fails on any direct import of a `document/*Ops` module that is not a read-only lookup. Enforced by the lint rule, not by review.

---

## 8. TRANSACTION MODEL

### 8.1 The five granularities

| Granularity | Unit of undo | Implementation |
|---|---|---|
| **Single command** | one `commit()` | `applyCommand` + `commit` |
| **Batch (gesture)** | one `commit()` for the whole gesture | the caller accumulates locally, commits once on release (the pattern `Timeline.tsx` already uses correctly) |
| **Plan transaction** | one `commit()` for the whole plan | `applyCommands` + one `commit` |
| **Undo / redo** | one snapshot step | existing `past`/`future` |
| **Rollback** | none needed | a failed fold returns the *original* project, so there is nothing to roll back |

**The invariant that makes this work:** a transaction is *not* a list of undo steps. It is one pure fold that produces one new document, followed by one `commit`. Undo granularity and mutation granularity are therefore the same thing, and a plan is undoable in a single keystroke regardless of how many operations it contains.

This is the requirement from the brief — *"an AI-generated plan should be applied as one understandable, reviewable, undoable production transaction"* — and the existing snapshot history already satisfies it. **No new undo machinery is needed.** What is needed is that nothing is committed in the middle.

### 8.2 The lifecycle

```
   Plan (JSON, untrusted)
        │
        ▼
   1. VALIDATE      PlanValidator  ── errors  ──▶ stop; nothing was touched
        │
        ▼
   2. COMPILE       PlanCompiler   ── throws  ──▶ stop; nothing was touched
        │
        ▼
   3. PREVIEW       applyCommands(plan.commands, ctx) with the deterministic allocator
        │             ├─ diff(project, preview)     ── what changes
        │             ├─ issuesFor(preview)         ── what it will break
        │             └─ commands[]                 ── what it will do
        │
        ▼
   4. APPLY         commit(preview, label)   ◀── exactly one commit
        │
        ▼
   5. UNDO          Ctrl+Z restores the entire pre-plan document
```

Steps 1–3 are side-effect free and can be run repeatedly, on a copy, as often as the user likes. Step 4 is the only mutation. There is no step 4a.

### 8.3 Failure semantics

**There is no partial application, and this is enforced by construction, not by discipline.**

`applyCommands` is a fold:

```ts
export function applyCommands(commands: readonly Command[], ctx: CommandContext): CommandResult {
  let project = ctx.project;
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    if (command === undefined) continue;
    const result = applyCommand(command, { ...ctx, project });
    if (!result.ok) {
      // The ORIGINAL project, not the partially-folded one. Nothing is observable.
      return { ok: false, error: { ...result.error, path: `commands[${i}].${command.kind}.${result.error.path ?? ''}` } };
    }
    // Belt and braces: an operation that returns an invalid document is a bug, and
    // the same rule `commit` already applies in dev.
    const issues = validateProject(result.project);
    if (issues.length > 0) {
      return { ok: false, error: { code: 'invalid-result', message: `${command.kind} produced an invalid document`, path: `commands[${i}] ${issues[0]?.path ?? ''}` } } };
    }
    project = result.project;
  }
  return { ok: true, project };
}
```

Because each operation is pure and returns a *new* document, the intermediate documents are unreachable garbage. There is no "already written to the database" state to roll back, because nothing is written until `commit`, and `commit` receives only the final document.

**Three failure classes, three behaviours:**

| Class | Example | Behaviour |
|---|---|---|
| **Rejected** | The plan names a character that does not exist | Never reaches the engine. `PlanValidator` reports it; the compiler is not run. |
| **Failed** | Two commands in the plan conflict — the second deletes what the first created | `applyCommands` returns `ok: false` with the failing index. The project is untouched. The user sees which command failed and can edit the plan. |
| **Refused** | The fold succeeds but `validateProject` reports issues | Same as failed, with code `invalid-result`. This is a bug in the command, and the message says so. |

### 8.4 Undo semantics

One `commit` per plan means:

- `past` gains exactly one entry, regardless of plan size.
- Ctrl+Z restores the whole pre-plan state, including any scene deleted by the plan.
- The autosave is scheduled once, not once per operation.
- A 200-command plan costs the same to undo as a 1-command edit.

**This is why the plan layer must not loop `commit()` itself.** That single rule is the difference between "AI changed the show" and "AI changed 200 things and I cannot get back".

### 8.5 What a transaction is not

- **Not a database transaction.** There is no multi-store write. `save()` writes one record.
- **Not resumable.** If the fold fails, the plan is not partially applied and not resumable — the user edits it and re-runs.
- **Not concurrent.** One open project, one editor, one transaction at a time. There is no optimistic-concurrency check, because there is no second writer. This changes the moment there is a backend (RULE 10), and the repository interface is where it will change.

### 8.6 Labels and provenance

`commit(next, label)` currently uses `label` only for a dev error message (`editorStore.ts:156`). It is discarded. In Phase 16 it is stored:

```ts
export interface HistoryEntry {
  label: string;
  project: Project;
  provenance: Provenance;
}
```

The history type changes from `Project[]` to `HistoryEntry[]`, which is a mechanical widening. `docs/ARCHITECTURE.md:80` already documents a `HistoryEntry` type that has never existed; this is where it becomes true.

The payoff: the undo dropdown can say "Undo: Add dialogue line (AI, gemini/claude-3.5)" instead of "Undo". That is the difference between an AI feature a user trusts and one they do not.

---

## 9. PLAN ARCHITECTURE

### 9.1 Which plans exist

The brief proposes `ProductionPlan → EpisodePlan → ScenePlan`. Evaluate all three:

| Plan | Verdict | Reasoning |
|---|---|---|
| **`ScenePlan`** | **Yes — the only one built in Phase 17** | It is the only granularity where every referenced id already exists and is checkable, and the only one whose output is a bounded, reviewable, undoable set of commands. |
| **`EpisodePlan`** | **Deferred, but shaped for now** | An episode plan is a *sequence* of scene plans plus a cut order. It is not a different mechanism, so it does not need to exist before `ScenePlan` does. Building it first would mean building a coordinator before its only component. |
| **`ProductionPlan`** | **Deferred** | Same argument, one level up. |

**Decision:** define the *envelope* for all three now, implement the leaf first. Concretely: `Plan` is a discriminated union with one variant today, and the union is designed so adding `EpisodePlan` later is additive.

```ts
export interface PlanEnvelope {
  /** Schema version of the plan format itself, separate from the document's. */
  planVersion: 1;
  kind: 'scene' | 'episode' | 'production';
  /** Free-form human title. Never used for identity. */
  title: string;
  /** Where this plan came from. Optional in every field (RULE 9). */
  provenance?: Provenance;
  /** The plan this one was derived from, if any. Enables review lineage. */
  parentPlanId?: string;
  createdAt: string;
  body: unknown;      // narrowed by `kind`; see ScenePlan below
}
```

Storing `body: unknown` with a `kind` discriminant is deliberate at this stage: it keeps `parsePlan` total and the union extensible, and it means a v2 plan with an unknown `kind` produces a clean `unsupported plan kind` error rather than a crash.

### 9.2 `ScenePlan`

The one plan that is built:

```ts
export interface ScenePlan {
  /** Existing scene to modify. Omit together with `newScene` to create. */
  sceneId?: Id;
  /** Create a new scene instead. */
  newScene?: {
    name: string;
    environmentId: Id;
    duration: number;
    backgroundColor?: string;
  };

  /** Character and prop staging. Order is significant: it determines z. */
  cast?: CastEntry[];

  /** Dialogue, in intended order. Compiler assigns cue timing if omitted. */
  dialogue?: PlannedLine[];

  /** Camera intent. Either an explicit move or a named preset. */
  camera?: PlannedCamera;

  /** Reusable animation requests. Phase 20+; accepted and ignored before then. */
  animation?: PlannedAnimation[];

  /** Explicit timing overrides for generated cues. */
  timing?: { dialogueStart?: number; dialogueGap?: number };
}

export interface CastEntry {
  /** Which character this is. Resolved against the merged asset library. */
  characterId: Id;
  /** Optional display name override; defaults to the character's name. */
  displayName?: string;
  poseId?: Id;
  expressionId?: Id;
  /** Either an anchor from the environment, or a free transform. */
  anchorId?: Id;
  transform?: Partial<Transform2D>;
  z?: number;
  flipX?: boolean;
  /** Expression changes over the scene, as { at, expressionId } steps. */
  expressionChanges?: { at: number; expressionId: Id }[];
}

export interface PlannedLine {
  speaker: string;
  /** Which cast entry delivers it. Resolved by displayName or characterId. */
  actorRef: string;
  text: string;
  emotion: string;
  subtitle?: string;
  /** Explicit cue window. Omit and the compiler lays it out. */
  start?: number;
  duration?: number;
  voiceId?: Id;
}

export interface PlannedCamera {
  /** An explicit move, or a preset name resolved against camera presets. */
  preset?: string;
  keyframes?: { at: number; x?: number; y?: number; zoom?: number; rotation?: number; ease?: EaseType }[];
}
```

### 9.3 Invariants every plan must satisfy

1. **A plan is JSON.** `JSON.parse(JSON.stringify(plan))` is a no-op. No functions, no classes, no `undefined`, no cycles, no `Date` objects.
2. **A plan never contains a rig, a palette, a shape, or a definition.** Only ids. If a plan could carry a `CharacterDef`, the asset-reuse invariant would be one AI hallucination away from being broken.
3. **A plan names ids; it does not create asset ids.** Assets are created by explicit `AddAsset`-class commands, which are themselves a plan kind when needed — but a `ScenePlan` may only *reference* existing asset ids. This is the single strongest safety property in the design.
4. **References are by stable id, never by index or array position.** A plan authored against scene 3 must still mean scene 3 after an unrelated edit.
5. **Optional fields are genuinely optional.** A plan that omits `duration` is not a request for the current duration; it is a request for the compiler's default. Absent and explicit must be distinguishable — hence `?:` on a field whose value can itself be `null` is banned. Use `undefined`-absent and `null`-explicit only where `null` is a legal value in the document.
6. **Provenance is optional everywhere.** A plan authored by a human, or by a test fixture, carries no provider and no model.

### 9.4 Provenance

```ts
export interface Provenance {
  /** Who or what authored this. 'ai' is a role, not a product. */
  actor: 'human' | 'ai' | 'system' | 'import';
  /** Optional. Absent for human edits. */
  provider?: string;   // 'anthropic', 'openai', 'local', ...
  model?: string;      // free-form; never parsed
  /** ISO 8601. */
  at: string;
  /** Free text. The user's note on their own edit, or the prompt summary. */
  note?: string;
}
```

`provider` and `model` are **optional strings with no union type and no validation against a known list.** A new provider appearing tomorrow must not require a schema change. This is what "provider-agnostic" means in practice, and it is also why `Provenance` must never be a foreign key to a provider table.

### 9.5 Storage

Plans are **not persisted in the project document.** They are:

- held in a transient UI store while under review,
- optionally written to a `plans` object store (Phase 18) as `{ id, planVersion, envelope }` JSON for the review history,
- and discarded once applied, except for the `Provenance` that gets stamped onto the resulting history entry.

**Why not in the document:** a plan is an *instruction*, not a *fact*. The document records what is true after the plan ran, not what was asked for. Putting instructions in the document would mean every render and every validator has to ignore half of it.

### 9.6 `parsePlan`

```ts
export type PlanParseError =
  | { code: 'not-json'; message: string }
  | { code: 'unknown-kind'; kind: string }
  | { code: 'schema'; path: string; message: string }
  | { code: 'unsupported-version'; planVersion: number };

/** Total: never throws, never returns a partially-valid plan. */
export function parsePlan(input: string | unknown): Result<PlanEnvelope, PlanParseError>;
```

Total, because it is the first thing that touches untrusted input. See §23.2.

---

## 10. PLAN VALIDATION

### 10.1 Why a separate validator

`validateProject` answers *"is this document structurally sound?"* — the mechanical invariants, run on load, on commit, and on every fold step.

`PlanValidator` answers a different question: *"is this instruction executable against this project?"* — before anything has been executed. The distinction matters:

| | `validateProject` | `PlanValidator` |
|---|---|---|
| Input | a `Project` | a `Plan` + a `Project` + a merged `AssetLibrary` |
| Question | is the result sound? | is the request valid? |
| Runs | on load, on every commit, after every command | once, before compiling |
| Failure | throws / refuses the commit | reports to the user, changes nothing |
| Knows about | the document | ids the document does not contain yet |

They must not be merged. A merged validator would have to reason about half-built documents, and would end up either too strict (rejecting a legitimate intermediate) or too loose (letting a broken one through).

### 10.2 The interface

```ts
export type Severity = 'error' | 'warning' | 'info';

export interface PlanDiagnostic {
  severity: Severity;
  /** Dotted path into the plan, e.g. `dialogue[2].actorRef`. */
  path: string;
  code: DiagnosticCode;
  message: string;
  /** A fix the compiler or the user could apply. Advisory only. */
  hint?: string;
}

export type DiagnosticCode =
  | 'missing-character' | 'missing-environment' | 'missing-pose' | 'missing-expression'
  | 'missing-prop' | 'missing-voice' | 'missing-anchor' | 'missing-audio'
  | 'unknown-actor-ref' | 'unknown-scene' | 'unknown-series' | 'unknown-preset'
  | 'invalid-timing' | 'invalid-duration' | 'negative-value' | 'out-of-range'
  | 'duplicate-id' | 'unknown-field' | 'cycle'
  | 'pose-incompatible' | 'voice-incompatible' | 'style-mismatch' | 'wardrobe-mismatch';

export interface PlanValidation {
  ok: boolean;                       // true iff there are zero 'error' diagnostics
  diagnostics: PlanDiagnostic[];
  /** Ids the plan references, resolved. Feeds the compiler and the diff. */
  resolved: ResolvedPlanReferences;
}

export function validatePlan(
  envelope: PlanEnvelope,
  ctx: { project: Project; assets: AssetLibrary },
): PlanValidation;
```

### 10.3 What it checks

**Reference existence** — every id the plan names resolves in the merged library or the document: `characterId`, `environmentId`, `poseId`, `expressionId`, `propId`, `voiceId`, `anchorId` (against the chosen environment's anchors, not globally), `sceneId`, `preset`.

**Reference compatibility** — the checks the current `validateProject` does not do:

- A `PoseDef`'s slots all exist as slots on the `CharacterDef`'s rig. A pose that keys `wingL` on a character with no such part is inert; that is legal but worth an `info`.
- A `PoseDef` that keys *no* slot the character has is a `warning` — it will render as a no-op, and that is almost always a mistake.
- `DialogueLine.actorRef` resolves to a cast entry in the same plan.
- A camera `preset` resolves, and the preset's frame is compatible with the environment's authored size.
- A `voiceId` belongs to the same series as the character. (`Series` is Phase 14; before then, a `warning`.)

**Timing** — the plan's times must fit the scene: `0 ≤ at ≤ scene.duration`; a `newScene.duration` must be positive and within a sane bound; an explicitly-requested dialogue cue must not overlap its predecessor beyond a configurable tolerance; a generated layout must fit inside `newScene.duration` or the compiler must extend it and say so.

**Structural** — a plan that both sets `sceneId` and `newScene` is an `error`; a `ScenePlan` with neither is an `error`; a `cast` entry with neither `anchorId` nor `transform` gets the scene's default placement (`info`, not an error); an unknown top-level field is a `warning` (forward compatibility), but an unknown field inside `transform` is an `error` (typo).

### 10.4 Severity semantics

- **`error`** — the plan cannot be executed as written. Compilation does not run. Nothing is touched. A plan with one error is not applied.
- **`warning`** — the plan is executable but almost certainly not what was meant. It **applies**, and the warning is shown in the preview and attached to the history entry. Blocking here trains users to click past warnings.
- **`info`** — a note. "No dialogue was specified; the scene will be silent." Never blocks, rarely worth a dialog.

The distinction between `warning` and `error` is a product decision with teeth: **anything that can be executed without corrupting the document is a warning.** Errors are for "this cannot happen".

### 10.5 Known limits, stated honestly

The continuity codes in `DiagnosticCode` — `pose-incompatible`, `voice-incompatible`, `style-mismatch`, `wardrobe-mismatch` — are **declared but not implemented** in Phase 17. §15 explains why. They exist in the type so the first continuity check does not require a breaking change to the diagnostic vocabulary, and they must be documented as unimplemented until they are not (RULE 9).

---

## 11. PLAN COMPILER

### 11.1 The contract

```ts
/**
 * Plan -> commands. Pure, total on valid input, deterministic.
 *
 * Never mutates its input. Never allocates an id itself. Never reads a clock.
 */
export function compilePlan(
  envelope: PlanEnvelope,
  ctx: { project: Project; assets: AssetLibrary },
): CompileResult;

export type CompileResult =
  | { ok: true; commands: Command[]; warnings: PlanDiagnostic[]; assumptions: Assumption[] }
  | { ok: false; diagnostics: PlanDiagnostic[] };

/** A decision the compiler made that the author did not specify. Shown in preview. */
export interface Assumption {
  path: string;      // into the plan
  decision: string;  // 'dialogue cue at 2.40s, duration 1.60s'
  reason: string;    // 'estimated from 28 characters at 4.2 syllables/second'
}
```

`Assumption` is the honesty mechanism. The prompt says AI should never silently change production; the same is true of the compiler. Every value the compiler invented is listed, reviewable, and attached to the resulting history entry.

### 11.2 The pipeline

```
ScenePlan
   │
   ├─ resolve cast entries      ── ids → concrete actor references
   ├─ lay out dialogue          ── explicit windows, or estimated from text length
   ├─ build camera keyframes    ── explicit, or preset → keyframes
   ├─ order by dependency       ── create before modify; reference before delete
   ▼
Command[]                          ← the ONLY thing the engine ever sees
   │
   ▼
applyCommands(commands, ctx)        ← pure fold, §8.3
   │
   ▼
Project                             ← one new document
   │
   ▼
commit(project, label)              ← one undo step
```

### 11.3 The compiler's hard rules

1. **No imports from `state`, `ui`, `ai`, `data`, or any browser API.** `src/core/commands/compile.ts` may import only `core/commands`, `core/types`, `core/document` (lookups and constants) and `core/constants`.
2. **No `Date`, no `crypto`, no `Math.random`.** Ids come from `ctx.allocate`; timestamps from `ctx.now`. This is what makes the compiler a pure function and is enforced by the ESLint restricted-globals rule added in Phase 17.
3. **Deterministic ordering.** Commands are emitted in a fixed order determined by the plan, never by object-key iteration order, `Set` order, or sort instability. Sorting is always `a.id < b.id` or an explicit index.
4. **Total on a validated plan.** A validated plan always compiles. If compilation can fail on a validated plan, the validator and the compiler disagree, and that is a bug in one of them with a test.
5. **No `Plan → Project`.** There is no shortcut that builds a document directly. Every change goes through a named command, so the plan's effect is always describable as a command list.

### 11.4 Rule 5, restated as an architectural test

The compiler's output is `Command[]`. `Command` is a discriminated union of plain data. `applyCommands` is a pure fold. Therefore:

> There is no code path by which an AI plan can reach the document without passing through the same validation and the same operations the UI uses.

The AI layer cannot bypass the engine, because the engine is the only thing that can produce a `Project`, and the only thing that can call the engine is `applyCommands`.

### 11.5 Determinism, and why the preview can be exact

`compilePlan` is deterministic by construction. `applyCommands` is deterministic **given the allocator** (§7.4). Therefore:

```ts
// In the review UI, on every re-render, with a fixed seed:
const seed = makeCountingAllocator();
const compiled = compilePlan(plan, ctx);
const previewed = applyCommands(compiled.commands, { ...ctx, allocate: seed });

// On Apply — the SAME fold, the SAME seed, from the SAME project:
const seed2 = makeCountingAllocator();
const applied = applyCommands(compiled.commands, { ...ctx, allocate: seed2 });
```

`previewed.project` and `applied.project` are `===` deep-equal. **The preview is the result, not an estimate of it.** A "Confirm" button that shows something different from what lands is the fastest way to destroy trust in an AI feature, and it is structurally impossible here.

### 11.6 A worked example

```jsonc
// A ScenePlan, as JSON. This is literally the wire format.
{
  "planVersion": 1,
  "kind": "scene",
  "title": "EP001 s2 — Nia overhears the plan",
  "provenance": { "actor": "ai", "provider": "anthropic", "model": "claude-sonnet-4", "at": "2026-09-29T10:00:00Z" },
  "createdAt": "2026-09-29T10:00:00Z",
  "body": {
    "newScene": { "name": "Overheard", "environmentId": "env.apartment", "duration": 12 },
    "cast": [
      { "characterId": "char.nia", "anchorId": "anchor.nia_couch", "poseId": "pose.sittingSofa", "z": 10 },
      { "characterId": "char.kito", "anchorId": "anchor.kitchen", "poseId": "pose.standing", "z": 20,
        "expressionChanges": [ { "at": 4.0, "expressionId": "expr.worried" } ] }
    ],
    "dialogue": [
      { "speaker": "NIA", "actorRef": "char.nia", "text": "You're not building an empire.", "emotion": "flat" },
      { "speaker": "KITO", "actorRef": "char.kito", "text": "I'm building a *very* good napkin.", "emotion": "defensive", "start": 3.0 }
    ],
    "camera": { "keyframes": [ { "at": 0, "x": 960, "y": 540, "zoom": 1 }, { "at": 12, "x": 900, "y": 520, "zoom": 1.2, "ease": "easeInOut" } ] }
  }
}
```

compiles to, in this order:

```
1  CreateScene            { name, environmentId, duration, backgroundColor }
2  PlaceCharacter         { sceneId, characterId, poseId, anchorId, z }        → nia
3  PlaceCharacter         { sceneId, characterId, poseId, anchorId, z }        → kito
4  AddDialogueLine        { sceneId, speaker, actorId, text, emotion, start, duration }
5  AddDialogueLine        { ... }
6  AddKeyframe            { actor kito, t: 4.0, expressionId: 'expr.worried' }
7  SetSceneCamera         { x: 960, y: 540, zoom: 1 }                          (rest)
8  AddSimpleClip          { kind: 'camera', start: 0, duration: 12 }
9  AddKeyframe            { camera, t: 0,  x, y, scaleX: 1,   ease: 'linear' }
10 AddKeyframe            { camera, t: 12, x, y, scaleX: 1.2, ease: 'easeInOut' }
11 AddSceneToEpisode      { episodeId, sceneId }
```

Plus three `Assumption`s the author did not specify: the two estimated dialogue cue windows, and the default background colour. All three appear in the preview. Nothing else is invented.

---

## 12. AI BOUNDARY

### 12.1 The dependency direction, restated

```
        UI          AI layer
          \          /
           \        /
            \      /
             \    /
              State
                |
              Core
                |
             (nothing)
```

The AI layer depends on the **plan and command vocabulary** and on nothing else. It never imports from `core/document`, never calls a document operation, never touches the store, the repository, the canvas, or the DOM. Its single output is a `PlanEnvelope`.

The load-bearing test is not a lint rule — lint rules can be path-patterned around. It is that **no module under `src/ai/**` can produce a `Project`**, because `applyCommands` is the only function that returns one and it lives in `core`. If `src/ai/**` cannot import it (or only its type), the boundary holds structurally.

### 12.2 Module layout

```
src/ai/
├── types.ts              PlanEnvelope re-export, AICapability, AIRequest, AIResponse
├── provider/
│   ├── AIProvider.ts     the interface. No vendor name anywhere.
│   ├── nullProvider.ts   returns `{ unavailable: true }`. The default. Always present.
│   └── <vendor>.browser.ts   one file per provider, added when needed
├── prompts/              prompt templates as data, not code. Versioned.
├── capabilities/
│   ├── scenePlanner.ts   the first and only capability (§13)
│   └── registry.ts       capability name -> { buildRequest, parseResponse }
└── index.ts              the only import surface the UI is allowed to use
```

### 12.3 The provider interface

```ts
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
  /** Provider-reported token counts if available. Optional. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AIProvider {
  /** Stable identifier, e.g. 'anthropic'. Not a type. Not an enum. */
  readonly id: string;
  /** Models this provider can serve, for the settings UI. */
  models(): Promise<string[]>;
  complete(request: AIRequest): Promise<AIResponse>;
  /** Whether credentials are configured. Never returns the credential. */
  isConfigured(): boolean;
}
```

**No provider name appears in a type, a switch, a default, or a test fixture that the engine depends on.** `id` is a string. `models()` is a list. Adding Gemini means adding one file under `src/ai/provider/`, and touching no other file.

### 12.4 The default is no AI

`nullProvider` is the default, is always registered, and reports `isConfigured() === false`. When no provider is configured:

- No AI affordance renders, or it renders disabled with an honest reason.
- Every code path that would call a provider short-circuits.
- **The editor behaves identically.** This is gate G3 (§33) and it is verified by deleting `src/ai/**` and re-running the full suite.

### 12.5 Credentials

- Credentials live in `localStorage` under a namespaced key, or in the OS keychain if one is available. Never in a document, never in a `SeriesDef`, never in a `Project`, never in an exported file.
- A project exported from a machine with credentials configured must not carry them. §20.3's export filter enforces this as a test, not as a convention.
- `isConfigured()` reports a boolean. There is no accessor that returns the secret to application code, so a bug in the AI layer cannot exfiltrate it into a plan, a log, or a document.

### 12.6 Capability vs agent

**A capability is a named, single-purpose, stateless transformation with a typed input and a typed output. An agent is a loop with memory and tool access.**

The brief's diagram implies agents. This specification builds capabilities only. An agent becomes justified when a task needs *sequential* decisions that depend on the results of earlier decisions — for example, "plan the episode, then look at what the scene plan needs, then go and plan those." That is a Phase 22+ concern and is explicitly out of scope (§28.7).

Building an agent framework first would mean inventing a tool-permission model, a memory model, and an iteration budget, all for a single-shot task that does not need any of them.

### 12.7 The seven roles, evaluated

| Role | Verdict | Phase |
|---|---|---|
| **AI Showrunner** (`idea → episode breakdown`) | Deferred | After `EpisodePlan` exists. It is a `kind: 'episode'` plan. Needs no new architecture. |
| **AI Writer** (`script → dialogue`) | Deferred | Needs a `Script` entity, which is rejected (§28.6). Revisit only if a Script entity is ever justified. |
| **AI Director** (`scene plan` → `ScenePlan`) | **This is the first one.** | 19 |
| **AI Asset Director** (`need a character who is X` → asset recommendations) | Deferred | Recommend-only, no commands. Needs `AnimationAsset` and `VoiceDef` to be useful. |
| **AI Voice Director** (cast voices) | Deferred | Needs `VoiceDef`, Phase 20+. |
| **AI Audio Director** (music cue sheets) | Deferred | Needs an audio mixdown model, Phase 20+. |
| **AI Continuity** (cross-scene checking) | Deferred | Needs the continuity engine, Phase 20+. §15. |

Every one of these is the *same mechanism* with a different prompt and a different plan kind. That is the point: the AI layer is one narrow pipe, not seven subsystems.

---

## 13. FIRST AI CAPABILITY

### 13.1 The candidates, compared

The brief asks not to rank but to explain. Here they are on the axes that decide it.

| Candidate | Inputs available today | Output compiles today? | Value if it fails | Architecture impact | Verdict |
|---|---|---|---|---|---|
| **AI Scene Planner** | Every scene, asset, pose, expression, prop and the whole rendered frame are addressable. The plan vocabulary is fully specified. | **Yes** — `ScenePlan` in §9.2 maps 1:1 to existing commands. | A reviewer sees a staged, timed, lit scene and edits it like any other edit. **Failure is visible and useful.** | Introduces the entire plan pipeline: parse, validate, compile, preview, apply, undo. Which is the architecture we want anyway. | **Build first.** |
| **AI Episode Planner** | Episode, scene order, duration, render settings. | No — needs `EpisodePlan` (§9.1). | A scene list. Failure is invisible: a bad breakdown looks like a good breakdown. | Same as above, plus a coordinator layer. | After Scene. |
| **AI Shot Planner** | Camera rest state and camera clips only. | No — `Shot` is rejected (§17.3). | Preset names. | Would require the `Shot` entity or a preset system that does not exist yet. | **Blocked** on Phase 9. |
| **AI Dialogue Generator** | Characters, cast, existing lines, text. | Partially — `PlannedLine` compiles, but a line without a cast entry has nothing to attach to. | Prose. | Small. | **Blocked** on the scene planner, because dialogue is a *field of* a scene plan. It is a Phase 19.5 refinement, not a separate capability. |
| **AI Asset Resolver** | The merged library, tags, descriptions. | No — it would have to *create* assets, which means generating rigs, palettes and poses. | A list of names. | Large and dangerous: it is the one capability that can break RULE 2. | **Rejected as a first capability.** It is also a prompt-injection target: an AI that can author `CharacterDef` can author anything. |
| **AI Character Blocking** | Anchors, transforms, z. | Yes, mechanically — it is a subset of `ScenePlan.cast`. | Positions. | None, but it is a *fragment*: a blocking with no dialogue, no camera and no timing is not a scene, and reviewing a fragment trains the reviewer to rubber-stamp. | Folded into Scene Planner. |

### 13.2 The decision

**The first capability is the AI Scene Planner**, and the previous audit's recommendation is confirmed — but for a stronger reason than "it is the natural next step."

> The Scene Planner is first because it is the only capability whose *output is a complete, renderable, reviewable unit of creative work*, and because building it forces the entire plan pipeline — which is the only thing the other six capabilities need. Every other candidate either produces a fragment nobody can judge, or produces something that cannot be compiled yet.

The strongest argument is the negative one: **AI Asset Resolver is the capability most likely to be built first by accident**, because "have the AI make me a character" is the most obviously compelling demo. It is also the one that would do the most damage, because the first thing it does is break the rule that a scene may only reference assets. It must come last, and it must never be able to emit a command that creates an asset without a human in the loop (Phase 19.5, a per-capability `maxSeverity: 'warning'` ceiling).

### 13.3 The capability's architecture

```ts
// src/ai/capabilities/scenePlanner.ts
export interface ScenePlannerInput {
  seriesId: Id;
  /** Which episode, if any, the scene is for. */
  episodeId?: Id;
  /** A natural-language brief from the user. Untrusted. */
  brief: string;
  /** Asset ids the plan must draw from. Empty means "you may choose". */
  permittedCharacterIds?: Id[];
  permittedEnvironmentIds?: Id[];
  /** Reference material: the previous scene's plan, a script excerpt. Optional. */
  context?: { previousSceneId?: Id; scriptExcerpt?: string; styleNotes?: string };
}

export interface ScenePlannerResult {
  plan: PlanEnvelope;          // kind: 'scene'
  raw: string;                 // what the model actually returned, verbatim
  refusal?: string;            // the model declined. An acceptable outcome.
}
```

`refusal` is a first-class result. A model that says "I can't write a scene for this brief" is a *good* outcome that the UI must render honestly, not an error to be retried in a loop.

The flow:

```
brief (untrusted string)
   │
   ▼
buildScenePlannerRequest(input)         pure. Produces a prompt + a JSON schema hint.
   │                                    The prompt embeds the permitted asset ids as
   │                                    DATA, inside clearly delimited blocks.
   ▼
provider.complete(request)              ── provider is a string id, not a type
   │                                    ── the key comes from the keychain, never from here
   ▼
parsePlan(response.text)                TOTAL. No throwing, no partial plans.
   │
   ├─ parse failure ─────────────────▶ "the model did not return a plan" (honest error)
   │
   ▼
validatePlan(plan, { project, assets })
   │
   ├─ errors ────────────────────────▶ show them; nothing is touched; suggest a retry
   │
   ▼
compilePlan(plan, ctx)                  deterministic, no ids allocated yet
   │
   ▼
applyCommands(commands, ctx)            the exact preview, with the exact allocator
   │
   ▼
render the previewed project at 3 times  ◀── THE REVIEW GATE
   in a side-by-side with the current
   │
   ▼
human edits the plan (a plan editor, not a
document editor) ──▶ re-validate ──▶ re-preview
   │
   ▼
APPLY ── one commit, one undo
```

**The three-times preview is deliberate.** A plan's failure modes are *staging* (who is where), *timing* (when does anyone speak), and *camera* (what is framed). Three stills at 10%, 50% and 90% of the scene catch all three, at negligible cost, and they catch them before apply rather than after undo. Rendering the preview costs nothing beyond one extra `renderScene` per still, because the renderer is pure and takes any document.

### 13.4 Why the plan is editable before it is applied

The plan editor is a form over `ScenePlan`, not over the document. This matters:

- Editing a plan re-validates and re-previews **without** adding an undo step, so a reviewer can iterate freely.
- Editing the *document* after applying means one undo step per tweak, and the AI's structure is already committed.
- A plan that is edited by a human and then applied is a `human`-provenance plan, and it gets human provenance in the history entry. §14 depends on this.

The alternative — apply, then fix in the document — is the "AI changed my show and I am now cleaning up" experience, and it is precisely what the brief's "human review" requirement is trying to prevent.

---

## 14. HUMAN-IN-THE-LOOP

### 14.1 The review workflow

```
  1. GENERATE   the model returns a plan; nothing is mutated
  2. VALIDATE   PlanValidator reports; errors block, warnings do not
  3. PREVIEW    compile + fold, then render 3 stills, side by side with the current scene
  4. EDIT       the user edits the PLAN — cast order, lines, timing, camera
  5. RE-VALIDATE / RE-PREVIEW   automatic on every edit; no undo step
  6. APPLY      one commit
  7. UNDO       one keystroke restores the entire pre-plan state
```

Steps 1–5 are free of side effects and repeatable. Step 6 is the only mutation. Step 7 is the existing snapshot history.

### 14.2 How the UI communicates authorship

Three distinct, visible states, per the brief. Concretely, in the scene list and the review panel:

| Badge | Meaning | Where it comes from |
|---|---|---|
| `AI` (accent colour) | This was proposed by a model, with `provider/model` in a tooltip | `Provenance.actor === 'ai'` |
| `Edited` (neutral) | A human changed an AI-proposed value | Plan field touched after generation |
| `System` (muted) | Generated by a tool, not a person: export, import, migration, asset-import | `Provenance.actor === 'system' \| 'import'` |

**A badge is not a log.** It is an honest, glanceable statement about how a value came to exist, and it must be impossible to display "AI" for something a human wrote. That means provenance is attached at the point of *provenance assignment*, not inferred from context.

### 14.3 Provenance metadata: the design

Two levels, and the distinction is the important part.

**Level 1 — the transaction.** The history entry records who caused the whole change:

```ts
{
  label: 'Apply AI scene plan: "Overheard"',
  provenance: { actor: 'ai', provider: 'anthropic', model: 'claude-sonnet-4', at: '...' }
}
```

**Level 2 — the individual field.** A `DialogueLine` or a `SceneActor` records who authored it:

```ts
interface DialogueLine {
  // ...existing fields...
  provenance?: Provenance;      // omitted for a human edit made in the editor
}
```

Level 2 is what makes a badge honest. Without it, "this whole scene is AI" would be false the moment a human retimed one line, and the badge would be a lie the UI tells 400 times an episode. With it, the badge is per-line:

- AI proposed, human never touched → `AI`
- AI proposed, human changed the timing → `Edited` (and `Edited` is the truth, because the value in the document is the human's)
- Created in the editor by a person → no badge at all

**Cost:** one optional field per record that a human can author, and it is `undefined` for 100% of human work today, so it costs nothing until the first AI plan runs. It is a Phase 19 change, not a Phase 16 one, and it is listed as such.

**`provider` and `model` stay optional strings.** The brief asks for exactly this. `Provenance` never becomes a foreign key, and the `Edited` badge is computed by comparing `provenance` to the plan's original value, not by looking up a provider registry.

### 14.4 What the review UI must never do

- **Never auto-apply.** There is no setting, preference, or "trusted mode" that skips review. A capability's ceiling is a hard gate in Phase 19.5, not a user preference.
- **Never apply on `ok: true` alone.** `ok` means "no errors", not "good". A plan that stages Nia facing the wall validates perfectly.
- **Never show a diff the user cannot act on.** If the preview says "adds 14 dialogue lines", the user must be able to click through to each one. A summary count alone is not review.
- **Never discard the raw response.** `ScenePlannerResult.raw` is kept for the review record. It is the only way to debug "why did it suggest that" and it is a UX affordance, not just a debugging one.

---

## 15. CONTINUITY SYSTEM

### 15.1 The problem, stated precisely

`validateProject` is **intra-document**: every reference inside one project resolves. It cannot see questions that need two scenes, two episodes, or two projects:

- Is Nia in two places at once across a cut?
- Does she wear the same outfit at the end of episode 1 and the start of episode 2?
- Is the couch she is sitting on the couch that exists?
- Does the landlord speak in a language his character does not speak?
- Is the style of scene 4 consistent with the show?

### 15.2 Which layer each check belongs in

Three layers, and putting a check in the wrong one is how continuity systems become unmaintainable.

| Layer | Runs | May reference | Cost | May use AI |
|---|---|---|---|---|
| **core validation** (`validateProject`) | every load, every commit | one project | microseconds | **Never** |
| **continuity engine** (new, pure) | on demand, on export, on episode change | one project's scenes, plus the series library | milliseconds | **Never** |
| **AI continuity** | on demand, user-initiated | anything, including script text | seconds, network | Yes |

**The rule: a check that can be expressed over the document is a continuity-engine check, not an AI check.** AI is for the checks that need *judgement* — is this dialogue funny, does this reading match Kito's established voice. A rule like "Nia appears in scene 3 but not in the scene her dialogue continues from" is arithmetic and must never be a prompt.

### 15.3 The continuity engine

Pure, in `src/core/continuity/`, no AI, no I/O.

```ts
export interface ContinuityContext {
  project: Project;
  assets: AssetLibrary;          // merged; may include the series library
  /** Scene-local overrides the user has explicitly authorised for a check. */
  acknowledged: ReadonlySet<string>;   // finding ids the user has dismissed
}

export interface ContinuityFinding {
  id: string;                    // stable, so dismissal sticks across edits
  severity: 'error' | 'warning' | 'info';
  check: ContinuityCheckId;
  path: string;                  // e.g. 'scenes[2].actors[0]'
  message: string;
  evidence?: { sceneId: Id; at?: number };
}

export type ContinuityCheckId =
  | 'character-presence'         // a character speaks in a scene they are not in
  | 'character-wardrobe'         // appearance changed without a marked change
  | 'prop-continuity'            // a held prop disappears between adjacent scenes
  | 'location-continuity'        // a scene's environment is not in the series library
  | 'prop-possession'            // a character holds a prop they never picked up
  | 'timeline-overlap'           // one actor animated in two concurrent clips
  | 'pose-applicability'         // a keyed pose has no effect on that rig
  | 'voice-consistency'          // a line's speaker has no recorded voice
  | 'subtitle-availability'      // a line has neither a recording nor a subtitle
  | 'style-consistency';         // reserved; requires StyleDef. Not implemented.

export function checkContinuity(ctx: ContinuityContext): ContinuityFinding[];
```

`acknowledged` is load-bearing. A continuity check that reports a finding the user has already decided about is a check the user turns off entirely, so dismissal must survive edits — which is why findings have stable ids derived from content, not array indices.

### 15.4 When each check runs

| Trigger | Checks |
|---|---|
| Every `validateProject` | none — it stays intra-document and fast |
| `validate` button / issue panel | all `warning`+`info` checks |
| Before export | all checks, including `error` |
| On scene change | checks scoped to that scene and its neighbours |
| User request, with AI | all checks plus judgement checks |

`error`-severity continuity findings **block export** only after a human has seen them. They never block a `commit` — a `commit` must never be rejected for a creative continuity reason, or the editor becomes unusable for iterative work.

### 15.5 What is deferred and why

- **Language and localization** (`style-consistency` partially) need a `Script`-adjacent concept of a line's language and a subtitle track model. Deferred to the same phase as `VoiceDef`.
- **AI continuity** needs the engine above, plus a capability that can *read* dialogue and judge it. It is a Phase 20+ capability, and it is recommend-only: it produces findings and suggestions, never commands.
- **`Shot` continuity** does not exist because `Shot` does not exist (§17.3).
- **Wardrobe** needs a wardrobe model — an `AppearanceDef` pairing a character with a set of palette overrides and a prop set. That is a real entity with a real use case (a character changes outfit), and it is **not** in Phase 19. It is in Phase 20+, because the first episode of ZANZA does not need it and the model should be designed when there is a scene that requires it.

### 15.6 The honest state

**None of the continuity checks above are implemented.** The engine, the finding type, and the check ids are specified so the Phase 20+ work has a target, and so `PlanValidator`'s diagnostic vocabulary does not need a breaking change (§10.5). Until they exist, the issue panel shows `validateProject` output only, and no document may claim otherwise (RULE 9).

---

## 16. ANIMATION ASSETS

### 16.1 The current problem

Animation is scene-local. A walk-in performed in scene 1 is re-authored in scene 5. This is the one place the system's reuse thesis is broken, and it is the reason the ROADMAP's "Animation Depth" phase is real work rather than polish.

### 16.2 The design

```ts
export interface AnimationAsset {
  id: Id;
  name: string;
  description: string;
  tags: string[];
  /** Which character this clip is authored for, or null if generic. */
  characterId: Id | null;
  /** Loop points. Drives the timeline UI and preview. */
  loop: boolean;
  /**
   * One or more lanes. A lane names a rig slot; a keyframe overrides that slot,
   * exactly as PoseDef does. This is AnimationAsset's only job.
   */
  lanes: AnimationLane[];
  duration: number;
}

export interface AnimationLane {
  /** A rig slot name, e.g. 'armL', 'legR', 'root'. */
  slot: string;
  keyframes: { at: number; props: SlotOverride; ease: EaseType }[];
}
```

**Keyed on `slot`, not on `PartDef.id`.** This is forced by the existing design and it is the right call: `PartDef.slot` is already a free-form string precisely so that a pose written for `armL` works on any character that has an `armL` part. An animation asset must honour the same contract, or it would need per-character variants for everything, which is exactly the duplication this phase exists to remove.

### 16.3 The relationship to existing types

| Type | Role | Changed? |
|---|---|---|
| `CharacterDef.rig: PartDef[]` | the skeleton an animation is authored against | No |
| `PoseDef` | a static set of slot overrides — the *rest* of an animation | No |
| `AnimationAsset` | a *timed* set of slot overrides, reusable | **New** |
| `Keyframe` | scene-time, with a `KeyframeTarget` (transform + pose + expression) | **No** |
| `Clip` | a placed instance on a scene track | Gained one optional field |
| `Track` | unchanged | No |

```ts
// The one field added to Clip:
animationId?: Id;      // -> AnimationAsset. Lanes are resolved at sample time.
```

### 16.4 The two-representation problem, and the decision

There are now two ways to animate an actor: a scene `Clip` with scene-time `Keyframe`s, and an `AnimationAsset` with clip-relative lanes. Converting between them needs a choice, and the choice is the design.

**Decision: `AnimationAsset` keyframe times are relative to the clip start. Scene `Keyframe` times stay absolute. Conversion happens at resolution time, not at storage time.**

```
An AnimationAsset placed at scene time T on a clip [S, S+D):
    sampleAnimation(asset, t)  ->  for each lane, sample its keyframes at (t - S)
                               ->  merge into a SlotOverride map
                               ->  applied as a fourth override layer, below keyframe
```

Why relative:

- The same asset placed at any time, any number of times, needs no rewriting. That is what "reusable" means.
- Authoring a clip once and dragging it to 40s must not require touching keyframes. The existing `moveClip` already shifts keyframes (`trackOps.ts`), and that would have to be extended for every asset type.

Why not convert to absolute on placement:

- It would make every placement a document mutation of the asset's data, which means `AnimationAsset` is no longer immutable, which means undo of a move is lossy, which means §8's single-snapshot undo starts needing special cases.
- It would require a v3→v4 keyframe rewrite, which §6.4 forbids.

**Consequence, and it must be documented:** the effective override order for an animated actor becomes five layers:

```
rest  <-  pose  <-  expression  <-  animation lanes  <-  scene keyframes
```

The animation layer sits **above pose and expression** (so an animation can drive a limb) and **below keyframes** (so a keyframe always wins, which is what an animator expects when they add a manual override). `resolveRig` gains one more optional parameter, and the existing three-layer path is unchanged when it is absent.

### 16.5 Slot applicability, checked at validation time

An `AnimationAsset` that keys a slot a character does not have is inert for that character. This is legal — it is how a shared asset is authored once and used across differently-rigged characters. But it must be **visible**:

- `validateProject` gains a check: for every scene actor with an animation clip, at least one keyed slot exists on the character's rig. A `warning` otherwise.
- This is the same shape as the `pose-incompatible` check in §10.3, and it is the check that makes F2 (the hardcoded `'mouth'` slot) impossible to reintroduce.

### 16.6 The list, and what is explicitly not built

Built in Phase 21: `AnimationAsset` authoring (as a JSON document operation first, UI later), placement, sampling, validation, and the timeline representation.

**Not built, and requiring a specific signal:**

- **A marketplace or plugin format.** Signal: two independent installations needing to exchange animation assets with assets *other than* characters. A `Series` scope already covers the realistic case.
- **IK, bone hierarchies, skinning.** Signal: a scene that cannot be staged with slot transforms. The limited-animation model is a deliberate MVP constraint (`docs/MVP.md:59`), not an oversight.
- **A graph editor.** Signal: keyframe density in a real episode exceeding what a lane list can author. Until then the existing per-lane editing is sufficient and a graph editor is a large surface for a small gain.
- **Onion skinning.** Cosmetic; independent of this architecture and can ship whenever.
- **Motion capture, retargeting, blending between assets.** Signal: production volume that makes hand-keying the bottleneck. Blending specifically requires a canonical pose space, which the current slot-override model does not have, and retrofitting one is a large change with no current need.

---

## 17. CAMERA ARCHITECTURE

### 17.1 What exists now

- `Scene.camera: { x, y, zoom, rotation }` — the rest framing.
- A `camera` track whose `targetId` is the literal `'camera'` and whose clips carry keyframes.
- `resolveCamera(scene.camera, clips, time)` merges them, with `zoom` stored as `scaleX` on the track for transform compatibility (`sample.ts:222`).
- Rendering: fit the environment frame into the viewport, then apply the camera on top (`render.ts:105-116`).
- Status: `partial`. It works, and nothing exposes it.

### 17.2 The design: presets, not a Shot entity

```ts
export interface CameraPreset {
  id: Id;
  name: string;
  description: string;
  tags: string[];
  camera: Camera;
  /** Optional recommended framing for a given environment size. */
  authoredFor?: { width: number; height: number };
}
```

Presets are **values, not assets**. They are not in `AssetLibrary`, they are not referenced by id from a scene, and they are copied into the scene when chosen. This is a deliberate rejection of abstraction: a preset that is referenced rather than copied means a series-level edit to "the wide two-shot" silently changes 300 finished scenes, and a preset that is copied means the scene is self-describing. For a production tool, self-description wins.

**Series or project scope?** Both, in the sense that they live in the same place assets live: series-scope in the target model, project-scope today. A project can override a series preset by name. The distinction is invisible to the camera panel, which lists resolved presets.

**Shot presets are named, not typed.** "Wide two-shot", "Over the shoulder", "Insert on the mug", "Push in on Nia" are `CameraPreset` rows. There is no `Shot` type because there is no data a `Shot` would hold that a `camera` clip does not already hold.

### 17.3 Multiple shots per scene, without a `Shot` entity

**Yes, and it already works.** A scene with a cut from a wide to a close-up is:

```
camera track
├── clip A  start 0.0  duration 4.0   keyframes → wide
└── clip B  start 4.0  duration 6.0   keyframes → close-up
```

`resolveCamera` merges active clips with later-start-wins, and `sampleTarget` already handles the case where clip A and clip B do not overlap. Two camera clips with a hard boundary is a cut. Overlapping clips with matched values is a dissolve. The model expresses both with no new entity and no code change.

**When a `Shot` entity becomes justified — the specific signal, not "it sounds useful":**

A `Shot` is justified when **a shot must be addressable, named, and enumerable as a unit of work** — that is, when the editor needs to answer questions the current model cannot:

1. "List every shot in this episode with its duration and its coverage status." Currently unanswerable: a camera clip is not enumerable as a shot because the model does not define what starts a shot (a new camera clip? a cut point? a camera-key discontinuity?).
2. "This shot needs a retake / an alt / a pickup." Requires shot identity.
3. "Shot 4 is over 8 seconds." Requires shot identity and a boundary rule.
4. "Two characters must not be in the same shot unless…" Requires a *membership* concept — which characters are in frame.

Signal 4 is the one that will actually force it, because it needs a membership set a camera clip does not carry. Signals 1–3 are conveniences. **Add `Shot` when continuity needs shot membership, not before.** §15.5's `Shot` continuity check is gated on this, which is the correct dependency order.

### 17.4 Camera authoring — Phase 9

Build order:

1. **A camera panel** exposing the rest framing as four numbers (x, y, zoom, rotation) with a numeric input per field, committing on blur. This is the same discipline the dialogue panel already uses, and it is one undo step per field.
2. **Preset list**, resolved from series + project, applied as a `SetSceneCamera` + camera clip write.
3. **Keyframe authoring on the camera lane** — already possible via the timeline; the panel's job is to make the channel discoverable.
4. **A "frame the selection" affordance** that computes a camera fitting the selected actors' bounds. This is a *pure* calculation in `src/core/animation/` or `src/core/document/` and is the single highest-value camera feature: it converts the rest-framing guesswork into one click.
5. **`zoom` is `scaleX`.** The camera panel must not expose the implementation detail. A `SetCameraZoom` command writes `scaleX` on the track; the panel shows "zoom". Do not add a `zoom` field to `KeyframeTarget` in Phase 9 — it is a v3 schema change for a cosmetic gain.

### 17.5 The renderer gap, honestly

`render.ts:115` scales by `camera.zoom * fit`, and the environment parallax at `render.ts:240` uses camera x/y directly. A camera move therefore parallaxes the environment but **not** anything drawn outside the environment frame, because there is nothing else to draw. That is correct today and will need a real background solution in the art-pipeline phase, at which point parallax and camera clipping must be revisited together. Flagged, not scheduled.

---

## 18. RENDERER EVOLUTION

### 18.1 What must not change

- `renderScene` stays a pure function with no retained state.
- It stays content-blind. Zero show-specific identifiers, now and after every phase.
- The draw order contract stays: background → environment → lighting → depth-sorted actors and props → subtitles.
- `RecordingContext` stays the test harness.
- No engine. RULE 11, and Canvas 2D is the right answer for a document-driven editor with a handful of shapes per part.

### 18.2 Must fix (Phase 15)

**R1 — `scaleY` is dropped (F1).** `render.ts:175` and `render.ts:207` read only `scaleX`. Fix: pass a distinct `scaleX` and `scaleY` into `ResolveRigOptions`, and honour both. This is a bug fix with a regression test (`scaleY: 0.5` on an actor must produce a `ctx.scale(x, 0.5)` call in the log), not a feature.

**R2 — The talk pulse is keyed to the literal `'mouth'` (F2).** Fix: add `mouthSlot: string` to `CharacterDef`, defaulting to `'mouth'` in `normaliseProject` so no migration is required for existing documents, and have `resolveRig` compare `part.slot === options.mouthSlot`. A character with a differently-named mouth part becomes animatable, and a character with no mouth part is silent rather than wrong. This is the same class of defect as `if (character.id === 'nia')` and it is fixed for the same reason.

**R3 — `resolveColor` fails silently (F3).** Fix: add `validateProject` checks that every `PartDef.colorKey` either resolves in its own palette or parses as a colour the Canvas accepts. A `warning` at authoring time, an `error` at load time. The fallback itself stays — a literal colour is a legitimate `colorKey` — but the *typo* must be reported rather than rendered as black.

**R4 — No per-frame index (F7).** Fix: build a `RenderIndex` once per `(project, scene)` identity change, not per frame.

```ts
export interface RenderIndex {
  characters: Map<Id, CharacterDef>;
  poses: Map<Id, PoseDef>;
  expressions: Map<Id, ExpressionDef>;
  props: Map<Id, PropDef>;
  environment: EnvironmentDef | null;
  /** track kind -> targetId -> clips. Replaces the per-target track scan. */
  tracksByKindTarget: Map<TrackKind, Map<Id, Clip[]>>;
  /** Dialogue clips sorted by start, with their resolved lines. */
  dialogue: { clip: Clip; line: DialogueLine; start: number; end: number }[];
  /** actorId -> is speaking. Computed once per frame, not once per actor. */
  speaking: Set<Id>;
}
```

`resolveRenderIndex(context, scene)` is pure, memoised by the caller on a `(context, sceneId, documentRevision)` key, and turns the render loop's `O(actors × assets)` and `O(actors × clips)` into `O(1)` lookups. This is a pure-function refactor with no behaviour change, and the determinism test proves it.

**R5 — The image branch is dead.** `render.ts:362` draws only if `options.images[part.id]` exists, and no caller passes `images`. Fix: either (a) an `ImageResolver` in `options` with a documented contract and a `core`-side test, or (b) delete the branch until the art pipeline needs it. **Decision: (b) for Phase 15, (a) with the art pipeline.** A dead code path in a "pure, no I/O" core is a liability, not a feature. `docs/ARCHITECTURE.md:196` claiming "the renderer already handles both" is corrected here.

**R6 — Stage redraws unconditionally.** `Stage.tsx:69` calls `renderScene` every rAF. Fix: skip when `(project, scene, playhead, showSubtitles, dpr, size)` are all unchanged. `docs/ARCHITECTURE.md:69`'s claim becomes true.

### 18.3 Should fix (Phase 15 or 16, in this order)

**R7 — `scaleY` on a *part* is already correct.** `drawParts` does `ctx.scale(part.scaleX, part.scaleY)` (`render.ts:339`) and `ResolvedPart` carries both. R1 is about the *instance* level only; the part level works. Do not "fix" it twice.

**R8 — Subtitle styling is hardcoded** (`render.ts:66-68`, `'#05070c'`, `'#f4f6fb'`, `MAX_SUBTITLE_WIDTH_RATIO`). Fix: move to `ProjectSettings` as a `subtitleStyle` object with today's values as the defaults, so an existing document renders identically. Also: subtitles should support a two-line stack, because a ZANZA line can exceed one line's width and `fillText` with `maxWidth` currently squashes it horizontally instead of wrapping.

**R9 — `Lighting` opacity constants are hardcoded** (0.28 ambient, 0.18 overlay, 0.85 vignette cap, 0.75 radius multiplier). Fix: fields on `Lighting` with those defaults. Same rule — defaults must reproduce today's pixels exactly.

**R10 — Environment layer sort allocates per frame** (`render.ts:234`: `[...environment.layers].sort(...)`). Fix: sort in the `RenderIndex`. Free, and it is one of the few per-frame allocations in the loop.

### 18.4 Future enhancement — explicitly not scheduled

| Enhancement | Signal that justifies it |
|---|---|
| **Strokes** (`PartDef.stroke?: { colorKey, width }`) | A style guide that specifies ink lines. Adds a `strokeStyle`/`lineWidth` per shape, which interacts with `pivot` and `scale`. ~30 lines when wanted. |
| **Gradients** on parts | A background or lighting need that flat fills cannot express. |
| **Real sprite/background support** | The art pipeline. Needs `ImageResolver`, atlasing, and a `core`-side seam. Not before then. |
| **Layer clipping / off-frame culling** | Measured frame time above budget on a real episode. Do not add speculatively — see §22. |
| **A second renderer** (WebGL) | A measured failure of Canvas 2D against the frame budget, on a real production, with a profile. Not a preference. |

**Strokes are the one item worth pre-designing**, because `ShapeDef` and `PartDef` are the two types every other future change touches. Adding `PartDef.stroke` is additive and optional, and doing it alongside the art pipeline rather than before avoids touching `PartDef` twice.

### 18.5 The determinism gate for all of the above

Every renderer change in §18.2 and §18.3 must pass:

1. **Render neutrality.** For the v1 project and the v2 migrated project, the draw logs are identical (§6.5).
2. **Determinism.** Same input, same log (`src/data/render.test.ts:32` already asserts this; it must keep passing through every renderer change).
3. **Golden logs for the acceptance scene** at the five times in `docs/MVP.md` §1, committed as fixtures. A change to the renderer that alters a golden log is either intended (update the fixture with a written reason) or a regression. Making the golden log *diffable in review* is what turns this from a tautology into a test.
4. **Content blindness.** A grep gate: `nia|kito|zanza|sheng|nairobi|2097|proj_` must not appear in `src/core/**`. `docs/ARCHITECTURE.md` claims zero occurrences today; keep it automated rather than asserted.

---

## 19. AUDIO ARCHITECTURE

### 19.1 What exists, and what is genuinely good

The separation is correct and should be preserved exactly:

```
audioPlan(project, scene) -> AudioSegment[]     pure, deterministic, no browser
        │
        ▼
AudioEngine(port, resolver)                      scheduler, 600ms lookahead
        │                                          testable via a fake AudioPort
        ▼
audioChannel.ts                                   store clock -> engine
        │
        ▼
recording.ts hasRecording()                      the one "is it missing" predicate
```

The engine never keeps its own clock. It is fed the store's `playhead`. Picture and sound cannot drift because there is only one time source. This is a better design than most production tools have and it must not be disturbed.

### 19.2 The two real defects

**D1 — the stale engine (F6).** `audioChannel.ts:16-22` caches the engine module-globally and constructs it from the first project's `assets.audio`. Consequences: switching projects plays the old project's mapping; attaching a recording to the current project is invisible to the engine; a `null` return for a missing file is cached forever, so attaching a file later still plays silence (`audioEngine.browser.ts:145` caches `null`).

Fix: the engine is owned by the store, not by a module. It is constructed on `hydrate`/`open` from the open project's assets, disposed on `close`, and the buffer cache is invalidated when the audio asset set changes. `stopPlaybackAudio` should not construct an engine either — it currently does, via `getEngine`, on a pause before anything ever played.

**D2 — one `AudioContext` per decoded file.** `createFetchingResolver` constructs a new `AudioContext` inside the resolver (`audioEngine.browser.ts:176`) and never closes it. Ten voice lines means ten audio contexts. Fix: one context per engine, created in the engine's constructor, closed in `dispose()`. This is a leak, not a style issue — browsers cap live contexts (Chrome around six, historically) and the failure mode is audio that silently stops working.

### 19.3 Scope: what audio belongs to

| Element | Scope | Reasoning |
|---|---|---|
| Cast voice takes, stingers, recurring SFX, theme music | **Series** | The show's identity. Reused in every episode. |
| Episode score cues, one-off SFX, ambience beds | **Project** | A cue sheet is per-production. |
| Clip placement, gain, mute, timing | **Scene** | Already correct. |

So audio is **not** global, **not** scene-scoped, and **not** purely series-scoped. It is a two-scope asset with scene-level instances — the same rule as every other asset (§4.2), applied to the one asset that also has binary payloads.

### 19.4 Missing pieces, and where they go

| Piece | Phase | Notes |
|---|---|---|
| **Attach a file to a slot** | 11 | Closes the Phase 8 gate. `AudioDef.src` is already a string; the UI writes it through `commit`. This is the single highest-value audio work: it is what makes the whole Phase 8 mechanism demonstrable. |
| **Where the bytes live** | 11 | A blob store. See §20.4. |
| **Per-line gain, fades** | 20+ | `Clip.gain` exists. Fades need a `gainEnvelope` on the clip. |
| **Ducking** | 20+ | A `DuckingRule` in project settings, resolved in `audioPlan` — pure, so it is testable. Ducking belongs in the *plan*, not the engine: the engine has no opinion about which source should duck which. |
| **A real mixdown** | 12 | Export. `OfflineAudioContext` renders the same `AudioSegment[]` deterministically and faster than real time. The plan is already pure, so mixdown is mostly a consumer of existing code. |
| **`VoiceDef`** | 20+ | `DialogueLine.speaker` is a free string and `voiceAudioId` points at a generic `AudioDef`. `VoiceDef` gives a speaker an identity, a default take, a language and a character. It needs a `DialogueLine.voiceId` (v2→v3, §6.1). |
| **Phoneme mouth shapes** | 20+ | Out of MVP scope by decision (`docs/MVP.md:59`). Not an architecture blocker. |

### 19.5 The mixdown and the export interaction

`audioPlan` returns windows on a *scene* timeline. Export needs a window on an *episode* timeline. That is an offset, not a redesign:

```
episode time = sceneOffset[i] + sceneTime
```

and `audioPlan` is called per scene with that offset applied to each segment. This belongs in a new pure module `src/core/audio/episodePlan.ts`, which is also what Phase 10's episode-sequential playback needs. **Build it in Phase 10, use it in Phase 12.** One function, two consumers.

---

## 20. PROJECT IO

### 20.1 The format decision

**Two formats, with different jobs. Not one format pretending to do both.**

| Format | Job | Contents |
|---|---|---|
| **`.zanza.json`** | interchange, versioning, backup, review | The complete `{ formatVersion, project }` document, plus — in the target model — an inline `{ formatVersion, series }` header. No binary media. Media is referenced by path with a declared `missing` state. |
| **`.zanza.pack`** (ZIP) | moving a production between machines | `manifest.json`, `project.zanza.json`, `series.zanza.json` (if the series has project-scoped siblings), `audio/<audioId>.<ext>`, `images/<partId>.<ext>`, `README.txt` |

`Project.serialize` already produces the JSON (`serialize.ts:38`). Phase 11 ships `.zanza.json` import and export. The ZIP format is **Phase 20+** — it is only worth building when a production actually has media, and today every audio slot is `src: null`, so a ZIP would contain a manifest and nothing else.

**Rationale for two formats rather than one:** a JSON document that embeds base64 audio is not diffable, not reviewable, and roughly 33% larger. A ZIP is not diffable at all. Keeping the document pure and the payload separate is what makes "export the project and diff it against last week's" a thing a producer can actually do.

### 20.2 The manifest

```jsonc
{
  "packVersion": 1,
  "createdAt": "...",
  "producer": "ZANZA Studio 0.x",
  "series": { "id": "...", "name": "ZANZA" },
  "project": { "id": "...", "name": "EP001" },
  "documentVersion": 2,
  "media": [
    { "audioId": "audio.voice.nia.01", "kind": "dialogue", "path": "audio/audio.voice.nia.01.ogg",
      "bytes": 18422, "duration": 1.8, "sha256": "…" }
  ]
}
```

`sha256` per file is not decoration. A pack is the only artifact that crosses a machine boundary, and a media pack that has silently lost a file produces audio that plays silence — the exact failure the `hasRecording` predicate was built to make visible. The manifest is what lets import verify rather than hope.

### 20.3 Export: what must be excluded

An export must never contain:

- AI provider credentials (RULE: they are in `localStorage`/keychain, never in a document — so this is a *test*, not a filter),
- the `plans` store's raw responses,
- any `metadata` key matching a configured secret pattern,
- absolute filesystem paths from the authoring machine (paths are pack-relative).

The export test asserts that a project saved on a machine with credentials configured produces a byte-identical file to one saved without. If that test is not written, the exclusion is a convention.

### 20.4 Where media bytes live

Today `AudioDef.src` is a string and **nothing stores bytes**. The target:

```
DB: zanza-studio
  ├─ projects
  ├─ series
  ├─ meta
  └─ media      (keyPath id)          [new, DB_VERSION 2 → 3]
       { id, kind: 'audio'|'image', mime, bytes: ArrayBuffer, duration, updatedAt }
```

`AudioDef.src` becomes a reference of one of two forms, distinguished by an explicit field rather than by sniffing a string:

```ts
export interface AudioDef {
  // ...
  /** 'local' = bytes in the media store; 'external' = a path the operator supplies. */
  srcKind: 'local' | 'external' | null;
  src: string | null;   // media id when local, path when external, null when missing
}
```

This is a schema change and belongs in **Phase 11** because attaching a file is a Phase 11 deliverable and it cannot work without somewhere to put the bytes. It is a v1→v2 change folded into the same migration as `Series` — one `formatVersion` bump, two independent changes, because they ship together. That is a deliberate trade: a slightly larger migration in exchange for one version number rather than two, and the render-neutrality gate covers both.

### 20.5 Import

```
read file
  → parseProject (total, throws ProjectParseError with paths)
  → on failure: show the issues, DO NOT import. Ever.
  → success: mint a NEW project id
  → default: new name "<name> (imported)"
  → user may choose "keep id" (restore/replace) or "new id" (copy)
  → if a series is declared and its id is not present: offer to create it, or
    attach to the matching series by name, or import assets as project overrides
  → media: verify each sha256; a mismatch is a WARNING and the file is imported
    as missing, not silently accepted
  → open it
```

**Import never trusts the file's identity.** A malicious or careless pack claiming `id: "proj_zanza_ep001"` must not overwrite the user's project. "Keep id" is an explicit, confirmed choice.

### 20.6 Duplicate, share, version, backup

| Operation | Design |
|---|---|
| **Duplicate** | Fresh ids for project, episodes, scenes, and every scene-local id. Asset ids preserved. `metadata.duplicatedFrom` records the source. |
| **Share** | Export `.zanza.json`. There is no share link, because there is no server. When there is a server, it is a `ProjectRepository` implementation and nothing else changes. |
| **Version** | Not a version-control system. Three honest options: (a) snapshots in the `projects` store, `metadata.snapshotOf` + `metadata.snapshotAt`; (b) export files the user versions themselves; (c) `updatedAt` plus autosave history. **Recommendation: (a) plus (b).** A "snapshot" button that writes a copy is 20 lines and covers 90% of the need; real branching is a Git problem and should stay a Git problem. |
| **Backup** | "Backup all" writes one pack per project plus a `series.json` per series. Backup/restore is symmetric with import/export, so it is the same code with a different target. |

---

## 21. TESTING STRATEGY

### 21.1 The rule the existing suite already proves

`AGENTS.md` RULE 5 (core is pure) plus the recording harness means **the interesting logic is testable without a browser**. 243 tests run in Node. Every architectural claim in this document that concerns `core` is verifiable in CI, not by hand.

The strategy below is therefore not "add more tests" — it is "add tests at the seams where a future mistake is most likely".

### 21.2 Test types and where each belongs

| Type | Location | What it proves |
|---|---|---|
| **Unit** | beside the module (`sample.test.ts`) | pure functions in isolation |
| **Property / generative** | beside the module | invariants hold across generated inputs, not just chosen ones |
| **Architecture** | `src/arch/*.test.ts` — a new top-level folder | layering, content-blindness, import rules — as *executable assertions* |
| **Migration** | `src/core/serialize.test.ts` | v_n → v_n+1 is total, idempotent, and render-neutral |
| **Renderer** | `src/core/render/*.test.ts` + `src/data/render.test.ts` | draw logs, determinism, goldens, balance |
| **Command** | `src/core/commands/*.test.ts` | one command = one document op; failure = original document |
| **Plan** | `src/core/plans/*.test.ts` | determinism, totality, validator/compiler agreement |
| **AI** | `src/ai/**/*.test.ts` | the boundary holds with a fake provider; no network in CI |
| **Store** | `src/state/editorStore.test.ts` | one commit per gesture, undo granularity, autosave |
| **UI** | `src/ui/**/*.test.tsx` | controls exist and dispatch the right command |
| **Manual** | `docs/MVP.md` §4 | the ten browser checks that a test cannot make |

### 21.3 The architecture test suite — new, and load-bearing

`src/arch/` contains only tests. It exists because §33's gates need *executable* forms, and because the plan in `docs/PLAN.md` records that a green gate is evidence of not having checked.

**`src/arch/layering.test.ts`**
- `src/core/**` imports nothing from `src/state`, `src/ui`, `src/ai`
- `src/core/**` imports nothing from `src/data` (currently true; a lint rule should enforce it)
- `src/core/**` contains no `React`, no `window`, no `document`, no `indexedDB` outside `*.browser.ts`
- `src/ai/**` imports nothing from `src/state`, `src/ui`
- `src/data/**` does not import from `src/state` or `src/ui`

**`src/arch/contentBlindness.test.ts`**
- No show-specific token in `src/core/**`: `nia`, `kito`, `zanza`, `sheng`, `nairobi`, `kilimani`, `2097`, `proj_zanza`
- No hardcoded episode or scene ids in `src/core/**`
- **No hardcoded rig slot names** outside a documented default — this is the F2 regression gate

**`src/arch/planIsolation.test.ts`**
- `src/ai/**` cannot construct a `Project` (no import path from `ai` to `applyCommands`'s return value)
- No provider name in a union, a switch, or a default in `src/core/**`
- `Provenance.provider` and `.model` are `string | undefined`, never a branded type
- Deleting `src/ai/**` does not change the test count for `src/core/**` (enforced as: no `src/core` test file imports from `src/ai`)

**`src/arch/commandCoverage.test.ts`**
- Every `commit()` call site outside `src/core/` is inside a UI action that dispatches a command
- No `src/ui/**` module imports a mutating `document/*Ops` function; read-only lookups are allowed

**`src/arch/mutationPath.test.ts`**
- Every mutation is a `commit()`; there is no other writer of `state.project`
- A test that runs each command and asserts `validateProject` is clean afterwards

### 21.4 Per-phase test requirements

| Phase | New tests required |
|---|---|
| 9 Camera | preset resolution; `frameTheSelection` bounds maths is pure and tested; a camera clip write is one undo step |
| 10 Playback | `episodePlan.ts` offset maths; sequence wrap; playhead spans scenes |
| 11 IO & session | round trip `serialize → parse → serialize` is byte-identical; duplicate mints fresh scene-local ids and preserves asset ids; import rejects an invalid document and does not write; `flush()` is called on `visibilitychange`; a corrupt record is quarantined and **not** overwritten |
| 12 Export | a 3-second scene exports and the file is playable; PNG still matches the golden draw log scaled; mixdown offsets are correct |
| 13 Acceptance | the ten `docs/MVP.md` checks pass at 1440p and 1920p, recorded in the changelog |
| 14 Series | migration is total, idempotent, and render-neutral for all seed scenes × 6 times; two series coexist; deleting a referenced series asset is refused; a project override wins over the series asset |
| 15 Engine | `scaleY` reaches pixels; a custom `mouthSlot` animates; an unresolvable `colorKey` is a warning at authoring and an error at load; the index produces draw logs identical to the pre-index renderer for every seed scene |
| 16 Commands | one command = one op; a failing command returns the original document; `applyCommands` rolls back on failure; labels reach the history |
| 17 Plans | compile is deterministic; a validated plan always compiles; the preview equals the applied document; an unparseable response is a clean error, not a crash |
| 18 Review | the plan editor re-validates on edit; no undo step is consumed by review; `Edited` badge appears only when a human changed an AI value |
| 19 AI | with a fake provider: validate → preview → apply → undo; with no provider: the suite count is unchanged; a plan naming a nonexistent character never reaches `commit`; `raw` is preserved |

### 21.5 The gates are architectural, not cosmetic

`docs/PLAN.md` records that three real defects passed all gates. The gates check that code compiles and that asserted behaviour holds; they cannot check that the assertions were the right ones. The response is §21.3 — assertions about the *architecture* itself — plus the existing review discipline, which remains:

> At every phase gate: `npm run verify`, then an **independent review pass** over what changed, asking *which branches and boundaries are unhandled?* and *which claims in the docs are false?*, then fix each confirmed defect with a regression test, then update `ROADMAP.md` honestly.

That last clause is not optional bookkeeping. Six documentation claims are already false today; see Appendix A.

---

## 22. PERFORMANCE STRATEGY

### 22.1 The budget, from AGENTS.md RULE 14

16 GB RAM, Intel UHD integrated graphics, 1920×1080 laptop, 60 fps stage redraw, no per-frame allocation in the hot path. 24 fps is the authored `STAGE_FPS`, so the editor has a 2.5× margin — which is the right way round for a tool that must stay responsive while a large document is open.

### 22.2 Current concerns, measured by reading the code

| Concern | Where | Current cost | Verdict |
|---|---|---|---|
| Asset lookups per frame | `render.ts:82,161,186,192,193` — five `Array.find` over asset collections, per actor per frame | `O(actors × assets)` | **Fix in Phase 15 (R4).** The index makes it `O(1)`. |
| Talking check per actor | `render.ts:194` calls `isActorTalking`, which does `allClips(scene)` + a `dialogue.find` — for every actor, every frame | `O(actors × clips)` | **Fix in Phase 15 (R4).** Computed once per frame into a `Set`. |
| Track scan per target | `render.ts:452-469` `sampleTarget` walks every track for every actor and prop | `O(targets × tracks)` | **Fix in Phase 15 (R4).** |
| Per-part allocation | `resolve.ts:182` allocates a `ResolvedPart` per rig part, per actor, per frame | `O(parts)` allocations/frame | **Leave.** The comment at `resolve.ts:158` already reasons about this. At 4 actors × 20 parts × 60 fps = 4,800 small objects/second, which is nothing for a modern GC, and a pool would reintroduce aliasing bugs into the single most correctness-critical function in the renderer. The two `resolveRig` instances that *do* need care are the `stack` array (already indexed) and `ResolvedPart` (already fresh, deliberately). |
| Layer sort per frame | `render.ts:234` `[...layers].sort()` | one array per frame | **Fix in Phase 15 (R10).** Free. |
| Unconditional redraw | `Stage.tsx:69` | a full render every rAF even when idle | **Fix in Phase 15 (R6).** The largest single win, because it takes idle cost to zero. |
| Draw-list closures | `render.ts:170,199` — a closure per actor and per prop per frame | `O(targets)` closures/frame | **Leave.** They are the cleanest way to defer rig resolution until draw order is known. |
| Autosave debounce | `autosave.ts` | one write per 800 ms idle | Fine. |
| Snapshot history | `editorStore.ts:163` `slice(-100)` | 100 full documents | **Current concern.** A large project at 5 MB → 500 MB retained. See §22.4. |
| IndexedDB write | `editorStore.ts:246` chained writes | one write per debounce | Fine. `structuredClone` per write on a 5 MB document is the actual cost. |
| `validateProject` per commit | `editorStore.ts:150` plus **once per command in `applyCommands`** (§8.3) | `O(entities)` per commit | **Watch.** Full validation after *every* command in a 200-command plan is `O(200 × document)`. Fix: validate incrementally, or validate once at the end of a plan fold. See §22.3. |
| `git`-scale concerns | — | — | **None.** This is a single-document local editor. |

### 22.3 The plan-compilation performance decision

§8.3's `applyCommands` validates after every command, which is correct for interactive single commands and too slow for a 200-command plan. Resolution:

- `applyCommand` (single) validates. Interactive edits stay safe.
- `applyCommands` (batch) validates **once at the end**, and every operation is already required to be total and to return a structurally valid document. A partial fold that would produce an invalid document fails anyway on the *next* command, because commands address ids that do not exist.

This is a defensible trade because the alternative — no validation at all — would be worse, and the invariant is enforced by the operations rather than by the validator. It is stated here rather than discovered later.

### 22.4 Undo history memory

Snapshot history is the right model and should not be replaced. The problem is arithmetic, not architecture: 100 snapshots × document size.

Options, in order of preference:

1. **Measure first.** The seed is ~200 KB. At 100 snapshots that is 20 MB — fine. A real episode project might be 2–5 MB → 200–500 MB — not fine on 16 GB with integrated graphics. So the problem is real, but only at episode scale.
2. **Reduce `HISTORY_LIMIT` adaptively** based on document size: `limit = clamp(2_000_000 / bytes, 20, 100)`. Ten lines, no structural change, and a small project keeps its full 100.
3. **Structured-clone sharing.** Not worth it. Snapshot history's virtue is that undo is exactly `past.pop()`; a shared-structure history reintroduces the mutation-aliasing class of bug that the immutable-document decision exists to eliminate.

**Decision: (1) then (2).** A patch-based history is explicitly rejected — `docs/ARCHITECTURE.md` already argues it would be contained to `commit()`, which is true and also the reason it is a *later* optimisation with a real risk, and Phase 17's plan-folds will make history pressure arrive earlier than it has so far.

### 22.5 Premature optimisation — do not do these

| Temptation | Why not yet | Signal to act |
|---|---|---|
| WebGL / a rendering engine | Canvas 2D is not the bottleneck at 4 actors. | A profile showing GPU-bound draw time on a real episode. |
| Object pooling in `resolveRig` | The allocation is small and the aliasing risk is real. | Measured GC pressure, i.e. a profile, not an estimate. |
| Spatial indexing for hit testing | The scene list is 5 items. | Scenes over ~500 with selection latency above one frame. |
| Virtualised scene/clip lists | Timeline already renders only what fits. | A timeline with >10,000 clips. |
| Diff-based rendering | The redraw skip (R6) gets 90% of it. | Measured idle cost still above budget after R4+R6. |
| Worker-based rendering | Canvas 2D is not thread-hostile for this. | Off-main-thread need, e.g. video export at interactive rates. |
| Incremental validation | §22.3's once-per-batch is enough. | A plan fold above 200 ms. |
| Indexed asset lookups in the document | The `RenderIndex` is a render-time cache, not document state. | Never — the document should stay plain JSON. |

### 22.6 The measurement to add in Phase 15

A `src/core/render/perf.test.ts` that renders the acceptance scene 600 times against a `RecordingContext` and asserts a *ceiling* on the number of draw operations, not on wall-clock time. Wall-clock assertions are flaky in CI and get disabled within a month. A draw-op count is deterministic, it catches accidental per-frame re-resolution and re-sorting, and it fails loudly when someone reintroduces an O(n²) scan. The real-machine check stays a manual step in `docs/MVP.md` §4.

---

## 23. SECURITY / DATA INTEGRITY

This is a local, single-user, no-backend application (RULE 10). "Security" here means **data integrity and untrusted input**, not access control. Every item below is a data-loss or data-corruption risk unless stated otherwise.

### 23.1 Threat model

| Source of untrusted input | Exists today | Severity |
|---|---|---|
| A hand-edited or corrupted `.zanza.json` | No (no IO yet) | High — a bad import must never write |
| A corrupt IndexedDB record | **Yes** | High — the current path loses data (F5) |
| An AI model's output | No (no AI yet) | High — it is a remote third party by definition |
| A media pack from another machine | No | Medium — a pack is the only artifact that crosses a boundary |
| Browser extensions / XSS | Yes, unavoidably | Low — no secrets in the DOM is the mitigation |

There is no network attack surface, no authentication, and no authorisation. Adding any of those is a backend decision, and the repository interface is where it lands.

### 23.2 Input handling rules

**Rule 1 — every parser is total.** `parseProject` throws a `ProjectParseError` with structured `issues`; `parsePlan` returns a `Result`. Neither ever leaves a partially-valid value in a variable. Anything that parses untrusted input takes `unknown`, not a type — the type is a claim, the parser is the check.

**Rule 2 — validate after parse, always.** `parseProject` already runs `validateProject` and throws on any issue (`serialize.ts:73-79`). `parsePlan` is followed by `PlanValidator`. No import path reaches the store without both.

**Rule 3 — never overwrite what failed to parse.** §5.6's quarantine. This is the single most important rule in this section.

**Rule 4 — an import mints a new identity unless a human says otherwise.** §20.5.

**Rule 5 — every document reaching the renderer is valid.** Guaranteed by `commit`'s validation, `parseProject`'s validation, and the fold's end-of-batch validation. There is no path to render an invalid document, and the stage cannot be pointed at a document that has not been through one of them.

### 23.3 AI output is untrusted data, structurally

Not "we validate it" — *structurally incapable of doing damage*:

1. It is a `string` from a remote third party. It is parsed by `parsePlan`, which is total.
2. It becomes a `PlanEnvelope` with a `planVersion` and a `kind`. An unknown `kind` is an error, not a guess.
3. It is validated against the actual project: every id must exist. **A model cannot invent a character and have it applied**, because `PlaceCharacter` takes a `characterId` that `validatePlan` and `validateProject` both check.
4. It is compiled by a pure function that emits a closed set of `Command` kinds. A model cannot emit an arbitrary command; it can only emit a `ScenePlan`, and the compiler decides what that becomes.
5. It is folded atomically (§8.3) and committed once.
6. It is never applied without review. Hard gate, not a preference.

**The residual risk, stated honestly:** a model can still propose a *legally valid but terrible* scene — everyone facing the wrong way, the camera on a wall, dialogue with the timings impossible to speak. Validation cannot catch that, and no amount of validation will. It is caught by the three-still preview (§13.3) and by the human. This is the reason review is a gate and not a nicety, and it is the reason the "trust this plan" fast path is rejected permanently rather than deferred.

### 23.4 Prompt injection

A `ScenePlanner` is asked to plan a scene from a brief, with the asset library in the prompt. A brief can contain text resembling instructions. Mitigations, in order of importance:

1. **The capability's output schema does not depend on the brief's structure.** Only asset ids that exist are usable, so an injected "use character `char.evil`" fails validation.
2. **Asset ids and environment facts are delimited data, not prose**, and the system instruction states that content inside a brief is content, never instruction.
3. **The model cannot write files, run code, or call tools.** There is no tool loop (§12.6). Injection can only change *proposed plan values*, all of which a human reviews before they land.
4. **A capability ceiling.** Phase 19.5 gives each capability a `maxSeverity`. `scenePlanner` is `warning` — it may never create assets, delete scenes, or produce `error`-free-but-destructive commands. Raising a ceiling is an explicit code change with a written justification.

**The honest caveat:** mitigation 1 is the real one and it is a property of the *architecture*, not of the prompt. Injection resistance here comes from the command/plan/validation structure, which is exactly why that structure must not be relaxed to "let the model be a bit more flexible".

### 23.5 Asset references and cross-scope integrity

The new failure mode Phase 14 introduces is a dangling reference across a scope boundary: a scene referencing a series asset that has been deleted. Rules:

- `removeAsset` on a **series** asset is refused if any project in the series references it, and the refusal names the referencing projects.
- `removeAsset` on a **project** asset is always safe: resolution falls back to the series asset, or — if there is no series asset — to a validation error, which is visible in the issue panel rather than a blank part.
- Every project is validated against the **merged** library, not its own. A project that is valid alone and dangling against its series is invalid, and the store refuses to open it.

### 23.6 Credentials

§12.5. Restated as invariants that must be tested, not reviewed:

- No provider credential is ever written into `Project`, `SeriesDef`, a plan, or an export.
- `AIProvider` exposes no method that returns a secret.
- Deleting `src/ai/**` removes every credential-handling code path from the build, because credentials live entirely in the AI layer's keychain adapter.

### 23.7 Local persistence

- One database per installation, one operator. No tenancy, so no cross-tenant leakage is possible.
- Writes are chained (`pendingSave`), so a slow write cannot land out of order and resurrect stale content. This is already correct (`editorStore.ts:255`).
- A record is only adopted into the store if the store still holds the document that was written (`editorStore.ts:267`). This prevents a slow save from clobbering a newer edit, and it is the kind of correctness detail that is easy to remove during a refactor. It gets a test in Phase 11.
- `structuredClone` on every write is O(document). At 5 MB and one write per 800 ms that is a real cost; Phase 20+ may store the document as the already-serialised string rather than re-serialising per write. Not now.

---

## 24. COMPLETE PHASE ROADMAP

The most important section. Phases 0–8 are the historical record and keep their numbers. **Everything from 9 onward is renumbered**, because the existing roadmap mixes completed phase numbers with planned ones and has no platform track at all.

### 24.1 Number reconciliation — nothing is lost

| Old `ROADMAP.md` | New | Note |
|---|---|---|
| 9 Camera (`partial`) | **9 — Camera Authoring** | same phase, completed |
| 10 Animation (`complete`) | *history* | keyframe sampling and interpolation. Retired as a number; its remaining scope (reusable clips) is Phase 21 |
| 11 Preview (`partial`) | **10 — Episode Playback & Transport** | the old 11's remaining scope |
| 12 Export (`planned`) | **12 — Export** | unchanged |
| 13 Polish (`planned`) | **13 — MVP Acceptance & Documentation Truth** | polish becomes the acceptance gate plus the doc corrections, which is what it actually is |
| 14 Art Pipeline | *deferred* | Phase 20+ band (§24.4) |
| 15 Animation Depth | **21 — Animation Assets** | moved into the platform track, after Series |
| 16 Dialogue & Audio Production | *deferred* | Phase 20+ band; voice, mixdown, phonemes |
| 17 Episode Assembly | **10 + 12** | folded into playback and export |
| 18 Director's Tools | *deferred* | Phase 20+ band; continuity engine |
| 19 AI Assistance | **16–19** | decomposed into four phases, which is the point of the exercise |
| 20 Platform (cloud) | *deferred* | §28.9 |
| 21 Zanza Ecosystem | *out of scope* | a different repository |

### 24.2 Phase 9 — CAMERA AUTHORING

**Objective:** make the camera authorable. The mechanism is done; nothing exposes it.

**Why it exists:** camera is the difference between "an animated scene" and "a shot". It is also the highest-leverage thing missing, because a good rest framing converts a mediocre scene into a watchable one, and every other phase benefits from a framed picture.

**Prerequisites:** none. Phase 8's mechanism is done; its remaining gap is not a prerequisite for camera.

**Architecture changes:** `CameraPreset` type; a pure `frameBounds(actors, environment)` calculation in `src/core/animation/`; `SetSceneCamera` and `SetCameraZoom` commands in the Phase 16 vocabulary (until then, direct ops — the command layer arrives in 16 and the panel is migrated in the same commit).

**Modules affected:** `src/core/types.ts` (`CameraPreset`), `src/core/animation/frame.ts` (new, pure), `src/ui/panels/CameraPanel.tsx` (new), `src/ui/App.tsx`, `src/ui/panels/Timeline.tsx` (camera lane discoverability), `src/data/seed.ts` (seeded presets).

**New domain concepts:** `CameraPreset`. No `Shot` (§17.3).

**Tests:** preset resolution; `frameBounds` is pure and correct for one actor, for many, and for actors outside the frame; a camera edit is one undo step; a keyframed zoom still renders (§4 of `docs/MVP.md`).

**Acceptance:** *"A user can pick a preset, nudge the rest framing numerically, keyframe a push-in, and frame a selection to fit — and undo each of those as one step."*

**Not included:** `Shot` entities; shot lists; continuity; a graph editor for camera curves; the `zoom` field rename (§17.4).

### 24.3 Phase 10 — EPISODE PLAYBACK & TRANSPORT

**Objective:** EP001 plays start to finish, with correct scene transitions and a playhead that spans scenes.

**Why it exists:** the MVP gate says "preview at speed". A scene-loop is not an episode. This is also the first consumer of `episodeDuration`-style composition across scenes, which Phase 12 needs.

**Prerequisites:** 9 (a framed picture is worth watching).

**Architecture changes:** a pure `src/core/audio/episodePlan.ts` (the offset maths, shared with export); a pure `episodeTimeline.ts` (flattened scene offsets, total duration, scene at time t); the store's clock gains a *sequence* mode — the current `advancePlayback` wraps at the scene end (`editorStore.ts:132`) and must instead cross the boundary. The clock remains single; only its wrap rule changes.

**Modules affected:** `src/core/audio/episodePlan.ts` (new), `src/core/timeline/episode.ts` (new), `src/state/editorStore.ts` (clock), `src/ui/Stage.tsx`, `src/ui/panels/TransportBar.tsx`, `src/ui/panels/SceneList.tsx`, `src/state/audioChannel.ts` (scene switch on boundary).

**New domain concepts:** none persisted. Everything is derived from `Episode.sceneIds` + `Scene.duration`.

**Tests:** offset maths for a multi-scene episode; playhead crosses a boundary and lands at the right time in the next scene; wrapping at the episode end; audio segments offset correctly across the boundary; a scene switch during playback stops the old audio and starts the new.

**Acceptance:** *"EP001 plays from the first frame of scene 1 to the last frame of scene 5, with dialogue, expressions and camera moves, and the playhead is continuous across all five scene boundaries."*

**Not included:** export; transitions or dissolves (out of MVP scope by decision, `docs/MVP.md:61`); a master timeline view; scrubbing across scenes at speed; per-scene audio offsets authored by hand.

### 24.4 Phases 11–13 — the MVP completion band

**Phase 11 — PROJECT IO & SESSION LIFECYCLE**

- **Objective:** the app becomes a tool you can keep work in. Multiple projects, a real lifecycle, file import/export, and the two data-loss defects (F4, F5) fixed.
- **Why now:** it closes Phase 8's gate (attach a file to a slot) and it is the last thing before the MVP is shippable. Both the audio defect and the persistence defects are in this phase, which is a coincidence worth naming: *everything here is about not losing a user's work.*
- **Architecture changes:** `Project | null`; `SeriesRepository`; a `projects`/`media` store split; `src/core/media/` (blob store behind an interface); `src/core/io/` (`exportProject`, `importProject`, `duplicateProject`); quarantine on parse failure; `flush()` wired to `visibilitychange`/`pagehide`; a `HistoryEntry` type with labels.
- **New domain concepts:** `SeriesRepository`; `MediaStore` interface; `ArchiveState`. `Series` itself is *not* yet created — a project may be series-less until Phase 14.
- **Modules affected:** `src/state/editorStore.ts` (the largest change in the MVP band), `src/state/autosave.ts`, `src/core/persistence/*` (new `series.ts`, `media.ts`, DB_VERSION 2), `src/core/serialize.ts` (first real migration), `src/core/types.ts` (`srcKind` on `AudioDef`), `src/ui/ProjectBrowser.tsx` (new), `src/ui/panels/AudioSlotPanel.tsx` (file attach), `src/ui/App.tsx`.
- **Tests:** JSON round trip is byte-identical; duplicate mints fresh scene-local ids and preserves asset ids; an invalid import writes nothing; a corrupt record is quarantined and not overwritten; `flush()` fires on `visibilitychange`; a slow save does not clobber a newer edit; attached audio is announced in the same transaction as the `commit` that set its `src`.
- **Acceptance:** *"Three projects can exist, be opened, switched between, duplicated, exported, and re-imported; a file can be attached to an audio slot and heard; a killed tab loses nothing."*
- **Not included:** `Series`; ZIP packs; snapshot versioning; cloud; media editing.

**Phase 12 — EXPORT**

- **Objective:** produce a playable video file. The milestone's actual deliverable, and the only phase with no code behind it at all.
- **Why now:** it is the milestone. Everything before it exists to make this output good.
- **Architecture changes:** a pure `src/core/export/frameSequence.ts` (which frames, at which time, for which settings — no browser APIs); a browser `frameEncoder.ts`; a `videoEncoder.ts`. **The `MediaRecorder` decision must be made here, in writing, before implementation** — `docs/PLAN.md:180` already flags it.
  - **The decision, made now:** `MediaRecorder` captures in real time and cannot render faster than the scene plays. A 3-second acceptance scene is 3 seconds of wall clock and drops frames under load. The options are real-time capture, frame-stepping with a paused recorder, or `WebCodecs` with a hand-rolled muxer. **Recommendation: PNG sequence as the reference path** (deterministic, always available, no codec dependency, and it makes the exporter's correctness testable by comparing frames against the golden draw logs), then `WebCodecs` + a minimal WebM muxer for video, with `MediaRecorder` as a real-time fallback. PNG-first also means "export" is demonstrable in Phase 12 even if video never works on a given machine — which is the honest-degradation posture the rest of this document insists on.
- **Modules affected:** `src/core/export/*` (new), `src/core/audio/episodePlan.ts` (mixdown consumer), `src/ui/ExportPanel.tsx` (new), `package.json` (**no new runtime dependency is expected** — a muxer is ~200 lines and RULE 11 requires the argument first).
- **Tests:** the frame sequence for a 3-second scene at 24 fps is exactly 72 frames at the right times; each frame's draw log matches the golden at that time; a mixdown's segment offsets match `episodePlan`.
- **Acceptance:** *"Export produces a playable video file of the scene's duration, verified by playing it — and on a machine where the video codec is unavailable, produces a PNG sequence plus an honest message, not a silent failure."*
- **Not included:** MP4/H.264; 4K; multi-machine render farms; burn-in of a timecode; automated publishing.

**Phase 13 — MVP ACCEPTANCE & DOCUMENTATION TRUTH**

- **Objective:** run the ten manual checks in `docs/MVP.md` §4 at 1440p and 1920p, and **make every document tell the truth.** The second half is not optional bookkeeping: six claims are already false (§Appendix A) and the roadmap itself is being replaced by §31.
- **Why it exists:** RULE 9. The audit exists because the docs claimed more than the code delivered, and the honest-status discipline is what makes the Phase 8 classification trustworthy.
- **Architecture changes:** none. This is a verification and documentation phase, and it is deliberately last in the MVP band — polishing an editor that cannot export is polishing the wrong thing (`docs/PLAN.md:200`).
- **Modules affected:** `docs/*` (all), `docs/ROADMAP.md` (replaced by §31), `docs/ARCHITECTURE.md` (six corrections), `docs/DATA_MODEL.md` (v1 + delta), `docs/MVP.md` (checklist results).
- **Tests:** no new tests; the existing suite is the regression net. One new: a docs-link check, because `docs/ARCHITECTURE.md` cites a test file that has never existed.
- **Acceptance:** *"All ten checks pass and are recorded with their results. Every doc claim matches the code. `ROADMAP.md` shows Phase 13 complete, honestly."*
- **Not included:** visual polish beyond what the checks require; performance work; new features of any kind.

### 24.5 Phase 14 — SERIES & ASSET SCOPE

**Objective:** make ZANZA the first series in a platform rather than the platform itself.

**Why it exists:** this is the phase the entire brief is about. Until it lands, every "reusable" claim in the product is scoped to a single project, and the second show is impossible.

**Prerequisites:** 11 (a project lifecycle to hang a series off) and 13 (the MVP proven, so the refactor is against a working product rather than a broken one). This ordering is the single most important scheduling decision in this document: **the platform work comes after the MVP, not before it.**

**Architecture changes:**
- `SeriesDef` persisted; `Project.seriesId`
- `SceneContext { assets, settings }`; `renderScene`'s second parameter re-typed from `Project` to `SceneContext` (structurally compatible, so all existing call sites keep working)
- `resolveAssets(project, series)` — a pure merge, computed at open, never persisted
- `removeAsset` gains a reference check across the series
- `validateProject` runs against the merged library
- v1 → v2 migration, lazy and idempotent
- camera presets resolve from both scopes

**New domain concepts:** `SeriesDef`, `SceneContext`, `SeriesRepository`, `resolveAssets`.

**Modules affected:** `src/core/types.ts`, `src/core/render/render.ts` (signature only), `src/core/render/resolve.ts` (asset access), `src/core/audio/audioPlan.ts` (signature only), `src/core/document/invariants.ts`, `src/core/serialize.ts` (the migration), `src/core/persistence/*` (the `series` store), `src/state/editorStore.ts`, `src/ui/SeriesBrowser.tsx` (new), `src/data/seed.ts` (split into `seedSeries` + `seedProject`).

**Tests:** migration is total, idempotent, and **render-neutral for all five seed scenes × six times** (§6.5); two structurally different series coexist with no `core/` change; a project override wins; deleting a referenced series asset is refused and names the referrer; a project that is valid alone but dangling against its series is refused; `migrateProjectFile` returns both series and project.

**Acceptance:** *"A second, structurally different fictional series can exist in the same installation, be authored, and render, with zero changes to `src/core/**` beyond the Series migration itself."*

**Not included:** `Studio`; `Season`; cross-series asset sharing; an `AssetRegistry`; cloud; accounts.

### 24.6 Phase 15 — ENGINE CORRECTNESS & RENDER PERFORMANCE

**Objective:** fix the eight findings from §0.2 that belong to the engine, and remove the O(n²) work from the render loop.

**Why it exists:** F1 is a silent-wrong-answer bug that makes the editor lie about what the user authored. F2 is a hardcoded convention of exactly the kind RULE 3 exists to prevent. F3 and F6 are data-integrity and data-loss issues. F7 and R6 are the difference between an editor that stays responsive and one that does not, on the machine in RULE 14. **These are Phase 8's tail and Phase 12's risk, not polish.**

**Prerequisites:** 14 for the `SceneContext` re-type (R1–R10 are all written against the merged view). It could run before 14 against `Project` directly, but doing it once against the final signature avoids doing the renderer's hot path twice.

**Architecture changes:** `CharacterDef.mouthSlot`; `ResolveRigOptions` gains `scaleX`/`scaleY`/`mouthSlot`; `RenderIndex` + `resolveRenderIndex`; `ProjectSettings.subtitleStyle`; `Lighting` opacity fields; the `images` branch deleted; a Stage dirty check; an adaptive `HISTORY_LIMIT`; golden render fixtures; a draw-op-count perf test.

**New domain concepts:** `RenderIndex`, `SubtitleStyle`, `mouthSlot`.

**Modules affected:** `src/core/render/*` (all), `src/core/types.ts`, `src/core/document/invariants.ts`, `src/core/constants.ts`, `src/ui/Stage.tsx`, `src/state/editorStore.ts`, `src/data/render.test.ts`, plus golden fixtures.

**Tests:** `scaleY` reaches pixels; a custom `mouthSlot` animates and a character with no mouth part is silent; an unresolvable `colorKey` warns at authoring and errors at load; `RenderIndex` produces draw logs **identical to the pre-index renderer** for every seed scene; the determinism test still passes; the content-blindness test covers rig slot names; draw-op count is under its ceiling; 600 frames of the acceptance scene complete inside the budget on the RULE 14 machine (manual).

**Acceptance:** *"Every §18.2 defect has a regression test, the render loop has no O(actors × assets) or O(actors × clips) work, and no documented renderer claim is false."*

**Not included:** strokes; WebGL; a graph editor; onion skinning; a dirty-check for `resolveRig`'s allocations.

### 24.7 Phase 16 — COMMANDS, TRANSACTIONS & PROVENANCE

**Objective:** a named, serializable command layer over the existing operations, and a transaction that applies a sequence atomically.

**Why it exists:** it is the substrate for the plan layer. Without it, `PlanCompiler` has nothing to emit, and the AI layer would have to either call document operations directly (losing preview, logging and review) or produce documents (losing the command list entirely).

**Prerequisites:** 15. Commands are written against the corrected engine, so the renderer's `scaleY` fix does not have to be re-validated through a command path.

**Architecture changes:** `src/core/commands/` (types, registry, `applyCommand`, `applyCommands`); injected `allocate`/`now`; `HistoryEntry` with labels; `validatePlan`-compatible `CommandResult`; the command-coverage lint rule; every UI panel migrated to dispatch commands; `applyCommands` validating once per batch (§22.3).

**New domain concepts:** `Command`, `CommandContext`, `CommandResult`, `CommandError`, `CommandErrorCode`, `HistoryEntry`, `Provenance`.

**Modules affected:** `src/core/commands/*` (new), `src/state/editorStore.ts`, all of `src/ui/**`, `eslint.config.js`.

**Tests:** one command maps to exactly one operation; a failing command returns the *original* document; a 200-command sequence rolls back completely on a mid-sequence failure; labels and provenance reach history; `applyCommands` is deterministic under a fixed allocator; the command-coverage gate passes; the existing 243 tests still pass with the UI migrated.

**Acceptance:** *"Every UI mutation dispatches a named command; a 200-command sequence applies as one undo step and rolls back to zero mutations on any failure; no `src/ui/**` file calls a mutating document operation directly."*

**Not included:** `Plan` types; the compiler; the validator; any AI. **Commands are useless alone and that is fine** — they are a prerequisite with a test suite, not a user-facing feature.

### 24.8 Phase 17 — PLANS, VALIDATION & COMPILATION

**Objective:** the pure plan pipeline. `Plan` → `PlanValidator` → `PlanCompiler` → `Command[]`, with a preview that is exact rather than approximate.

**Why it exists:** this is the machine the AI layer feeds. It is also, on its own, genuinely useful: a plan is a scriptable, reviewable, deterministic way to author a scene, and a test fixture generator.

**Prerequisites:** 16. The compiler emits commands.

**Architecture changes:** `src/core/plans/` — `types.ts` (`PlanEnvelope`, `ScenePlan`), `parse.ts` (total), `validate.ts`, `compile.ts`; the deterministic allocator; an ESLint restricted-globals rule banning `Date`, `crypto` and `Math.random` in `src/core/plans/**` and `src/core/commands/**`.

**New domain concepts:** `PlanEnvelope`, `ScenePlan`, `PlanValidation`, `PlanDiagnostic`, `CompileResult`, `Assumption`, `ResolvedPlanReferences`.

**Modules affected:** `src/core/plans/*` (new), `src/core/commands/registry.ts`, `eslint.config.js`, fixtures under `src/data/plans/`.

**Tests:** a validated plan always compiles; an invalid plan never reaches the compiler; `compilePlan` is byte-identical across runs; `preview === applied` for a set of fixture plans; dialogue layout produces non-overlapping cues inside the scene; every unresolvable id produces the right diagnostic code; a `ScenePlan` with a made-up `characterId` fails validation; compile of a plan with an unknown `kind` is a clean error.

**Acceptance:** *"Given a valid plan, compilation is deterministic and the previewed document is deep-equal to the document that applying it produces. Given an invalid one, nothing is touched and the diagnostic names the path."*

**Not included:** `EpisodePlan`; `ProductionPlan`; the review UI (18); any provider call (19). This phase is **entirely pure and entirely testable without a browser or a network** — which is the reason to build it before the AI layer rather than with it.

### 24.9 Phase 18 — PLAN REVIEW WORKFLOW

**Objective:** make a plan reviewable and editable *before* it touches production.

**Why it exists:** it is the difference between "AI changed my show and I am cleaning up" and "AI drafted a scene and I approved it". It is also the brief's "Human Review" step, and it is a prerequisite for the AI gate.

**Prerequisites:** 17.

**Architecture changes:** a `plans` object store for review history; `PlanReviewPanel.tsx` — a form over `ScenePlan`, **not** over the document; the three-still side-by-side preview; the diff view (`what changes / what it breaks / what it does`); `Assumption` display; a re-validate/re-preview loop that consumes no undo step; the `Edit`d provenance computation (per-value, §14.3).

**New domain concepts:** `PlanRecord` (persisted envelope), `PlanDiff`, `PlanReviewState`.

**Modules affected:** `src/ui/panels/PlanReviewPanel.tsx` (new), `src/ui/panels/PlanEditor.tsx` (new), `src/state/planStore.ts` (new, transient), `src/core/persistence/plans.ts` (new), `src/core/planDiff.ts` (new, pure).

**Tests:** editing a plan re-validates and re-previews with no `commit` and no history entry; a preview of a plan that deletes a scene shows the scene in the diff; an `error` diagnostic blocks apply and a `warning` does not; the three-still preview renders the previewed document, not the current one; the `Edit`d badge appears only when a human changed an AI value.

**Acceptance:** *"A plan can be generated, diagnosed, previewed beside the current scene, edited, re-previewed, applied as one commit, and undone as one step — with no mutation before the final Apply button."*

**Not included:** the AI. **A plan can be authored by hand, loaded from a fixture, or pasted as JSON.** The review workflow is a complete, testable feature with no provider, and it must ship and be exercised that way.

### 24.10 Phase 19 — AI BOUNDARY & FIRST CAPABILITY

**Objective:** the AI boundary, and one capability: the Scene Planner.

**Why it exists:** it is the capability the whole plan architecture was built for (§13).

**Prerequisites:** 17 and 18. **Not 16 alone** — a plan that can be produced but not reviewed is a machine for destroying work, which is the worst possible first impression of an AI feature.

**Architecture changes:** `src/ai/` (§12.2); `AIProvider` + `nullProvider`; the capability registry; `src/ai/capabilities/scenePlanner.ts`; the keychain adapter for credentials; settings UI for provider configuration; per-capability `maxSeverity` ceilings; the three-still preview wired to the capability's output; per-record `Provenance` on `DialogueLine` and `SceneActor`; the AI badges in the scene list and review panel.

**New domain concepts:** `AIProvider`, `AIRequest`, `AIResponse`, `AICapability`, `ScenePlannerInput`, `ScenePlannerResult`, `nullProvider`.

**Modules affected:** `src/ai/**` (new), `src/ui/panels/PlanReviewPanel.tsx` (the generate button), `src/ui/SettingsPanel.tsx` (new), `src/core/types.ts` (`provenance?` on two record types), `eslint.config.js` (extended layering rules).

**Tests:** with a fake provider: validate → preview → apply → undo, with the document deep-equal to the original after undo; with no provider configured, the editor is fully functional and the test count is unchanged; a plan naming a nonexistent character never reaches `commit`; a hostile brief cannot produce a valid plan that references an asset outside the permitted list; the raw response is preserved; deleting `src/ai/**` leaves the suite green.

**Acceptance:** *"With no provider configured, **the editor is fully functional and no AI affordance is broken** — removing `src/ai/**` entirely leaves every other test passing. With a fake provider, a `ScenePlan` can be generated, validated, previewed beside the current scene, edited, applied as one transaction, and undone as one step, without bypassing the engine at any point."*

**Not included:** a real provider integration (a user adds one file); `EpisodePlan`; asset creation (§19.5's ceiling makes it impossible); sub-agents; tool use; streaming; fine-tuning; AI in the export path.

**19.5 — the capability ceiling, specified in Phase 19**

| Capability | `maxSeverity` | May create assets | May delete |
|---|---|---|---|
| `scenePlanner` | `warning` | **No** | No — may only modify or create scenes' contents |
| Everything else | — | Deferred | Deferred |

`maxSeverity: 'warning'` means: if validating the plan against a strict pass produces any `error`, the capability is refused, and additionally the compiler asserts that no emitted command is of a creating or deleting kind for a `scenePlanner`. A test enumerates the emitted command kinds against an allow-list. **This is the single guard that keeps the AI layer from ever becoming the thing that breaks RULE 2**, and it is enforced by a test rather than by a convention.

### 24.11 The unscheduled band (Phase 20+)

Named so they are not lost, and each with its entry condition in §28. These are **not** on the critical path and none of them blocks anything above.

| # | Work | Entry condition |
|---|---|---|
| 20 | **Audio production** — `VoiceDef`, file management, per-line gain and fades, ducking, a real mixdown, phoneme mouth shapes | A real episode with a real cast recorded |
| 20 | **Continuity engine** — §15.3, with `WardrobeDef` and `style-consistency` | Two episodes that must agree with each other |
| 21 | **Animation assets** — §16 | A second episode that needs the same walk-in |
| 20 | **Asset authoring UI** — the library is read-only today | Someone other than an engineer needs to add a character |
| 20 | **Art pipeline** — image parts, atlasing, `ImageResolver`, strokes | An art director with painted assets |
| 20 | **ZIP packs, snapshots, version history** | A production with media, or a user who has lost work |
| 22+ | **AI Showrunner, Episode Planner, Asset Director, Voice Director, Audio Director, AI Continuity** | Each becomes a `kind` of plan plus a prompt |
| 22+ | **`Shot` entity** | §17.3 signal 4 — continuity needs shot membership |
| 23 | **Cloud repository, accounts, collaboration** | RULE 10 is lifted deliberately, and `ProjectRepository` is the seam |
| — | **ZANZA SOCIAL / ZANZA GAME** | A different repository. `core/` is portable and the document is the shared asset — that is the whole reason for RULE 4 and the content-blind renderer. |

---

## 25. PHASE DEPENDENCY GRAPH

```
                    ┌──────────────────────────────────────────┐
                    │  PHASE 8 (partial) — audio mechanism done  │
                    │  file attach missing, flush() unwired     │
                    └───────────────────┬──────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────┐
                    │  9  CAMERA AUTHORING                     │
                    │  no prerequisites                        │
                    └───────────────────┬──────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────┐
                    │ 10  EPISODE PLAYBACK & TRANSPORT         │
                    │  needs 9 (worth watching)                │
                    │  yields: episodePlan.ts, episode timeline│
                    └───────────────────┬──────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
┌───────▼────────┐            ┌─────────▼─────────┐          ┌────────▼────────┐
│ 11 PROJECT IO  │            │ 12 EXPORT         │          │ (art, content)  │
│ & SESSION      │            │ needs 10's        │          │ deferred        │
│ LIFECYCLE      │            │ episodePlan       │          └─────────────────┘
│                │            │ PNG-first (§24.4)  │
│ fixes F4, F5   │            └─────────┬─────────┘
│ closes P8 gate │                      │
└───────┬────────┘                      │
        └───────────────────┬───────────┘
                    ┌───────▼────────┐
                    │ 13 MVP         │
                    │ ACCEPTANCE &   │
                    │ DOC TRUTH      │
                    └───────┬────────┘
                            │  ← THE MVP ENDS HERE
                    ┌───────▼────────┐
                    │ 14 SERIES &    │  v1 → v2 migration, render-neutral
                    │ ASSET SCOPE    │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ 15 ENGINE      │  F1 F2 F3 F6 F7, RenderIndex
                    │ CORRECTNESS &  │
                    │ PERFORMANCE    │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ 16 COMMANDS,   │  the substrate
                    │ TRANSACTIONS & │
                    │ PROVENANCE     │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ 17 PLANS,      │  pure, no browser, no network
                    │ VALIDATION &   │
                    │ COMPILATION    │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ 18 PLAN REVIEW │  human-in-the-loop
                    │ WORKFLOW       │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ 19 AI BOUNDARY │
                    │ & FIRST        │  ← the AI layer enters the system here
                    │ CAPABILITY     │
                    └───────┬────────┘
                            │
                            ▼
                    Phase 20+ band (each independently gated)
                    voice · continuity · animation assets · art ·
                    asset authoring · packs · more AI capabilities ·
                    Shot · cloud
```

**The three load-bearing edges:**

1. **13 → 14.** The Series refactor happens *after* the MVP is proven. Doing it first means refactoring a document model that has never produced a video file, which is how you discover the model was wrong — the mistake `docs/PLAN.md:213` already identifies for Phase 7.
2. **16 → 17.** The compiler has nothing to emit without commands.
3. **18 → 19.** A capability that can produce a plan but not a reviewable preview is a machine for destroying work.

**The one deliberately absent edge:** nothing in Phase 19 depends on Phase 20+. The AI layer is buildable on a platform with no voice, no reusable animation, and no continuity engine, because a `ScenePlan` references ids and timing — which is exactly what already exists.

---

## 26. EXACT IMPLEMENTATION ORDER

Step order within each phase, chosen to minimise rewrites. Each phase's first step is usually the one that makes later steps safe.

### Phase 9 — Camera
1. `frameBounds(actors, environment)` as a pure function + tests. No UI, no types. Establishes that the interesting part is arithmetic and belongs in `core`.
2. `CameraPreset` type + seed presets in `src/data/`.
3. Preset resolution (project + series scope later; project only now) + tests.
4. `CameraPanel` rest-framing numeric fields, commit-on-blur, one undo step.
5. Preset picker wired to `SetSceneCamera` + a camera clip.
6. "Frame selection" button.
7. Camera-lane discoverability in the timeline.

*Why this order:* step 1 before 4 means the panel is a thin shell over a tested calculation, rather than a component containing untested geometry.

### Phase 10 — Episode playback
1. `src/core/timeline/episode.ts` — pure: scene offsets, total duration, scene at time, time within scene. Fully tested, no store change.
2. `src/core/audio/episodePlan.ts` — pure: the same offsets applied to `AudioSegment[]`. Phase 12's mixdown depends on this.
3. The store clock gains a mode: scene-wrap (today) and episode-advance. `advancePlayback` crosses boundaries.
4. `Stage` and `TransportBar` read episode time.
5. Scene-list auto-follow during playback.
6. Audio channel handles the scene switch at a boundary.
7. Spacebar transport binding (`docs/MVP.md` check 3 says spacebar; nothing implements it).

*Why this order:* both pure modules land and are tested before the store changes, so the store change is a small diff against known-good arithmetic.

### Phase 11 — Project IO & session
1. `HistoryEntry` with labels — a widening of two fields, no behaviour change. Establishes the provenance plumbing.
2. Wire `autosave.flush()` to `visibilitychange`/`pagehide`. **One-line-class fix for real data loss; do it first.**
3. Quarantine on parse failure. **The other data-loss fix.**
4. `Project | null` in the store, plus `status`. Expect UI churn; it is the honest state.
5. `ProjectBrowser` — list, open, close, create, duplicate, delete, archive.
6. `.zanza.json` export, then import. Round-trip byte-identical test.
7. `MediaStore` interface + IndexedDB `media` store; DB_VERSION 2.
8. File attach UI for an `AudioDef` → `commit(UpdateAudioAsset)`. **This closes the Phase 8 gate.**
9. `duplicateProject` with fresh scene-local ids, preserved asset ids.
10. Snapshots (a `metadata.snapshotOf` copy) — cheap, do it while the write path is fresh.

*Why this order:* steps 2 and 3 are the two data-loss defects and they are 30 lines between them. Everything else is scope. Do the cheap irreversible-risk items first.

### Phase 12 — Export
1. **`frameSequence(settings, episode) -> { index, time }[]`, pure and tested.** No canvas. The frame list is the correctness surface.
2. PNG still of the current frame.
3. PNG sequence, frame by frame, at the computed times.
4. **Compare the PNG sequence against the golden draw logs at the same times.** This is the exporter's real test.
5. Mixdown via `OfflineAudioContext` driven by `episodePlan` (Phase 10's module).
6. The video encoder decision, written down, then implemented. `WebCodecs` + a minimal WebM muxer, or `MediaRecorder` as a real-time fallback.
7. `ExportPanel` with honest capability reporting and progress.

*Why this order:* PNG-first makes export *demonstrable and verifiable* before any codec is involved, so a codec problem can never be mistaken for a renderer problem.

### Phase 13 — MVP acceptance
1. Run the ten checks. Record results honestly, including failures.
2. Fix what the checks found.
3. Independent review pass; fix findings with regression tests.
4. Correct every false doc claim (Appendix A). Replace `ROADMAP.md` with §31.

### Phase 14 — Series & asset scope
1. `SeriesDef` type + `SeriesRepository` + the `series` store; DB_VERSION 2 → 3. **No behaviour change yet.**
2. `SceneContext` and `resolveAssets(project, series)`, pure and tested, with project-wins semantics.
3. Re-type `renderScene`, `resolveCharacter` lookups and `audioPlan` to take `SceneContext`. **Call sites do not change** — that is the whole point, and the compiler proves it.
4. `migrateProjectFile` + the v1→v2 migration + `migrateProject` wiring.
5. **The render-neutrality gate.** Five seed scenes × six times. Must pass before anything else in this phase.
6. `seedSeries()` / `seedProject()` split in `src/data/`, with the test fixtures updated to the new shape.
7. `validateProject` against the merged library; `removeAsset` reference check.
8. `SeriesBrowser`; the `seriesId` picker on project creation.
9. Idempotency test: migrate twice, assert no change.

*Why this order:* step 3 before step 5 is what makes step 5 meaningful. And step 5 before steps 7–9 means the scope change is proven render-neutral before any new behaviour is layered on it.

### Phase 15 — Engine correctness & performance
1. `RenderIndex` + `resolveRenderIndex` **with draw-log equality tests against the current renderer first.** Add the index without changing behaviour; prove it; then delete the old paths.
2. Stage dirty check (R6) — the single largest idle-cost win.
3. R1 `scaleY`, with a regression test that fails before the fix.
4. R2 `mouthSlot`, with the F2 regression test.
5. R3 `colorKey` validation, warning at authoring and error at load.
6. R10 layer sort into the index; R5 delete the dead image branch.
7. R8/R9 subtitle and lighting styling as data, with defaults that reproduce today's pixels exactly.
8. Adaptive `HISTORY_LIMIT`.
9. Golden render fixtures committed; the draw-op-count perf test; the content-blindness test extended to rig slot names.
10. Correct `docs/ARCHITECTURE.md`'s renderer claims.

*Why this order:* step 1 is a pure performance refactor with an exact behavioural proof, so it is safe to land first and makes every subsequent change cheaper to verify. Steps 3–5 are bug fixes with failing tests written first.

### Phase 16 — Commands, transactions & provenance
1. `Command`, `CommandContext`, `CommandResult`, `CommandError` types.
2. `applyCommand` + the registry, wrapping **one** operation. No UI change yet.
3. Injected `allocate`/`now` + the determinism test.
4. `applyCommands` with batch semantics + the rollback test (a mid-sequence failure returns the original).
5. `HistoryEntry` labels reaching the store; an undo-label test.
6. Migrate one panel (the dialogue panel — the most command-shaped UI in the app) end to end, as the reference.
7. Migrate the remaining panels.
8. The command-coverage lint rule; make it pass.
9. End-of-batch validation (§22.3) with a timing test on a 200-command sequence.

*Why this order:* steps 2–5 are pure and fully testable with no UI touched, so the riskiest part (atomicity) is proven before a single panel is migrated.

### Phase 17 — Plans, validation & compilation
1. `PlanEnvelope` + `parsePlan` (total) + the parse-error tests.
2. `ScenePlan` type + fixtures.
3. `validatePlan` — reference existence first, then compatibility, then timing, then structure. Tests per diagnostic code.
4. `compilePlan` for one command at a time, in the §11.6 order. Determinism test from the first command.
5. `preview === applied` test. **This is the property the whole review workflow rests on.**
6. The remaining commands; the full fixture set.
7. The ESLint restricted-globals rule (no `Date`, no `crypto`, no `Math.random`).
8. `Assumption` recording for every compiler-invented value.

*Why this order:* validator before compiler, so the compiler's precondition is a tested contract rather than an assumption. Determinism test at step 4, not at the end, so it is never retrofitted.

### Phase 18 — Plan review
1. `planDiff(project, next)` — pure, tested. Which scenes/assets/lines are added, changed, removed; which issues appear.
2. `PlanReviewPanel` rendering a diff with no editing.
3. The three-still side-by-side preview.
4. `PlanEditor` — a form over `ScenePlan`, re-validating and re-previewing on every change, consuming no undo step.
5. Apply + one undo. `planStore` as transient UI state.
6. `Assumption` display.
7. `PlanRecord` persistence and a review history.
8. The per-value `Edit`d computation.

*Why this order:* read-only review (2) before editing (4), so the diff is trustworthy before the user can change the thing it describes.

### Phase 19 — AI boundary
1. `src/ai/types.ts` + `AIProvider` + `nullProvider` + `isConfigured()`. No capability. The editor is unchanged and must be tested as unchanged.
2. The capability registry + a `testFixture` capability that returns a plan from a file. **A complete end-to-end review workflow with no provider at all.**
3. The credentials adapter (keychain or `localStorage` namespace) + the no-secret-in-export test.
4. `scenePlanner.ts` + its prompt as versioned data.
5. The three-still preview wired to a capability's output.
6. Per-record `Provenance` + the badges.
7. The `maxSeverity` ceiling and the emitted-command-kind allow-list test.
8. The settings UI for provider configuration.
9. The isolation gate: delete `src/ai/**`, run the suite.
10. A `docs/` page recording how to add a provider, so the first real integration is a one-file change.

*Why this order:* step 2 is the load-bearing one. A full review workflow driven by a fixture is a working feature with no network, no keys and no cost — which means the risky part (review, apply, undo, badges) is proven before any model is ever called.

---

## 27. ARCHITECTURAL DECISIONS THAT MUST BE FROZEN

Decisions that are expensive to reverse. "Freeze" means: changing this later is a data-model migration, a rewrite, or both.

| # | Decision | Why it matters | Proposed decision | What breaks if changed later |
|---|---|---|---|---|
| D1 | **Series owns reusable assets; Project owns overrides** | It is the whole difference between "one show" and "a platform" | Series-scope primary, project-scope override, resolved by id at open, **never persisted merged** | Every document, every reference, the renderer signature, `validateProject`, the exporter, and the AI planner's asset vocabulary. The single most expensive decision in this document. |
| D2 | **Project is the transaction, history, persistence and export unit** | Undo, autosave, IO and history all already assume it | Keep. `Series` never becomes a transaction boundary | `commit`, `past`/`future`, `ProjectRepository`, export, and every `HistoryEntry`. A change means re-architecting undo. |
| D3 | **Scenes live in a flat pool per Project; `Episode.sceneIds` holds order** | It makes "find scene by id" O(1) on the render path | Keep flat. Nesting is a rewrite of every lookup, the render path, and the episode model | The renderer hot path, `lookups.ts`, `episodeScenes`, the exporter, and every plan that names scenes. |
| D4 | **Scenes reference assets by id; no definition can be embedded** | It is RULE 2, and it is the property that makes reuse work at 400 scenes | Keep. `SceneActor` must remain incapable of holding a rig | The AI layer's safety model, asset reuse, the 400-scene editing claim, and the whole asset-reuse thesis. |
| D5 | **One mutation path: `commit()`** | It is what makes RULE 7 mechanically true | Keep. Every mutation, including every plan, goes through exactly one `commit` | Undo correctness, autosave, and the plan transaction guarantee. Any bypass is a bug. |
| D6 | **A plan transaction is one `commit`, not N** | It is the brief's explicit requirement | Frozen. `applyCommands` folds, validates, and commits once | The undo story, the review story, and user trust in the AI layer. |
| D7 | **A plan is JSON data; a command is JSON data** | Review, diffing, logging, replay and the AI boundary all depend on it | Frozen. No functions, no classes, no `undefined`, no cycles | Preview, logging, the `raw` audit trail, cross-language tools, and the entire review UI. |
| D8 | **The compiler is deterministic given an injected allocator** | It makes the preview *exact* rather than approximate | Frozen. `allocate` and `now` are injected; `Date`/`crypto` are banned by lint in `core/commands` and `core/plans` | The preview, the diff, `preview === applied`, and every test that compares a plan's effect. |
| D9 | **AI produces plans; it never produces documents** | It keeps the engine usable with AI removed entirely | Frozen. `src/ai/**` cannot import `applyCommands` | The isolation gate, the content-blindness of the engine, and the ability to delete the AI layer. |
| D10 | **`Provenance.provider` and `.model` are optional strings** | Provider-agnostic means no union, no enum, no registry | Frozen | Every new provider becomes a schema change; every historical record becomes un-readable. |
| D11 | **Keyframes stay absolute scene time; `AnimationAsset` uses clip-relative lanes** | It avoids a v3→v4 keyframe rewrite and keeps assets immutable on placement | Frozen | Every existing document, every `moveClip`/`trimClip` keyframe-shift rule, and the migration ladder. |
| D12 | **The renderer is a pure function of `(ctx, SceneContext, scene, time)`** | Determinism, export correctness, testability and undo-redraw all rest on it | Frozen. No retained state, ever | Export, the determinism test, the golden fixtures, the entire test strategy, and the ability to add a second renderer. |
| D13 | **`SlotOverride` keyed by free-form `slot` strings** | It is why one pose works on every character that has the part | Frozen. A closed union makes every new character a type change | Asset reuse, `AnimationAsset` reuse, the F2 `mouthSlot` fix, and RULE 3. |
| D14 | **One clock, owned by the store** | Picture, sound and every UI readout cannot drift | Frozen. `advancePlayback` is the only thing that moves time | Audio/picture sync, the transport, the timeline playhead, and the exporter. A second clock is the bug `docs/PLAN.md:79` records. |
| D15 | **Core is pure; browser globals only in `*.browser.ts`; layering enforced by lint** | It is why 243 tests run without a browser | Frozen, and extended: `core` must not import `data` either | The whole test strategy, portability to other renderers, and RULE 5. |
| D16 | **Pose and expression are separate character-independent libraries** | `rest ← pose ← expression ← keyframe`, five layers after §16 | Frozen | Every rig, every pose, the animation layer's position, and the continuity model. |
| D17 | **Formats: pure JSON document + separate media payload** | Diffable, reviewable, versionable, and testable | Frozen. No base64 in the document, ever | Every export, every diff, the pack format, and the ability to version a project in Git. |
| D18 | **A corrupt document is quarantined, never overwritten** | Data loss is worse than a failed load | Frozen | User trust, and recovery from any future storage bug. |

**Not frozen** (cheap to change): camera presets vs a `Shot` entity; the `SceneContext` field names; the phase numbering; subtitle styling fields; `HISTORY_LIMIT`; the number of continuity checks; which AI capability is second.

---

## 28. THINGS WE SHOULD NOT BUILD YET

For each: why it is premature, and the **specific signal** that would justify it. A signal must be an observation, not a feeling.

### 28.1 `Studio`

**Why premature:** one installation serves one operator, who produces one set of shows. A `Studio` with a name, a logo and a member list is a tenancy boundary, and there is no tenancy — no accounts, no server (RULE 10). It would also be a second thing to load, save and migrate for no behaviour.

**Signal:** accounts or multi-user access ships. That is, a `ProjectRepository` implementation that is not local. The `Studio` arrives the day a `Project` needs an owner that is not the installation.

### 28.2 `Season`

**Why premature:** `Episode` already has `title`, `description` and `metadata: Record<string,string>`. "Season 2" is `metadata.season = "2"` and an episode-number field. A `Season` entity adds a level that must be resolved, migrated, and displayed, in order to hold two fields.

**Signal:** a series has a season structure that must be *navigable and overridable as a unit* — per-season render settings, a per-season asset override set, a season-level cut order, or a per-season continuity boundary. If a season ever needs behaviour rather than metadata, it becomes an entity.

### 28.3 A unified `Asset` type / an `AssetRegistry`

**Why premature:** `AssetLibrary`'s six named collections give compile-time exhaustiveness: adding a seventh asset kind is a type error in every exhaustive `switch`, which is a feature. A single `Asset` union with a `kind` tag converts all of that into runtime checks. An `AssetRegistry` adds a second store and cross-store referential integrity to solve sharing that `Series` already solves — a series **is** the registry.

**Signal:** assets must be shared **across series** (a stock library, a co-production, a client-supplied asset pack). At that point, a registry is the right answer and the two-store integrity problem is worth paying for.

### 28.4 `StyleDef`

**Why premature:** style is currently distributed — `CharacterDef.palette` (colour), `EnvironmentDef.lighting` (light), and the renderer's subtitle constants. A `StyleDef` would unify them, but nothing needs them unified today: a show has one palette per character and one lighting design per environment, both authored directly on the asset.

**Signal:** a show needs a *palette or lighting change to propagate to assets that were authored before it* — which requires a style to have been named at authoring time. Until someone says "recolour EP001 to the new ZANZA house style", the indirection is pure.

### 28.5 `SeriesBible`

**Why premature:** a bible is prose — tone, rules, facts — and the system has no text store, no search, and no reader. Persisting it would mean putting a document in the project that nothing executes, which is a file, not a feature. **The bible is a real thing a real show needs, and it is a different product** (a reference tool, not a production engine).

**Signal:** AI capabilities need a factual grounding source — a "showrunner" that must know the canon. That is the moment a structured bible becomes machine-readable, and at that moment it is a `Series.metadata` + a documents table, not an engine entity.

### 28.6 `Script`

**Why premature:** a script is text *before* production, and the production model is already reachable without it — `docs/PRODUCT.md:13` states the pre-stages are "represented in the data model so they can be added without a migration", and `DialogueLine` is that representation for the only part a script contributes today (lines).

**Signal:** a script must be *imported and broken down automatically* — page → scene → line, with structure that survives round-tripping. That is real work and a real entity, and it is the prerequisite for `AI Writer` (§12.7), which is why both are deferred together.

### 28.7 A multi-agent AI framework

**Why premature:** the first capability (§13) is a single-shot transformation. An agent framework requires a tool-permission model, a memory model, an iteration budget, and a failure taxonomy — none of which have a user yet. Building it first means inventing all four to serve a task that needs none of them.

**Signal:** a capability that needs *sequential* decisions, where step *n* depends on step *n-1*'s output — "plan the episode, then plan each scene the episode needs". That is one real capability that justifies the framework, and it comes after `EpisodePlan` exists.

### 28.8 A plugin system, a marketplace, or animation asset exchange

**Why premature:** a plugin format is a public API commitment, and `core/` is not a stable public API — it is a v0.1 codebase that Phase 14 and 15 will still change. Committing to a plugin contract now means either freezing the architecture prematurely or shipping a compatibility layer nobody needs.

**Signal:** a second implementation of the engine exists (another renderer, a headless renderer, a game runtime) and needs to consume the document. That is the `ZANZA GAME` case, and it is a *different repository* that depends on this one, not a plugin inside it.

### 28.9 Cloud collaboration, multi-user realtime editing, microservices

**Why premature:** RULE 10 forbids a backend. Realtime collaboration needs conflict resolution, presence, and an operation log — and snapshot-history undo is fundamentally incompatible with concurrent editing, so "collaboration" here would mean replacing the undo model, not adding a feature.

**Signal:** more than one person needs to work on the same production, and they are not taking turns. Until then, export a `.zanza.json` and email it. **`ProjectRepository` is the seam, and a `HttpProjectRepository` is a Phase 23 item with no editor change.**

### 28.10 A generative video / image pipeline

**Why premature:** it is a content-generation problem with a dependency, a cost model, a licensing question, and a nondeterminism problem — all of which are real, none of which the platform needs. The renderer draws shapes; a generative pipeline produces images; they meet at `PartDef.shape = { kind: 'image' }`, which already exists.

**Signal:** an art pipeline is needed, at which point the seam is `ImageResolver` and the generator is a separate concern entirely.

---

## 29. ZANZA AS THE FIRST SERIES

### 29.1 The mapping

Every ZANZA thing is a **row**, not a type, a branch, or a special case.

| ZANZA | In the architecture | Where it lives |
|---|---|---|
| The show itself | a `SeriesDef` row | `series` store |
| Nia, Kito, Mama Nia, The Landlord | 4 `CharacterDef`s | `series.assets.characters` |
| Nia's Apartment, Zanza Street, Zanza Lounge | 3 `EnvironmentDef`s | `series.assets.environments` |
| Poses (`pose.sittingSofa`, `pose.walkingIn`, …) | `PoseDef`s | `series.assets.poses` |
| Expressions (`expr.neutral`, `expr.happy`, …) | `ExpressionDef`s | `series.assets.expressions` |
| Props (phone, mug, tablet, mic, …) | `PropDef`s | `series.assets.props` |
| Voice takes and stingers | `AudioDef` slots | `series.assets.audio` |
| EP001 "RENT IS DUE" | a `Project` | `projects` store |
| Its 5 scenes | 5 `Scene`s | `ep_001.scenes` |
| "Bro, where have you been?" | a `DialogueLine` | `scene_001.dialogue[0]` |
| Kilimani 2.0 | `CharacterDef.description` prose | data |
| Zanza City, 2097 | `Project.description` / `SeriesDef.description` prose | data |
| Sheng, the slang, the tone | dialogue `text` and `emotion` prose | data |
| The house visual style | each character's `palette`, each environment's `lighting` | data |
| "Nia is 23" | `CharacterDef.description` prose | data |

**Note the last five rows.** The creative canon that gives ZANZA its identity — the city, the year, the city district, the language, the tone — is **prose in description and dialogue fields**. None of it is structure. That is the design working: the show's soul is content, and content is a string.

### 29.2 What changes in `src/data/` at Phase 14

```ts
// today
export const SEED_PROJECT: Project          // assets + episodes + scenes, one value

// Phase 14
export const SEED_SERIES: SeriesDef        // the reusable library: 4 characters,
                                           // 3 environments, poses, expressions, props, audio
export const SEED_PROJECT: Project         // assets: {} (no overrides), seriesId,
                                           // episodes, scenes
export function seedContext(): SceneContext // { assets: SEED_SERIES.assets, settings: SEED_PROJECT.settings }
```

`SEED_PROJECT.scenes` and `SEED_PROJECT.episodes` are **unchanged**. The scene data is identical; only where the assets come from moves. That is the migration's whole claim, and `seedContext()` is what the renderer tests pass instead of a project.

### 29.3 The ZANZA-specific tests that must keep passing

- `src/data/rule3.test.ts` — the synthetic character added to the *resolved* library, staged, keyed, rendered. It must pass identically before and after the migration.
- `src/data/render.test.ts` — determinism and the draw-log goldens, unchanged.
- `src/data/seed.test.ts` — the seed validates and every scene renders.
- `src/data/ops.test.ts` — the seed is built from generic operations.
- The new render-neutrality gate (§6.5).

**If any of these needs editing to accommodate Series rather than to accommodate a new test, the Series change has violated RULE 3.** That is the check, and it is why the migration comes with a test suite rather than a refactor note.

### 29.4 How a second show would look

```
SHOW_B — "Harbour Lights"
  series_harbour_lights
    assets: 6 characters, 4 environments, their own poses, expressions, props, audio
  Project A → 2 episodes
  Project B → 1 episode (a pilot that became a series)

SHOW_C — "The Long Way Round"
  series_long_way_round
    assets: ...
```

Zero changes to `src/core/**` beyond the Phase 14 migration. The renderer draws both because both are `SceneContext`s. The AI Scene Planner plans for both because both are `AssetLibrary`s. The command vocabulary is identical because both are documents.

**That is the multi-series gate (G1), and it is a test, not an aspiration.**

### 29.5 What must never appear in `src/core/`

```
nia · kito · mama nia · landlord · zanza · sheng · nairobi · kilimani · 2097
proj_zanza_ep001 · anchor.nia_couch · pose.sittingSofa · 'mouth' as a magic name
```

The first ten are content. The eleventh is a fixture id. The twelfth is the F2 class of bug. All twelve are forbidden in `src/core/**`, enforced by `src/arch/contentBlindness.test.ts` (§21.3) rather than by diligence — and the fact that a *magical rig slot name* belongs in that list is a direct result of F2 being found.

---

## 30. FINAL ARCHITECTURE DIAGRAM

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  INSTALLATION — one local operator, one IndexedDB database, no backend       ║
║  RULE 10. No accounts, no auth, no server.                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
        │
        │  ┌─────────────────────────────────────────────────────────────────┐
        │  │ PERSISTENCE  [persistence]                                       │
        │  │  SeriesRepository      ProjectRepository      MediaStore         │
        │  │  IndexedDb · Memory      IndexedDb · Memory     IndexedDb          │
        │  │  stores: series · projects · media · meta · plans                │
        │  └─────────────────────────────────────────────────────────────────┘
        │        ▲ (async, one-way: state writes, never reads the store)
        │        │
┌───────▼──────────────────────────────────────────────────────────────────────┐
│  UI  [ui]                        React 19 — presentation and wiring only   │
│                                                                              │
│  ProjectBrowser   SeriesBrowser   SceneList   DialoguePanel   AssetPanel    │
│  CameraPanel      Timeline        TransportBar   Stage(canvas)   IssuePanel  │
│  PlanReviewPanel  PlanEditor      ExportPanel   SettingsPanel                 │
│  Stage.test · Timeline.test · DialoguePanel.test · AssetPanel.test           │
│        │                                                                       │
│        │ reads via selectors · mutates ONLY through commit() or a command      │
╌───────▼──────────────────────────────────────────────────────────────────────┐
│  STATE  [state]                    Zustand 5 — one store, one document       │
│                                                                              │
│  project: Project | null        series: SeriesDef | null                     │
│  past/future: HistoryEntry[]    (snapshots, HISTORY_LIMIT, labels, prov.)   │
│  playhead · playing · sceneId · selection · dirty · status                    │
│                                                                              │
│  commit(next, label)   ← THE ONLY MUTATION PATH (RULE 7)                     │
│  undo · redo · hydrate · open · close · save · autosave(schedule|flush)       │
│  planStore (transient: a plan under review)  ·  audioChannel (clock → engine) │
└───────┬──────────────────────────────────────────────────────────────────────┘
        │
        │  ┌─────────────────────────────────────────────────────────────────┐
        │  │ AI LAYER  [ai]                       Phase 19+ — optional      │
        │  │                                                                 │
        │  │  AIProvider (id: string)  ←  nullProvider (the default)          │
        │  │  AICapabilityRegistry                                            │
        │  │  scenePlanner  (maxSeverity: 'warning')                          │
        │  │  prompts/  (versioned data)      capabilities/  (Phase 19.5+)   │
        │  │  keychain adapter (credentials — never in a document)            │
        │  │                                                                 │
        │  │  OUTPUT: PlanEnvelope (JSON)   INPUT: a brief + asset ids        │
        │  │  CANNOT: import commands · import core/document · touch state   │
        │  └──────────────────────────────┬──────────────────────────────────┘
        │                                 │ Plan only
┌───────▼─────────────────────────────────┴──────────────────────────────────────┐
│  CORE  [core]              PURE. No React, no DOM, no browser globals        │
│                              outside *.browser.ts.   243+ tests, no browser.  │
│                                                                              │
│  ┌── plans/ ────────────┐   PlanEnvelope → parse (total) → validate           │
│  │ types · parse ·      │   → compile (deterministic) → Command[]            │
│  │ validate · compile   │   → preview  (=== the result, not an estimate)     │
│  └──────────┬───────────┘                                                      │
│             │ Command[]                                                        │
│  ┌──────────▼───────────┐   applyCommand / applyCommands                       │
│  │ commands/           │   injected allocate() + now()  →  deterministic     │
│  │ types · registry    │   batch = ONE commit  →  ONE undo step              │
│  └──────────┬───────────┘                                                      │
│             │                                                                  │
│  ┌──────────▼───────────┐   114 pure exported operations + factories         │
│  │ document/           │   Project  ←→  new Project.  No in-place mutation.   │
│  │ projectOps · sceneOps│   validateProject  ← refuses an invalid document    │
│  │ trackOps · dialogue │   lookups (25)  ·  invariants                       │
│  │ lookups·invariants  │                                                      │
│  └──────────┬───────────┘                                                      │
│             │                                                                  │
│  ┌──────────▼──────────────────────────────────────────────────────────────┐ │
│  │ THE ENGINE                                                              │ │
│  │  animation/  sample.ts (keyframes, per-channel, discrete hold)          │ │
│  │              sampleCamera · talkPulse · frameBounds   [pure]             │ │
│  │  timeline/   geometry.ts (lanes, ruler, snap) · episode.ts  [pure]       │ │
│  │  audio/      audioPlan.ts → AudioSegment[]      [pure]                  │ │
│  │              episodePlan.ts (offsets)           [pure]                  │ │
│  │              recording.ts (hasRecording)         [pure]                  │ │
│  │  render/     renderScene(ctx, SceneContext, scene, time, options)         │ │
│  │              resolve.ts (rest←pose←expr←anim←key)  shapes.ts             │ │
│  │              RenderIndex  ·  pure · deterministic · content-blind        │ │
│  │  export/     frameSequence (pure) · frameEncoder · videoEncoder  (P12)   │ │
│  │  continuity/ checkContinuity  [specified, NOT implemented — §15.6]       │ │
│  │  serialize   CURRENT_FORMAT_VERSION · MIGRATIONS · parseProject (total)   │ │
│  └──────────┬──────────────────────────────────────────────────────────────┘ │
│             │                                                                  │
│  ┌──────────▼───────────┐   browser globals allowed in *.browser.ts ONLY     │
│  │ *.browser.ts        │   audioEngine · indexedDb · frameEncoder            │
│  │ persistence · audio │   Everything else is pure and testable in Node.     │
│  └──────────────────────┘                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
        │
        │  ┌─────────────────────────────────────────────────────────────────┐
        └──│  DATA  [data]         ZANZA. Content only. Phase 14: the series  │
           │  seedSeries · seedProject (split) · rig builder                  │
           │  characters · environments · poses · expressions · props · audio│
           │  rule3.test · render.test · seed.test · ops.test · rig.test      │
           │  PROHIBITED IN core: nia kito zanza sheng nairobi 2097           │
           └─────────────────────────────────────────────────────────────────┘

╔══════════════════════════════════════════════════════════════════════════════╗
║  DIRECTION OF DEPENDENCY — downward only, enforced by eslint.config.js        ║
║                                                                              ║
║    ui (3)  ──▶  state (2)  ──▶  core (1)  ──▶  (nothing)                   ║
║                                    ▲                                          ║
║    ai  ──Plan/Command──▶  core     │  NEVER core ──▶ ai                     ║
║                                    │                                          ║
║    data (1)  ──▶  core (1)         │  peers only                             ║
║                                                                              ║
║  Enforced gates:  G1 multi-series · G2 content-blind renderer               ║
║                   G3 AI isolation · G4 migration render-neutrality          ║
║                   G6 command coverage · G7 plan validity                     ║
╚══════════════════════════════════════════════════════════════════════════════╝

  JSDoc notes:  [pure]          no I/O, no clock, no randomness
                [specified]     designed, NOT implemented
                *.browser.ts     the only modules allowed browser globals
```

### 30.1 How this differs from the brief's proposed diagram

| The brief proposed | This specification | Why |
|---|---|---|
| `Series Manager`, `Asset Registry`, `Project Registry` as three top-level systems | One `SeriesRepository` + one `ProjectRepository` + one `MediaStore` | A registry is a lookup over a store. Three systems implies three stores and cross-store integrity, for what is one database with four object stores. §4.4. |
| `Production Engine → Document Model, Document Operations, Commands, Plan Validator, Plan Compiler, Invariants, Animation, Timeline, Camera, Audio, Renderer` | The same list, but with **Commands above Document Operations** and **Plans above Commands** | The brief's list is a flat enumeration. The ordering in this diagram is the actual dependency: plans emit commands, commands call operations, operations produce documents. `Camera` is not a module — it is a track kind, a `Camera` struct and a `CameraPreset` table. |
| `Editor → Project Browser, Series Browser, Scene Editor, Timeline, Asset Browser, Review` | The same six | Agreed, with `Review` split into `PlanReviewPanel` and `PlanEditor`, and `Project Browser`/`Series Browser` merged into one browser (an installation with a few dozen projects does not need two levels of navigation, and two levels is one too many on a 1440p screen). |
| `AI Production Layer → Showrunner, Writer, Director, Asset Director, Voice Director, Audio Director, Continuity` | One `AIProvider` interface + a capability registry | The brief's seven roles are **one mechanism** with different prompts. Building seven subsystems for one pipe is the overbuild RULE 1 exists to prevent. §12.7. |
| A "Multi-series" diagram with Studio at the top | Series at the top of the data, no Studio | §28.1. There is one operator; a Studio is a tenancy boundary with no tenancy. |
| `Shot` implied by "multiple shots per scene" | No `Shot` entity | §17.3. Multiple shots per scene already work; a `Shot` is justified only when continuity needs shot *membership*. |

---

## 31. FINAL PHASE TABLE

**This is the authoritative implementation roadmap.** It replaces the phase list in `docs/ROADMAP.md`. Phases 0–8 are the historical record and keep their numbers; everything from 9 onward is this table.

| Phase | Name | Primary Goal | Depends On | Major Deliverable | AI? |
|---|---|---|---|---|---|
| 0–6 | Architecture → Character system | Foundation | — | Types, ops, assets, environments, rigs, composition | No |
| 7 | Timeline | Manipulation | 0–6 | Lanes, ruler, clips, keyframes, tracks, one-commit-per-gesture | No |
| 8 | Dialogue / audio | Mechanism + honest silence | 7 | `audioPlan`, Web Audio scheduler, dialogue panel | No |
| **9** | **Camera Authoring** | Make the camera authorable | 8 | `CameraPreset`, `frameBounds`, `CameraPanel`, presets, frame-selection | No |
| **10** | **Episode Playback & Transport** | EP001 plays end to end | 9 | `episodeTimeline`, `episodePlan`, continuous playhead, spacebar | No |
| **11** | **Project IO & Session Lifecycle** | Keep work; close Phase 8 | 10 | `Project\|null`, ProjectBrowser, JSON import/export, media store, file attach, **F4 + F5 fixed** | No |
| **12** | **Export** | Produce a playable file | 10 | PNG still → PNG sequence → video; mixdown; honest codec reporting | No |
| **13** | **MVP Acceptance & Doc Truth** | Prove it; make the docs honest | 11, 12 | The 10 manual checks; 6 false doc claims corrected; roadmap replaced | No |
| **14** | **Series & Asset Scope** | Make ZANZA the *first* series | 13 | `SeriesDef`, `SceneContext`, v1→v2 migration (render-neutral), SeriesBrowser | No |
| **15** | **Engine Correctness & Render Performance** | Stop lying; stop being O(n²) | 14 | `RenderIndex`, `scaleY` fix, `mouthSlot`, colour validation, golden fixtures | No |
| **16** | **Commands, Transactions & Provenance** | A named, atomic seam | 15 | `src/core/commands/`, `applyCommands`, `HistoryEntry`, coverage gate | No |
| **17** | **Plans, Validation & Compilation** | The pure plan pipeline | 16 | `parsePlan` → `validatePlan` → `compilePlan`; `preview === applied` | No |
| **18** | **Plan Review Workflow** | Human in the loop | 17 | Plan diff, 3-still preview, plan editor, Apply/Undo, `Edit`d badges | No |
| **19** | **AI Boundary & First Capability** | The first AI feature | 17, 18 | `AIProvider` + `nullProvider`, Scene Planner, capability ceiling, isolation gate | **Yes** |
| 20+ | Audio production · Continuity · Asset authoring · Art pipeline · Packs | Content depth | any | `VoiceDef`, `checkContinuity`, asset editor, `ImageResolver`, ZIP | Optional |
| 21 | Animation Assets | Reusable clips | 14, 20+ | `AnimationAsset`, `Clip.animationId`, 5-layer override | No |
| 22+ | More AI capabilities | One `kind` each | 19 | Showrunner, Episode, Asset/Voice/Audio Director, Continuity | **Yes** |
| 23 | Cloud repository & accounts | RULE 10 lifted | 21+ | `HttpProjectRepository`; **no editor change** | No |

**The shape of the table is the argument.** Eleven phases of engineering with no AI in them, then the AI layer, then optional AI capabilities. The brief's diagram puts AI at the top of the system from day one; this table puts it at the bottom, plugged into a seam that was built and tested for it by five phases that had nothing to do with it.

---

## 32. FINAL RISK REGISTER

Architectural risks, not generic software risks. Severity is the cost of being wrong, not the probability.

| # | Risk | Severity | When It Appears | Mitigation |
|---|---|---|---|---|
| R1 | **The Series refactor is done before the MVP is proven, and the document model turns out to be wrong** | **Critical** | If Phase 14 precedes Phase 13 | Phase ordering: 13 → 14. Plus the render-neutrality gate (§6.5), so a Series bug cannot masquerade as a model bug. This is the single most valuable scheduling decision in this document. |
| R2 | **A plan is applied without review, or a review step is bypassed for convenience** | **Critical** | Phase 19, and every "just this once" after it | Hard gate in code, never a preference. `scenePlanner` cannot emit creating or deleting commands, enforced by a command-kind allow-list test (§24.10). No "trusted mode" is ever added. |
| R3 | **A corrupt project is silently overwritten** (F5, present today) | **Critical** | Already live | Quarantine on parse failure (§5.6); fixed in Phase 11 step 3, deliberately early. The bad record is never written again. |
| R4 | **Edits are lost on tab close** (F4, present today) | High | Already live | Wire `flush()` to `visibilitychange`/`pagehide`; Phase 11 step 2, deliberately first. |
| R5 | **A cross-project or cross-series asset reference dangles** | High | Phase 14 | `removeAsset` refuses a referenced series asset and names the referrer; `validateProject` runs against the merged library; a project that is valid alone but dangling against its series is refused at open. |
| R6 | **An AI plan proposes something valid but unusable, and validation says "ok"** | High | Phase 19 | Validation cannot catch judgement. The three-still preview and the human are the gate (§13.3). Stated here so nobody later "improves" the review flow by trusting the validator. |
| R7 | **The command layer drifts from what the editor can do** | High | Phase 16, and every phase after | The command-coverage lint rule (§7.7, G6), not diligence. This drift is what would make the plan compiler wrong. |
| R8 | **The plan compiler becomes non-deterministic, so the preview lies** | High | Phase 17 | Injected `allocate`/`now`; `Date`/`crypto`/`Math.random` banned by lint in `core/commands` and `core/plans`; the `preview === applied` test is a gate (§33 G8), not a nice-to-have. |
| R9 | **Export depends on a browser codec that is absent on the target machine** | High | Phase 12 | PNG sequence first, as the reference path; video is additive; capability is feature-detected and reported honestly, never assumed. The exporter's correctness is verified against draw-log goldens, so a codec failure can never be mistaken for a renderer failure. |
| R10 | **Snapshot history exhausts memory at episode scale** | Medium | Phase 17+ (plan folds arrive before episodes do) | Adaptive `HISTORY_LIMIT` by document size (§22.4). Patch-based history explicitly rejected — it is contained to `commit()` but is a real risk with no current need. |
| R11 | **`resolveRig` allocations or the render loop regress performance on the RULE 14 machine** | Medium | Phase 15 | The `RenderIndex` and the Stage dirty check. A draw-op-count ceiling test catches the algorithmic regressions deterministically, because a wall-clock assertion in CI gets disabled within a month. |
| R12 | **The AI's output is used as data, not as a suggestion, somewhere in the code** | Medium | Phase 19 and after | `src/ai/**` cannot import `applyCommands`; the architecture tests assert it. The plan is the *only* output channel, and it lands in a document only through `commit` after review. |
| R13 | **Prompt injection through the scene brief** | Medium | Phase 19 | The brief is data inside a delimited block; the output schema only accepts ids that exist; no tool loop; capability ceiling. The real mitigation is structural: an injected instruction cannot create an asset, because no capability can. |
| R14 | **The renderer is given a second responsibility and loses purity** | Medium | Any future renderer work | D12 is frozen. The `images` branch is deleted rather than left as dead code with a half-wired contract (R5 in §18.2). |
| R15 | **Phase numbers drift again and the roadmap becomes unreadable** | Medium | Immediately | §31 is authoritative and §24.1 maps every old number. The change log in `ROADMAP.md` records renumbering explicitly, as it already does for a status correction. |
| R16 | **Scope creep into the platform before the MVP ships** | Medium | Ongoing | RULE 1. Every phase in §31 is sized for one concern, and §28 names the deferred work so it is not re-litigated mid-phase. Phase 14 is the *first* platform phase, and it is gated on Phase 13. |
| R17 | **The docs drift from the code again** | Medium | Ongoing | Six false claims exist today (Appendix A). Phase 13 corrects them; the review discipline in `docs/PLAN.md` catches new ones; a docs-link test catches dead file references, which is the specific failure mode found twice (`render.test.ts`, `invariants.test.ts`). |
| R18 | **`shot` is introduced because it sounds useful** | Medium | Whenever camera authoring strains | §17.3's four signals, and signal 4 (continuity needs shot membership) is the only one that justifies it. Named so "it would be tidier" is not sufficient. |
| R19 | **A future AI capability can create assets, breaking RULE 2** | Medium | Phase 19.5+ | Capability ceilings are per-capability and enforced by a command-kind allow-list. Raising one is a code change with a written justification, which is the point. |
| R20 | **`CharacterDef.height` stays dead while the docs claim it is used** | Low | Already live | `docs/DATA_MODEL.md:127` describes a stage control that does not exist. Either the field gets used (it is a sensible input to `frameBounds` in Phase 9) or the doc is corrected in Phase 13. Tracked here so it is not forgotten. |
| R21 | **The `isActorTalking` / `allClips` O(actors × clips) cost reappears in a new consumer** | Low | Any future per-frame code | The `RenderIndex` is the sanctioned place for per-frame lookups, and the draw-op ceiling test plus a code-review question ("is this inside a per-frame path?") catch it. |

---

## 33. ARCHITECTURAL ACCEPTANCE GATES

Each gate is a test or an explicit check that must be demonstrably met before the next phase begins. A gate that cannot be *run* is not a gate. `docs/PLAN.md` records the discipline: `npm run verify` first, then an independent review pass, because three real defects passed every gate.

### G0 — Build gates (every phase, unchanged)

```bash
npm run lint       # clean
npm run typecheck  # clean
npm run test       # green, with new tests for new logic
npm run build      # succeeds
```

Necessary. Not sufficient. Never weakened to make a phase pass (RULE 8).

---

### G1 — Multi-series gate *(Phase 14)*

> *A second, structurally different fictional series can exist in the same installation, be authored, and render, with zero changes to `src/core/**` beyond the Series migration itself.*

**How it is checked:** `src/arch/multiseries.test.ts` builds a synthetic series with a different palette scheme, a different rig topology (a non-humanoid: no `armL`, no legs), a different environment size, and different pose/expression names. It is placed in the same database as ZANZA, both are openable in turn, and both render. The test asserts the *content-blindness* grep finds no show token in `src/core/**`.

**What it proves:** the renderer, the sampler, the operation set and the command vocabulary are genuinely generic. This is the automated form of "ZANZA is content, not architecture" — and the non-humanoid rig is the part that matters, because a humanoid with different colours would pass a design that secretly assumes arms and legs.

**Broken if:** a second series needs a `core/` change. **Not satisfied by:** a second series that is a recolour of the first.

---

### G2 — Content-blind renderer gate *(Phase 14, re-asserted every phase after)*

> *The renderer contains no show-specific identifiers, and no magic rig slot names.*

**How it is checked:** `src/arch/contentBlindness.test.ts` greps `src/core/**` for `nia|kito|zanza|sheng|nairobi|kilimani|2097|proj_zanza`, for any episode or scene id literal, and for the hardcoded slot name `'mouth'` outside a documented default. Runs in CI, fails the build.

**What it proves:** the property `docs/ARCHITECTURE.md` asserts in prose and `src/data/rule3.test.ts` demonstrates for one character. The grep makes it continuous rather than a one-time observation, and it is the direct regression gate for F2.

**Broken if:** any of those tokens appears in `src/core/**`, including in a test fixture (fixtures live in `src/data/`).

---

### G3 — AI isolation gate *(Phase 19)*

> *Removing all AI code leaves the editor fully functional.*

**How it is checked:** (1) delete `src/ai/**`; (2) run the full suite; (3) every test that is not an AI test passes unchanged. (4) Additionally, `src/arch/planIsolation.test.ts` runs always: no `src/core/**` test imports `src/ai/**`, and no provider name appears in any `src/core/**` type or switch.

**What it proves:** the core engine is usable with AI completely disabled — the brief's hardest requirement, and the one most easily lost by a convenience import.

**Broken if:** a `core` test, a `core` type, or a `state` module needs the AI layer to work.

---

### G4 — Migration render-neutrality gate *(Phase 14)*

> *Migrating a v1 project to v2 changes no pixel.*

**How it is checked:** for every scene in the v1 seed and in a hand-built v1 fixture, at times `{0, 0.5, 1.0, 2.37, duration − 0.01, duration}`, the `RecordingContext` draw log from `renderScene(ctx, v1Project, scene, t)` is deep-equal to the log from `renderScene(ctx, resolveAssets(v2Project, series), scene, t)`.

**What it proves:** the Series change is a scope change, not a behaviour change. It also catches an entire class of migration bug — a changed id, a reordered collection, a lost field — that unit tests on the data model would not.

**Broken if:** a single draw operation differs. **Not satisfied by:** "the scenes look the same".

---

### G5 — Transaction gate *(Phases 16, 17)*

> *A failed plan produces zero partial mutations.*

**How it is checked:** a fixture sequence of 200 commands in which command 137 deletes a scene that command 200 modifies. `applyCommands` returns `ok: false` with `path: 'commands[136].DeleteScene'`; `ctx.project` is `===` the input document; no intermediate document is reachable; no `commit` occurred.

**Plus:** a single failing command in a batch returns the original document, and a command that *succeeds* but produces an invalid document is refused with `invalid-result`.

**What it proves:** the brief's "no half-applied AI plan, no silent invalid operation". It is checked on a large sequence deliberately — the failure mode is a partial fold that only shows up in the middle of a long one.

**Broken if:** any mutation is observable after a failure. **Not satisfied by:** a rollback that restores the document but has already written to IndexedDB.

---

### G6 — Command coverage gate *(Phase 16, and every phase after)*

> *Every user-visible mutation is a named command, and every command is reachable.*

**How it is checked:** `src/arch/commandCoverage.test.ts` plus a lint rule. No `src/ui/**` module imports a mutating function from `src/core/document/*Ops`; read-only lookups are permitted. Every `commit()` call site outside `src/core/` is inside a UI action that dispatches a command from the registry. Every command in the registry is either dispatched by a UI action or emitted by `compilePlan`.

**What it proves:** the command vocabulary describes what the editor can actually do. This matters because `PlanCompiler` emits commands: a vocabulary that has drifted is a compiler that cannot express a legitimate edit, and the plan layer would be quietly incomplete.

**Broken if:** a panel can change the document without naming what it did.

---

### G7 — Plan validity gate *(Phases 17, 19)*

> *AI plans must validate before mutation, and an unresolvable reference can never reach the engine.*

**How it is checked:** three tests. (1) A `ScenePlan` naming a nonexistent `characterId` produces `missing-character` at `dialogue[0].actorRef` and `cast[0].characterId`, and `applyCommands` is never called. (2) A `ScenePlan` whose `newScene.duration` is 0 produces `invalid-duration` and mutates nothing. (3) A response that is not a plan — prose, a truncated JSON object, a `kind` from a future version — produces a clean `PlanParseError` and a crash-free UI, and `commit` is not called.

**Plus:** with a fake provider, a hostile brief attempting to reference an asset outside the permitted list fails validation.

**What it proves:** the brief's "AI output must be treated as untrusted data", enforced structurally rather than by a prompt.

**Broken if:** any plan with an unresolvable id reaches `commit`, or any malformed response can crash the editor.

---

### G8 — Preview-exactness gate *(Phase 17)*

> *The preview is the result, not an estimate of it.*

**How it is checked:** for every fixture plan, `applyCommands(compilePlan(plan, ctx), ctx + countingAllocator)` is deep-equal to the document produced by applying the same plan through the real apply path. Both are run from the same starting project, and the allocator seed is identical.

**What it proves:** the review UI cannot show the user something different from what lands. Once this fails, every downstream trust property of the AI layer is gone, and it fails *silently* — the preview looks plausible. This is why it is a gate rather than a test.

**Broken if:** the preview and the applied document differ in any field, including generated ids.

---

### G9 — Undo granularity gate *(Phases 9, 11, 16, 17, 18)*

> *Every user-visible mutation is undoable, and a compound operation is one undo step.*

**How it is checked:** one test per mutation surface: a camera preset apply, a frame-selection, a playhead-adjacent edit, a file attach, a project open/close, a dialogue drag (already asserted in `Timeline.test.tsx`), a 200-command plan apply, a plan review session. Each asserts exactly one `past` entry and an exact restoration of the prior document.

**What it proves:** RULE 7. It is the oldest gate in the project and the one most likely to be quietly broken by a refactor that introduces a second write path — which is exactly what Phases 11, 16 and 18 each do.

**Broken if:** any mutation adds zero undo steps, or more than one for a compound operation.

---

### G10 — Determinism gate *(every phase touching the renderer, the sampler, the compiler or a migration)*

> *The same input always produces the same output.*

**How it is checked:** three tests. (1) The existing `renderScene` call-log determinism test (`src/data/render.test.ts:32`) keeps passing. (2) `compilePlan` is byte-identical across repeated runs. (3) Golden draw logs for the acceptance scene at the `docs/MVP.md` §1 times, committed as fixtures, so a renderer change is either intentional (fixture updated with a written reason) or a regression caught in review.

**What it proves:** frame-accurate export, testable undo-redraw, and a reviewable renderer diff. `docs/PLAN.md` records the inverse lesson: a green gate is evidence of not having checked, and a golden log that is *diffable in review* is what makes this gate more than a tautology.

**Broken if:** identical input produces a different log, or a golden changes without a written reason.

---

### G11 — Data-integrity gate *(Phase 11)*

> *A document that fails to parse is never written, and a corrupt record is never overwritten.*

**How it is checked:** (1) An import of an invalid `.zanza.json` writes nothing to any store and reports the issues. (2) A record whose `document` is corrupted is quarantined on load, the store is not modified, and the UI shows a recovery state. (3) A save in flight does not clobber a newer edit. (4) `autosave.flush()` is invoked on `visibilitychange`.

**What it proves:** F4 and F5 are fixed, and stay fixed. (2) is the one that matters: data loss is worse than a failed load, always.

**Broken if:** any code path writes a document that failed validation, or overwrites a record it could not read.

---

### G12 — Layering gate *(every phase)*

> *Imports flow downward only; core never imports AI.*

**How it is checked:** the existing `local/no-upward-imports` ESLint rule, plus `src/arch/layering.test.ts` for the rules the lint tiers do not express: `core` must not import `data`; `ai` must not import `state` or `ui`; `*.browser.ts` is the only place a browser global may appear.

**What it proves:** RULE 5 and the brief's "Never: Core → AI". Note that `PLAN.md`'s "Known gap: layering is unenforced" is **stale** — `eslint.config.js:75` has enforced it since before this audit. What is genuinely unenforced is `core → data`, which this gate adds.

**Broken if:** any upward import compiles, or any browser global appears outside a `*.browser.ts` file.

---

### G13 — Documentation-truth gate *(Phase 13, and every phase after)*

> *Every claim in `docs/` matches the code.*

**How it is checked:** a link-and-reference test that every file path mentioned in `docs/*.md` exists; a review pass at every phase gate (already required by `docs/PLAN.md`); and Appendix A's six corrections applied in Phase 13.

**What it proves:** RULE 9 at the documentation level. Six claims are false today, and two of them — `src/core/render/render.test.ts` and `src/core/document/invariants.test.ts` — are references to test files that have never existed, which is how a reader can be sent looking for evidence that was never written.

**Broken if:** a doc names a file that does not exist, or claims a feature is implemented when it is a placeholder.

---

### G14 — MVP acceptance gate *(Phase 13)*

> *The ten manual checks in `docs/MVP.md` §4 pass at 1440p and 1920p.*

**How it is checked:** by hand, in a browser, with the results recorded in `ROADMAP.md`'s changelog. Checks 1, 2, 3, 6, 7, 8, 9 and 10 are the load-bearing ones; check 10 (a fifth character with no `core/` change) is already automated in `src/data/rule3.test.ts` and must also pass manually.

**Note:** check 3 says "spacebar plays and pauses" and **no spacebar binding exists today** — the transport has a Play/Pause button. Either the binding ships in Phase 10 (it is on that phase's list) or the check is amended. It must not be quietly marked passed.

**What it proves:** the milestone. **Broken if:** any check is reported as passing without having been run.

---

## Appendix A — Documentation corrections required in Phase 13

Six false or stale claims found by reading the source against the docs at `3a3a144`. Each is a concrete, checkable error, and the fix is Phase 13's job.

| # | File:line | Claim | Reality |
|---|---|---|---|
| A1 | `docs/ARCHITECTURE.md:167-170` | "**Three** independent override layers: `rest ← pose ← keyframe`" | **Four**: `rest ← pose ← expression ← keyframe` (`resolve.ts:141-143`). `docs/DATA_MODEL.md:102` has the same error. |
| A2 | `docs/ARCHITECTURE.md:236-237` | "Autosave … also flushes on `visibilitychange`" | `autosave.flush()` is **never called**; no `visibilitychange` or `pagehide` listener exists. An edit within 800 ms of closing the tab is lost. (F4) |
| A3 | `docs/ARCHITECTURE.md:251` | "See `src/core/render/render.test.ts`" | That file does not exist. The determinism test is at `src/data/render.test.ts:32`. |
| A4 | `docs/ARCHITECTURE.md:264` | "`data` imports `core` types only" | `src/data/rig.ts` imports **runtime values** from `core/render/shapes`. |
| A5 | `docs/ARCHITECTURE.md:69, 297-299` | "the render loop skips the frame entirely when nothing has changed"; "an idle editor costs no CPU" | `src/ui/Stage.tsx:69` calls `renderScene` unconditionally every rAF. No dirty check exists. (R6) |
| A6 | `docs/ARCHITECTURE.md:281` | "Audio pipeline is real and exercised by tests with **generated tones**" | No tone is ever synthesised. `audioEngine.browser.test.ts` drives a hand-written fake `AudioPort`. The mechanism is real; the wording is not. |

**Additional corrections, lower severity but in the same category:**

- `docs/ARCHITECTURE.md:80-81` documents a `HistoryEntry` type. It does not exist. It becomes real in Phase 16.
- `docs/ARCHITECTURE.md:168` names `resolveActor(character, pose, expression, time)`. No such function; it is `resolveCharacter(character, options)`.
- `docs/ARCHITECTURE.md:178` lists shape primitives as "`ellipse`, `roundRect`, `path`, `poly`". There is no `poly`; `rect` is missing. `polyline()` is a constructor returning `{ kind: 'path' }`.
- `docs/ARCHITECTURE.md:209` attributes `clampTime()` to the sampling module. It is in `src/core/timeline/geometry.ts` and is not in the render path.
- `docs/ARCHITECTURE.md:220` says `IndexedDbProjectRepository` is the only implementation. `MemoryProjectRepository` also implements it.
- `docs/ARCHITECTURE.md:229` says `migrateProject` is an ordered list of migrations. `MIGRATIONS` is an **empty array**; no migration has ever run.
- `docs/ARCHITECTURE.md:196` says the renderer "already handles" image parts. The `drawImage` branch requires `options.images`, which no caller passes. The branch is dead.
- `docs/ARCHITECTURE.md:266-268` names the RULE 3 test character `"test.puppet"` and claims a selector assertion. The id is `char.synthetic_tester`; there is no selector assertion.
- `docs/ARCHITECTURE.md:278` lists `MediaRecorder` as a live risk to "feature-detect". There is no export code at all.
- `docs/DATA_MODEL.md:365` cites `src/core/document/invariants.test.ts`. It does not exist; the invariants are exercised indirectly.
- `docs/DATA_MODEL.md:127-129` describes `CharacterDef.height` driving a stage control, and a `getCharacterHeadY()` function. Neither the control nor the function exists; `height` is never read in `src/`.
- `docs/DATA_MODEL.md:371` says "Every `Track` and `Clip` `targetId` resolves". `Clip` has no `targetId`.
- `docs/DATA_MODEL.md:148` documents `EnvPart { id: string }`. It is `id?: Id` — optional.
- `docs/DATA_MODEL.md:43-46` says every part has a slot, parent, pivot and rest transform. True of `PartDef`, false of `EnvPart`, which has none of them.
- `docs/DATA_MODEL.md:136-138` uses `Nia_Couch` / `Kito_Door` as anchor ids. The seed uses `anchor.nia_couch` / `anchor.kito_door`.
- `docs/MVP.md:51` says undo is "not yet wired to keyboard shortcuts". Ctrl/Cmd+Z is wired in `src/ui/App.tsx:40-55`; `docs/MVP.md:94` check 4 relies on it. The same table's rows 10, 11 and 12 are stale against the shipped dialogue panel and transport.
- `docs/MVP.md:55-56` says items with `none` in the UI column "are Phase 7 and Phase 12 work" and points at `ROADMAP.md`, which says the current phase is 8 and Phase 7 is complete.
- `docs/PLAN.md:261-270` records a "Known gap: layering is unenforced". `eslint.config.js:75` has enforced downward-only imports as an error. The genuinely unenforced edge is `core → data`.
- `docs/PRODUCT.md:80` says MVP scope ends at EXPORT, while `docs/MVP.md:53` records export as not started. `docs/PRODUCT.md:86` also adds AUDIO to the milestone, which `docs/MVP.md:4` does not.

**The pattern, stated once:** the docs are not wrong about the architecture; they are wrong about *what exists*. `AGENTS.md` RULE 9 asks for honest status labels in code and docs, and the drift is entirely in the second. Phase 13 is therefore a documentation phase with a real gate (G13), not housekeeping.

---

## Appendix B — Document map for implementation

| Concern | Module | Phase | Pure? |
|---|---|---|---|
| Domain types | `src/core/types.ts` | 14, 19, 20 | Yes |
| Document operations | `src/core/document/**` (114 exports) | unchanged | Yes |
| Invariants | `src/core/document/invariants.ts` | 14, 15 | Yes |
| Serialization + migrations | `src/core/serialize.ts` | 11, 14 | Yes |
| Commands | `src/core/commands/**` | 16 | Yes |
| Plans | `src/core/plans/**` | 17 | Yes |
| Plan diff | `src/core/planDiff.ts` | 18 | Yes |
| Continuity | `src/core/continuity/**` | 20+ | Yes |
| Sampling | `src/core/animation/sample.ts` | unchanged | Yes |
| Camera framing | `src/core/animation/frame.ts` | 9 | Yes |
| Timeline geometry | `src/core/timeline/geometry.ts` | unchanged | Yes |
| Episode timeline | `src/core/timeline/episode.ts` | 10 | Yes |
| Audio plan | `src/core/audio/audioPlan.ts` | unchanged | Yes |
| Episode audio | `src/core/audio/episodePlan.ts` | 10 | Yes |
| Recording predicate | `src/core/audio/recording.ts` | unchanged | Yes |
| Audio engine | `src/core/audio/audioEngine.browser.ts` | 15 (D1, D2) | No — browser |
| Renderer | `src/core/render/render.ts` | 14, 15 | Yes |
| Rig resolution | `src/core/render/resolve.ts` | 15 (R1, R2) | Yes |
| Render index | `src/core/render/index.ts` | 15 | Yes |
| Export | `src/core/export/**` | 12 | Partly |
| Media store | `src/core/media/**` | 11 | No — browser |
| IO | `src/core/io/**` | 11 | Partly |
| Persistence | `src/core/persistence/**` | 11, 14 | No — browser |
| Store | `src/state/editorStore.ts` | 11, 14, 16 | No |
| Plan review state | `src/state/planStore.ts` | 18 | No |
| Audio adapter | `src/state/audioChannel.ts` | 15 (D1) | No |
| AI layer | `src/ai/**` | 19+ | No |
| Content | `src/data/**` | 14 | Yes |
| Architecture tests | `src/arch/**` | 13, 15, 16, 17, 19 | Yes |
| Render test harness | `src/test/recordingContext.ts` | unchanged | Yes |

---

**ARCHITECTURE SPECIFICATION COMPLETE**

**Files created:** `docs/ARCHITECTURE_SPEC.md` (this document).
**No other file was modified.** `git status` shows only this new file and the pre-existing untracked `docs/9-14audit prompt.txt`.
**No code implemented.** Every type, module, phase, command, plan and gate described above is a design, not a change.
