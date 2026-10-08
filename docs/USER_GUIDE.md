# ZANZA STUDIO — USER GUIDE

> **Scope warning.** This guide documents the application **as it exists today**,
> which is a working engine with a live timeline, a dialogue editor, and audio
> playback behind a shell. There is no export, no way to add or remove content from
> the asset library, and no way to attach an audio file to a slot. Sections marked
> **Not available** name what is planned and where it is planned. Nothing in this
> guide describes a feature that is mocked, and no disabled control pretends to
> work.

If you are evaluating whether this is finished: it is not. See
[`../README.md`](../README.md) § STATUS and [`PLAN.md`](PLAN.md).

---

## 1. WHAT YOU ARE LOOKING AT

```
+--------------------------------------------------------------+
| ZANZA  EP001 ...  Undo Redo Save  [Play] [===] 0/10s   CC  |  <- transport
+----------+---------------------------------------------------+
| Scenes   |                                                   |
|  SC01    |                                                   |
|  SC02    |                  THE STAGE                       |
|  SC03    |              (what the scene looks like)         |
|  SC04    |                                                   |
|  SC05    |                                                   |
|----------|                                                   |
| Dialogue |                                                   |
|  1.2s Nia|                                                   |
|  >Bro, w.|                                                   |
|  Speaker |                                                   |
|  [Nia  ] +---------------------------------------------------+
|  Line    | 0  1  2  3  4  5  6  7  8  9  10s       <- ruler |
|  [.....] | [======]        [=========]     [=========]      |
|  Cue     | [D][D]  [A][A][A]  [E][E][E]                     |  <- lanes
|  Gain    |  Validation issues (empty when healthy)            |
|  Voice   |                                                   |
|----------|                                                   |
| Assets   |                                                   |
|  (read-  |                                                   |
|   only)  |                                                   |
+----------+---------------------------------------------------+
```

| Region | What it is |
|---|---|
| **Transport bar** (top) | Playback, undo/redo, save, the playhead scrubber, the subtitle toggle |
| **Scene list** (left, top) | The five EP001 scenes. Click to open one. |
| **Dialogue panel** (left) | The lines of the open scene, and the editor for the selected one. See § 4c. |
| **Asset panel** (left, bottom) | The project's asset library. **Read-only today.** |
| **Stage** (centre) | A live render of the current scene at the current playhead |
| **Timeline** (below the stage) | Lanes, ruler, playhead, and clip move/trim. See § 4b. |
| **Issue panel** (bottom) | Validation problems. Empty means the document is sound. |

The left column scrolls. The stage is a fixed width, so it gets the space it needs
rather than sharing it with an inspector.

---

## 2. STARTING THE APP

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. See [`DEPLOY.md`](DEPLOY.md) for hosting a built
copy.

The app opens the EP001 demo project so there is something on screen immediately.

---

## 3. THE STAGE

The stage is a **viewport, not a paint surface.** You cannot draw on it, and that is
deliberate — this is a staging and timing tool, not a raster editor.

It redraws continuously from the current playhead, so expressions, camera moves, and
character animation all show up as you move the scrubber.

The stage renders at 1920×1080 (the project setting) and is displayed at 960 px wide.
It is not yet responsive to window size.

### Reading a scene

- **Nia** and **Kito** are staged in the apartment. Kito walks in during scene 1.
- Subtitle text appears along the bottom when a dialogue line is under the playhead.
- The camera pushes in slightly during scene 1.
- When a character has a line under the playhead, their mouth opens and closes on a
  talk pulse. This is a placeholder for real lip sync, which is out of scope.

---

## 4. TRANSPORT

| Control | Effect |
|---|---|
| **Play** | Starts the current scene looping from its current playhead |
| **Pause** | Stops playback |
| **Scrubber** | Moves the playhead. The stage redraws to match |
| **Timecode** | Current playhead and scene duration, in seconds |
| **CC** | Shows or hides the subtitle bar. A view preference, so it is not an undo step |

The scrubber range and the duration in the timecode both come from the scene you
have open, not the first scene in the list.

Playback runs on one clock, held in the store. The stage advances it, the transport
reads it, and the timeline playhead reads it, so they cannot drift apart. The stage
and the timecode update on every frame, but the timeline playhead does not
re-render React to do it — it moves via `requestAnimationFrame` and a direct
`transform3d`, so scrubbing playback does not re-render the panel sixty times a
second.

---

## 4b. THE TIMELINE

Below the stage. One lane per track, clips laid out by their start time and
duration, diamond markers for keyframes.

| Control | Effect |
|---|---|
| **Ruler** | Click to move the playhead. Drag to scrub |
| **Zoom** | `-` / `+`, or the zoom buttons. 4–480 px per second |
| **Clip** | Click to select. Drag the body to move it, drag either end to trim it. **Delete / Backspace** removes it |
| **Keyframe** | **Double-click a clip** to pin the pose it draws at that moment; the diamond lands on the frame grid. **Drag a diamond** to move it in time — it snaps to frames. **Delete / Backspace** removes the selected keyframe |
| **Track** | Each track's name row has controls: **`+`** drops a 1-second clip on that track at the playhead; **`×`** deletes the track (a dialogue track takes its line with it); **`↑` / `↓`** reorder; **M** silences every clip on it for playback |
| **Between tracks** | Drag a clip onto a lane of the same kind to move it to that track; the target lane highlights while you are over it. A lane of a different kind ignores the drop |
| **Playhead** | The red line. Matches the stage and the timecode exactly |

A drag is a single undo step, not one per frame: the clip (or keyframe) follows the
pointer while you drag, and the document is written once when you let go.

Snapping applies to the start of a moved clip and to a trimmed start, against clip
edges and whole seconds. Hold `Alt` while dragging to turn it off. Keyframes snap
to the frame grid (at the project's frame rate).

When a clip moves or its start edge trims, its keyframes travel with it — the
animation is content, not wallpaper. Trimming the *end* edge off a clip cuts the
keyframes that the cut reveals as well.

The timeline is live. It shows the scene you have open, and edits a clip in place —
there is no separate "edit mode" and no second representation of the same data.

**Delete on a dialogue cue deletes the line.** A cue is the timing of a line, so
removing the clip alone would leave the text in the script with nothing that ever shows
or plays it. The line, its cue, and the lane that existed only to hold it all go
together, in one undo step.

---

## 4c. THE DIALOGUE PANEL

Left column, under the scene list. It lists the open scene's lines in cue order, and
**`＋`** adds a new line at the playhead.

Click a line — in the list, or by selecting its clip in the timeline — to edit it:

| Field | Effect |
|---|---|
| **Speaker** | The name on the line. Free text, so a character can be credited before they are staged |
| **Actor** | Which staged character is saying it. Drives the talk pulse |
| **Emotion** | Free text, with the project's own expression names offered as suggestions |
| **Line** | The spoken text. This is what the subtitle shows unless overridden |
| **Subtitle** | Overrides the burnt-in text. **Use line text** puts the line text back |
| **Cue** | The line's start and duration, in seconds. The same edit as dragging the clip |
| **Go** | Moves the playhead to the start of that cue |
| **Gain** | The cue's level, 0 to 2. Silence is 0, unity is 1 |
| **Voice** | Which audio slot this line is spoken by. See § 6 |
| **Delete line** | Removes the line, its cue, and its lane, in one undo step |

Text fields commit when you click away from them, not per keystroke, so a typed line is
one undo step rather than one per letter. The gain slider commits when you let go, for
the same reason.

Everything here goes through the same document operations as the timeline and the same
`commit()` path, so `Ctrl+Z` reaches all of it.

---

## 5. SCENES

Click any scene in the list to open it. The stage switches immediately and the
playhead is preserved.

The five scenes of EP001, *Rent Is Due*:

| # | Scene | Beat |
|---|---|---|
| 1 | SC01 — Bro, Where Have You Been? | The rent conversation |
| 2 | SC02 — Terms and Conditions | The landlord arrives |
| 3 | SC03 — Outside | On the street |
| 4 | SC04 — The Lounge | The empire conversation |
| 5 | SC05 — Mama Nia Calls | Mama Nia rings |

**Not available:** creating, renaming, reordering, duplicating, or deleting scenes
through the UI. The document operations for all of these exist and are tested; no
control calls them yet.

---

## 6. THE ASSET PANEL

Lists everything the project defines: characters, environments, poses, expressions,
props, and audio cues.

It is **read-only**. The panel says so, and there is no editing control that does
nothing — an inoperative button would be a placeholder dressed as a feature.

| Library | Count | Notes |
|---|---|---|
| Characters | 4 | Nia, Kito, Mama Nia, The Landlord |
| Environments | 3 | Nia's Apartment, Zanza Street, Zanza Lounge |
| Poses | 15 | Shared across the whole cast by design |
| Expressions | 12 | Shared across the whole cast by design |
| Props | several | Phone, sofa, laptop, and so on |
| Audio | several | **Every entry has no recording.** See below |

### Why one rig and one set of poses for everyone

A character-specific rig would mean re-authoring every pose for every character.
Instead, all four characters are built from a shared humanoid rig and differ only by
proportions and colour palette, so a single pose works on all of them. This is the
reason the asset library scales to 100+ uses, and it is enforced by a test: see
`src/data/rule3.test.ts`.

### Audio plays, but no slot has a recording behind it

Audio **playback exists**: pressing play schedules every audio and dialogue clip on the
open scene against the playhead, applies the per-clip gain, loops ambience beds, and
mutes a muted lane. It is driven by the same clock as the picture, so sound and stage
cannot drift apart.

Every audio entry still ships with **no file attached**, so the demo is silent. The
panel says so in two places — the asset library marks each slot **no recording**, and
the dialogue panel says **No recording: this slot declares a voice but has no file. Plays
silent.** A generated placeholder tone would be indistinguishable from a real recording
in a demo, and would be a lie about the state of the project. Recording the ZANZA cast
is a production task, not an engineering one.

**Not available:** attaching a file to a slot, ambience beds you can author, per-line
fades, and any real mixdown in export.

---

## 7. UNDO, REDO, AND SAVE

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+S` / `Cmd+S` | Save to the browser's local database |

Undo and redo work by snapshotting the whole document, capped at 100 steps (fewer
when the document grows large, so history stays within a memory budget).

Undo and redo are live. Moving or trimming a clip in the timeline is the first control
to change the document, and each completed drag is one step. The buttons enable
themselves as soon as there is something to undo, and the keyboard shortcuts work
whether or not the buttons are enabled.

If undo appears disabled it is because the history is genuinely empty — nothing has
changed the document yet in this session. Every mutation goes through `commit()`;
there is no second path that edits the document behind the history's back.

Ctrl+S does work: it writes the current project to IndexedDB.

### Where your work is stored

In your browser's IndexedDB, per origin. This means:

- Clearing site data erases your projects.
- Projects do not sync between browsers or machines.
- Opening the app from a different URL or port is a different database.
- There is no server and no account (`AGENTS.md` RULE 10).

**Not available:** exporting a project file, importing one, or any cloud sync. Until
that ships, there is no way to move a project off the machine that made it.

---

## 8. THE ISSUE PANEL

Runs the project through the validator and lists anything wrong: a reference to an
asset that does not exist, a clip that runs past the end of its scene, a keyframe
outside its clip, and so on.

**When it is empty, the document is sound.** The seed project opens with no issues.

The document is also validated on every mutation, so an edit that would break an
invariant is refused rather than committed. If the panel ever fills up during normal
use, that is a bug worth reporting.

---

## 9. NOT AVAILABLE

Everything below is planned and unscheduled, or scheduled. None of it works.

| Feature | Where planned |
|---|---|
| Editing actors and assets: move, scale, pose, expression, anchor binding, add or remove a character | Phase 14 / 15 (post-MVP) |
| Attaching a file to an audio slot, importing audio | Phase 8 (current phase) / 16 |
| Camera presets and a camera panel | Phase 9 |
| Episode-sequential playback | Phase 11 |
| PNG still, project JSON import/export, video export | Phase 12 |

If you need any of these, the honest answer is that they are not built. Nothing in
this application is a stub waiting to be filled in; the missing pieces have not been
started.

---

## 10. TROUBLESHOOTING

**The stage is blank or the scene list is empty.**
The project failed to load from IndexedDB. Open DevTools → Application → IndexedDB
and delete the database, then reload to reseed from the in-memory seed project. This
also discards any saved edits.

**"This project has no scenes yet."**
The loaded document has no scenes. Almost always the result of a failed or corrupt
load; delete the database as above.

**The issue panel is full of errors.**
Something has written an invalid document — usually a hand-edited `.json` import, once
import exists. Until then, this indicates a bug. Please report it with the scene id
and the issue text.

**Undo and Redo are greyed out.**
Expected only if you have not changed anything yet — editing a clip or a line is what
fills the history. If it is greyed out after you have edited, that is a bug. See § 7.

**The timecode does not match the scene length.**
That is a bug. The timecode is supposed to read the scene you have open. Please report
it with the scene id.

**Audio is silent.**
Expected until a recording is attached to a slot — see § 6. The asset library and the
dialogue panel both say which slots are empty. If a slot reports a file and is still
silent, that is a bug; check the browser console, which logs the fetch or decode
failure.

**A line's subtitle does not appear.**
The line's cue has to be under the playhead, and the cue is what the timeline lane shows.
Check the lane is not muted, and that the `Cue` start in the dialogue panel is where you
think it is.
