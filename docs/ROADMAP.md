# ZANZA STUDIO — ROADMAP

> **Current phase: Phase 13 — POLISH (in progress)**

Canonical phase list. `AGENTS.md` RULE 1 forbids implementing any phase marked
`planned` until the current one is complete and its gates pass.

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
| 7 | Timeline | **complete** | Tracks, clips, keyframes, transport, scrubbing, snapping |
| 8 | Dialogue / audio | **complete** | Dialogue lines, subtitles, audio clips, Web Audio playback |
| 9 | Camera | **complete** | Rest camera, keyframed moves, shot presets |
| 10 | Animation | **complete** | Keyframes, interpolation, talk pulse |
| 11 | Preview | **complete** | rAF playback loop, episode sequential playback |
| 12 | Export | **complete** | PNG still, WebM video, project JSON |
| 13 | Polish | **in progress** | Lint/typecheck/test/build green, MVP acceptance gate passed |

---

## PHASE 13 — POLISH (current)

The final phase of the MVP. Success is the acceptance gate in `docs/MVP.md` §4,
not new features.

- [x] `npm run lint` clean
- [x] `npm run typecheck` clean
- [x] `npm run test` green — unit + integration
- [x] `npm run build` succeeds
- [x] Undo/redo covers every mutation path in the UI
- [x] Autosave survives a hard reload
- [x] Export verified end-to-end in Chromium
- [x] A fifth synthetic character is placeable with zero `core/` changes (RULE 3 test)
- [x] Docs match the implementation

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
| 2026-09-27 | Phases 0-13 implemented. MVP acceptance gate passed. Phase 14 next. |
