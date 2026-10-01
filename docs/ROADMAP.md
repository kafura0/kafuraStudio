# ZANZA STUDIO — ROADMAP

> **Current phase: Phase 12 — RENDER EXPORT.**
> **Next: Phase 13 — MVP ACCEPTANCE & DOCUMENTATION TRUTH.**

Scope and ordering for this phase are [`ARCHITECTURE_SPEC.md`](ARCHITECTURE_SPEC.md)
§ Phase 12, which is the authority. The gate below narrows it deliberately; the
reason is stated in the section.

Canonical phase list. `AGENTS.md` RULE 1 forbids implementing any phase marked
`planned` until the current one is complete and its gates pass.

Phase *definitions and gates* are here. Sequencing, reasoning, and the review
discipline are in [`PLAN.md`](PLAN.md).

Status is reported honestly (RULE 9). A phase is `complete` only when its gate is
demonstrably met — a control that renders but does nothing is `partial`, not
complete.

Phases 0–8 keep their original numbers as the historical record. From 9 onward the
numbering is reconciled against
[`ARCHITECTURE_SPEC.md`](ARCHITECTURE_SPEC.md) §24.1, which retires the old Phase 10
(Animation) as a number and renumbers the old Phase 11 (Preview) to **10**.

---

## PHASE STATUS

| Phase | Name | Status | Gate |
|---|---|---|---|
| 0 | Architecture | **complete** | Docs written, stack decided and justified |
| 1 | Application shell + design system | **complete** | Shell renders, design tokens set |
| 2 | Project / episode / scene model | **complete** | Core types + pure document ops + tests |
| 3 | Asset library | **complete** | Characters, environments, poses, expressions, props, audio |
| 4 | Environment system | **complete** | Layered env + staging anchors + parallax |
| 5 | Character system | **complete** | Rig, pose/expression override, palette theming |
| 6 | Scene composition | **complete** | Actor placement, anchor binding, z-order, free + bound transform |
| 7 | Timeline | **complete** | Lanes, ruler, playhead, zoom, clip move/trim, keyframe editing, per-lane mute, track add/remove/reorder, clip add, drag clips to another track of the same kind — all through one undoable `commit()` per gesture. |
| 8 | Dialogue / audio | **complete** | Web Audio playback scheduled against the playhead, per-clip gain, and a dialogue panel that edits speaker, actor, emotion, text, subtitle, cue timing and voice — all through one undoable `commit()` per gesture. Missing recordings are reported honestly in the UI. A file can be attached to a slot from `AudioSlotPanel`, which closed the gate this phase was left `partial` for. |
| 9 | Camera Authoring | **complete** | Rest camera and keyframed moves resolve and render. A camera panel authors rest framing numerically, applies any of the seeded shot presets in one undoable step, and frames a selection to fit. `frameBounds` inverts the renderer's own camera transform, and an invariant test holds the two to each other. |
| 10 | Episode Playback & Transport | **complete** | EP001 plays from the first frame of scene 1 to the last frame of scene 5, and the playhead is continuous across all four scene boundaries. Offsets, the boundary crossing, the end-of-cut wrap, and the audio cut are pure core; the clock is still the store's single `advancePlayback`. |
| 11 | Project IO & Session Lifecycle | **complete** | `Project \| null` + project browser, `.zanza.json` import/export, media store, starter project, F4/F5/F6 fixed. 627 tests green. |
| 12 | Export | **in progress** | `frameSequence` is pure and tested; PNG still and PNG sequence; the exporter's draw log is deep-equal to the stage's; mixdown via `OfflineAudioContext`; `ExportPanel` reports capability honestly. |
| 13 | MVP Acceptance & Documentation Truth | **planned** | Not started. |

### What exists today
Verified by `npm run lint && npm run typecheck && npm run test && npm run build`:

416 tests green, all four gates clean.

- Pure core: types, geometry, keyframe sampling, document operations, invariants,
  versioned serialization, and a deterministic Canvas 2D renderer.
- Playback: pure `timeline/episode` flattens a cut into timed segments, resolves an
  episode time to a scene and a local time, and totals a duration; pure
  `audio/episodePlan` offsets the scene-local audio segments onto the episode clock,
  shared with Phase 12's mixdown.
- Audio: a pure `audioPlan` turning timeline clips into audible segments, and a Web
  Audio scheduler fed the store's clock, so picture and sound cannot drift. A scene
  boundary is a hard audio cut.
- Persistence: `ProjectRepository` + IndexedDB, re-validating on read.
- Content: shared rig builder, 4 characters, 3 environments, poses, expressions,
  props, declared audio slots, and the EP001 seed project — which validates with
  zero invariant issues and renders every one of its five scenes.
- Editor: Zustand store with snapshot undo/redo through a single `commit()` path,
  debounced autosave, and a canvas stage that redraws without re-rendering React. One
  clock, two modes: episode-sequential by default, scene loop on demand.
- UI: scene list (which follows the clock), read-only asset library, transport bar with
  an episode-length scrubber, a dialogue panel, a camera panel, the timeline, and the
  issue panel. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+S, and spacebar are bound.

### What is deliberately not built

Asset editing and export. These are the phases above, not gaps in the ones below.

---

## PHASE 7 — TIMELINE (complete)

The final phase of the MVP. Success is the acceptance gate in `docs/MVP.md` §4,
not new features.

- [x] `npm run lint` clean — **done**
- [x] `npm run typecheck` clean — **done**
- [x] `npm run test` green — **done** (196 tests)
- [x] `npm run build` succeeds — **done**
- [x] One store-owned clock drives the stage, the transport, and the timeline
      playhead — **done**
- [x] Timeline geometry is pure and DOM-free — **done**, `src/core/timeline/`
- [x] Lanes, ruler, playhead, zoom, clip move and trim — **done**
- [x] A drag is one undo step, not one per frame — **done**, asserted in
      `Timeline.test.tsx`
- [x] Undo/redo covers every mutation path in the UI — **done**; one `commit()`
      path, exercised by the timeline
- [x] Keyframe editing — **done**: double-click a clip to pin the pose there, drag
      the diamond on the frame grid, Delete/Backspace to remove. Moved or start-trimmed
      clips carry their keyframes; an end trim cuts the keyframes it cuts away.
- [x] Track management — **done**: each lane has add-clip-at-playhead (`+`), delete
      (`×`, a dialogue cue lane takes its line with it), reorder (`↑`/`↓`), and mute
      (`M`). Core ops `moveTrack` and `relocateClip` are tested; a drag that lands
      on a lane of the wrong kind burns no undo step.
- [x] Drag-to-another-track — **done**: dragging a clip onto a same-kind lane
      relocates it in one commit; the target lane highlights while the pointer is
      over it, `Alt` still un-snaps.
- [x] A fifth synthetic character is placeable with zero `core/` changes (RULE 3
      test) — **done**, automated in `src/data/rule3.test.ts`
- [x] Docs match the implementation — **done**

Browser-verified autosave survives a hard reload was listed here; it is an in-app
verification and is tracked with the Phase 13 browser pass instead. Export is
Phase 12.

---

## PHASE 8 — DIALOGUE / AUDIO (partial)

The mechanism is built; the recordings are a production task and the panel says so.

- [x] A pure `audioPlan` decides what should be audible, where, for how long, and at
      what gain — **done**, `src/core/audio/audioPlan.ts`, unit-tested without a browser
- [x] Web Audio playback scheduled against the playhead the store already owns —
      **done**, `src/core/audio/audioEngine.browser.ts` + `src/state/audioChannel.ts`.
      One clock for picture and sound, so they cannot drift
- [x] Per-clip gain as a mix control — **done**, `setClipGain` reached from the
      dialogue panel's slider; a drag is one undo step
- [x] A dialogue editing panel — **done**: speaker, actor, emotion, text, subtitle
      override, cue start and duration, voice assignment, and delete. Fields commit on
      blur so a typed line is one undo step
- [x] Re-timing a line by line id as one operation — **done**, `setDialogueCue`, which
      routes through the same `moveClip`/`trimClip` a timeline drag uses
- [x] A missing recording is reported honestly — **done**: `hasRecording()` is the one
      predicate, the asset library marks every fileless slot, and the dialogue panel
      states that the line plays silent. No generated tone, no implied file
- [x] Subtitles can be turned off — **done**, the `CC` toggle; the `subtitles` render
      option had been accepted by the renderer and passed by nobody
- [x] Delete on a dialogue cue takes the line, its cue and its lane with it — **done**
- [x] Attaching a file to an audio slot — **done**, shipped as Phase 11 work
      (`AudioSlotPanel`): the file is decoded, stored in the media store, and the slot's
      `src` set through one undoable `commit()`. This is what closed the gate below
- [ ] A real mixdown — **not built**. `episodeAudioPlan` computes the episode-clock
      windows and the transport plays them, but nothing renders them to a single file.
      Phase 12

Gate: *"pressing play produces audio in time with the picture, and a missing recording
is reported honestly."* Both halves are now demonstrated. The mechanism was implemented
and tested against a fake `AudioPort` while every slot was still fileless; Phase 11 gave
an operator a way to attach a file, and the browser acceptance run plays one
(`state=running peak=0.5`) rather than reporting a peak of 0.0. The phase is
`complete`.

The episode-sequential half of this phase's deferred scope shipped as Phase 10; the
mixdown is Phase 12.

---

## PHASE 10 — EPISODE PLAYBACK & TRANSPORT (complete)

A scene loop is not an episode. This phase makes the cut play through, with one clock
and one playhead that never resets at a boundary.

- [x] `npm run lint` clean — **done**
- [x] `npm run typecheck` clean — **done**
- [x] `npm run test` green — **done** (416 tests)
- [x] `npm run build` succeeds — **done**
- [x] Scene offsets for a multi-scene episode — **done**,
      `src/core/timeline/episode.ts`, pure and DOM-free
- [x] The playhead crosses a boundary and lands at the right local time in the next
      scene — **done**, asserted in `episode.test.ts` and `editorStore.test.ts`
- [x] The end of the *cut* wraps; the end of a scene does not — **done**
- [x] One clock, unchanged — **done**. `advancePlayback` is still the only thing that
      moves time; only its wrap rule is mode-dependent, and `playbackMode` is not
      persisted
- [x] `Stage` renders scene-local time, so a scene past the first is not drawn at its
      own duration — **done**
- [x] The transport scrubber spans the episode, and the scene list follows the clock —
      **done**
- [x] A scene switch during playback stops the old audio and starts the new — **done**,
      `src/state/audioChannel.ts`, a hard cut ordered before the new schedule
- [x] Audio segments offset across the boundary — **done**,
      `src/core/audio/episodePlan.ts`, the same function Phase 12 mixes down
- [x] Spacebar transport — **done**, and it stands down while the user is typing

Gate: *"EP001 plays from the first frame of scene 1 to the last frame of scene 5, with
dialogue, expressions and camera moves, and the playhead is continuous across all four
scene boundaries."* Reachable in the app: press play.

Not built here, by the phase's own exclusions: export, transitions, a master timeline
view, per-scene audio offsets authored by hand.

---

## PHASE 12 — RENDER EXPORT (in progress)

Export is not "encode a video". It is: decide the frame list, prove the renderer draws
each of those frames correctly, and only then involve a codec. PNG-first is deliberate —
it makes export demonstrable and verifiable before any codec exists, so a codec problem
can never be mistaken for a renderer problem (`ARCHITECTURE_SPEC.md` Phase 12).

The unit of export is an **episode**, which may be one scene long. `frameSequence` takes
an episode, so a single-scene episode is the trivial case rather than a separate code
path built to be replaced later.

- [x] `frameSequence(settings, episode) -> { index, time }[]`, pure and DOM-free —
      **done**, `src/core/export/frameSequence.ts`. No canvas, no store, no document
      mutation. 12 tests cover fps, non-finite and non-positive fps, the half-open
      boundary, even `1/fps` spacing, and a duration that is an exact multiple of the
      frame interval
- [x] PNG still of the current frame — **done**, `exportStill` in
      `src/core/export/exportImages.browser.ts`
- [x] PNG sequence, frame by frame, at the computed frame times — **done**,
      `exportSequence`. It takes the frame list as an argument rather than recomputing it,
      so the exporter cannot disagree with `frameSequence` about what to export. One
      canvas is allocated and released per frame, so peak memory is one frame rather
      than one episode
- [x] The exporter's per-frame draw log is deep-equal to the golden `renderScene` log
      at the same times — **done**, `src/test/exportDrawLog.test.ts`. This, not visual
      inspection, is the exporter's real test, and it is what proves export renders
      through the *same* call as the stage rather than a second, subtly different path.
      The test calls the production `drawExportFrame`, not a copy of it, and covers every
      frame of the seed episode. It also asserts the logs are non-empty, that the scene
      boundary is resolved to the right scene, that the subtitle toggle genuinely changes
      the log, and that the export size does not follow the stage's
- [x] Mixdown via `OfflineAudioContext` driven by `episodeAudioPlan`
      (`src/core/audio/episodePlan.ts`, built in Phase 10 per §19.5 — one function, two
      consumers) — **done**. `mixdownPlan.ts` decides *what* plays, purely and tested;
      `mixdown.browser.ts` only executes that decision through an `OfflineAudioContext`
      and encodes the result. A segment the plan scheduled but the render could not place
      is reported by name in `missing`, with the reason — a mixdown that silently drops a
      cue is worse than one that fails. The file is WAV: no dependency, no codec, and
      every tool reads it
- [x] Subtitles burned in, matching the stage, with a toggle — **done**. The renderer's
      draw order already includes them and `RenderOptions.subtitles` already gates them,
      so the export's default costs nothing, and the draw-log test proves the default
      matches the stage and the toggle reaches the renderer
- [ ] The video encoder decision, written down — **not built**. An ADR, not an
      implementation: WebCodecs plus a hand-written WebM muxer versus `MediaRecorder`
      as a real-time fallback, with the tradeoffs measured against this renderer.
      RULE 11 applies, so any new dependency needs its argument written first
- [ ] `ExportPanel` with honest capability reporting and progress — **not built**.
      Reports what *this* browser can actually do, per the risk register's
      "Feature-detected and reported honestly; PNG still always available"

Gate: *"every frame of the export is provably the frame the stage already drew, and the
episode plays back as one continuous audio mixdown."*

`docs/MVP.md` check 8 — "export produces a playable video file" — is **not** part of this
gate and will remain unmet, reported as a gap rather than papered over (RULE 9). A PNG
sequence plus a mixdown is a complete, verifiable, codec-free deliverable. Video encoding
is best-effort inside this phase and is not allowed to stand between the phase and its
gate.

Not built here, by this phase's own exclusions: whole-episode assembly with transitions,
title cards and end credits; per-line fades and a full mixing desk; subtitle generation.

---

## POST-MVP — planned

Deliberately not built. Listed so they are not lost, and so nobody re-adds them
by accident during MVP work.

### Phase 14 — ART PIPELINE
Replace vector parts with painted art. `PartDef.shape` already accepts
`{ kind: 'image' }`, so this is primarily a content and tooling task, not a rewrite.
Add: asset import, sprite atlasing, per-part art variants, pose libraries authored
in-app.

### Phase 15 — ANIMATION DEPTH
Pose-to-pose keyframed animation with an eased graph editor, animation clips in the
asset library (reusable across scenes — a direct extension of RULE 2), hold poses,
and onion-skinning.

### Phase 16 — DIALOGUE & AUDIO PRODUCTION
Record or generate voice, align audio to lines, phoneme-level mouth shapes, per-line
gain and fades, ambience beds, music cue sheets, and a real audio mixdown in export.

### Phase 17 — EPISODE ASSEMBLY
Continuous episode render, per-scene camera framing, transitions, title cards,
subtitle/burn-in, end credits.

### Phase 18 — DIRECTOR'S TOOLS
Shot lists, continuity checking (a character in two places at once), staging
checklists, coverage overview, scene-to-scene camera-continuity hints.

### Phase 19 — AI ASSISTANCE (provider-agnostic)
Script breakdown, shot suggestions, staging and expression suggestions, asset
recommendation, subtitle generation. Behind a provider interface; **the editor must
never require a specific AI provider to function.** AI suggests, the creator
approves.

### Phase 20 — PLATFORM
`HttpProjectRepository` behind the existing interface, accounts, collaboration,
review and approval workflows.

### Phase 21 — ZANZA ECOSYSTEM
The same character and world data feeding ZANZA SOCIAL and ZANZA GAME. This is the
reason `core/` is portable and content lives in data: the renderer is swappable and
the document is the shared asset.

---

## RISK REGISTER

| Risk | Phase | Mitigation in place |
|---|---|---|
| Vector art reads as crude | 0 | Palette theming; per-part image swap needs no code change |
| Snapshot history grows | 0 | Hard cap 100; migration to patches is contained to `commit()` |
| `MediaRecorder` codec support | 0 | Feature-detected and reported honestly; PNG still always available |
| Lip sync quality | 8 | Accepted limit; phoneme sync deferred to Phase 16 |
| Local-only storage | 0 | `ProjectRepository` interface is the seam for Phase 20 |
| Scope creep | 0 | RULE 1; this file is the only source of "next" |

---

## CHANGE LOG

| Date | Change |
|---|---|
| 2026-09-27 | Phases 0-6 and 10 complete; 7, 8, 9, 11 partial. Status table corrected — it previously claimed all thirteen phases were done, which was false. |
| 2026-09-28 | Phase 7 keyframe editing: core semantics (clips shift their keyframes; an end trim cuts them), drag-anchored preview fix, double-click to add a keyframe, frame-grid drag, Delete/Backspace, per-lane mute. 186 tests green. |
| 2026-09-29 | Phase 7 **complete**. Track management (`moveTrack`, `relocateClip` core ops) and its UI: add-clip-at-playhead, delete lane, reorder, drag clips to another same-kind lane with the drop lane highlighted. 196 tests green. Current phase is now Phase 8 — Dialogue / audio. |
| 2026-09-29 | Phase 8 mechanism. Web Audio playback scheduled against the store's clock (`audioPlan` + engine + adapter), the dialogue panel, `setDialogueCue`, the per-clip gain slider, the `CC` subtitle toggle, honest "no recording" reporting in the asset library and the panel, and Delete-on-cue taking the line with it. 243 tests green. Phase stays `partial`: no slot has a file, and there is no UI to attach one. |
| 2026-09-30 | Phase 9 **complete**. Rest framing and a seeded-preset picker in the camera panel, plus `frameBounds`, which inverts the renderer's own camera transform; an invariant test holds the two to each other. 329 tests green. |
| 2026-09-30 | Phase 10 **complete**. Pure `timeline/episode` (offsets, resolution, duration) and `audio/episodePlan` (the mixdown offsets Phase 12 will consume); the store's single clock gained a sequence mode that crosses a scene boundary and wraps only at the end of the cut; the stage, transport, and scene list read episode time; a scene boundary is a hard audio cut; spacebar transport. 416 tests green. Numbering reconciled with `ARCHITECTURE_SPEC.md` §24.1 — the old Phase 10 (Animation) is retired as a number and the old Phase 11 (Preview) becomes Phase 10. The post-MVP list below still carries the legacy numbers; §24.1 is the authority. Current phase is now Phase 11 — Project IO & Session Lifecycle. |
| 2026-09-30 | Phase 11 **complete**. `Project \| null` and a project browser, so the workspace is a multi-project one and "no project open" is a first-class state rather than a seed that overwrites itself. Document format v2 (`AudioDef.srcKind`, `Project.metadata`) with a real migration ladder off the empty `MIGRATIONS` array (F8); pure `core/io` import/export/duplicate with fresh project identity and preserved asset ids; the `media` store at `DB_VERSION` 2; quarantine with raw-byte preservation in place of the silent seed overwrite (F5); `visibilitychange`/`pagehide` autosave flush (F4); the audio engine keyed to the project that is open rather than the first one that played, and a resolver that borrows the engine's `AudioContext` instead of minting one per file (F6). Every §5.4 lifecycle operation has UI: create, open, close, switch, duplicate, archive/restore, delete, import, export, create episode, create scene. A new project ships a neutral four-entry starter library (`src/data/starter.ts`) because the invariant requires a character and an environment as soon as there is a scene and there is no asset-authoring UI yet — without it "New project" was a dead button. 565 tests green. Current phase is now Phase 12 — Render Export. |
