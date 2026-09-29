# ZANZA STUDIO — ROADMAP

> **Current phase: Phase 8 — DIALOGUE / AUDIO**

Canonical phase list. `AGENTS.md` RULE 1 forbids implementing any phase marked
`planned` until the current one is complete and its gates pass.

Phase *definitions and gates* are here. Sequencing, reasoning, and the review
discipline are in [`PLAN.md`](PLAN.md).

Status is reported honestly (RULE 9). A phase is `complete` only when its gate is
demonstrably met — a control that renders but does nothing is `partial`, not
complete.

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
| 8 | Dialogue / audio | **partial** | Web Audio playback scheduled against the playhead, per-clip gain, and a dialogue panel that edits speaker, actor, emotion, text, subtitle, cue timing and voice — all through one undoable `commit()` per gesture. Missing recordings are reported honestly in the UI. There is no way to attach a file to a slot, and no audio is authored. |
| 9 | Camera | **partial** | Rest camera and keyframed moves resolve and render. No shot presets, no camera UI. |
| 10 | Animation | **complete** | Keyframes, interpolation, per-channel holds, talk pulse |
| 11 | Preview | **partial** | The stage loops one scene via rAF. No episode-sequential playback, no transport UI beyond play/pause. |
| 12 | Export | **planned** | Nothing written. Not started. |
| 13 | Polish | **planned** | Not started. |

### What exists today
Verified by `npm run lint && npm run typecheck && npm run test && npm run build`:

243 tests green, all four gates clean.

- Pure core: types, geometry, keyframe sampling, document operations, invariants,
  versioned serialization, and a deterministic Canvas 2D renderer.
- Audio: a pure `audioPlan` turning timeline clips into audible segments, and a Web
  Audio scheduler fed the store's clock, so picture and sound cannot drift.
- Persistence: `ProjectRepository` + IndexedDB, re-validating on read.
- Content: shared rig builder, 4 characters, 3 environments, poses, expressions,
  props, declared audio slots, and the EP001 seed project — which validates with
  zero invariant issues and renders every one of its five scenes.
- Editor: Zustand store with snapshot undo/redo through a single `commit()` path,
  debounced autosave, and a canvas stage that redraws without re-rendering React.
- UI: scene list, read-only asset library, transport bar with a subtitle toggle,
  a dialogue panel, the timeline, and the issue panel.

### What is deliberately not built

Asset editing, attaching files to audio slots, episode playback, and export. These are
the phases above, not gaps in the ones below.

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
- [ ] Attaching a file to an audio slot — **not built**. The engine resolves and
      decodes whatever `src` holds, and there is no UI that sets it; the honest state
      is reported instead
- [ ] Episode-sequential playback and a real mixdown — Phase 11 and Phase 12

Gate: *"pressing play produces audio in time with the picture, and a missing recording
is reported honestly."* The second half is demonstrated. The first half cannot be
demonstrated on the shipped content, because no slot has a file — the mechanism is
implemented and tested against a fake `AudioPort`, and stays silent until content
exists. The phase is left `partial` for that reason, not `complete`.

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
