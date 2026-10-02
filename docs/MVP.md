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

If this scene can be **staged, timed, previewed at speed, and exported to a playable
file**, the system works. Everything else is expansion.

"Playable file" is doing real work in that sentence, and it is the one part of the
milestone that is not met. What ships today is a PNG sequence plus a WAV mixdown: a
frame-accurate, shareable result that any tool can turn into a video, but not a video
this application produces. `docs/adr/001-video-encoding.md` records the decision not to
take a browser-dependent `MediaRecorder` path.

---

## 2. REQUIRED CAPABILITIES

Status is reported honestly (AGENTS.md RULE 9). **model** = the document model,
operations and renderer support it and it is tested. **UI** = a control exists the
user can actually operate. A capability is only `implemented` when both are true.

| # | Capability | Model | UI | Notes |
|---|---|---|---|---|
| 1 | Create / open a project | done | done | Project browser: create, open, close, duplicate, archive/restore, delete. Nothing is auto-opened on launch — the list is the startup screen |
| 2 | Create an episode | done | done | `+ Episode` on each project row; undoable when that project is the open one |
| 3 | Create / open a scene | done | done | `+ New scene`, and an empty project offers "Add the first scene". A new scene starts with a background and no actors (see 6/7) |
| 4 | Load a reusable environment | done | done | 3 environments render |
| 5 | Load reusable characters | done | done | 4 characters, all placeable |
| 6 | Place characters in a scene | done | done | Via seed; no drag-to-place yet |
| 7 | Move and scale characters | done | none | `setActorTransform` / anchor binding exist |
| 8 | Change character pose | done | none | `setActorPose` exists |
| 9 | Change character expression | done | none | `setActorExpression` exists |
| 10 | Add dialogue lines | done | done | `DialoguePanel` adds a line at the playhead, with its cue on the dialogue lane |
| 11 | Place dialogue on the timeline | done | done | "Add clip at playhead" on the dialogue lane; timing lives on the clip, by design |
| 12 | Basic timeline playback | done | done | Transport play/pause and scrubber, plus spacebar. One store clock drives stage, transport, and timeline playhead |
| 13 | Basic camera controls | done | done | Keyframed moves render; rest framing is authored numerically; seeded shot presets apply in one undoable step; a selection can be framed to fit |
| 14 | Basic animation keyframes | done | done | Add/move/delete on the timeline; keyframes travel with moves and start trims; an end trim cuts them |
| 15 | Save project | done | done | IndexedDB persists; `.zanza.json` import/export from the browser, plus Ctrl/Cmd+S |
| 16 | Load project | done | done | Hydrates on start, re-validates and migrates on read; an unreadable record is quarantined and reported, not overwritten |
| 17 | Undo / redo | done | done | One `commit()` path; one step per drag/gesture; bound to Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z |
| 18 | Preview scene | done | done | Play/pause, a scrubber, and spacebar; episode-sequential playback across the whole cut, or a scene loop on demand |
| 19 | Export a basic scene result | done | done | A cut exports to a PNG sequence at the episode's authored size plus one continuous 16-bit/48 kHz stereo WAV mixdown, with subtitles burned in. **No single-file video** — see check 8 and `docs/adr/001-video-encoding.md` |
| 20 | Attach a recording to an audio slot | done | done | `AudioSlotPanel` stores the bytes in the media store and sets `srcKind: 'local'` |
| 21 | Put a scene in a cut, and a sound in a scene | done | done | From the editor, both undoable. Refuses an audio slot with no file rather than placing silence |

The MVP gate is **not met**, and the reason is narrow: check 8 wants a playable video
file, and no muxer is present. Rows 7, 8 and 9 still have no UI — the operations exist
and are tested, and an actor can be placed, posed and expressioned through the seed
project and the timeline, but there is no per-actor inspector to drag, pose or
expression from. That is the honest state of those three.

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

1. Boot with an empty database → the project browser appears, and "New project" →
   "Open" gives an empty editor that can take its first scene.
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
11. Press play from the first frame of scene 1 → EP001 runs through to the last frame
    of scene 5, and the playhead keeps climbing across all four scene boundaries
    instead of snapping back to zero.
12. Open project A, edit it, switch to project B, switch back → the edit is there, and
    B has no trace of A's history, selection or audio.

Check 10 is the load-bearing one. If adding a character requires a code change, the
architecture has failed, regardless of whether the other checks pass.

**Current status: not met, on check 8 alone.** The four build gates pass — lint clean,
typecheck clean, 744 tests green across 51 files, build succeeds.

*Automated.* Check 9 (round-trip the project JSON) in `src/core/io/projectIo.test.ts`.
Check 12 (no history or selection bleed between projects) in
`src/state/editorStore.lifecycle.test.ts`. Check 3 (spacebar), 4 (undo/redo), 10 (RULE 3)
and 11 (episode playback) are implemented and automated. Check 10 is the one the design
is built for: `src/data/rule3.test.ts` adds an unknown character to the production
project, stages it, keys it, poses it, gives it an expression and renders it, with
`validateProject` clean throughout and no `core/` file touched.

*Walked in a real browser.* Checks 1, 2, 5, 6 and 7 were walked at 1920×1080 by the
Phase 11 acceptance run (44/44). Phase 12's export was walked at 1920×1080 (47/47): a cut
exports to 288 PNGs at the episode's authored 1920×1080, correctly ordered and non-empty,
the first and last of which decode to non-blank images, and to one continuous 12.000s WAV
with no silence and no clipping. Cancellation works and export does not mutate the
project. Phase 11's migration path was walked separately (35/35).

*Not passing.* Check 8 wants a playable video file. Phase 12's gate is deliberately a PNG
sequence plus a mixdown rather than a video, so this remains unbuilt and is reported as a
gap rather than claimed. Check 4's drag leg is the other thing no automated run covers:
undo and redo are tested through the store, and the browser run confirms the keystrokes
and the timeline drag, but no script drives a pointer drag on the stage, because there is
still no per-actor drag handle to drag.

---

## 5. MEASURE OF SUCCESS

A producer should be able to open the app and, within a few minutes, watch a ZANZA
scene play back at real time with dialogue, expressions and a camera move — and then
export it. Everything after this is refinement: better art, more scenes, more
episodes, lip sync, audio, AI assistance.
