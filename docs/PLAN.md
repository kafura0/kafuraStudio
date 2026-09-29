# ZANZA STUDIO — DEVELOPMENT PLAN

> **Current phase: Phase 8 — DIALOGUE / AUDIO**
> **Not started: Phase 12 — EXPORT**

The plan of record for what gets built next, in what order, and what is
deliberately left alone. Phase *definitions* and *gates* live in
[`ROADMAP.md`](ROADMAP.md); this file is the sequencing, the reasoning, and the
things that would be easy to forget.

[`../AGENTS.md`](../AGENTS.md) RULE 1 forbids implementing a later phase because it
"would be nice". This document is the argument for what comes next, not permission
to skip ahead.

---

## WHERE WE ARE

The engine is finished. The application is not.

| Working | Not built |
|---|---|
| Document model, all operations, invariants | Episode-sequential playback |
| Deterministic renderer | **Export** |
| Keyframe sampling, camera, talk pulse | Preset cameras |
| Seed content: 4 characters, 3 sets, 5 scenes | `.zanza.json` import/export |
| IndexedDB persistence, re-validating on read | Asset editing |
| Undo/redo through one `commit()` | Attaching a file to an audio slot |
| Stage with a 60fps rAF loop | — |
| Timeline: lanes, ruler, playhead, zoom, move/trim, keyframe editing, mute, track add/remove/reorder, drag-to-another-track | |
| Audio: pure plan + Web Audio playback on the store's clock, per-clip gain | |
| Dialogue panel: text, speaker, actor, emotion, subtitle, cue timing, voice | |

243 tests, four gates green. The useful consequence of the layering rule is that the
core can be tested to exhaustion without a browser, so the remaining work is almost
entirely UI and a serialisation-to-media pipeline.

### The defect class that shaped this plan

Three bugs recently passed all 71 tests *and* a clean typecheck — the same class of
bug later found again in the timeline (see Phase 7, where the drag preview fed on
itself and still passed every gate):

- back hair rendered at the frame origin instead of on the head
- `drawParts` discarded `PartDef.pivot`, so every rotated limb turned about its own
  middle instead of its joint
- `addDialogueLineWithCue` copied every clip onto every dialogue track

None of them were visible in a test. All three were found by reading the code
against the model, after the gates were green. That is a real and recurring failure
mode: **a green gate is not evidence of correctness, only of not having checked.**

So: every phase below ends with an **independent review pass**, not just the four
gates. See [Review discipline](#review-discipline).

---

## PHASE 7 — TIMELINE (current)

**Done:** lanes, ruler, playhead, zoom, clip selection, clip move, clip trim,
keyframe editing, per-lane mute, and live undo. The clock question below was decided
and implemented. **Open:** track management (add/remove/reorder) and
drag-to-another-track.

**Built:**

1. [x] Track list, grouped by kind, showing the target's name.
2. [x] Clip lanes with a time ruler and a draggable playhead.
3. [x] Drag a clip to move it in time; drag its edges to trim.
4. [x] Select a clip. Add a keyframe by double-clicking a clip; drag the diamond to
      move it on the frame grid; Delete/Backspace removes the selection. A moved or
      start-trimmed clip carries its keyframes; an end trim cuts the keyframes past
      the cut (asserted in `trackOps.test.ts`).
5. [x] Scrub and play, with the store playhead as the single source of truth.
6. [~] Mute — done, per-lane **M** control. Solo — operation does not exist.

**The clock question, decided.** `Stage` advanced a private clock inside
`requestAnimationFrame` while the store's playhead sat still, so the two could not
agree. The store now owns time and the stage samples from it: `advancePlayback(dt)`
is the only thing that moves the playhead, and the stage, the transport, and the
timeline all read the same value. The store is a subscriber, so a component that
re-renders on the playhead is a 60fps React render — which is why the timeline's
playhead marker is a `requestAnimationFrame` loop writing `transform3d` directly
rather than state.

**Still worth knowing:** a drag holds the clip (or keyframe) in local state and
commits once on release, so one drag is one undo step instead of sixty. The preview
is always derived from the drag-start values, never from the previous preview —
a self-referential preview drifts a few pixels per pointermove.

**Gate:** a user can drag a dialogue clip 1s later, play, and watch the subtitle
change cue. Undo restores the original position. All four build gates green.
**Met** — the subtitle offset is sampled from the clip at the playhead, and the
one-step undo is asserted in `src/ui/panels/Timeline.test.tsx`.

**Fixed along the way:** `TransportBar` derived duration from `project.scenes[0]`
rather than the active scene, so the scrubber was wrong for every scene except the
first. The drag preview accumulated across pointer moves (a second `pointermove`
measured from the first preview instead of the gesture origin), so a two-move drag
overshot; regression test moves twice to the same spot and asserts the clip lands
where the pointer is. A keyframe drag commonly grabbed from the wrong anchor too:
the preview measured from the clip start rather than the keyframe, so a keyframe
sitting mid-clip jumped.

---

## PHASE 8 — DIALOGUE AND AUDIO (current, partial)

**Build:** Web Audio playback scheduled against scene time, mix controls per clip,
subtitle rendering verified, and a dialogue editing panel — text, speaker, emotion,
and the cue's start and duration.

**Constraint:** the audio *assets* ship with `src: null`. The pipeline is real; the
recordings are a production task. Playback must degrade to silence without warnings
or errors, and the UI must say the recording is missing rather than implying a file
exists. Do not fake it with a generated tone — that is a placeholder dressed as a
feature (RULE 9).

**Gate:** pressing play produces audio in time with the picture, and a missing
recording is reported honestly.

**Done:** the pure `audioPlan`; the Web Audio scheduler fed the store's own clock, so
picture and sound cannot drift; the per-clip gain slider; the dialogue panel with
speaker, actor, emotion, text, subtitle override, cue start and duration, voice and
delete; `setDialogueCue`, so a typed number and a dragged clip are the same edit; the
`CC` subtitle toggle; and honest "no recording" reporting from one predicate,
`hasRecording`.

**Not done, deliberately:** there is no UI for attaching a file to a slot, so the
gate's first half cannot be demonstrated on the shipped content. The mechanism is
tested against a fake `AudioPort` and stays silent until content exists. A file-attach
flow is the next piece of this phase: the engine already resolves and decodes whatever
`src` holds, so what is missing is picking a file and writing the asset through
`commit()`.

---

## PHASE 9 — CAMERA

**Build:** shot presets and a camera panel. Rest camera and keyframed moves already
resolve and render; nothing exposes them.

**Gate:** a keyframed zoom plays smoothly and the camera panel can author one.

---

## PHASE 10 — ANIMATION (complete)

**Done.** Keyframes, linear and step interpolation, per-channel holds, and the talk
pulse live in `src/core/animation/` and `src/core/render/`, are pure, and are
covered by `sample.test.ts`, `sparse.test.ts`, and `parts.test.ts`.

Selection and keyframe editing are **not** a separate phase. They are part of the
Phase 7 timeline UI, because a timeline whose clips cannot be selected is a readout
rather than an editor. Selection is done; keyframe editing is not, and it is the
main thing left in this phase.

---

## PHASE 11 — PREVIEW

**Build:** episode-sequential playback across all five scenes, with correct scene
transitioning and a playhead that spans scenes rather than restarting.

**Gate:** EP001 plays start to finish with dialogue, expressions, and camera moves.

---

## PHASE 12 — EXPORT (not started)

The milestone's actual deliverable, and the one with no code behind it at all.

**Build, in this order:**

1. **PNG still** of the current frame. Smallest useful export; proves the pipeline.
2. **Project JSON** (`.zanza.json`) import and export. Also the cleanest test of
   the serialization round trip, and it is needed to move projects between machines.
3. **WebM video** via an offscreen canvas and `MediaRecorder`.

**The export trap.** `MediaRecorder` captures a canvas in real time; it cannot
render faster than the scene plays. A naive implementation takes as long as the scene
is long and drops frames under load. The options are real-time capture, a frame-step
approach with a paused recorder, or `WebCodecs` with a muxer. Decide with the
3-second acceptance scene in mind, and write the decision down here. Do not discover
this during implementation.

**Gate:** export produces a playable video file of the scene's duration, verified by
playing it.

---

## PHASE 13 — POLISH

Success is the MVP acceptance gate in [`MVP.md`](MVP.md) §4, not new features. All
ten manual checks at 1440p and 1920p.

---

## SEQUENCING AND WHY

**The path to deployment is Phases 7 to 12, in order.** Phase 7 makes the document
manipulable, 8 and 9 add the content lanes, 11 adds playback, and 12 adds export.
Polishing before 12 ships means polishing an editor that cannot produce the thing it
exists to produce, so 13 is deliberately last.

Note that "deployed" and "usable" are different milestones. The app is deployable
today — it is a static bundle with no backend, and [`DEPLOY.md`](DEPLOY.md) covers
building and hosting it. A deployed build at the end of Phase 12 is the first one
that can actually export an episode, which is the real deliverable. Do not describe
a Phase 7 build as a finished product, because it is not one.

**Why Phase 7 is first.** Everything the user does next flows through the timeline.
Audio timing, camera authoring, episode playback, and export all read from tracks
and clips. Building them on a document model that has never been exercised by a
human dragging anything is how you discover the model was wrong.

**Why export is last but not optional.** It is the milestone, and it is the phase
most likely to be underestimated. The `MediaRecorder` decision above is the kind of
thing that should be a documented choice made early and revisited, not a surprise at
the end. It is called out here so it is not a surprise.

**Why audio is after the timeline.** Playback is a consumer of the same clock the
timeline defines. Building the clock twice is how they drift.

**What is deliberately not being built** (from `MVP.md` §3, repeated so it is not
re-litigated): frame-by-frame drawing tools, skeletal rigging and IK, phoneme lip
sync, particles, real audio recording and TTS, any backend, mobile layout, scene
dissolves, and drawing directly on the canvas.

---

## REVIEW DISCIPLINE

New in this plan, and the reason the last three defects are not a pattern we keep
rediscovering.

**At every phase gate, in this order:**

1. `npm run verify` — the four build gates. Necessary, not sufficient.
2. **An independent review pass** over what changed, from a context that did not
   write it. Two questions to put to it: *which branches and boundaries are
   unhandled?* and *which claims in the docs are false?*
3. Fix what it finds, with a regression test per confirmed defect.
4. Update `ROADMAP.md` status honestly. A phase is `complete` only when its gate is
   demonstrably met.

Rationale is short. Self-review missed three real defects that the gates accepted.
The gates check that code compiles and that asserted behaviour holds; they cannot
check that the assertions were the right ones. An independent pass can.

---

## RISKS

| Risk | Impact | Mitigation |
|---|---|---|
| Timeline playhead and stage clock disagree | Playback is unusable, and the bug is intermittent | **Resolved** — the store owns time; both read it |
| `MediaRecorder` cannot render faster than real time | Export is unreliable or drops frames | Decide the approach during Phase 12 design, with the 3s scene as the test case |
| Audio assets have no recordings | Playback is silent in the demo | Report missing recordings honestly; content is a production task, not a code task |
| UI is built on core that hides defects | Defects surface late, when they are expensive | Review pass at every gate, as above |
| No lint rule enforces the layering | `core` could start importing `ui` or `data` | `AGENTS.md` §3 requires a rule or a review. **Currently neither exists.** See below. |
| Scope creep into the renderer | A drawing tool starts appearing | The stage is a viewport, not a paint surface. This is not negotiable. |

### Known gap: layering is unenforced

`AGENTS.md` §3 states that imports flow downward only and that "a lint rule or
review must catch any upward import". Today **neither exists** —
`eslint.config.js` has no boundary rule, so nothing but reviewer diligence keeps
`src/core` free of `ui`, `state`, and `data`.

This is the cheapest high-value item in the plan and it is not scheduled. It should
be done before Phase 7, because Phase 7 is the first phase that will tempt someone to
import a store hook into a core module to get the playhead.

---

## DEFINITION OF DONE

Per phase, from `AGENTS.md` §4:

- [ ] Works in the running app, verified manually at 1440p and 1920p
- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm run test` green, with new tests for new logic
- [ ] `npm run build` succeeds
- [ ] Independent review pass completed and findings resolved
- [ ] Every mutation undoable
- [ ] No hardcoded character or set names in generic code
- [ ] Docs updated: `ROADMAP.md` status, and this plan if the sequencing changed
- [ ] Commits small and logical, one concern each
