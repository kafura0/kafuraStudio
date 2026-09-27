# ZANZA STUDIO — MVP

> The definition of done for the first technical milestone.
> **Milestone statement: a real ZANZA scene, staged, timed, previewed and exported.**

---

## 1. ACCEPTANCE SCENE

`EP001 "RENT IS DUE"` · Scene 1 · `NIA'S APARTMENT` · Nia + Kito · 4 dialogue
lines · expression changes · a walk-on · a camera push-in.

Nia sits on the couch. Kito enters through the door anchor. Nia reacts.

| # | Speaker | Line |
|---|---|---|
| 1 | NIA | "Bro, where have you been?" |
| 2 | KITO | "Building my empire." |
| 3 | NIA | "You owe me rent." |
| 4 | KITO | "...the empire is still in development." |

If this scene can be **staged, timed, previewed at speed, and exported to a video
file**, the system works. Everything else is expansion.

---

## 2. REQUIRED CAPABILITIES

| # | Capability | Status |
|---|---|---|
| 1 | Create / open a project | implemented |
| 2 | Create an episode | implemented |
| 3 | Create / open a scene | implemented |
| 4 | Load a reusable environment | implemented |
| 5 | Load reusable characters | implemented |
| 6 | Place characters in a scene | implemented |
| 7 | Move and scale characters | implemented |
| 8 | Change character pose | implemented |
| 9 | Change character expression | implemented |
| 10 | Add dialogue lines | implemented |
| 11 | Place dialogue on the timeline | implemented |
| 12 | Basic timeline playback | implemented |
| 13 | Basic camera controls | implemented |
| 14 | Basic animation keyframes | implemented |
| 15 | Save project | implemented (IndexedDB + `.zanza.json` import/export) |
| 16 | Load project | implemented |
| 17 | Undo / redo | implemented |
| 18 | Preview scene | implemented |
| 19 | Export a basic scene result | implemented (WebM via MediaRecorder, PNG still) |

---

## 3. EXPLICITLY OUT OF SCOPE

Named here so their absence reads as a decision, not an oversight.

| Not in MVP | Why |
|---|---|
| Frame-by-frame drawing tools | The editor is a *staging and timing* tool, not a raster editor |
| Skeletal rigging / inverse kinematics | Slot-transform override covers limited animation |
| Phoneme lip sync | Per-line mouth shapes plus a talk pulse are enough for now |
| Particle systems, filters, shaders | Off-palette for a sitcom production tool |
| Real audio recording / TTS | Pipeline is real; content is a separate task |
| Cloud, accounts, collaboration | No backend yet (`AGENTS.md` RULE 10) |
| Mobile layout | Desktop production tool, 1440px+ |
| Scene transitions / dissolves | A cut is the sitcom default anyway |
| Drawing directly on the canvas | The stage is a viewport, not a paint surface |

---

## 4. ACCEPTANCE GATE

The milestone ships when **all** of the following are true:

```bash
npm run lint       # clean
npm run typecheck  # clean
npm run test       # green
npm run build      # succeeds
```

**And** the following manual checks pass at 1440p and 1920p:

1. Boot with an empty database → the ZANZA demo project loads.
2. The acceptance scene renders with Nia and Kito in the apartment, correctly layered.
3. Spacebar plays and pauses; the playhead advances; expressions change on cue.
4. Drag Nia → undo (Ctrl+Z) → she returns. Redo (Ctrl+Shift+Z) → she returns again.
5. Select a dialogue clip, drag it 1s later; when the playhead is in that line the
   subtitle shows the moved line.
6. Keyframe a camera zoom-in; play it; the framing changes smoothly.
7. Reload the browser → the project, including edits, is still there.
8. Export produces a playable video file of the scene duration.
9. Export the project JSON, reload the app, import it → identical document.
10. Add a fifth character to the asset library → placeable, animatable and
    renderable **without editing a single line of `core/`**. (RULE 3.)

Check 10 is the load-bearing one. If adding a character requires a code change, the
architecture has failed, regardless of whether the other nine pass.

---

## 5. MEASURE OF SUCCESS

A producer should be able to open the app and, within a few minutes, watch a ZANZA
scene play back at real time with dialogue, expressions and a camera move — and then
export it. Everything after this is refinement: better art, more scenes, more
episodes, lip sync, audio, AI assistance.
