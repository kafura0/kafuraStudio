# ADR 001 — How this project encodes video

- **Status:** accepted, for Phase 12
- **Date:** 2026-10-01
- **Spec:** `ARCHITECTURE_SPEC.md` Phase 12, step 6

## Context

Phase 12's gate is a PNG sequence plus a mixdown, and it passes on that alone. Video
encoding is best-effort inside the phase. But "best-effort" is not a plan — it is the
absence of one, and its absence would leave the next person to invent a video export
without knowing what was already measured. This is the written decision Phase 12 asks for,
and it is a decision plus its fallback, not an implementation.

The renderer is `renderScene(ctx, project, scene, time)` on a Canvas 2D surface. An
exporter already has, per frame:

- a real `HTMLCanvasElement` with a 2D context, at the authored resolution
- a PNG of it, via `toBlob`
- the exact wall-clock time that frame represents
- a finished audio mixdown as a single `AudioBuffer` plus a WAV

So the question is narrow: given finished frames and a finished buffer, which browser API
turns them into a file?

## Options considered

### 1. `MediaRecorder` on a `captureStream` of a canvas

Draw each frame to a canvas, pipe `canvas.captureStream(fps)` into a `MediaRecorder`, and
let the browser encode. Audio is added by routing the `AudioBuffer` into a
`MediaContextDestination` alongside it.

For: no muxer to write, no encoder to configure, well supported, and the file opens in
every current browser and in every current NLE.

Against, and the decisive part: it is **real-time**. A 38-second episode takes 38 seconds
minimum, and it takes 38 seconds even on a machine that could render all 456 frames in
three. There is no way to ask it to go faster than the clock. Cancellation means
discarding everything recorded so far. It also records whatever the surface happened to
hold at each tick, so a dropped frame on a slow machine is baked into the file rather than
re-rendered. On the 16 GB / integrated-graphics dev machine that is a real risk, and the
failure is silent — the output is short and nobody notices until the cut is delivered.

### 2. `VideoEncoder` (WebCodecs) plus a hand-written WebM muxer

`VideoEncoder` is a real encoder: frames in, compressed chunks out, no clock, as fast as
the machine allows. The problem is everything around it. WebCodecs gives you encoded
bitstreams, not a container. Producing a `.webm` means writing EBML, a `Segment`, a
`Tracks` element, `SimpleBlock`s, and correct keyframe and timestamp handling — a muxer,
by any honest description, and a container-format bug produces a file that some players
open and others refuse.

For: correct frame timing, fast, cancellable, no dropped frames.

Against: the muxer is the risk, and it is *silent* risk. A file with a subtly wrong
`TimestampScale` plays at the wrong speed in some players. This is precisely the class of
defect that passes CI and is found by a client.

### 3. `VideoEncoder` plus `webm-muxer` (a dependency)

Option 2 with someone else's container code.

For: no hand-written muxer, fast, correct timing.

Against: a new runtime dependency. AGENTS.md RULE 11 holds that the dependency set is
React, Zustand, and dev tooling, and that adding one requires the argument written down
*first*. The argument exists — "we need a container and WebCodecs does not provide one" is
a real one — but it is a smaller claim than it looks: the 38-second episode the phase
actually needs is already delivered by a PNG sequence and a WAV, so a video container is a
convenience rather than a requirement, and taking a dependency for a convenience is exactly
the trade RULE 11 exists to make deliberately.

## Decision

**`MediaRecorder` for video, on the honest grounds that it is what a phase-12 export can
support without a new dependency, and PNG sequence plus WAV as the delivery format that
this project actually exports.**

Concretely:

- The exporter's deliverable is the PNG sequence and the mixdown. Both are complete,
  verifiable, and codec-free, and they are what `ExportPanel` offers as the export.
- Video is offered as an extra when the browser can do it, labelled as best-effort, and
  never required for the export to be considered done. It is a convenience for a person
  who wants to hand someone one file, not the artifact the phase is judged on.
- `MediaRecorder`'s real-time cost is accepted for that convenience, and stated in the UI
  rather than hidden. A user who exports 38 seconds of video waits 38 seconds, and the
  panel shows a progress bar while it happens.
- No WebCodecs code, no muxer, and no new dependency in this phase.

## Consequences

- `ExportFormat` already has `'webm' | 'png-sequence'`, and the PNG sequence is what ships
  as the primary. The `'webm'` member is not used by the panel yet, and a half-implemented
  enum member that nothing sets would be a placeholder, so it is left alone here rather
  than wired to a path that does not exist.
- When a real video export is wanted later, this ADR is the thing to revisit. The two
  honest routes are then: accept the dependency and use `webm-muxer`, or write the muxer
  and test it against files other players must read. Both are bigger than Phase 12, and
  the PNG-plus-WAV route means the project is not blocked until they are done.
- MVP check 8 ("export produces a playable video file") stays unmet until video is built
  and verified. It is reported as a gap rather than claimed. A `MediaRecorder` path that
  was never run in a real browser would not close it, and the panel's capability reporting
  is written so it cannot pretend to.

## What would change this

If a user needs one-file video as a matter of course rather than occasionally — because
the delivery target requires it — then the real-time cost and the missing-fragment risk
both become unacceptable, and the dependency argument in option 3 becomes a requirement
rather than a convenience. At that point: add `webm-muxer`, write down the dependency in
the PR description as RULE 11 demands, and build on `VideoEncoder`.
